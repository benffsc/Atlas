-- MIG_243__pipeline_runs.sql
-- Pipeline run tracking for automated refresh jobs
-- Part of DEP_010: Deploy + auto-refresh pipeline
-- SAFE: Additive only, no destructive operations

-- ============================================================
-- PART 1: Create pipeline_runs table
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.pipeline_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Pipeline identification
    pipeline_name TEXT NOT NULL,

    -- Timing
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,

    -- Status: running, ok, error, skipped
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'ok', 'error', 'skipped')),

    -- Results
    row_counts JSONB DEFAULT '{}'::jsonb,
    details JSONB DEFAULT '{}'::jsonb,

    -- Error info (if failed)
    error_message TEXT,
    error_trace TEXT
);

COMMENT ON TABLE trapper.pipeline_runs IS
'Tracks automated pipeline runs (ingest, refresh, etc). Each row = one pipeline execution.';

COMMENT ON COLUMN trapper.pipeline_runs.pipeline_name IS
'Identifier for the pipeline: airtable_pull, clinichq_file_ingest, etc.';

COMMENT ON COLUMN trapper.pipeline_runs.row_counts IS
'JSON object with counts: {inserted: N, updated: M, skipped: K}';

COMMENT ON COLUMN trapper.pipeline_runs.details IS
'Freeform JSON for extra info: source files, warnings, etc.';

-- ============================================================
-- PART 2: Index for efficient queries
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_name_started
ON trapper.pipeline_runs(pipeline_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status
ON trapper.pipeline_runs(status) WHERE status = 'running';

-- ============================================================
-- PART 3: View for latest run per pipeline
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_pipeline_latest AS
SELECT DISTINCT ON (pipeline_name)
    id,
    pipeline_name,
    started_at,
    finished_at,
    status,
    row_counts,
    details,
    error_message,
    EXTRACT(EPOCH FROM (COALESCE(finished_at, NOW()) - started_at))::int AS duration_seconds,
    CASE
        WHEN status = 'running' THEN 'In Progress'
        WHEN status = 'ok' THEN 'Success'
        WHEN status = 'error' THEN 'Failed'
        WHEN status = 'skipped' THEN 'Skipped'
    END AS status_display,
    -- Time since last run
    EXTRACT(EPOCH FROM (NOW() - started_at))::int AS seconds_ago
FROM trapper.pipeline_runs
ORDER BY pipeline_name, started_at DESC;

COMMENT ON VIEW trapper.v_pipeline_latest IS
'Latest run per pipeline for dashboard display.';

-- ============================================================
-- PART 4: View for pipeline health summary
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_pipeline_health AS
SELECT
    pipeline_name,
    COUNT(*) AS total_runs,
    COUNT(*) FILTER (WHERE status = 'ok') AS successful_runs,
    COUNT(*) FILTER (WHERE status = 'error') AS failed_runs,
    MAX(started_at) AS last_run_at,
    MAX(started_at) FILTER (WHERE status = 'ok') AS last_success_at,
    MAX(started_at) FILTER (WHERE status = 'error') AS last_failure_at,
    -- Success rate (last 10 runs)
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE status = 'ok') / NULLIF(COUNT(*), 0),
        1
    ) AS success_rate_pct
FROM trapper.pipeline_runs
WHERE started_at > NOW() - INTERVAL '30 days'
GROUP BY pipeline_name;

COMMENT ON VIEW trapper.v_pipeline_health IS
'Pipeline health metrics over the last 30 days.';

-- ============================================================
-- PART 5: Helper function to start a pipeline run
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.start_pipeline_run(
    p_pipeline_name TEXT,
    p_details JSONB DEFAULT '{}'::jsonb
) RETURNS UUID AS $$
DECLARE
    v_run_id UUID;
BEGIN
    INSERT INTO trapper.pipeline_runs (pipeline_name, details)
    VALUES (p_pipeline_name, p_details)
    RETURNING id INTO v_run_id;

    RETURN v_run_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PART 6: Helper function to complete a pipeline run
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.complete_pipeline_run(
    p_run_id UUID,
    p_status TEXT,
    p_row_counts JSONB DEFAULT '{}'::jsonb,
    p_error_message TEXT DEFAULT NULL,
    p_error_trace TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    UPDATE trapper.pipeline_runs
    SET
        finished_at = NOW(),
        status = p_status,
        row_counts = p_row_counts,
        error_message = p_error_message,
        error_trace = p_error_trace
    WHERE id = p_run_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Verification
-- ============================================================

\echo ''
\echo 'MIG_243 applied. Pipeline tracking ready.'
\echo ''

\echo 'Tables created:'
SELECT tablename FROM pg_tables
WHERE schemaname = 'trapper' AND tablename = 'pipeline_runs';

\echo ''
\echo 'Views created:'
SELECT viewname FROM pg_views
WHERE schemaname = 'trapper' AND viewname LIKE 'v_pipeline%';

\echo ''
\echo 'Functions created:'
SELECT proname FROM pg_proc
WHERE pronamespace = 'trapper'::regnamespace
AND proname LIKE '%pipeline%';
