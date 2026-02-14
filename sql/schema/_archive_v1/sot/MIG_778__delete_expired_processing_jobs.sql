-- ============================================================================
-- MIG_778: Delete Expired Processing Jobs (DH_A001)
-- ============================================================================
-- TASK_LEDGER reference: DH_A001
-- ACTIVE Impact: No — processing_jobs is background async queue
--
-- Deletes 26,204 expired processing jobs tagged by MIG_772.
-- These are phantom jobs whose records were already processed by direct
-- ingest script calls. They sit in 'expired' status with no value.
-- ============================================================================

\echo '=== MIG_778: Delete Expired Processing Jobs (DH_A001) ==='

-- ============================================================================
-- Step 1: Pre-delete diagnostics
-- ============================================================================

\echo ''
\echo 'Step 1: Pre-delete state'

\echo 'Processing jobs by status:'
SELECT status, COUNT(*) AS cnt,
    pg_size_pretty(SUM(pg_column_size(processing_jobs.*))::bigint) AS est_data_size
FROM trapper.processing_jobs
GROUP BY status
ORDER BY cnt DESC;

\echo ''
\echo 'Total table size:'
SELECT pg_size_pretty(pg_total_relation_size('trapper.processing_jobs')) AS total_size;

-- ============================================================================
-- Step 2: Verify no FK references to processing_jobs
-- ============================================================================

\echo ''
\echo 'Step 2: FK references to processing_jobs (should be 0 or self-referential):'

SELECT conname AS constraint_name,
    conrelid::regclass AS referencing_table,
    confrelid::regclass AS referenced_table
FROM pg_constraint
WHERE confrelid = 'trapper.processing_jobs'::regclass;

-- ============================================================================
-- Step 3: Verify no views read expired jobs specifically
-- ============================================================================

\echo ''
\echo 'Step 3: Views referencing processing_jobs:'

SELECT viewname
FROM pg_views
WHERE schemaname = 'trapper'
  AND definition ILIKE '%processing_jobs%';

-- ============================================================================
-- Step 4: Create backup
-- ============================================================================

\echo ''
\echo 'Step 4: Creating backup of expired jobs'

DROP TABLE IF EXISTS trapper._backup_expired_jobs_778;

CREATE TABLE trapper._backup_expired_jobs_778 AS
SELECT job_id, source_system, source_table, status, queued_at, completed_at, last_error
FROM trapper.processing_jobs
WHERE status = 'expired';

\echo 'Backup rows:'
SELECT COUNT(*) AS backup_rows FROM trapper._backup_expired_jobs_778;

-- ============================================================================
-- Step 5: Delete expired jobs
-- ============================================================================

\echo ''
\echo 'Step 5: Deleting expired processing jobs'

DELETE FROM trapper.processing_jobs WHERE status = 'expired';

\echo 'Rows deleted (check via backup count vs remaining):'
SELECT COUNT(*) AS remaining_jobs FROM trapper.processing_jobs;

-- ============================================================================
-- Step 6: Post-delete diagnostics
-- ============================================================================

\echo ''
\echo 'Step 6: Post-delete state'

\echo 'Processing jobs by status:'
SELECT status, COUNT(*) AS cnt FROM trapper.processing_jobs GROUP BY status ORDER BY cnt DESC;

\echo ''
\echo 'Table size after cleanup:'
SELECT pg_size_pretty(pg_total_relation_size('trapper.processing_jobs')) AS total_size;

-- ============================================================================
-- Step 7: Summary
-- ============================================================================

\echo ''
\echo '====== MIG_778 SUMMARY ======'
\echo 'Deleted expired processing jobs (tagged by MIG_772).'
\echo 'Backup table: trapper._backup_expired_jobs_778'
\echo ''
\echo 'Rollback:'
\echo '  INSERT INTO trapper.processing_jobs (job_id, source_system, source_table, status, queued_at, completed_at, last_error)'
\echo '  SELECT job_id, source_system, source_table, status, queued_at, completed_at, last_error'
\echo '  FROM trapper._backup_expired_jobs_778;'
\echo ''
\echo '=== MIG_778 Complete ==='
