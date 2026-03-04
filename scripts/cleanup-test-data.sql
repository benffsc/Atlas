-- Cleanup E2E Test Data
--
-- Removes all test records created by E2E tests.
-- Test records are identified by:
--   - source_system = 'e2e_test'
--   - IDs/names matching 'e2e-test-%' pattern
--   - Emails matching 'e2e-%@test.example.com'
--   - created_by = 'e2e_test'
--
-- Usage: psql $DATABASE_URL -f scripts/cleanup-test-data.sql

BEGIN;

-- 1. Delete relationship records first (foreign key dependencies)
DELETE FROM sot.cat_place_relationships WHERE evidence_type = 'e2e_test';
DELETE FROM sot.person_cat_relationships WHERE evidence_type = 'e2e_test';
DELETE FROM sot.person_place_relationships WHERE evidence_type = 'e2e_test';

-- 2. Delete operational records
DELETE FROM ops.journal_entries WHERE created_by = 'e2e_test' OR body LIKE 'e2e-test-%';
DELETE FROM ops.map_annotations WHERE created_by = 'e2e_test' OR label LIKE 'e2e-test-%';
DELETE FROM ops.web_intake_submissions WHERE submission_id LIKE 'e2e-test-%' OR email LIKE 'e2e-%@test.example.com';

-- 3. Delete core entities
DELETE FROM ops.requests WHERE source_system = 'e2e_test' OR request_id::text LIKE 'e2e-test-%';
DELETE FROM sot.places WHERE source_system = 'e2e_test' OR id::text LIKE 'e2e-test-%';
DELETE FROM sot.people WHERE source_system = 'e2e_test' OR id::text LIKE 'e2e-test-%';
DELETE FROM sot.cats WHERE source_system = 'e2e_test' OR id::text LIKE 'e2e-test-%';

COMMIT;

-- 4. Verification: all counts should be 0
SELECT 'journal_entries' AS entity, COUNT(*) AS remaining FROM ops.journal_entries WHERE created_by = 'e2e_test'
UNION ALL
SELECT 'map_annotations', COUNT(*) FROM ops.map_annotations WHERE created_by = 'e2e_test'
UNION ALL
SELECT 'intake_submissions', COUNT(*) FROM ops.web_intake_submissions WHERE submission_id LIKE 'e2e-test-%'
UNION ALL
SELECT 'requests', COUNT(*) FROM ops.requests WHERE source_system = 'e2e_test'
UNION ALL
SELECT 'places', COUNT(*) FROM sot.places WHERE source_system = 'e2e_test'
UNION ALL
SELECT 'people', COUNT(*) FROM sot.people WHERE source_system = 'e2e_test'
UNION ALL
SELECT 'cats', COUNT(*) FROM sot.cats WHERE source_system = 'e2e_test';
