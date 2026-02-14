-- MIG_507: Merge ShelterLuv Duplicate People
--
-- Problem:
--   ShelterLuv imports created duplicate people because the processor
--   function was never implemented. Examples:
--   - Claire Simpson: 3 records
--   - Veronica Beller: 2 records
--
-- Solution:
--   1. Create view to identify duplicate candidates by name
--   2. Auto-merge exact name matches (high confidence)
--   3. Log all merges for audit trail
--   4. Flag uncertain matches for manual review
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_507__merge_shelterluv_duplicates.sql

\echo ''
\echo '=============================================='
\echo 'MIG_507: Merge ShelterLuv Duplicates'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Pre-merge diagnostics
-- ============================================================

\echo '1. Pre-merge diagnostics...'
\echo ''

-- Show duplicate counts by source
\echo 'Duplicate people by name (all sources):'
SELECT
  p.data_source::TEXT,
  COUNT(*) as people_with_dupes,
  SUM(dupe_count - 1) as total_duplicates
FROM (
  SELECT
    LOWER(TRIM(display_name)) as norm_name,
    data_source,
    COUNT(*) as dupe_count
  FROM trapper.sot_people
  WHERE merged_into_person_id IS NULL
    AND display_name IS NOT NULL
    AND TRIM(display_name) != ''
  GROUP BY LOWER(TRIM(display_name)), data_source
  HAVING COUNT(*) > 1
) d
JOIN trapper.sot_people p ON LOWER(TRIM(p.display_name)) = d.norm_name
  AND p.data_source = d.data_source
  AND p.merged_into_person_id IS NULL
GROUP BY p.data_source
ORDER BY total_duplicates DESC;

-- ============================================================
-- 2. Create view for duplicate candidates
-- ============================================================

\echo ''
\echo '2. Creating v_shelterluv_name_duplicates view...'

CREATE OR REPLACE VIEW trapper.v_shelterluv_name_duplicates AS
WITH name_groups AS (
  SELECT
    LOWER(TRIM(display_name)) as normalized_name,
    array_agg(person_id ORDER BY created_at) as person_ids,
    array_agg(display_name ORDER BY created_at) as display_names,
    array_agg(primary_email ORDER BY created_at) as emails,
    array_agg(primary_phone ORDER BY created_at) as phones,
    array_agg(data_source::TEXT ORDER BY created_at) as sources,
    COUNT(*) as dupe_count
  FROM trapper.sot_people
  WHERE merged_into_person_id IS NULL
    AND display_name IS NOT NULL
    AND TRIM(display_name) != ''
  GROUP BY LOWER(TRIM(display_name))
  HAVING COUNT(*) > 1
)
SELECT
  ng.normalized_name,
  ng.person_ids,
  ng.display_names,
  ng.emails,
  ng.phones,
  ng.sources,
  ng.dupe_count,
  -- Determine canonical: prefer person with most identifiers
  (
    SELECT pi.person_id
    FROM unnest(ng.person_ids) AS pid(person_id)
    LEFT JOIN LATERAL (
      SELECT person_id, COUNT(*) as id_count
      FROM trapper.person_identifiers
      WHERE person_id = pid.person_id
      GROUP BY person_id
    ) pi ON true
    ORDER BY COALESCE(pi.id_count, 0) DESC, pid.person_id
    LIMIT 1
  ) as canonical_person_id,
  -- All names match exactly (case-insensitive)
  (SELECT COUNT(DISTINCT LOWER(TRIM(dn))) = 1 FROM unnest(ng.display_names) dn) as names_match_exactly
FROM name_groups ng
ORDER BY ng.dupe_count DESC;

COMMENT ON VIEW trapper.v_shelterluv_name_duplicates IS
'Identifies people with duplicate names for merge review.
canonical_person_id = person to keep (has most identifiers).
names_match_exactly = safe to auto-merge.';

-- ============================================================
-- 3. Create auto-merge function
-- ============================================================

\echo '3. Creating auto_merge_name_duplicates function...'

CREATE OR REPLACE FUNCTION trapper.auto_merge_name_duplicates(
  p_dry_run BOOLEAN DEFAULT true,
  p_limit INT DEFAULT 1000
)
RETURNS TABLE (
  merged_count INT,
  skipped_count INT,
  error_count INT,
  details JSONB
) AS $$
DECLARE
  v_merged INT := 0;
  v_skipped INT := 0;
  v_errors INT := 0;
  v_details JSONB := '[]'::JSONB;
  v_rec RECORD;
  v_source_id UUID;
  v_result JSONB;
  v_person_ids UUID[];
  v_canonical_id UUID;
