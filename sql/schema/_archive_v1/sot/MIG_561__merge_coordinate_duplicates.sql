\echo ''
\echo '=============================================='
\echo 'MIG_561: Merge Existing Coordinate Duplicates'
\echo '=============================================='
\echo ''
\echo 'One-time cleanup to merge places with identical coordinates'
\echo 'but different address spellings (e.g., McCarren vs McCarran).'
\echo ''

-- ============================================================================
-- STEP 1: Identify coordinate duplicates
-- ============================================================================

\echo 'Step 1: Identifying coordinate duplicates...'

-- Create temp table with groups of coordinate duplicates
DROP TABLE IF EXISTS _coordinate_duplicates;

CREATE TEMP TABLE _coordinate_duplicates AS
WITH coordinate_groups AS (
    SELECT
        ST_SnapToGrid(location::geometry, 0.00001) as grid_point,
        array_agg(place_id ORDER BY
            -- Score: prefer places with more relationships
            (
                SELECT COUNT(*) FROM trapper.sot_requests WHERE place_id = p.place_id
            ) +
            (
                SELECT COUNT(*) FROM trapper.person_place_relationships WHERE place_id = p.place_id
            ) * 2 DESC,
            -- Then prefer places with normalized_address
            CASE WHEN normalized_address IS NOT NULL THEN 0 ELSE 1 END,
            -- Then older places
            created_at
        ) as place_ids,
        array_agg(formatted_address ORDER BY created_at) as addresses
    FROM trapper.places p
    WHERE location IS NOT NULL
      AND merged_into_place_id IS NULL
      AND (unit_number IS NULL OR unit_number = '')  -- Don't merge different units
    GROUP BY ST_SnapToGrid(location::geometry, 0.00001)
    HAVING COUNT(*) > 1
)
SELECT
    place_ids[1] as keep_place_id,
    unnest(place_ids[2:]) as merge_place_id,
    addresses[1] as keep_address,
    addresses[2:] as merge_addresses
FROM coordinate_groups;

-- Show what will be merged
\echo ''
\echo 'Coordinate duplicates found:'
SELECT * FROM _coordinate_duplicates LIMIT 30;

SELECT COUNT(*) as total_merges_needed FROM _coordinate_duplicates;

-- ============================================================================
-- STEP 2: Merge duplicates using existing merge_places function
-- ============================================================================

\echo ''
\echo 'Step 2: Merging coordinate duplicates...'

DO $$
DECLARE
    r RECORD;
    v_merged_count INT := 0;
    v_error_count INT := 0;
BEGIN
    FOR r IN SELECT keep_place_id, merge_place_id FROM _coordinate_duplicates LOOP
        BEGIN
            -- Use existing merge_places function which handles all FK cascading
            PERFORM trapper.merge_places(
                r.keep_place_id,
                r.merge_place_id,
                'coordinate_duplicate_mig561'
            );
            v_merged_count := v_merged_count + 1;

            IF v_merged_count % 50 = 0 THEN
                RAISE NOTICE 'Merged % places so far...', v_merged_count;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Failed to merge % into %: %',
                r.merge_place_id, r.keep_place_id, SQLERRM;
            v_error_count := v_error_count + 1;
        END;
    END LOOP;

    RAISE NOTICE '';
    RAISE NOTICE '==========================================';
    RAISE NOTICE 'Merge complete: % places merged, % errors', v_merged_count, v_error_count;
    RAISE NOTICE '==========================================';
END $$;

-- ============================================================================
-- STEP 3: Verify results
-- ============================================================================

\echo ''
\echo 'Step 3: Verifying results...'

-- Check remaining coordinate duplicates
\echo ''
\echo 'Remaining coordinate duplicates (should be 0):'
SELECT COUNT(*) as remaining_duplicates
FROM (
    SELECT ST_SnapToGrid(location::geometry, 0.00001)
    FROM trapper.places
    WHERE location IS NOT NULL
      AND merged_into_place_id IS NULL
      AND (unit_number IS NULL OR unit_number = '')
    GROUP BY ST_SnapToGrid(location::geometry, 0.00001)
    HAVING COUNT(*) > 1
) x;

-- Show recent merges
\echo ''
\echo 'Recent merges from this migration:'
SELECT
    place_id,
    formatted_address,
    merged_into_place_id,
    merge_reason
FROM trapper.places
WHERE merge_reason = 'coordinate_duplicate_mig561'
ORDER BY merged_at DESC
LIMIT 10;

-- Clean up
DROP TABLE IF EXISTS _coordinate_duplicates;

\echo ''
\echo '=============================================='
\echo 'MIG_561 Complete!'
\echo '=============================================='
\echo ''
\echo 'All places with identical coordinates have been merged.'
\echo 'Original places are preserved (soft delete via merged_into_place_id).'
\echo ''
