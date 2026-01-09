-- QRY_081__hist_ingest_smoke.sql
-- Quick smoke test for ClinicHQ historical ingest
-- Fast checks: row counts, date ranges, hash duplicates
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/queries/QRY_081__hist_ingest_smoke.sql

\pset pager off
\echo '=== HIST INGEST SMOKE TEST ==='

-- Row counts + date ranges (single query for speed)
SELECT
    'clinichq_hist_appts' AS tbl,
    COUNT(*)::text AS rows,
    MIN(appt_date)::text AS min_date,
    MAX(appt_date)::text AS max_date,
    (COUNT(*) - COUNT(DISTINCT (source_file, source_row_hash)))::text AS hash_dupes
FROM trapper.clinichq_hist_appts
UNION ALL
SELECT 'clinichq_hist_cats', COUNT(*)::text, MIN(appt_date)::text, MAX(appt_date)::text,
       (COUNT(*) - COUNT(DISTINCT (source_file, source_row_hash)))::text
FROM trapper.clinichq_hist_cats
UNION ALL
SELECT 'clinichq_hist_owners', COUNT(*)::text, MIN(appt_date)::text, MAX(appt_date)::text,
       (COUNT(*) - COUNT(DISTINCT (source_file, source_row_hash)))::text
FROM trapper.clinichq_hist_owners
ORDER BY tbl;

-- Quick health check
\echo ''
SELECT
    CASE
        WHEN (SELECT COUNT(*) FROM trapper.clinichq_hist_appts) > 0
             AND (SELECT COUNT(*) - COUNT(DISTINCT (source_file, source_row_hash)) FROM trapper.clinichq_hist_appts) = 0
        THEN 'OK - appts populated, no dupes'
        WHEN (SELECT COUNT(*) FROM trapper.clinichq_hist_appts) = 0
        THEN 'EMPTY - run ingest'
        ELSE 'WARNING - hash dupes detected'
    END AS status;

\echo '=== SMOKE TEST COMPLETE ==='
