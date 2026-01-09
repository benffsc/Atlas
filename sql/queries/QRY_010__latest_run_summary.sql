-- QRY_010__latest_run_summary.sql
-- Latest ingest run summary by source system and table
--
-- Shows the most recent successful ingest for each source table,
-- including row counts and timing.
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_010__latest_run_summary.sql

SELECT
    ir.source_system,
    ir.source_table,
    ir.run_status,
    ir.row_count AS file_rows,
    ir.rows_inserted,
    ir.rows_linked,
    ROUND(ir.run_duration_ms / 1000.0, 1) AS duration_sec,
    ir.started_at::date AS run_date,
    LEFT(ir.source_file_name, 40) AS file_name
FROM trapper.ingest_runs ir
WHERE ir.run_id IN (
    SELECT DISTINCT ON (source_system, source_table) run_id
    FROM trapper.ingest_runs
    WHERE run_status = 'completed'
    ORDER BY source_system, source_table, started_at DESC
)
ORDER BY ir.source_system, ir.source_table;

-- Also show staged record counts by source
\echo ''
\echo 'Staged records by source:'
SELECT source_system, source_table, COUNT(*) AS records
FROM trapper.staged_records
GROUP BY 1, 2
ORDER BY 1, 2;
