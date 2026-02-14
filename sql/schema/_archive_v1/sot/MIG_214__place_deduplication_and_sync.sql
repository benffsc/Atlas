-- MIG_214__place_deduplication_and_sync.sql
-- Comprehensive fix for place deduplication and linkage sync
--
-- Problems addressed:
--   1. Semantic duplicates exist (e.g., "920 Jamboree Drive" vs "920 Jamboree Dr")
--   2. Request estimated_cat_count not auto-creating colony estimates
--   3. Attribution view data not synced to request_cats table
--   4. No mechanism to prevent duplicate places on insert
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_214__place_deduplication_and_sync.sql

\echo ''
\echo 'MIG_214: Place Deduplication and Linkage Sync'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Create address normalization function
-- ============================================================

\echo 'Creating address normalization function...'

CREATE OR REPLACE FUNCTION trapper.normalize_address(p_address TEXT)
RETURNS TEXT AS $$
BEGIN
    IF p_address IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN LOWER(TRIM(
        -- Remove ", USA" suffix
        REGEXP_REPLACE(
        -- Standardize street type abbreviations
        REGEXP_REPLACE(
        REGEXP_REPLACE(
        REGEXP_REPLACE(
        REGEXP_REPLACE(
        REGEXP_REPLACE(
        REGEXP_REPLACE(
        REGEXP_REPLACE(
        REGEXP_REPLACE(
        REGEXP_REPLACE(
        REGEXP_REPLACE(
        REGEXP_REPLACE(
            p_address,
            ',\s*USA$', '', 'i'),           -- Remove ", USA"
            '\bDrive\b', 'Dr', 'gi'),       -- Drive -> Dr
            '\bStreet\b', 'St', 'gi'),      -- Street -> St
            '\bAvenue\b', 'Ave', 'gi'),     -- Avenue -> Ave
            '\bRoad\b', 'Rd', 'gi'),        -- Road -> Rd
            '\bBoulevard\b', 'Blvd', 'gi'), -- Boulevard -> Blvd
            '\bLane\b', 'Ln', 'gi'),        -- Lane -> Ln
            '\bCourt\b', 'Ct', 'gi'),       -- Court -> Ct
            '\bCircle\b', 'Cir', 'gi'),     -- Circle -> Cir
            '\bHighway\b', 'Hwy', 'gi'),    -- Highway -> Hwy
            '\bParkway\b', 'Pkwy', 'gi'),   -- Parkway -> Pkwy
            '\s+', ' ', 'g')                -- Normalize whitespace
    ));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.normalize_address IS
'Normalizes an address for deduplication: lowercase, removes USA suffix, standardizes abbreviations.';

-- ============================================================
-- 2. Add normalized_address column to places
-- ============================================================

\echo ''
\echo 'Adding normalized_address column...'

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS normalized_address TEXT;

-- Populate for existing records
UPDATE trapper.places
SET normalized_address = trapper.normalize_address(formatted_address)
WHERE normalized_address IS NULL;

-- Create index for deduplication lookups
CREATE INDEX IF NOT EXISTS idx_places_normalized_address
ON trapper.places(normalized_address);

\echo 'Normalized addresses populated:'
SELECT COUNT(*) as places_with_normalized FROM trapper.places WHERE normalized_address IS NOT NULL;

-- ============================================================
-- 3. Merge duplicate places
-- ============================================================

\echo ''
\echo 'Finding and merging duplicate places...'

DO $$
DECLARE
    v_dup RECORD;
    v_keep_id UUID;
    v_remove_id UUID;
    v_merged INT := 0;
    v_place_ids UUID[];
    i INT;
BEGIN
    -- Find all duplicate groups
    FOR v_dup IN
        SELECT
            normalized_address,
            ARRAY_AGG(place_id ORDER BY
                -- Prefer: has location, has cat activity, older record
                (location IS NOT NULL) DESC,
                has_cat_activity DESC NULLS LAST,
                created_at ASC
            ) as place_ids
        FROM trapper.places
        WHERE normalized_address IS NOT NULL
        GROUP BY normalized_address
        HAVING COUNT(*) > 1
    LOOP
        v_place_ids := v_dup.place_ids;
        v_keep_id := v_place_ids[1]; -- Best quality record

        -- Merge all others into the first
        FOR i IN 2..array_length(v_place_ids, 1)
        LOOP
            v_remove_id := v_place_ids[i];

            -- Check both still exist
            IF EXISTS (SELECT 1 FROM trapper.places WHERE place_id = v_keep_id)
               AND EXISTS (SELECT 1 FROM trapper.places WHERE place_id = v_remove_id) THEN
                PERFORM trapper.merge_places(v_keep_id, v_remove_id, 'semantic_duplicate');
                v_merged := v_merged + 1;
            END IF;
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Merged % duplicate places', v_merged;
END $$;

\echo 'Places after deduplication:'
SELECT COUNT(*) as total_places FROM trapper.places;

