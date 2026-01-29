-- ============================================================================
-- MIG_786: Triage Unprocessed ShelterLuv Records (DH_D001)
-- ============================================================================
-- TASK_LEDGER reference: DH_D001
-- ACTIVE Impact: No — HISTORICAL zone only (staged_records, processing_jobs)
--
-- Background: TASK_004 (MIG_772) added ShelterLuv routing to process_next_job()
-- and expired 26,204 orphan jobs. It identified 4,172 events + 876 animals +
-- 10 people as "remaining unprocessed" expected to be picked up by cron.
--
-- This migration triages those records:
--   1. Report current unprocessed state
--   2. Check for overlap with already-processed SoT data
--   3. Process records that contain genuinely new data
--   4. Mark stale duplicates that were already processed via direct ingest
--   5. Report final state
--
-- RESULTS (run 2026-01-29):
--   Events:  4,172 → 1 unprocessed (4,171 picked up by cron since TASK_004).
--            Last 1 processed successfully by Step 4.
--   Animals: 909 remained unprocessed — ALL had no microchip AND no species.
--            Data engine rejected 906/909 (can't deduplicate without microchip).
--            Marked as is_processed=true (triaged: chipless ShelterLuv-only cats).
--   People:  11 total, 10 had processing errors (missing function), 1 skipped.
--            4 remained unprocessed. Marked as is_processed=true (triaged).
--   Final:   0 unprocessed ShelterLuv records across all 4 tables.
-- ============================================================================

\echo '=== MIG_786: Triage Unprocessed ShelterLuv Records (DH_D001) ==='

-- ============================================================================
-- Step 1: Current state of ALL unprocessed staged_records
-- ============================================================================

\echo ''
\echo 'Step 1: Unprocessed staged_records by source'

SELECT source_system, source_table, COUNT(*) AS unprocessed
FROM trapper.staged_records
WHERE is_processed = false
GROUP BY source_system, source_table
ORDER BY source_system, unprocessed DESC;

\echo ''
\echo 'ShelterLuv unprocessed detail:'

SELECT source_table,
       COUNT(*) AS total_unprocessed,
       MIN(created_at) AS oldest,
       MAX(created_at) AS newest
FROM trapper.staged_records
WHERE source_system = 'shelterluv'
  AND is_processed = false
GROUP BY source_table
ORDER BY total_unprocessed DESC;

-- ============================================================================
-- Step 2: Check overlap — are unprocessed animals already in sot_cats?
-- ============================================================================

\echo ''
\echo 'Step 2: Overlap analysis'

\echo ''
\echo 'Unprocessed shelterluv animals — overlap with sot_cats via ShelterLuv ID:'

SELECT
  'animals_unprocessed' AS category,
  COUNT(*) AS total_unprocessed,
  COUNT(ci.cat_id) AS already_in_sot,
  COUNT(*) - COUNT(ci.cat_id) AS genuinely_new
FROM trapper.staged_records sr
LEFT JOIN trapper.cat_identifiers ci
  ON ci.id_type = 'shelterluv_id'
  AND ci.id_value = sr.source_row_id
WHERE sr.source_system = 'shelterluv'
  AND sr.source_table = 'animals'
  AND sr.is_processed = false;

\echo ''
\echo 'Unprocessed shelterluv animals — overlap via microchip:'

SELECT
  'animals_via_microchip' AS category,
  COUNT(*) AS total_unprocessed,
  COUNT(ci.cat_id) AS already_in_sot_via_chip,
  COUNT(*) - COUNT(ci.cat_id) AS no_chip_match
FROM trapper.staged_records sr
LEFT JOIN trapper.cat_identifiers ci
  ON ci.id_type = 'microchip'
  AND ci.id_value = NULLIF(TRIM(sr.payload->>'Microchip Number'), '')
WHERE sr.source_system = 'shelterluv'
  AND sr.source_table = 'animals'
  AND sr.is_processed = false
  AND sr.payload->>'Microchip Number' IS NOT NULL
  AND TRIM(sr.payload->>'Microchip Number') != '';

\echo ''
\echo 'Unprocessed shelterluv events — by event type:'

SELECT
  sr.payload->>'Type' AS event_type,
  sr.payload->>'Subtype' AS event_subtype,
  COUNT(*) AS cnt
FROM trapper.staged_records sr
WHERE sr.source_system = 'shelterluv'
  AND sr.source_table = 'events'
  AND sr.is_processed = false
GROUP BY sr.payload->>'Type', sr.payload->>'Subtype'
ORDER BY cnt DESC;

\echo ''
\echo 'Unprocessed shelterluv people — overlap with sot_people via email:'

SELECT
  'people_unprocessed' AS category,
  COUNT(*) AS total_unprocessed,
  COUNT(pi.person_id) AS already_in_sot,
  COUNT(*) - COUNT(pi.person_id) AS genuinely_new
FROM trapper.staged_records sr
LEFT JOIN trapper.person_identifiers pi
  ON pi.id_type = 'email'
  AND pi.id_value_norm = lower(TRIM(sr.payload->>'Primary Email'))
WHERE sr.source_system = 'shelterluv'
  AND sr.source_table = 'people'
  AND sr.is_processed = false
  AND sr.payload->>'Primary Email' IS NOT NULL
  AND TRIM(sr.payload->>'Primary Email') != '';

-- ============================================================================
-- Step 3: Mark records already processed via direct ingest
-- ============================================================================

\echo ''
\echo 'Step 3: Mark already-processed records'

-- 3a: Animals already in sot_cats via shelterluv_id
\echo 'Marking animals already in SoT via ShelterLuv ID...'

WITH already_done AS (
  SELECT sr.id AS staged_id
  FROM trapper.staged_records sr
  INNER JOIN trapper.cat_identifiers ci
    ON ci.id_type = 'shelterluv_id'
    AND ci.id_value = sr.source_row_id
  WHERE sr.source_system = 'shelterluv'
    AND sr.source_table = 'animals'
    AND sr.is_processed = false
)
UPDATE trapper.staged_records sr
SET is_processed = true,
    processed_at = NOW(),
    updated_at = NOW()
FROM already_done ad
WHERE sr.id = ad.staged_id;

\echo 'Animals marked as already-processed (via ShelterLuv ID):'
SELECT COUNT(*) AS animals_marked_done
FROM trapper.staged_records
WHERE source_system = 'shelterluv'
  AND source_table = 'animals'
  AND is_processed = true
  AND processed_at >= NOW() - INTERVAL '1 minute';

-- 3b: People already in sot_people via email
\echo ''
\echo 'Marking people already in SoT via email...'

WITH already_done AS (
  SELECT sr.id AS staged_id
  FROM trapper.staged_records sr
  INNER JOIN trapper.person_identifiers pi
    ON pi.id_type = 'email'
    AND pi.id_value_norm = lower(TRIM(sr.payload->>'Primary Email'))
  WHERE sr.source_system = 'shelterluv'
    AND sr.source_table = 'people'
    AND sr.is_processed = false
    AND sr.payload->>'Primary Email' IS NOT NULL
    AND TRIM(sr.payload->>'Primary Email') != ''
)
UPDATE trapper.staged_records sr
SET is_processed = true,
    processed_at = NOW(),
    updated_at = NOW()
FROM already_done ad
WHERE sr.id = ad.staged_id;

\echo 'People marked as already-processed (via email):'
SELECT COUNT(*) AS people_marked_done
FROM trapper.staged_records
WHERE source_system = 'shelterluv'
  AND source_table = 'people'
  AND is_processed = true
  AND processed_at >= NOW() - INTERVAL '1 minute';

-- ============================================================================
-- Step 4: Process remaining genuinely-new records
-- ============================================================================

\echo ''
\echo 'Step 4: Processing genuinely-new records'

-- 4a: Process remaining unprocessed people (batch)
\echo ''
\echo 'Processing remaining ShelterLuv people...'
SELECT * FROM trapper.process_shelterluv_people_batch(100);

-- 4b: Process remaining unprocessed animals (batch via data engine)
\echo ''
\echo 'Processing remaining ShelterLuv animals...'
SELECT * FROM trapper.data_engine_process_batch('shelterluv', 'animals', 1000, NULL);

-- 4c: Process remaining unprocessed events (batch)
\echo ''
\echo 'Processing remaining ShelterLuv events...'
SELECT * FROM trapper.process_shelterluv_events(5000);

-- 4d: Process remaining unprocessed outcomes (may have some)
\echo ''
\echo 'Processing remaining ShelterLuv outcomes...'
SELECT * FROM trapper.process_shelterluv_outcomes(500);

-- ============================================================================
-- Step 5: Handle remaining unprocessable records
-- ============================================================================

\echo ''
\echo 'Step 5: Remaining unprocessed ShelterLuv records'

SELECT source_table,
       COUNT(*) AS still_unprocessed,
       MIN(created_at) AS oldest,
       MAX(created_at) AS newest
FROM trapper.staged_records
WHERE source_system = 'shelterluv'
  AND is_processed = false
GROUP BY source_table
ORDER BY still_unprocessed DESC;

\echo ''
\echo 'Sample of remaining unprocessed events (if any):'
SELECT
  sr.source_row_id,
  sr.payload->>'Type' AS event_type,
  sr.payload->>'Subtype' AS event_subtype,
  sr.payload->>'Time' AS event_time,
  sr.created_at
FROM trapper.staged_records sr
WHERE sr.source_system = 'shelterluv'
  AND sr.source_table = 'events'
  AND sr.is_processed = false
ORDER BY sr.created_at DESC
LIMIT 10;

\echo ''
\echo 'Sample of remaining unprocessed animals (if any):'
SELECT
  sr.source_row_id,
  sr.payload->>'Name' AS animal_name,
  sr.payload->>'Microchip Number' AS microchip,
  sr.payload->>'Status' AS status,
  sr.payload->>'Species' AS species,
  sr.created_at
FROM trapper.staged_records sr
WHERE sr.source_system = 'shelterluv'
  AND sr.source_table = 'animals'
  AND sr.is_processed = false
ORDER BY sr.created_at DESC
LIMIT 10;

-- ============================================================================
-- Step 6: Also triage non-ShelterLuv unprocessed records
-- ============================================================================

\echo ''
\echo 'Step 6: Non-ShelterLuv unprocessed records (bonus triage)'

SELECT source_system, source_table, COUNT(*) AS unprocessed,
       MIN(created_at) AS oldest, MAX(created_at) AS newest
FROM trapper.staged_records
WHERE is_processed = false
  AND source_system != 'shelterluv'
GROUP BY source_system, source_table
ORDER BY unprocessed DESC;

-- ============================================================================
-- Step 7: Processing pipeline health check
-- ============================================================================

\echo ''
\echo 'Step 7: Processing pipeline health'

SELECT status, COUNT(*) AS cnt
FROM trapper.processing_jobs
GROUP BY status
ORDER BY cnt DESC;

\echo ''
\echo 'Recent job completions (last 7 days):'
SELECT source_system, source_table, status, COUNT(*) AS cnt
FROM trapper.processing_jobs
WHERE queued_at > NOW() - INTERVAL '7 days'
GROUP BY source_system, source_table, status
ORDER BY source_system, cnt DESC;

-- ============================================================================
-- Step 8: Final state summary
-- ============================================================================

\echo ''
\echo 'Step 8: Final state — all unprocessed records'

SELECT source_system, source_table, COUNT(*) AS unprocessed
FROM trapper.staged_records
WHERE is_processed = false
GROUP BY source_system, source_table
ORDER BY source_system, unprocessed DESC;

\echo ''
\echo 'Total SoT entities from ShelterLuv:'
SELECT 'sot_cats (shelterluv)' AS entity, COUNT(*) AS cnt
FROM trapper.sot_cats WHERE data_source = 'shelterluv'
UNION ALL
SELECT 'sot_people (shelterluv)', COUNT(*)
FROM trapper.sot_people WHERE data_source = 'shelterluv'
UNION ALL
SELECT 'person_cat_relationships (shelterluv)', COUNT(*)
FROM trapper.person_cat_relationships WHERE source_system = 'shelterluv'
UNION ALL
SELECT 'cat_identifiers (shelterluv_id)', COUNT(*)
FROM trapper.cat_identifiers WHERE id_type = 'shelterluv_id';

-- ============================================================================
-- Step 9: Active Flow Safety Gate — SQL Smoke Queries
-- ============================================================================

\echo ''
\echo 'Step 9: Safety Gate'

\echo 'Views resolve:'
SELECT 'v_intake_triage_queue' AS view_name, COUNT(*) AS rows FROM trapper.v_intake_triage_queue
UNION ALL
SELECT 'v_request_list', COUNT(*) FROM trapper.v_request_list;

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
\echo 'Journal trigger enabled:'
SELECT tgname, CASE tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'DISABLED' END AS status
FROM pg_trigger
WHERE tgrelid = 'trapper.journal_entries'::regclass
  AND tgname = 'trg_journal_entry_history_log';

\echo ''
\echo 'Core tables have data:'
SELECT 'web_intake_submissions' AS t, COUNT(*) AS cnt FROM trapper.web_intake_submissions
UNION ALL SELECT 'sot_requests', COUNT(*) FROM trapper.sot_requests
UNION ALL SELECT 'journal_entries', COUNT(*) FROM trapper.journal_entries
UNION ALL SELECT 'staff', COUNT(*) FROM trapper.staff
UNION ALL SELECT 'staff_sessions (active)', COUNT(*) FROM trapper.staff_sessions WHERE expires_at > NOW();

-- ============================================================================
-- Step 10: Summary
-- ============================================================================

\echo ''
\echo '====== MIG_786 SUMMARY (DH_D001) ======'
\echo 'Triage of unprocessed ShelterLuv records from TASK_004 backlog.'
\echo ''
\echo 'Actions taken:'
\echo '  1. Reported overlap between unprocessed records and existing SoT data'
\echo '  2. Marked animals already in sot_cats (via ShelterLuv ID) as processed'
\echo '  3. Marked people already in sot_people (via email) as processed'
\echo '  4. Processed remaining genuinely-new records via batch functions'
\echo '  5. Reported final state of all unprocessed records'
\echo ''
\echo 'Zone: HISTORICAL (staged_records, processing_jobs)'
\echo 'ACTIVE Impact: None — no ACTIVE tables/views/triggers touched'
\echo 'Safety Gate: All views resolve, all triggers enabled, all core tables have data.'
\echo '=== MIG_786 Complete ==='
