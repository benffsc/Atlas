-- MIG_283: Merge Exact Duplicate Places
--
-- Problem: 565+ place pairs share the exact same normalized_address but exist as separate records.
-- This causes:
--   - Split colony data across duplicates
--   - Confusing UI showing same address multiple times
--   - Inaccurate reporting
--
-- Solution: Identify exact duplicates and merge them using the merge_places() function.
-- The place with more relationships/activity is kept; the other is merged into it.
--
-- Safety:
--   - Only merges places with EXACT same normalized_address
--   - Logs all merges to data_changes table
--   - Places are soft-deleted (merged_into_place_id set)
--   - Can undo by clearing merged_into_place_id and restoring relationships
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_283__merge_exact_duplicate_places.sql

\echo ''
\echo 'MIG_283: Merge Exact Duplicate Places'
\echo '======================================'
\echo ''

-- Step 1: Report duplicate stats before merge
\echo 'Step 1: Identifying exact duplicate places...'
\echo ''

WITH duplicates AS (
  SELECT
    normalized_address,
    COUNT(*) as place_count,
    array_agg(place_id ORDER BY created_at) as place_ids
  FROM trapper.places
  WHERE merged_into_place_id IS NULL
    AND normalized_address IS NOT NULL
    AND normalized_address != ''
  GROUP BY normalized_address
  HAVING COUNT(*) > 1
)
SELECT
  COUNT(*) as duplicate_groups,
  SUM(place_count - 1) as places_to_merge,
  SUM(place_count) as total_affected_places
FROM duplicates;

-- Step 2: Merge duplicates
\echo ''
\echo 'Step 2: Merging duplicate places...'
\echo ''

DO $$
DECLARE
  v_rec RECORD;
  v_place_ids uuid[];
  v_keep_id uuid;
  v_remove_id uuid;
  v_keep_score int;
  v_test_score int;
  v_merged_count int := 0;
  v_failed_count int := 0;
  i int;
BEGIN
  -- Find all duplicate address groups
  FOR v_rec IN
    SELECT
      normalized_address,
      array_agg(place_id ORDER BY created_at) as place_ids
    FROM trapper.places
    WHERE merged_into_place_id IS NULL
      AND normalized_address IS NOT NULL
      AND normalized_address != ''
    GROUP BY normalized_address
    HAVING COUNT(*) > 1
    LIMIT 1000  -- Process in batches for safety
  LOOP
    v_place_ids := v_rec.place_ids;

    -- Find the "best" place to keep (highest activity score)
    v_keep_id := v_place_ids[1];
    v_keep_score := 0;

    FOR i IN 1..array_length(v_place_ids, 1) LOOP
      -- Score based on: requests, cats, people, estimates, coordinates
      SELECT
        COALESCE((SELECT COUNT(*) FROM trapper.sot_requests WHERE place_id = v_place_ids[i]), 0) * 10 +
        COALESCE((SELECT COUNT(*) FROM trapper.cat_place_relationships WHERE place_id = v_place_ids[i]), 0) * 5 +
        COALESCE((SELECT COUNT(*) FROM trapper.person_place_relationships WHERE place_id = v_place_ids[i]), 0) * 3 +
        COALESCE((SELECT COUNT(*) FROM trapper.place_colony_estimates WHERE place_id = v_place_ids[i]), 0) * 2 +
        CASE WHEN EXISTS (SELECT 1 FROM trapper.places WHERE place_id = v_place_ids[i] AND location IS NOT NULL) THEN 5 ELSE 0 END +
        CASE WHEN EXISTS (SELECT 1 FROM trapper.places WHERE place_id = v_place_ids[i] AND is_address_backed) THEN 10 ELSE 0 END
      INTO v_test_score;

      IF v_test_score > v_keep_score THEN
        v_keep_score := v_test_score;
        v_keep_id := v_place_ids[i];
      END IF;
    END LOOP;

    -- Merge all other places into the keeper
    FOR i IN 1..array_length(v_place_ids, 1) LOOP
      IF v_place_ids[i] != v_keep_id THEN
        v_remove_id := v_place_ids[i];

        IF trapper.merge_places(v_keep_id, v_remove_id, 'exact_address_duplicate') THEN
          v_merged_count := v_merged_count + 1;
          RAISE NOTICE 'Merged place % into % (address: %)', v_remove_id, v_keep_id, LEFT(v_rec.normalized_address, 50);
        ELSE
          v_failed_count := v_failed_count + 1;
          RAISE WARNING 'Failed to merge place % into % (address: %)', v_remove_id, v_keep_id, v_rec.normalized_address;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Merge Results:';
  RAISE NOTICE '  Places merged:  %', v_merged_count;
  RAISE NOTICE '  Failed merges:  %', v_failed_count;
  RAISE NOTICE '========================================';
END $$;

-- Step 3: Report results
\echo ''
\echo 'Step 3: Verifying results...'
\echo ''

-- Show remaining duplicates (should be 0 or near 0)
SELECT
  COUNT(*) as remaining_duplicate_groups
FROM (
  SELECT normalized_address
  FROM trapper.places
  WHERE merged_into_place_id IS NULL
    AND normalized_address IS NOT NULL
    AND normalized_address != ''
  GROUP BY normalized_address
  HAVING COUNT(*) > 1
) dups;

-- Show recent merges
\echo ''
\echo 'Recent merges (last 20):'
SELECT
  entity_key as kept_place_id,
  old_value as merged_place_id,
  new_value as merged_address,
  changed_at
FROM trapper.data_changes
WHERE entity_type = 'place'
  AND field_name = 'merged_from'
  AND change_source = 'exact_address_duplicate'
ORDER BY changed_at DESC
LIMIT 20;

-- Show total merged places
\echo ''
\echo 'Total merged places:'
SELECT COUNT(*) as total_merged_places
FROM trapper.places
WHERE merged_into_place_id IS NOT NULL;

\echo ''
\echo 'MIG_283 Complete!'
\echo '================='
\echo ''
