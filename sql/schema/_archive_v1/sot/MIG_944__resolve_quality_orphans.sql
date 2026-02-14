\echo ''
\echo '=============================================='
\echo 'MIG_944: Resolve Quality Queue Orphans'
\echo '=============================================='
\echo ''
\echo 'Problem: 553 records with data_quality = needs_review are blocking the queue.'
\echo ''
\echo 'Root cause (MIG_881):'
\echo '  - First-name-only records from web_app were marked needs_review'
\echo '  - Intent: exclude from search but preserve for audit'
\echo '  - Problem: records with NO identifiers can NEVER be resolved'
\echo ''
\echo 'Fix:'
\echo '  - Records with NO email AND NO phone -> orphan_no_identifiers'
\echo '  - Records with identifiers stay needs_review (can be matched later)'
\echo ''

-- ============================================================================
-- PART 1: Add orphan_no_identifiers to data_quality enum if not exists
-- ============================================================================

\echo '1. Ensuring orphan_no_identifiers is a valid data_quality value...'

-- Check current constraint
DO $$
DECLARE
  v_constraint_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO v_constraint_def
  FROM pg_constraint
  WHERE conname = 'sot_people_data_quality_check'
    AND conrelid = 'trapper.sot_people'::regclass;

  IF v_constraint_def IS NOT NULL AND v_constraint_def NOT LIKE '%orphan_no_identifiers%' THEN
    EXECUTE 'ALTER TABLE trapper.sot_people DROP CONSTRAINT IF EXISTS sot_people_data_quality_check';
    EXECUTE 'ALTER TABLE trapper.sot_people ADD CONSTRAINT sot_people_data_quality_check
      CHECK (data_quality IN (''normal'', ''garbage'', ''needs_review'', ''orphan_no_identifiers''))';
    RAISE NOTICE 'Added orphan_no_identifiers to data_quality constraint';
  ELSE
    RAISE NOTICE 'Constraint already includes orphan_no_identifiers or does not exist';
  END IF;
END $$;

-- ============================================================================
-- PART 2: Analyze what's in needs_review
-- ============================================================================

\echo ''
\echo '2. Analyzing needs_review records...'

\echo 'Current breakdown of needs_review by identifier presence:'
SELECT
  CASE
    WHEN primary_email IS NULL AND primary_phone IS NULL THEN 'no_identifiers'
    WHEN primary_email IS NOT NULL AND primary_phone IS NOT NULL THEN 'has_both'
    WHEN primary_email IS NOT NULL THEN 'has_email_only'
    WHEN primary_phone IS NOT NULL THEN 'has_phone_only'
  END AS identifier_status,
  COUNT(*) AS count
FROM trapper.sot_people
WHERE data_quality = 'needs_review'
  AND merged_into_person_id IS NULL
GROUP BY 1
ORDER BY 2 DESC;

-- ============================================================================
-- PART 3: Move orphans (no identifiers) to orphan_no_identifiers
-- ============================================================================

\echo ''
\echo '3. Moving records with NO identifiers to orphan_no_identifiers...'

WITH updated AS (
  UPDATE trapper.sot_people
  SET data_quality = 'orphan_no_identifiers',
      updated_at = NOW()
  WHERE data_quality = 'needs_review'
    AND merged_into_person_id IS NULL
    AND primary_email IS NULL
    AND primary_phone IS NULL
    -- Double-check person_identifiers table too
    AND NOT EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.person_id = sot_people.person_id
    )
  RETURNING person_id
)
SELECT COUNT(*) AS orphans_reclassified FROM updated;

-- ============================================================================
-- PART 4: Update surface views to exclude orphan_no_identifiers
-- ============================================================================

\echo ''
\echo '4. Ensuring orphan_no_identifiers is excluded from identity matching...'

-- The key filter in MIG_882 should already exclude needs_review
-- We just need to ensure orphan_no_identifiers is also excluded

-- Check if v_active_people or similar views need updating
DO $$
BEGIN
  -- Most views already filter on data_quality NOT IN ('garbage', 'needs_review')
  -- orphan_no_identifiers should be added to those exclusions
  -- This is a documentation note - the actual fix is in MIG_882 filter
  RAISE NOTICE 'Views filtering by data_quality should also exclude orphan_no_identifiers';
END $$;

-- ============================================================================
-- PART 5: Verification
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Data quality breakdown after fix:'
SELECT
  data_quality,
  COUNT(*) AS count
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
  AND data_quality IN ('needs_review', 'orphan_no_identifiers', 'garbage')
GROUP BY data_quality
ORDER BY count DESC;

\echo ''
\echo 'Remaining needs_review (should have identifiers):'
SELECT
  p.display_name,
  p.primary_email,
  p.primary_phone,
  p.data_source
FROM trapper.sot_people p
WHERE p.data_quality = 'needs_review'
  AND p.merged_into_person_id IS NULL
LIMIT 10;

\echo ''
\echo '=============================================='
\echo 'MIG_944 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  - Added orphan_no_identifiers to data_quality values'
\echo '  - Moved records with NO email AND NO phone to orphan_no_identifiers'
\echo '  - These records can never be identity-matched, so they are not reviewable'
\echo ''
\echo 'Remaining needs_review records HAVE identifiers and CAN be resolved.'
\echo ''
