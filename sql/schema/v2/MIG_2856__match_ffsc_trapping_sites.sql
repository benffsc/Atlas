-- MIG_2856: Match FFSC trapping sites to places (FFS-263)
--
-- Problem: ~150 trapping sites in ops.v_ffsc_trapping_sites have extracted
-- location names (e.g., "West School Street", "1823 Larry Dr.") but no place
-- links. Cats at these sites are invisible on the map.
--
-- Approach:
-- 1. Create staging table with cleaned/classified locations
-- 2. Dedup doubled names (ClinicHQ concatenates first+last, often identical)
-- 3. Auto-match addresses to existing places via normalized_address
-- 4. Create new places for unmatched addresses
-- 5. Match business names by display_name
-- 6. Exclude person names (known trappers/staff)
-- 7. Link matched appointments
-- 8. Create monitoring view
--
-- Depends on: MIG_2855 (ffsc_program classification, v_ffsc_trapping_sites view)

BEGIN;

-- =============================================================================
-- Step 1a: Create staging/review table
-- =============================================================================

CREATE TABLE IF NOT EXISTS ops.ffsc_trapping_site_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_name TEXT NOT NULL,
    extracted_location TEXT NOT NULL,
    cleaned_location TEXT,
    location_type TEXT,      -- 'address', 'business', 'person_name', 'ambiguous'
    cat_count INTEGER,
    matched_place_id UUID REFERENCES sot.places(place_id),
    match_method TEXT,       -- 'normalized_address', 'display_name', 'created_from_address', 'person_name_excluded'
    needs_review BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ffsc_trapping_site_matches_client_name
    ON ops.ffsc_trapping_site_matches(client_name);
CREATE INDEX IF NOT EXISTS idx_ffsc_trapping_site_matches_type
    ON ops.ffsc_trapping_site_matches(location_type);

-- =============================================================================
-- Steps 1b–1g: Populate, classify, match, and link
-- =============================================================================

DO $$
DECLARE
    r RECORD;
    v_cleaned TEXT;
    v_type TEXT;
    v_place_id UUID;
    v_count INTEGER;
