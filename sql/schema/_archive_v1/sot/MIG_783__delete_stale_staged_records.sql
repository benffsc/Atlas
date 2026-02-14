-- ============================================================================
-- MIG_783: Delete Stale Staged Records (DH_B002)
-- ============================================================================
-- TASK_LEDGER reference: DH_B002
-- ACTIVE Impact: No — staged_records is L1 RAW (append-only audit trail).
--   No ACTIVE UI reads individual staged records. Processing pipeline only
--   processes the latest version via is_processed flag.
--
-- Deletes 2,311 stale staged records where a newer version of the same
-- source record exists (same source_system + source_table + source_row_id,
-- more recent created_at).
--
-- 91,942 rows with NULL source_row_id are NOT duplicates (each has a unique
-- payload) and are untouched.
--
-- Also cleans up 130 data_quality_issues rows that reference stale staged
-- records (the only FK constraint on staged_records).
-- ============================================================================

\echo '=== MIG_783: Delete Stale Staged Records (DH_B002) ==='

-- ============================================================================
-- Step 1: Pre-change state
-- ============================================================================

\echo ''
\echo 'Step 1: Pre-change state'

\echo 'Total staged_records:'
SELECT COUNT(*) AS total_rows FROM trapper.staged_records;

\echo ''
\echo 'Rows with source_row_id vs NULL:'
SELECT
  COUNT(*) FILTER (WHERE source_row_id IS NOT NULL) AS has_source_id,
  COUNT(*) FILTER (WHERE source_row_id IS NULL) AS null_source_id
FROM trapper.staged_records;

\echo ''
\echo 'Stale duplicates (non-latest per source key):'
SELECT COUNT(*) AS stale_count
FROM trapper.staged_records sr
WHERE sr.source_row_id IS NOT NULL
  AND sr.id NOT IN (
    SELECT DISTINCT ON (source_system, source_table, source_row_id) id
    FROM trapper.staged_records
    WHERE source_row_id IS NOT NULL
    ORDER BY source_system, source_table, source_row_id, created_at DESC
  );

\echo ''
\echo 'Stale breakdown by source:'
SELECT sr.source_system, sr.source_table, COUNT(*) AS stale
FROM trapper.staged_records sr
WHERE sr.source_row_id IS NOT NULL
  AND sr.id NOT IN (
    SELECT DISTINCT ON (source_system, source_table, source_row_id) id
    FROM trapper.staged_records
    WHERE source_row_id IS NOT NULL
    ORDER BY source_system, source_table, source_row_id, created_at DESC
  )
GROUP BY sr.source_system, sr.source_table
ORDER BY stale DESC;

\echo ''
\echo 'data_quality_issues referencing stale records:'
SELECT COUNT(*) AS dqi_stale_refs
FROM trapper.data_quality_issues dqi
WHERE dqi.staged_record_id NOT IN (
  SELECT DISTINCT ON (source_system, source_table, source_row_id) id
  FROM trapper.staged_records
  WHERE source_row_id IS NOT NULL
  ORDER BY source_system, source_table, source_row_id, created_at DESC
);

\echo ''
\echo 'Total data_quality_issues:'
SELECT COUNT(*) AS total_dqi FROM trapper.data_quality_issues;

-- ============================================================================
-- Step 2: Create backup tables
-- ============================================================================

\echo ''
\echo 'Step 2: Creating backup tables'

-- Backup stale staged records
CREATE TABLE IF NOT EXISTS trapper._backup_stale_staged_records_783 AS
SELECT sr.*
FROM trapper.staged_records sr
WHERE sr.source_row_id IS NOT NULL
  AND sr.id NOT IN (
    SELECT DISTINCT ON (source_system, source_table, source_row_id) id
    FROM trapper.staged_records
    WHERE source_row_id IS NOT NULL
    ORDER BY source_system, source_table, source_row_id, created_at DESC
  );

\echo 'Stale staged records backup count:'
SELECT COUNT(*) AS backup_rows FROM trapper._backup_stale_staged_records_783;

-- Backup data_quality_issues (all 130 rows reference stale records)
CREATE TABLE IF NOT EXISTS trapper._backup_data_quality_issues_783 AS
SELECT * FROM trapper.data_quality_issues;

