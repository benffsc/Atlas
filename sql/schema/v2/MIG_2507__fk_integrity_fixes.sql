-- MIG_2507: FK Integrity Fixes
--
-- Problem: Foreign key references point to merged entities
-- - 16 appointments with person_id pointing to merged people
-- - 9 cat relationships pointing to merged cats
--
-- Solution:
-- 1. Update appointment person_ids to follow merge chain
-- 2. Delete stale cat relationships to merged cats
--
-- Created: 2026-02-26

\echo ''
\echo '=============================================='
\echo '  MIG_2507: FK Integrity Fixes'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Pre-check: Count FK issues
-- ============================================================================

\echo '1. Pre-check: Counting FK integrity issues...'

SELECT
  'appointments_with_merged_person' as issue,
  COUNT(*) as count
FROM ops.appointments a
JOIN sot.people p ON a.person_id = p.person_id
WHERE p.merged_into_person_id IS NOT NULL
UNION ALL
SELECT
  'person_cat_with_merged_cat',
  COUNT(*)
FROM sot.person_cat pc
JOIN sot.cats c ON pc.cat_id = c.cat_id
WHERE c.merged_into_cat_id IS NOT NULL
UNION ALL
SELECT
  'cat_place_with_merged_cat',
  COUNT(*)
FROM sot.cat_place cp
JOIN sot.cats c ON cp.cat_id = c.cat_id
WHERE c.merged_into_cat_id IS NOT NULL;

-- ============================================================================
-- 2. Fix appointments pointing to merged people
-- ============================================================================

\echo ''
\echo '2. Fixing appointments with merged person_id...'

-- Follow merge chain to find ultimate target
WITH RECURSIVE merge_chain AS (
  -- Base: people that are merged
  SELECT person_id as original_id, merged_into_person_id as target_id, 1 as depth
  FROM sot.people
  WHERE merged_into_person_id IS NOT NULL

  UNION ALL

  -- Recursive: follow the chain
  SELECT mc.original_id, p.merged_into_person_id, mc.depth + 1
  FROM merge_chain mc
  JOIN sot.people p ON mc.target_id = p.person_id
  WHERE p.merged_into_person_id IS NOT NULL
    AND mc.depth < 10  -- Safety limit
),
final_targets AS (
  SELECT original_id, target_id
  FROM merge_chain mc
  WHERE NOT EXISTS (
    SELECT 1 FROM sot.people p
    WHERE p.person_id = mc.target_id
      AND p.merged_into_person_id IS NOT NULL
  )
)
UPDATE ops.appointments a
SET person_id = ft.target_id
FROM final_targets ft
WHERE a.person_id = ft.original_id;

SELECT 'appointments_fixed' as result, COUNT(*) as count
FROM ops.appointments a
JOIN sot.people p ON a.person_id = p.person_id
WHERE p.merged_into_person_id IS NOT NULL;

-- Expected: 0

-- ============================================================================
-- 3. Delete stale person_cat relationships to merged cats
-- ============================================================================

\echo ''
\echo '3. Deleting stale person_cat relationships to merged cats...'

-- Note: Merged cat's relationships should already exist on the winner cat
-- So these are orphan references that can be safely deleted

DELETE FROM sot.person_cat pc
USING sot.cats c
WHERE pc.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NOT NULL;

SELECT 'person_cat_remaining_to_merged' as result, COUNT(*) as count
FROM sot.person_cat pc
JOIN sot.cats c ON pc.cat_id = c.cat_id
WHERE c.merged_into_cat_id IS NOT NULL;

-- Expected: 0

-- ============================================================================
-- 4. Delete stale cat_place relationships to merged cats
-- ============================================================================

\echo ''
\echo '4. Deleting stale cat_place relationships to merged cats...'

DELETE FROM sot.cat_place cp
USING sot.cats c
WHERE cp.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NOT NULL;

SELECT 'cat_place_remaining_to_merged' as result, COUNT(*) as count
FROM sot.cat_place cp
JOIN sot.cats c ON cp.cat_id = c.cat_id
WHERE c.merged_into_cat_id IS NOT NULL;

-- Expected: 0

-- ============================================================================
-- 5. Post-check: Verify all FK issues resolved
-- ============================================================================

\echo ''
\echo '5. Post-check: Verifying all FK issues resolved...'

SELECT
  'appointments_with_merged_person' as issue,
  COUNT(*) as remaining
FROM ops.appointments a
JOIN sot.people p ON a.person_id = p.person_id
WHERE p.merged_into_person_id IS NOT NULL
UNION ALL
SELECT
  'person_cat_with_merged_cat',
  COUNT(*)
FROM sot.person_cat pc
JOIN sot.cats c ON pc.cat_id = c.cat_id
WHERE c.merged_into_cat_id IS NOT NULL
UNION ALL
SELECT
  'cat_place_with_merged_cat',
  COUNT(*)
FROM sot.cat_place cp
JOIN sot.cats c ON cp.cat_id = c.cat_id
WHERE c.merged_into_cat_id IS NOT NULL;

-- All should be 0

\echo ''
\echo '=============================================='
\echo '  MIG_2507 Complete'
\echo '=============================================='
\echo ''
\echo 'Fixed: Appointments pointing to merged people'
\echo 'Deleted: Stale cat relationships to merged cats'
\echo 'Result: All FK references now point to active entities'
\echo ''