BEGIN
    -- =========================================================================
    -- Step 1b: Populate with cleaned/classified locations
    -- =========================================================================

    FOR r IN
        SELECT client_name, extracted_location, cat_count
        FROM ops.v_ffsc_trapping_sites
    LOOP
        v_cleaned := r.extracted_location;

        -- Dedup doubled names: ClinicHQ concatenates first+last name fields,
        -- and for trapping sites both fields often contain the same text.
        -- e.g., "Sonoma County Landfill Petaluma Sonoma County Landfill Petaluma"
        -- PostgreSQL supports backreferences in POSIX regex patterns.
        IF v_cleaned ~* '^(.+)\s+\1$' THEN
            v_cleaned := REGEXP_REPLACE(v_cleaned, '^(.+)\s+\1$', '\1', 'i');
        END IF;

        -- Strip any remaining FFSC references that survived the view's stripping
        v_cleaned := REGEXP_REPLACE(v_cleaned, '\s*\b(ffsc|forgotten felines)\b\s*', ' ', 'gi');
        v_cleaned := BTRIM(REGEXP_REPLACE(v_cleaned, '\s+', ' ', 'g'));

        -- Skip empty or too-short results
        IF v_cleaned IS NULL OR LENGTH(v_cleaned) < 3 THEN
            CONTINUE;
        END IF;

        -- Classify location type
        IF v_cleaned ~ '^\d+\s+' THEN
            -- Starts with digits: likely a street address
            v_type := 'address';
        ELSIF EXISTS (
            SELECT 1
            FROM sot.people p
            JOIN sot.person_roles pr ON pr.person_id = p.person_id
            WHERE pr.role IN ('trapper', 'ffsc_trapper', 'community_trapper',
                              'staff', 'coordinator', 'head_trapper')
              AND p.merged_into_person_id IS NULL
              AND LOWER(BTRIM(p.first_name || ' ' || p.last_name)) = LOWER(v_cleaned)
        ) THEN
            -- Matches a known trapper/staff name
            v_type := 'person_name';
        ELSE
            -- Business name, landmark, or other location
            v_type := 'business';
        END IF;

        INSERT INTO ops.ffsc_trapping_site_matches (
            client_name, extracted_location, cleaned_location, location_type, cat_count
        ) VALUES (
            r.client_name, r.extracted_location, v_cleaned, v_type, r.cat_count
        );
    END LOOP;

    SELECT COUNT(*) INTO v_count FROM ops.ffsc_trapping_site_matches;
    RAISE NOTICE 'Step 1b: Populated % trapping site entries', v_count;

    -- =========================================================================
    -- Step 1c: Auto-match addresses to existing places
    -- Match location_type = 'address' by normalized_address comparison.
    -- =========================================================================

    -- Try direct normalized match first
    UPDATE ops.ffsc_trapping_site_matches m
    SET matched_place_id = sub.place_id,
        match_method = 'normalized_address',
        needs_review = FALSE
    FROM (
        SELECT DISTINCT ON (sot.normalize_address(m2.cleaned_location))
            m2.id AS match_id,
            p.place_id
        FROM ops.ffsc_trapping_site_matches m2
        JOIN sot.places p ON p.normalized_address = sot.normalize_address(m2.cleaned_location)
        WHERE m2.location_type = 'address'
          AND m2.matched_place_id IS NULL
          AND p.merged_into_place_id IS NULL
          AND p.normalized_address IS NOT NULL
        ORDER BY sot.normalize_address(m2.cleaned_location), p.created_at
    ) sub
    WHERE m.id = sub.match_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Step 1c: Matched % addresses to existing places (direct)', v_count;

    -- Try with Sonoma County suffix for better matching
    UPDATE ops.ffsc_trapping_site_matches m
    SET matched_place_id = sub.place_id,
        match_method = 'normalized_address',
        needs_review = FALSE
    FROM (
        SELECT DISTINCT ON (sot.normalize_address(m2.cleaned_location || ', Sonoma County, CA'))
            m2.id AS match_id,
            p.place_id
        FROM ops.ffsc_trapping_site_matches m2
        JOIN sot.places p
            ON p.normalized_address = sot.normalize_address(m2.cleaned_location || ', Sonoma County, CA')
        WHERE m2.location_type = 'address'
          AND m2.matched_place_id IS NULL
          AND p.merged_into_place_id IS NULL
          AND p.normalized_address IS NOT NULL
        ORDER BY sot.normalize_address(m2.cleaned_location || ', Sonoma County, CA'), p.created_at
    ) sub
    WHERE m.id = sub.match_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Step 1c: Matched % more addresses (with county suffix)', v_count;

    -- =========================================================================
    -- Step 1d: Create places for unmatched addresses
    -- Uses sot.find_or_create_place_deduped() which handles dedup + address
    -- record creation. Places enter geocoding queue automatically.
    -- =========================================================================

    v_count := 0;
    FOR r IN
        SELECT id, cleaned_location
        FROM ops.ffsc_trapping_site_matches
        WHERE location_type = 'address'
          AND matched_place_id IS NULL
    LOOP
        v_place_id := sot.find_or_create_place_deduped(
            r.cleaned_location || ', Sonoma County, CA',
            r.cleaned_location,  -- display_name = original location name
            NULL, NULL,          -- no coordinates
            'clinichq'           -- source = clinichq (where the data came from)
        );

        IF v_place_id IS NOT NULL THEN
            UPDATE ops.ffsc_trapping_site_matches
            SET matched_place_id = v_place_id,
                match_method = 'created_from_address',
                needs_review = FALSE
            WHERE id = r.id;

            v_count := v_count + 1;
        END IF;
    END LOOP;

    RAISE NOTICE 'Step 1d: Created % new places for unmatched addresses', v_count;

    -- =========================================================================
    -- Step 1e: Match business names by display_name (case-insensitive)
    -- These are flagged for review since display_name matching is fuzzy.
    -- =========================================================================

    UPDATE ops.ffsc_trapping_site_matches m
    SET matched_place_id = sub.place_id,
        match_method = 'display_name',
        needs_review = TRUE
    FROM (
        SELECT DISTINCT ON (LOWER(m2.cleaned_location))
            m2.id AS match_id,
            p.place_id
        FROM ops.ffsc_trapping_site_matches m2
        JOIN sot.places p
            ON LOWER(BTRIM(p.display_name)) = LOWER(m2.cleaned_location)
        WHERE m2.location_type = 'business'
          AND m2.matched_place_id IS NULL
          AND p.merged_into_place_id IS NULL
        ORDER BY LOWER(m2.cleaned_location), p.created_at
    ) sub
    WHERE m.id = sub.match_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Step 1e: Matched % business names by display_name', v_count;

    -- =========================================================================
    -- Step 1f: Mark person names as excluded
    -- These are trappers who booked under their name + FFSC, not places.
    -- =========================================================================

    UPDATE ops.ffsc_trapping_site_matches
    SET match_method = 'person_name_excluded',
        needs_review = FALSE
    WHERE location_type = 'person_name';

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Step 1f: Excluded % person names', v_count;

    -- =========================================================================
    -- Step 1g: Link matched appointments to places
    -- Only for high-confidence, no-review matches (addresses).
    -- Does NOT overwrite existing inferred_place_id.
    -- =========================================================================

    UPDATE ops.appointments a
    SET inferred_place_id = m.matched_place_id
    FROM ops.ffsc_trapping_site_matches m
    WHERE m.matched_place_id IS NOT NULL
      AND m.needs_review = FALSE
      AND a.ffsc_program = 'ffsc_trapping_site'
      AND a.client_name = m.client_name
      AND a.inferred_place_id IS NULL;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Step 1g: Linked % trapping site appointments to places', v_count;
END $$;

-- =============================================================================
-- Step 1h: Create monitoring view
-- =============================================================================

CREATE OR REPLACE VIEW ops.v_ffsc_trapping_site_match_status AS
SELECT
    location_type,
    match_method,
    needs_review,
    COUNT(*) AS site_count,
    SUM(cat_count) AS total_cats,
    COUNT(*) FILTER (WHERE matched_place_id IS NOT NULL) AS matched_count,
    COUNT(*) FILTER (WHERE matched_place_id IS NULL AND location_type != 'person_name') AS unmatched_count
FROM ops.ffsc_trapping_site_matches
GROUP BY location_type, match_method, needs_review
ORDER BY location_type, match_method;

COMMIT;
