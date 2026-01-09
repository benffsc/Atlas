-- QRY_076__duplicates_missing_merge_target.sql
-- List duplicates where merged_into_source_record_id is set but merged_into_case_number is NULL
--
-- Purpose: Identify duplicates that have a merge link but the target case_number couldn't be resolved.
-- These need manual review or the target request may not exist in the database yet.
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/queries/QRY_076__duplicates_missing_merge_target.sql

\pset pager off
\echo '=============================================='
\echo 'DUPLICATES MISSING MERGE TARGET CASE NUMBER'
\echo '=============================================='

-- ============================================
-- 1) DUPLICATES WITH UNRESOLVED MERGE TARGETS
-- ============================================
\echo ''
\echo '--- Duplicates with merged_into_source_record_id but no case_number ---'

SELECT
    r.case_number AS dup_case_number,
    r.source_record_id AS dup_source_record_id,
    r.merged_into_source_record_id AS target_source_record_id,
    r.merged_into_case_number AS target_case_number,
    r.status::text,
    r.archive_reason,
    r.archived_at::date AS archived_date
FROM trapper.requests r
WHERE r.archive_reason = 'duplicate'
  AND r.merged_into_source_record_id IS NOT NULL
  AND r.merged_into_case_number IS NULL
ORDER BY r.case_number;

-- ============================================
-- 2) CHECK IF TARGET EXISTS IN DB
-- ============================================
\echo ''
\echo '--- Target source_record_ids that may exist in DB ---'

SELECT
    r.case_number AS dup_case,
    r.merged_into_source_record_id AS target_rid,
    target.case_number AS found_target_case,
    target.status::text AS target_status
FROM trapper.requests r
LEFT JOIN trapper.requests target
    ON target.source_record_id = r.merged_into_source_record_id
WHERE r.archive_reason = 'duplicate'
  AND r.merged_into_source_record_id IS NOT NULL
  AND r.merged_into_case_number IS NULL
ORDER BY r.case_number;

-- ============================================
-- 3) SUMMARY
-- ============================================
\echo ''
\echo '--- Summary ---'

SELECT
    'Total duplicates' AS metric,
    COUNT(*)::text AS value
FROM trapper.requests
WHERE archive_reason = 'duplicate'
UNION ALL
SELECT
    'With merge target resolved',
    COUNT(*)::text
FROM trapper.requests
WHERE archive_reason = 'duplicate'
  AND merged_into_case_number IS NOT NULL
UNION ALL
SELECT
    'With merge target UNRESOLVED',
    COUNT(*)::text
FROM trapper.requests
WHERE archive_reason = 'duplicate'
  AND merged_into_source_record_id IS NOT NULL
  AND merged_into_case_number IS NULL
UNION ALL
SELECT
    'No merge link at all',
    COUNT(*)::text
FROM trapper.requests
WHERE archive_reason = 'duplicate'
  AND merged_into_source_record_id IS NULL;

\echo ''
\echo '=============================================='
\echo 'QUERY COMPLETE'
\echo '=============================================='
