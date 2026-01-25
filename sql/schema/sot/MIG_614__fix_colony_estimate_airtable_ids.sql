-- MIG_614: Fix Colony Estimate Airtable IDs
--
-- Problem: Colony estimates have Airtable record IDs (recXXX) in source_record_id
-- but these should point to Atlas request UUIDs for proper linking in the UI.
--
-- Solution: Map Airtable IDs to Atlas request UUIDs via sot_requests.source_record_id
-- Note: source_system is 'airtable_ffsc' not 'airtable'

\echo ''
\echo '=============================================='
\echo 'MIG_614: Fix Colony Estimate Airtable IDs'
\echo '=============================================='
\echo ''

-- Count records before fix
\echo 'Colony estimates with Airtable IDs before fix:'
SELECT COUNT(*) AS count_before
FROM trapper.place_colony_estimates
WHERE source_record_id LIKE 'rec%';

-- Step 1: Delete duplicate estimates
-- Some estimates have Airtable IDs but there's already an estimate with the Atlas UUID
\echo ''
\echo 'Removing duplicates (estimates with Airtable IDs that already have Atlas UUID versions)...'

DELETE FROM trapper.place_colony_estimates ce
USING trapper.sot_requests r
WHERE ce.source_record_id = r.source_record_id
  AND ce.source_record_id LIKE 'rec%'
  AND r.source_system = 'airtable_ffsc'
  AND EXISTS (
    SELECT 1 FROM trapper.place_colony_estimates existing
    WHERE existing.source_record_id = r.request_id::TEXT
  );

-- Step 2: Update remaining estimates with Airtable IDs to use Atlas UUIDs
\echo ''
\echo 'Updating colony estimates to use Atlas request UUIDs...'

UPDATE trapper.place_colony_estimates ce
SET source_record_id = r.request_id::TEXT
FROM trapper.sot_requests r
WHERE ce.source_record_id = r.source_record_id
  AND ce.source_record_id LIKE 'rec%'
  AND r.source_system = 'airtable_ffsc';

-- Also update source_entity_id if it has Airtable IDs
UPDATE trapper.place_colony_estimates ce
SET source_entity_id = r.request_id
FROM trapper.sot_requests r
WHERE ce.source_entity_id::TEXT = r.source_record_id
  AND r.source_record_id LIKE 'rec%'
  AND r.source_system = 'airtable_ffsc';

-- Count records after fix
\echo ''
\echo 'Colony estimates with Airtable IDs after fix:'
SELECT source_type, COUNT(*)
FROM trapper.place_colony_estimates
WHERE source_record_id LIKE 'rec%'
GROUP BY source_type
ORDER BY COUNT(*) DESC;

\echo ''
\echo 'Note: Remaining Airtable IDs are likely from sources without Atlas equivalents'
\echo '(e.g., P75 surveys from airtable_project75). These will not be clickable in the UI.'

\echo ''
\echo '=============================================='
\echo 'MIG_614 Complete!'
\echo '=============================================='
\echo ''