\echo 'DQI backup count:'
SELECT COUNT(*) AS backup_rows FROM trapper._backup_data_quality_issues_783;

-- ============================================================================
-- Step 3: Delete data_quality_issues (FK blocker)
-- ============================================================================

\echo ''
\echo 'Step 3: Deleting data_quality_issues referencing stale records'

DELETE FROM trapper.data_quality_issues
WHERE staged_record_id NOT IN (
  SELECT DISTINCT ON (source_system, source_table, source_row_id) id
  FROM trapper.staged_records
  WHERE source_row_id IS NOT NULL
  ORDER BY source_system, source_table, source_row_id, created_at DESC
);

\echo 'Remaining DQI rows (should be 0):'
SELECT COUNT(*) AS remaining_dqi FROM trapper.data_quality_issues;

-- ============================================================================
-- Step 4: Delete stale staged records
-- ============================================================================

\echo ''
\echo 'Step 4: Deleting stale staged records'

DELETE FROM trapper.staged_records
WHERE source_row_id IS NOT NULL
  AND id NOT IN (
    SELECT DISTINCT ON (source_system, source_table, source_row_id) id
    FROM trapper.staged_records
    WHERE source_row_id IS NOT NULL
    ORDER BY source_system, source_table, source_row_id, created_at DESC
  );

-- ============================================================================
-- Step 5: Post-change verification
-- ============================================================================

\echo ''
\echo 'Step 5: Post-change state'

\echo 'Total staged_records:'
SELECT COUNT(*) AS total_rows FROM trapper.staged_records;

\echo ''
\echo 'Rows with source_row_id vs NULL (NULL should be unchanged):'
SELECT
  COUNT(*) FILTER (WHERE source_row_id IS NOT NULL) AS has_source_id,
  COUNT(*) FILTER (WHERE source_row_id IS NULL) AS null_source_id
FROM trapper.staged_records;

\echo ''
\echo 'Remaining stale duplicates (must be 0):'
SELECT COUNT(*) AS remaining_stale
FROM trapper.staged_records sr
WHERE sr.source_row_id IS NOT NULL
  AND sr.id NOT IN (
    SELECT DISTINCT ON (source_system, source_table, source_row_id) id
    FROM trapper.staged_records
    WHERE source_row_id IS NOT NULL
    ORDER BY source_system, source_table, source_row_id, created_at DESC
  );

\echo ''
\echo 'Post-change breakdown by source:'
SELECT source_system, source_table,
  COUNT(*) AS total,
  COUNT(DISTINCT source_row_id) AS distinct_ids
FROM trapper.staged_records
GROUP BY source_system, source_table
ORDER BY total DESC;

-- ============================================================================
-- Step 6: Active Flow Safety Gate
-- ============================================================================

\echo ''
\echo 'Step 6: Safety Gate'

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

\echo ''
\echo 'Staged records views still resolve:'
SELECT 'v_staged_records_latest_run' AS view_name, COUNT(*) AS rows FROM trapper.v_staged_records_latest_run
UNION ALL
SELECT 'v_clinichq_stats', COUNT(*) FROM trapper.v_clinichq_stats
UNION ALL
SELECT 'v_orchestrator_health', COUNT(*) FROM trapper.v_orchestrator_health;

-- ============================================================================
-- Step 7: Summary
-- ============================================================================

\echo ''
\echo '====== MIG_783 SUMMARY ======'
\echo 'Deleted stale staged records (older versions of re-ingested source records):'
\echo '  Stale staged_records deleted: ~2,311'
\echo '  data_quality_issues deleted: 130 (all referenced stale records, FK constraint)'
\echo ''
\echo '91,942 rows with NULL source_row_id are NOT duplicates (unique payloads) — untouched.'
\echo ''
\echo 'Backups preserved in:'
\echo '  trapper._backup_stale_staged_records_783'
\echo '  trapper._backup_data_quality_issues_783'
\echo ''
\echo 'Rollback:'
\echo '  INSERT INTO trapper.data_quality_issues SELECT * FROM trapper._backup_data_quality_issues_783;'
\echo '  INSERT INTO trapper.staged_records SELECT * FROM trapper._backup_stale_staged_records_783;'
\echo '=== MIG_783 Complete ==='
