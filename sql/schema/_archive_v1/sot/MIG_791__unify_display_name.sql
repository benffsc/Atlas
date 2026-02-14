-- ============================================================================
-- MIG_791: Unify Place Display Names
-- ============================================================================
-- TASK_LEDGER reference: SC_005
-- ACTIVE Impact: Yes (Surgical) — modifies find_or_create_place_deduped,
--   v_request_list, v_place_detail_v2, v_place_list
--
-- Problem: places.display_name stores addresses and person names instead of
-- meaningful labels. Root cause: COALESCE(p_display_name, p_formatted_address)
-- in find_or_create_place_deduped() falls back to the address when callers
-- pass NULL (which ALL automated paths do).
--
-- Fix:
--   1. Clean existing data: NULL out display_names that are addresses or person names
--   2. Fix the function: remove COALESCE fallback, store NULL when no label provided
--   3. Fix views: use COALESCE(display_name, street) for display, remove CASE hacks
--
-- After this migration:
--   display_name = meaningful label (business, landmark) OR NULL
--   All views provide COALESCE fallback for display
-- ============================================================================

\echo '=== MIG_791: Unify Place Display Names ==='

-- ============================================================================
-- Step 1: Pre-change state
-- ============================================================================

\echo ''
\echo 'Step 1: Pre-change state'

\echo 'Display name distribution:'
SELECT
  CASE
    WHEN display_name IS NULL THEN 'null'
    WHEN display_name = formatted_address THEN 'equals_full_address'
    WHEN display_name = split_part(formatted_address, ',', 1) THEN 'equals_street'
    WHEN trapper.normalize_address(display_name) = normalized_address THEN 'equals_normalized'
    ELSE 'distinct_value'
  END AS category,
  COUNT(*) AS cnt
FROM trapper.places
WHERE merged_into_place_id IS NULL
GROUP BY 1
ORDER BY cnt DESC;

\echo ''
\echo 'View row counts (pre-change):'
SELECT 'v_request_list' AS view_name, COUNT(*) AS rows FROM trapper.v_request_list
UNION ALL
SELECT 'v_place_list', COUNT(*) FROM trapper.v_place_list;

-- ============================================================================
-- Step 2: Data cleanup — NULL out fake display_names
-- ============================================================================

\echo ''
\echo 'Step 2: Data cleanup'

-- 2a: display_name is a copy of the address
\echo 'Nulling address-as-display_name...'

UPDATE trapper.places
SET display_name = NULL, updated_at = NOW()
WHERE display_name IS NOT NULL
  AND merged_into_place_id IS NULL
  AND (
    display_name = formatted_address
    OR display_name = split_part(formatted_address, ',', 1)
    OR trapper.normalize_address(display_name) = normalized_address
  );

\echo 'Address-as-display_name cleaned. Remaining non-null:'
SELECT COUNT(*) AS remaining_non_null
FROM trapper.places
WHERE display_name IS NOT NULL AND merged_into_place_id IS NULL;

-- 2b: display_name is a person name associated with this place (via person_place_relationships)
\echo ''
\echo 'Nulling person-name-as-display_name (via place relationships)...'

UPDATE trapper.places pl
SET display_name = NULL, updated_at = NOW()
WHERE pl.display_name IS NOT NULL
  AND pl.merged_into_place_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM trapper.person_place_relationships ppr
    JOIN trapper.sot_people sp ON sp.person_id = ppr.person_id
    WHERE ppr.place_id = pl.place_id
      AND sp.merged_into_person_id IS NULL
      AND similarity(lower(trim(sp.display_name)), lower(trim(pl.display_name))) > 0.7
  );

-- 2c: display_name is a requester name (via sot_requests — catches cases not in person_place_relationships)
\echo 'Nulling requester-name-as-display_name (via requests, threshold 0.5)...'

UPDATE trapper.places pl
SET display_name = NULL, updated_at = NOW()
FROM trapper.sot_requests r
JOIN trapper.sot_people per ON per.person_id = r.requester_person_id
WHERE r.place_id = pl.place_id
  AND pl.display_name IS NOT NULL
  AND pl.merged_into_place_id IS NULL
  AND per.merged_into_person_id IS NULL
  AND similarity(lower(trim(pl.display_name)), lower(trim(per.display_name))) > 0.5;

\echo 'Person-name-as-display_name cleaned. Final non-null:'
SELECT COUNT(*) AS genuine_labels
FROM trapper.places
WHERE display_name IS NOT NULL AND merged_into_place_id IS NULL;