-- ============================================================
-- 4. Create trigger to normalize addresses on insert/update
-- ============================================================

\echo ''
\echo 'Creating address normalization trigger...'

CREATE OR REPLACE FUNCTION trapper.trg_normalize_place_address()
RETURNS TRIGGER AS $$
BEGIN
    -- Normalize the address
    NEW.normalized_address := trapper.normalize_address(NEW.formatted_address);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalize_place_address ON trapper.places;
CREATE TRIGGER trg_normalize_place_address
    BEFORE INSERT OR UPDATE OF formatted_address ON trapper.places
    FOR EACH ROW
    EXECUTE FUNCTION trapper.trg_normalize_place_address();

-- ============================================================
-- 5. Create function to find or create place (with dedup)
-- ============================================================

\echo ''
\echo 'Creating find_or_create_place_deduped function...'

CREATE OR REPLACE FUNCTION trapper.find_or_create_place_deduped(
    p_formatted_address TEXT,
    p_display_name TEXT DEFAULT NULL,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL,
    p_source_system TEXT DEFAULT 'atlas'
)
RETURNS UUID AS $$
DECLARE
    v_normalized TEXT;
    v_existing_id UUID;
    v_new_id UUID;
BEGIN
    -- Normalize the address
    v_normalized := trapper.normalize_address(p_formatted_address);

    IF v_normalized IS NULL OR v_normalized = '' THEN
        RETURN NULL;
    END IF;

    -- Check for existing place with same normalized address
    SELECT place_id INTO v_existing_id
    FROM trapper.places
    WHERE normalized_address = v_normalized
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        RETURN v_existing_id;
    END IF;

    -- Create new place
    INSERT INTO trapper.places (
        display_name,
        formatted_address,
        normalized_address,
        location,
        data_source,
        place_origin
    ) VALUES (
        COALESCE(p_display_name, p_formatted_address),
        p_formatted_address,
        v_normalized,
        CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL
             THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
             ELSE NULL END,
        p_source_system::trapper.data_source_type,
        'atlas'
    )
    RETURNING place_id INTO v_new_id;

    RETURN v_new_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_or_create_place_deduped IS
'Finds existing place by normalized address or creates new one. Prevents duplicates.';

-- ============================================================
-- 6. Create trigger for request colony estimates
-- ============================================================

\echo ''
\echo 'Creating request colony estimate trigger...'

CREATE OR REPLACE FUNCTION trapper.trg_request_colony_estimate()
RETURNS TRIGGER AS $$
BEGIN
    -- Only create estimate if we have a place and cat count
    IF NEW.place_id IS NOT NULL
       AND NEW.estimated_cat_count IS NOT NULL
       AND NEW.estimated_cat_count > 0 THEN

        -- Insert colony estimate if not exists
        INSERT INTO trapper.place_colony_estimates (
            place_id,
            total_cats,
            source_type,
            observation_date,
            is_firsthand,
            reported_by_person_id,
            source_system,
            source_record_id
        ) VALUES (
            NEW.place_id,
            NEW.estimated_cat_count,
            'trapping_request',
            COALESCE(NEW.source_created_at::date, NEW.created_at::date, CURRENT_DATE),
            TRUE,
            NEW.requester_person_id,
            NEW.source_system,
            NEW.source_record_id
        )
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_request_colony_estimate ON trapper.sot_requests;
CREATE TRIGGER trg_request_colony_estimate
    AFTER INSERT OR UPDATE OF place_id, estimated_cat_count ON trapper.sot_requests
    FOR EACH ROW
    EXECUTE FUNCTION trapper.trg_request_colony_estimate();

-- ============================================================
-- 7. Create linkage resync function
-- ============================================================

\echo ''
\echo 'Creating linkage resync function...'

CREATE OR REPLACE FUNCTION trapper.resync_all_linkages()
RETURNS TABLE (
    appointments_linked INT,
    cat_place_relationships_created INT,
    procedures_created INT,
    colony_estimates_created INT,
    places_updated INT
) AS $$
DECLARE
    v_appts INT := 0;
    v_cpr INT := 0;
    v_procs INT := 0;
    v_colony INT := 0;
    v_places INT := 0;
