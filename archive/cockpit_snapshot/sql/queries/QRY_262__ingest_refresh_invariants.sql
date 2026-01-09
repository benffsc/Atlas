-- QRY_262__ingest_refresh_invariants.sql
-- MEGA_008: Ingest refresh contract invariants
--
-- These checks validate that the ingest refresh contract is working correctly:
-- 1. No duplicates by (source_system, source_pk) in mutable data tables
-- 2. source_pk is populated for all records
-- 3. Row counts are stable (no unexpected growth)
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/queries/QRY_262__ingest_refresh_invariants.sql

\echo '============================================'
\echo 'MEGA_008: Ingest Refresh Contract Invariants'
\echo '============================================'
\echo ''

-- ============================================================
-- CHECK 1: No NULL source_pk values
-- ============================================================

\echo 'CHECK 1: No NULL source_pk values'

SELECT 'appointment_requests' AS table_name,
       COUNT(*) AS total_rows,
       COUNT(*) FILTER (WHERE source_pk IS NULL) AS null_source_pk,
       CASE WHEN COUNT(*) FILTER (WHERE source_pk IS NULL) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM trapper.appointment_requests

UNION ALL

SELECT 'clinichq_upcoming_appointments',
       COUNT(*),
       COUNT(*) FILTER (WHERE source_pk IS NULL),
       CASE WHEN COUNT(*) FILTER (WHERE source_pk IS NULL) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM trapper.clinichq_upcoming_appointments

UNION ALL

SELECT 'clinichq_hist_appts',
       COUNT(*),
       COUNT(*) FILTER (WHERE source_pk IS NULL),
       CASE WHEN COUNT(*) FILTER (WHERE source_pk IS NULL) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM trapper.clinichq_hist_appts

UNION ALL

SELECT 'clinichq_hist_cats',
       COUNT(*),
       COUNT(*) FILTER (WHERE source_pk IS NULL),
       CASE WHEN COUNT(*) FILTER (WHERE source_pk IS NULL) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM trapper.clinichq_hist_cats

UNION ALL

SELECT 'clinichq_hist_owners',
       COUNT(*),
       COUNT(*) FILTER (WHERE source_pk IS NULL),
       CASE WHEN COUNT(*) FILTER (WHERE source_pk IS NULL) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM trapper.clinichq_hist_owners;

\echo ''

-- ============================================================
-- CHECK 2: No duplicate (source_system, source_pk) in mutable tables
-- ============================================================

\echo 'CHECK 2: No duplicate (source_system, source_pk) in mutable tables'

WITH dupes AS (
    SELECT source_system, source_pk, COUNT(*) as cnt
    FROM trapper.appointment_requests
    GROUP BY source_system, source_pk
    HAVING COUNT(*) > 1
)
SELECT 'appointment_requests' AS table_name,
       COALESCE((SELECT COUNT(*) FROM dupes), 0) AS duplicate_count,
       CASE WHEN (SELECT COUNT(*) FROM dupes) = 0 THEN 'PASS' ELSE 'FAIL' END AS status;

WITH dupes AS (
    SELECT source_system, source_pk, COUNT(*) as cnt
    FROM trapper.clinichq_upcoming_appointments
    GROUP BY source_system, source_pk
    HAVING COUNT(*) > 1
)
SELECT 'clinichq_upcoming_appointments' AS table_name,
       COALESCE((SELECT COUNT(*) FROM dupes), 0) AS duplicate_count,
       CASE WHEN (SELECT COUNT(*) FROM dupes) = 0 THEN 'PASS' ELSE 'FAIL' END AS status;

\echo ''

-- ============================================================
-- CHECK 3: Unique constraint exists
-- ============================================================

\echo 'CHECK 3: Unique constraints exist'

SELECT 'appointment_requests' AS table_name,
       CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c
           JOIN pg_namespace n ON n.oid = c.connamespace
           WHERE n.nspname = 'trapper'
           AND c.conname = 'uq_appointment_requests_source_pk'
       ) THEN 'PASS' ELSE 'FAIL' END AS status;

SELECT 'clinichq_upcoming_appointments' AS table_name,
       CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c
           JOIN pg_namespace n ON n.oid = c.connamespace
           WHERE n.nspname = 'trapper'
           AND c.conname = 'uq_clinichq_upcoming_source_pk'
       ) THEN 'PASS' ELSE 'FAIL' END AS status;

\echo ''

-- ============================================================
-- CHECK 4: Row count summary
-- ============================================================

\echo 'CHECK 4: Row count summary'

SELECT 'requests (canonical)' AS table_name, COUNT(*) AS rows FROM trapper.requests
UNION ALL
SELECT 'appointment_requests', COUNT(*) FROM trapper.appointment_requests
UNION ALL
SELECT 'clinichq_upcoming_appointments', COUNT(*) FROM trapper.clinichq_upcoming_appointments
UNION ALL
SELECT 'clinichq_hist_appts', COUNT(*) FROM trapper.clinichq_hist_appts
UNION ALL
SELECT 'clinichq_hist_cats', COUNT(*) FROM trapper.clinichq_hist_cats
UNION ALL
SELECT 'clinichq_hist_owners', COUNT(*) FROM trapper.clinichq_hist_owners;

\echo ''

-- ============================================================
-- CHECK 5: Source PK uniqueness rate
-- ============================================================

\echo 'CHECK 5: Source PK uniqueness rate'

SELECT
    'appointment_requests' AS table_name,
    COUNT(*) AS total_rows,
    COUNT(DISTINCT source_pk) AS unique_pks,
    ROUND(100.0 * COUNT(DISTINCT source_pk) / NULLIF(COUNT(*), 0), 2) AS uniqueness_pct,
    CASE WHEN COUNT(*) = COUNT(DISTINCT source_pk) THEN 'PASS' ELSE 'WARN' END AS status
FROM trapper.appointment_requests

UNION ALL

SELECT
    'clinichq_upcoming_appointments',
    COUNT(*),
    COUNT(DISTINCT source_pk),
    ROUND(100.0 * COUNT(DISTINCT source_pk) / NULLIF(COUNT(*), 0), 2),
    CASE WHEN COUNT(*) = COUNT(DISTINCT source_pk) THEN 'PASS' ELSE 'WARN' END
FROM trapper.clinichq_upcoming_appointments;

\echo ''
\echo '============================================'
\echo 'Invariant checks complete.'
\echo '============================================'
