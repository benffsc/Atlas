-- MIG_287: Fix Duplicate Colony Estimates
--
-- Problem: Colony estimates have duplicates due to:
-- 1. Same Airtable record imported with different source_system values
--    ('airtable' vs 'airtable_ffsc', 'airtable_project75', etc.)
-- 2. Missing unique constraint that accounts for this scenario
--
-- Solution:
-- 1. Normalize all airtable-* source_system values to 'airtable'
-- 2. Delete true duplicates (keeping the oldest)
-- 3. Add a partial unique index for better duplicate prevention
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_287__fix_duplicate_colony_estimates.sql

\echo ''
\echo 'MIG_287: Fix Duplicate Colony Estimates'
\echo '========================================'
\echo ''

-- Step 1: Report current duplicates
\echo 'Step 1: Counting duplicates before fix...'

SELECT
  'Same source_record_id, different source_system' as issue_type,
  COUNT(*) as duplicate_count
FROM (
  SELECT source_record_id
  FROM trapper.place_colony_estimates
  WHERE source_record_id IS NOT NULL
    AND source_record_id NOT LIKE 'kml_%'  -- KML records use coords as ID
  GROUP BY source_record_id
  HAVING COUNT(*) > 1
) d;

-- Step 2: Normalize airtable source_system values
\echo ''
\echo 'Step 2: Normalizing airtable source_system values...'

UPDATE trapper.place_colony_estimates
SET source_system = 'airtable'
WHERE source_system LIKE 'airtable_%'
  AND source_system != 'airtable';

-- Step 3: Delete duplicates (keep oldest by created_at)
\echo ''
\echo 'Step 3: Deleting duplicate records (keeping oldest)...'

WITH duplicates AS (
  SELECT
    estimate_id,
    ROW_NUMBER() OVER (
      PARTITION BY source_record_id
      ORDER BY created_at ASC
    ) as rn
  FROM trapper.place_colony_estimates
  WHERE source_record_id IS NOT NULL
    AND source_record_id NOT LIKE 'kml_%'
),
to_delete AS (
  SELECT estimate_id
  FROM duplicates
  WHERE rn > 1
)
DELETE FROM trapper.place_colony_estimates
WHERE estimate_id IN (SELECT estimate_id FROM to_delete);

-- Step 4: Add partial unique index for non-KML records
\echo ''
\echo 'Step 4: Adding unique index for source_record_id (non-KML)...'

DROP INDEX IF EXISTS trapper.idx_colony_estimates_source_record_unique;

CREATE UNIQUE INDEX idx_colony_estimates_source_record_unique
ON trapper.place_colony_estimates (source_record_id)
WHERE source_record_id IS NOT NULL
  AND source_record_id NOT LIKE 'kml_%';

-- Step 5: For KML records, add unique index on place_id + source_record_id
-- (allows multiple KML pins to match same place, but not same pin twice)
\echo ''
\echo 'Step 5: Adding unique index for KML source_record_id per place...'

DROP INDEX IF EXISTS trapper.idx_colony_estimates_kml_unique;

CREATE UNIQUE INDEX idx_colony_estimates_kml_unique
ON trapper.place_colony_estimates (place_id, source_record_id)
WHERE source_record_id LIKE 'kml_%';

-- Step 6: Verify fix
\echo ''
\echo 'Step 6: Verifying fix...'

SELECT
  'Remaining duplicates (same source_record_id)' as check_type,
  COUNT(*) as count
FROM (
  SELECT source_record_id
  FROM trapper.place_colony_estimates
  WHERE source_record_id IS NOT NULL
    AND source_record_id NOT LIKE 'kml_%'
  GROUP BY source_record_id
  HAVING COUNT(*) > 1
) d;

-- Summary stats
\echo ''
\echo 'Colony estimates by source_system:'
SELECT source_system, COUNT(*) as count
FROM trapper.place_colony_estimates
GROUP BY source_system
ORDER BY count DESC;

\echo ''
\echo 'MIG_287 Complete!'
\echo '================='
\echo ''