BEGIN
    -- 1. Re-link appointments via clinichq_animal_id
    UPDATE trapper.sot_appointments a
    SET cat_id = ci.cat_id,
        updated_at = NOW()
    FROM trapper.cat_identifiers ci
    WHERE ci.id_type = 'clinichq_animal_id'
      AND ci.id_value = a.appointment_number
      AND a.cat_id IS NULL
      AND a.appointment_number IS NOT NULL;
    GET DIAGNOSTICS v_appts = ROW_COUNT;

    -- 2. Create missing cat_place_relationships
    INSERT INTO trapper.cat_place_relationships (
        cat_id, place_id, relationship_type, source_system, source_table
    )
    SELECT DISTINCT a.cat_id, a.place_id, 'procedure', 'clinichq', 'appointment_info'
    FROM trapper.sot_appointments a
    WHERE a.cat_id IS NOT NULL AND a.place_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trapper.cat_place_relationships cpr
        WHERE cpr.cat_id = a.cat_id AND cpr.place_id = a.place_id
      )
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_cpr = ROW_COUNT;

    -- 3. Create missing cat_procedures
    INSERT INTO trapper.cat_procedures (
        cat_id, appointment_id, procedure_type, procedure_date,
        is_spay, is_neuter, performed_by, source_system, source_record_id
    )
    SELECT DISTINCT ON (a.cat_id, a.appointment_date, a.is_spay, a.is_neuter)
        a.cat_id, a.appointment_id,
        CASE WHEN a.is_spay THEN 'spay' WHEN a.is_neuter THEN 'neuter' ELSE 'other' END,
        a.appointment_date, a.is_spay, a.is_neuter, a.vet_name,
        'clinichq', a.source_record_id
    FROM trapper.sot_appointments a
    WHERE a.cat_id IS NOT NULL AND (a.is_spay OR a.is_neuter)
      AND NOT EXISTS (
        SELECT 1 FROM trapper.cat_procedures cp
        WHERE cp.cat_id = a.cat_id AND cp.procedure_date = a.appointment_date
          AND cp.is_spay = a.is_spay AND cp.is_neuter = a.is_neuter
      )
    ORDER BY a.cat_id, a.appointment_date, a.is_spay, a.is_neuter, a.created_at
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_procs = ROW_COUNT;

    -- 4. Create missing colony estimates from requests
    INSERT INTO trapper.place_colony_estimates (
        place_id, total_cats, source_type, observation_date,
        is_firsthand, reported_by_person_id, source_system, source_record_id
    )
    SELECT
        r.place_id, r.estimated_cat_count, 'trapping_request',
        COALESCE(r.source_created_at::date, r.created_at::date),
        TRUE, r.requester_person_id, r.source_system, r.source_record_id
    FROM trapper.sot_requests r
    WHERE r.estimated_cat_count IS NOT NULL AND r.estimated_cat_count > 0
      AND r.place_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trapper.place_colony_estimates e
        WHERE e.place_id = r.place_id AND e.source_record_id = r.source_record_id
      )
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_colony = ROW_COUNT;

    -- 5. Update place activity flags
    UPDATE trapper.places p
    SET has_cat_activity = TRUE,
        updated_at = NOW()
    WHERE EXISTS (
        SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = p.place_id
    ) AND (p.has_cat_activity = FALSE OR p.has_cat_activity IS NULL);
    GET DIAGNOSTICS v_places = ROW_COUNT;

    RETURN QUERY SELECT v_appts, v_cpr, v_procs, v_colony, v_places;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.resync_all_linkages IS
'Re-syncs all linkages: appointments→cats, cats→places, procedures, colony estimates.
Run periodically to catch any gaps in the pipeline.';

-- ============================================================
-- 8. Create unique constraint to prevent future duplicates
-- ============================================================

\echo ''
\echo 'Creating unique constraint on normalized_address...'

-- First, ensure no duplicates remain
DO $$
BEGIN
    -- Check for remaining duplicates
    IF EXISTS (
        SELECT 1 FROM trapper.places
        GROUP BY normalized_address
        HAVING COUNT(*) > 1
    ) THEN
        RAISE NOTICE 'Duplicates still exist - skipping unique constraint';
    ELSE
        -- Create unique index if no duplicates
        CREATE UNIQUE INDEX IF NOT EXISTS idx_places_normalized_address_unique
        ON trapper.places(normalized_address)
        WHERE normalized_address IS NOT NULL;
        RAISE NOTICE 'Created unique index on normalized_address';
    END IF;
END $$;

-- ============================================================
-- 9. Run initial resync
-- ============================================================

\echo ''
\echo 'Running initial linkage resync...'

SELECT * FROM trapper.resync_all_linkages();

-- ============================================================
-- 10. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Place count:'
SELECT COUNT(*) as total_places FROM trapper.places;

\echo ''
\echo 'Remaining duplicates (should be 0):'
SELECT COUNT(*) as duplicate_groups
FROM (
    SELECT normalized_address
    FROM trapper.places
    WHERE normalized_address IS NOT NULL
    GROUP BY normalized_address
    HAVING COUNT(*) > 1
) d;

\echo ''
\echo 'Colony estimate coverage:'
SELECT
    (SELECT COUNT(*) FROM trapper.sot_requests WHERE estimated_cat_count > 0) as requests_with_estimate,
    (SELECT COUNT(*) FROM trapper.place_colony_estimates WHERE source_type = 'trapping_request') as colony_from_requests;

\echo ''
\echo 'Appointment linkage rate:'
SELECT
    COUNT(*) as total,
    COUNT(cat_id) as linked,
    ROUND(100.0 * COUNT(cat_id) / COUNT(*), 1) as pct_linked
FROM trapper.sot_appointments;

SELECT 'MIG_214 Complete' AS status;