BEGIN
  -- Process duplicate groups where names match exactly
  FOR v_rec IN
    SELECT
      normalized_name,
      person_ids,
      canonical_person_id,
      dupe_count
    FROM trapper.v_shelterluv_name_duplicates
    WHERE names_match_exactly = true
      AND dupe_count <= 5  -- Sanity limit
    ORDER BY dupe_count DESC
    LIMIT p_limit
  LOOP
    v_person_ids := v_rec.person_ids;
    v_canonical_id := v_rec.canonical_person_id;

    -- Merge each duplicate into canonical
    FOR i IN 1..array_length(v_person_ids, 1) LOOP
      v_source_id := v_person_ids[i];

      -- Skip canonical person
      IF v_source_id = v_canonical_id THEN
        CONTINUE;
      END IF;

      -- Skip if already merged
      IF EXISTS (
        SELECT 1 FROM trapper.sot_people
        WHERE person_id = v_source_id
          AND merged_into_person_id IS NOT NULL
      ) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      IF p_dry_run THEN
        -- Dry run: just count
        v_merged := v_merged + 1;
        v_details := v_details || jsonb_build_object(
          'action', 'would_merge',
          'source', v_source_id,
          'target', v_canonical_id,
          'name', v_rec.normalized_name
        );
      ELSE
        -- Actually merge
        BEGIN
          v_result := trapper.merge_people(
            p_source_person_id := v_source_id,
            p_target_person_id := v_canonical_id,
            p_reason := 'shelterluv_duplicate_auto',
            p_merged_by := 'mig_507'
          );

          v_merged := v_merged + 1;
          v_details := v_details || jsonb_build_object(
            'action', 'merged',
            'source', v_source_id,
            'target', v_canonical_id,
            'name', v_rec.normalized_name,
            'result', v_result
          );

        EXCEPTION WHEN OTHERS THEN
          v_errors := v_errors + 1;
          v_details := v_details || jsonb_build_object(
            'action', 'error',
            'source', v_source_id,
            'target', v_canonical_id,
            'name', v_rec.normalized_name,
            'error', SQLERRM
          );
        END;
      END IF;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT v_merged, v_skipped, v_errors, v_details;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.auto_merge_name_duplicates IS
'Auto-merges people with exact matching names.
Use p_dry_run=true (default) to preview changes.
Use p_dry_run=false to actually merge.
Returns counts and details of all merge operations.';

-- ============================================================
-- 4. Dry run to show what would be merged
-- ============================================================

\echo ''
\echo '4. Dry run preview of merges...'
\echo ''

SELECT * FROM trapper.auto_merge_name_duplicates(p_dry_run := true, p_limit := 50);

-- ============================================================
-- 5. Actually perform the merges
-- ============================================================

\echo ''
\echo '5. Performing auto-merges...'
\echo ''

SELECT * FROM trapper.auto_merge_name_duplicates(p_dry_run := false, p_limit := 1000);

-- ============================================================
-- 6. Post-merge verification
-- ============================================================

\echo ''
\echo '6. Post-merge verification...'
\echo ''

-- Check Claire Simpson
\echo 'Claire Simpson records:'
SELECT
  person_id,
  display_name,
  primary_email,
  data_source::TEXT,
  merged_into_person_id,
  merged_at
FROM trapper.sot_people
WHERE display_name ILIKE '%claire simpson%'
ORDER BY merged_into_person_id NULLS FIRST;

-- Check Veronica Beller
\echo ''
\echo 'Veronica Beller records:'
SELECT
  person_id,
  display_name,
  primary_email,
  data_source::TEXT,
  merged_into_person_id,
  merged_at
FROM trapper.sot_people
WHERE display_name ILIKE '%veronica beller%'
ORDER BY merged_into_person_id NULLS FIRST;

-- Show remaining duplicates
\echo ''
\echo 'Remaining duplicate groups (need manual review):'
SELECT
  normalized_name,
  dupe_count,
  sources,
  names_match_exactly
FROM trapper.v_shelterluv_name_duplicates
WHERE names_match_exactly = false
ORDER BY dupe_count DESC
LIMIT 20;

-- ============================================================
-- 7. Summary
-- ============================================================

\echo ''
\echo '=============================================='
\echo 'MIG_507 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - v_shelterluv_name_duplicates: View to identify duplicates'
\echo '  - auto_merge_name_duplicates(): Function to auto-merge'
\echo ''
\echo 'Merged duplicates where names match exactly.'
\echo 'Remaining duplicates with different name variations need manual review.'
\echo ''

-- Show merge statistics
SELECT 'Total merges performed' as metric, COUNT(*) as count
FROM trapper.sot_people
WHERE merge_reason = 'shelterluv_duplicate_auto'
  AND merged_at > NOW() - INTERVAL '5 minutes';

-- Record migration
SELECT trapper.record_migration(507, 'MIG_507__merge_shelterluv_duplicates');