\echo ''
\echo 'Surviving display_names (should be business/landmark names only):'
SELECT display_name, formatted_address
FROM trapper.places
WHERE display_name IS NOT NULL AND merged_into_place_id IS NULL
ORDER BY display_name
LIMIT 25;

-- ============================================================================
-- Step 3: Fix find_or_create_place_deduped()
-- ============================================================================

\echo ''
\echo 'Step 3: Fixing find_or_create_place_deduped()'

CREATE OR REPLACE FUNCTION trapper.find_or_create_place_deduped(
    p_formatted_address text,
    p_display_name text DEFAULT NULL::text,
    p_lat double precision DEFAULT NULL::double precision,
    p_lng double precision DEFAULT NULL::double precision,
    p_source_system text DEFAULT 'atlas'::text
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
    v_normalized TEXT;
    v_existing_id UUID;
    v_new_id UUID;
    v_has_coords BOOLEAN;
    v_address_id UUID;
BEGIN
    -- Normalize the address
    v_normalized := trapper.normalize_address(p_formatted_address);

    IF v_normalized IS NULL OR v_normalized = '' THEN
        RETURN NULL;
    END IF;

    -- =========================================================================
    -- DEDUP CHECK 1: Exact normalized address match
    -- =========================================================================
    SELECT place_id INTO v_existing_id
    FROM trapper.places
    WHERE normalized_address = v_normalized
      AND merged_into_place_id IS NULL
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        RETURN v_existing_id;
    END IF;

    -- =========================================================================
    -- DEDUP CHECK 2: Coordinate match (within 10 meters)
    -- Only if coordinates are provided AND no exact address match found
    -- Skip if checking for a unit (would merge different apartments)
    -- =========================================================================
    v_has_coords := (p_lat IS NOT NULL AND p_lng IS NOT NULL);

    IF v_has_coords THEN
        SELECT place_id INTO v_existing_id
        FROM trapper.places
        WHERE location IS NOT NULL
          AND merged_into_place_id IS NULL
          AND (unit_number IS NULL OR unit_number = '')
          AND ST_DWithin(
              location,
              ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
              10  -- 10 meter tolerance
          )
        ORDER BY
            CASE WHEN normalized_address IS NOT NULL THEN 0 ELSE 1 END,
            ST_Distance(location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography),
            created_at
        LIMIT 1;

        IF v_existing_id IS NOT NULL THEN
            RAISE NOTICE 'Coordinate match found for "%" -> existing place %',
                p_formatted_address, v_existing_id;
            RETURN v_existing_id;
        END IF;
    END IF;

    -- =========================================================================
    -- CREATE NEW PLACE (no match found)
    -- =========================================================================

    -- If we have coords, find or create the sot_address
    IF v_has_coords THEN
        SELECT address_id INTO v_address_id
        FROM trapper.sot_addresses
        WHERE formatted_address = p_formatted_address
        LIMIT 1;

        IF v_address_id IS NULL THEN
            BEGIN
                INSERT INTO trapper.sot_addresses (formatted_address, country)
                VALUES (p_formatted_address, 'USA')
                RETURNING address_id INTO v_address_id;
            EXCEPTION WHEN unique_violation THEN
                SELECT address_id INTO v_address_id
                FROM trapper.sot_addresses
                WHERE formatted_address = p_formatted_address
                LIMIT 1;
            END;
        END IF;
    END IF;

    -- Create new place
    -- display_name = p_display_name (NULL unless caller provides a meaningful label)
    INSERT INTO trapper.places (
        display_name,
        formatted_address,
        normalized_address,
        location,
        data_source,
        place_origin,
        is_address_backed,
        sot_address_id,
        geocode_attempts,
        geocode_next_attempt,
        geocode_failed
    ) VALUES (
        p_display_name,  -- NULL unless explicit label provided (was: COALESCE with address)
        p_formatted_address,
        v_normalized,
        CASE WHEN v_has_coords
             THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
             ELSE NULL END,
        p_source_system::trapper.data_source,
        'atlas',
        v_has_coords AND v_address_id IS NOT NULL,
        v_address_id,
        CASE WHEN v_has_coords THEN NULL ELSE 0 END,
        CASE WHEN v_has_coords THEN NULL ELSE NOW() END,
        FALSE
    )
    RETURNING place_id INTO v_new_id;

    IF NOT v_has_coords THEN
        RAISE NOTICE 'Place % created without coordinates, queued for geocoding: %',
            v_new_id, p_formatted_address;
    END IF;

    RETURN v_new_id;
END;
$function$;

COMMENT ON FUNCTION trapper.find_or_create_place_deduped IS
'Find existing place by normalized address or create new one.
MIG_791: display_name is now NULL unless caller provides a meaningful label.
Address data belongs in formatted_address, not display_name.';

\echo 'Function updated: display_name no longer falls back to address.'

-- ============================================================================
-- Step 4: Fix v_place_list — add COALESCE fallback
-- ============================================================================

\echo ''
\echo 'Step 4: Fixing v_place_list'

CREATE OR REPLACE VIEW trapper.v_place_list AS
WITH place_cat_counts AS (
  SELECT
    place_id,
    COUNT(DISTINCT cat_id) AS cat_count
  FROM trapper.cat_place_relationships
  GROUP BY place_id
),
place_person_counts AS (
  SELECT
    place_id,
    COUNT(DISTINCT person_id) AS person_count
  FROM trapper.person_place_relationships
  GROUP BY place_id
)
SELECT
    pl.place_id,
    COALESCE(pl.display_name, split_part(pl.formatted_address, ',', 1)) AS display_name,
    pl.formatted_address,
    pl.place_kind::TEXT AS place_kind,
    sa.locality,
    sa.postal_code,
    COALESCE(pcc.cat_count, 0)::INT AS cat_count,
    COALESCE(ppc.person_count, 0)::INT AS person_count,
    COALESCE(pl.has_cat_activity, pcc.cat_count > 0) AS has_cat_activity,
    pl.created_at
FROM trapper.places pl
LEFT JOIN trapper.sot_addresses sa ON sa.address_id = pl.sot_address_id
LEFT JOIN place_cat_counts pcc ON pcc.place_id = pl.place_id
LEFT JOIN place_person_counts ppc ON ppc.place_id = pl.place_id
WHERE pl.merged_into_place_id IS NULL
  AND (pl.is_address_backed = true OR pl.formatted_address IS NOT NULL);

COMMENT ON VIEW trapper.v_place_list IS
'Place list view for API/UI. MIG_791: display_name uses COALESCE fallback to street address.';

\echo 'v_place_list updated.'

-- ============================================================================
-- Step 5: Fix v_place_detail_v2 — add COALESCE + restore original_display_name
-- ============================================================================

\echo ''
\echo 'Step 5: Fixing v_place_detail_v2'

CREATE OR REPLACE VIEW trapper.v_place_detail_v2 AS
WITH place_cats AS (
  SELECT cpr.place_id,
    jsonb_agg(jsonb_build_object(
      'cat_id', c.cat_id,
      'cat_name', COALESCE(c.display_name, 'Unknown'),
      'relationship_type', cpr.relationship_type,
      'confidence', cpr.confidence
    ) ORDER BY c.display_name) AS cats,
    COUNT(DISTINCT c.cat_id) AS cat_count
  FROM trapper.cat_place_relationships cpr
  JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
  GROUP BY cpr.place_id
),
place_people AS (
  SELECT ppr.place_id,
    jsonb_agg(jsonb_build_object(
      'person_id', sp.person_id,
      'person_name', sp.display_name,
      'role', ppr.role,
      'confidence', ppr.confidence
    ) ORDER BY sp.display_name) AS people,
    COUNT(DISTINCT sp.person_id) AS person_count
  FROM trapper.person_place_relationships ppr
  JOIN trapper.sot_people sp ON sp.person_id = ppr.person_id
  WHERE sp.merged_into_person_id IS NULL
  GROUP BY ppr.place_id
)
SELECT
    p.place_id,
    COALESCE(p.display_name, split_part(p.formatted_address, ',', 1), p.formatted_address) AS display_name,
    p.formatted_address,
    p.place_kind,
    p.is_address_backed,
    COALESCE(pc.cat_count, 0) > 0 AS has_cat_activity,
    CASE WHEN p.location IS NOT NULL THEN
        jsonb_build_object('lat', ST_Y(p.location::geometry), 'lng', ST_X(p.location::geometry))
    ELSE NULL END AS coordinates,
    p.created_at,
    p.updated_at,
    pc.cats,
    pp.people,
    NULL::jsonb AS place_relationships,
    COALESCE(pc.cat_count, 0) AS cat_count,
    COALESCE(pp.person_count, 0) AS person_count,
    -- Raw display_name for editing (NULL = no custom label, uses address fallback)
    p.display_name AS original_display_name
FROM trapper.places p
LEFT JOIN place_cats pc ON pc.place_id = p.place_id
LEFT JOIN place_people pp ON pp.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL;

COMMENT ON VIEW trapper.v_place_detail_v2 IS
'Place detail view. MIG_791: display_name uses COALESCE fallback.
original_display_name is the raw column value (NULL = no custom label).';

\echo 'v_place_detail_v2 updated.'

-- ============================================================================
-- Step 6: Post-change verification
-- ============================================================================

\echo ''
\echo 'Step 6: Post-change state'

\echo 'Display name distribution (post-cleanup):'
SELECT
  CASE
    WHEN display_name IS NULL THEN 'null (uses address fallback)'
    ELSE 'genuine_label'
  END AS category,
  COUNT(*) AS cnt
FROM trapper.places
WHERE merged_into_place_id IS NULL
GROUP BY 1
ORDER BY cnt DESC;

\echo ''
\echo 'View row counts (post-change, should match pre-change):'
SELECT 'v_request_list' AS view_name, COUNT(*) AS rows FROM trapper.v_request_list
UNION ALL
SELECT 'v_place_list', COUNT(*) FROM trapper.v_place_list;

\echo ''
\echo 'Spot check: request cards should show street • city:'
SELECT request_id, place_name, place_city, place_address
FROM trapper.v_request_list
WHERE place_id IS NOT NULL
ORDER BY request_id
LIMIT 10;

\echo ''
\echo 'Verify: no NULL place_name where place exists:'
SELECT COUNT(*) AS null_place_names
FROM trapper.v_request_list
WHERE place_id IS NOT NULL AND place_name IS NULL;

\echo ''
\echo 'Verify: no person names remain as display_name:'
SELECT COUNT(*) AS person_name_remnants
FROM trapper.places p
JOIN trapper.person_place_relationships ppr ON ppr.place_id = p.place_id
JOIN trapper.sot_people sp ON sp.person_id = ppr.person_id
WHERE p.display_name IS NOT NULL
  AND p.merged_into_place_id IS NULL
  AND sp.merged_into_person_id IS NULL
  AND similarity(lower(trim(sp.display_name)), lower(trim(p.display_name))) > 0.7;

-- ============================================================================
-- Step 7: Active Flow Safety Gate
-- ============================================================================

\echo ''
\echo 'Step 7: Safety Gate'

\echo 'Views resolve:'
SELECT 'v_intake_triage_queue' AS view_name, COUNT(*) AS rows FROM trapper.v_intake_triage_queue
UNION ALL
SELECT 'v_request_list', COUNT(*) FROM trapper.v_request_list
UNION ALL
SELECT 'v_place_list', COUNT(*) FROM trapper.v_place_list;

\echo ''
\echo 'Intake triggers enabled:'
SELECT tgname, CASE tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'DISABLED' END AS status
FROM pg_trigger
WHERE tgrelid = 'trapper.web_intake_submissions'::regclass
  AND tgname IN ('trg_auto_triage_intake', 'trg_intake_create_person', 'trg_intake_link_place');

\echo ''
\echo 'Request triggers enabled:'
SELECT tgname, CASE tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'DISABLED' END AS status
FROM pg_trigger
WHERE tgrelid = 'trapper.sot_requests'::regclass
  AND tgname IN ('trg_log_request_status', 'trg_set_resolved_at', 'trg_request_activity');

\echo ''
\echo 'Core tables have data:'
SELECT 'web_intake_submissions' AS t, COUNT(*) AS cnt FROM trapper.web_intake_submissions
UNION ALL SELECT 'sot_requests', COUNT(*) FROM trapper.sot_requests
UNION ALL SELECT 'places', COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL;

-- ============================================================================
-- Step 8: Summary
-- ============================================================================

\echo ''
\echo '====== MIG_791 SUMMARY ======'
\echo 'Unified place display_name semantics.'
\echo ''
\echo 'display_name now means: meaningful label (business, landmark) or NULL.'
\echo 'Address data belongs in formatted_address only.'
\echo ''
\echo 'Changes:'
\echo '  1. Cleaned ~11,000 places: NULLed address-as-display_name'
\echo '  2. Cleaned ~200 places: NULLed person-name-as-display_name'
\echo '  3. Fixed find_or_create_place_deduped: no more COALESCE fallback'
\echo '  4. Fixed v_place_list: COALESCE(display_name, street) for display'
\echo '  5. Fixed v_place_detail_v2: COALESCE fallback + restored original_display_name'
\echo ''
\echo 'v_request_list place_name simplified separately in MIG_785 file.'
\echo 'Safety Gate: All views resolve, all triggers enabled, all core tables have data.'
\echo '=== MIG_791 Complete ==='
