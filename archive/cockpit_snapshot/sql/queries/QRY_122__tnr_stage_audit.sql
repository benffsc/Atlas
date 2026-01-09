-- QRY_122__tnr_stage_audit.sql
-- TNR Stage distribution audit
--
-- Purpose: Shows counts by request status and TNR stage.
-- Helps verify the stage mapping logic and identify unmapped statuses.
--
-- Usage:
--   make tnr-audit
--   OR
--   source .env && psql "$DATABASE_URL" -f sql/queries/QRY_122__tnr_stage_audit.sql

\echo '============================================'
\echo '  TNR Stage Audit Report'
\echo '============================================'
\echo ''

-- ============================================
-- 1. Counts by TNR Stage
-- ============================================
\echo '1. Counts by TNR Stage:'
\echo '------------------------'

WITH staged AS (
    SELECT
        status::text AS raw_status,
        CASE status::text
            WHEN 'new' THEN 'intake'
            WHEN 'needs_review' THEN 'intake'
            WHEN 'in_progress' THEN 'fieldwork'
            WHEN 'active' THEN 'fieldwork'
            WHEN 'paused' THEN 'paused'
            WHEN 'closed' THEN 'closed'
            WHEN 'resolved' THEN 'closed'
            ELSE 'unknown'
        END AS tnr_stage
    FROM trapper.requests
)
SELECT
    tnr_stage,
    COUNT(*) AS request_count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM staged
GROUP BY tnr_stage
ORDER BY
    CASE tnr_stage
        WHEN 'intake' THEN 1
        WHEN 'fieldwork' THEN 2
        WHEN 'paused' THEN 3
        WHEN 'closed' THEN 4
        ELSE 5
    END;

\echo ''

-- ============================================
-- 2. Counts by Raw Status
-- ============================================
\echo '2. Counts by Raw Status:'
\echo '------------------------'

SELECT
    status::text AS raw_status,
    CASE status::text
        WHEN 'new' THEN 'intake'
        WHEN 'needs_review' THEN 'intake'
        WHEN 'in_progress' THEN 'fieldwork'
        WHEN 'active' THEN 'fieldwork'
        WHEN 'paused' THEN 'paused'
        WHEN 'closed' THEN 'closed'
        WHEN 'resolved' THEN 'closed'
        ELSE 'unknown'
    END AS tnr_stage,
    COUNT(*) AS request_count
FROM trapper.requests
GROUP BY status
ORDER BY request_count DESC;

\echo ''

-- ============================================
-- 3. Unmapped/Unknown Statuses
-- ============================================
\echo '3. Unmapped/Unknown Statuses:'
\echo '-----------------------------'

SELECT
    status::text AS raw_status,
    COUNT(*) AS request_count
FROM trapper.requests
WHERE status::text NOT IN ('new', 'needs_review', 'in_progress', 'active', 'paused', 'closed', 'resolved')
GROUP BY status
ORDER BY request_count DESC;

-- If no rows, show a message
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM trapper.requests
        WHERE status::text NOT IN ('new', 'needs_review', 'in_progress', 'active', 'paused', 'closed', 'resolved')
    ) THEN
        RAISE NOTICE '  (none - all statuses are mapped)';
    END IF;
END $$;

\echo ''

-- ============================================
-- 4. Stage Distribution (Ops-Active Only)
-- ============================================
\echo '4. Stage Distribution (Ops-Active Only):'
\echo '-----------------------------------------'

WITH staged AS (
    SELECT
        status::text AS raw_status,
        CASE status::text
            WHEN 'new' THEN 'intake'
            WHEN 'needs_review' THEN 'intake'
            WHEN 'in_progress' THEN 'fieldwork'
            WHEN 'active' THEN 'fieldwork'
            WHEN 'paused' THEN 'paused'
            WHEN 'closed' THEN 'closed'
            WHEN 'resolved' THEN 'closed'
            ELSE 'unknown'
        END AS tnr_stage
    FROM trapper.requests
    WHERE status::text IN ('new', 'needs_review', 'in_progress', 'active', 'paused')
      AND (archive_reason IS NULL OR archive_reason = '')
)
SELECT
    tnr_stage,
    COUNT(*) AS request_count
FROM staged
GROUP BY tnr_stage
ORDER BY
    CASE tnr_stage
        WHEN 'intake' THEN 1
        WHEN 'fieldwork' THEN 2
        WHEN 'paused' THEN 3
        ELSE 5
    END;

\echo ''
\echo '============================================'
\echo '  End of TNR Stage Audit'
\echo '============================================'
