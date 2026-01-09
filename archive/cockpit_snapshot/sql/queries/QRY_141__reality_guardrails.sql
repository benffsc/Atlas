-- QRY_141__reality_guardrails.sql
-- Reality Guardrails: Quick checks to ensure logic layer matches operational reality
--
-- Usage:
--   make reality-check
--   OR
--   source .env && psql "$DATABASE_URL" -f sql/queries/QRY_141__reality_guardrails.sql
--
-- See also: docs/REALITY_CONTRACT.md

\echo '============================================'
\echo '  Reality Guardrails Check'
\echo '============================================'
\echo ''

-- ============================================
-- 1. Status Distribution
-- ============================================
\echo '1. Status Distribution:'
\echo '-----------------------'

SELECT
    status::text AS status,
    COUNT(*) AS count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM trapper.requests
GROUP BY status
ORDER BY count DESC;

\echo ''

-- ============================================
-- 2. TNR Stage Distribution
-- ============================================
\echo '2. TNR Stage Distribution:'
\echo '--------------------------'

WITH staged AS (
    SELECT
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
    COUNT(*) AS count,
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
-- 3. Triage Bucket Counts
-- ============================================
\echo '3. Triage Bucket Counts:'
\echo '------------------------'

SELECT bucket, count
FROM trapper.v_triage_counts
ORDER BY
    CASE bucket
        WHEN 'needs_geo' THEN 1
        WHEN 'raw_address' THEN 2
        WHEN 'missing_contact' THEN 3
        WHEN 'unassigned' THEN 4
        ELSE 5
    END;

\echo ''

-- ============================================
-- 4. Data Issues Summary (if table exists)
-- ============================================
\echo '4. Data Issues Summary (open only):'
\echo '------------------------------------'

SELECT issue_type, COUNT(*) AS open_count
FROM trapper.data_issues
WHERE NOT is_resolved
GROUP BY issue_type
ORDER BY open_count DESC;

\echo ''

-- ============================================
-- 5. Assignment Coverage
-- ============================================
\echo '5. Assignment Coverage (ops-active requests):'
\echo '----------------------------------------------'

SELECT
    CASE WHEN assigned_trapper_person_id IS NOT NULL THEN 'assigned' ELSE 'unassigned' END AS assignment_status,
    COUNT(*) AS count
FROM trapper.requests
WHERE status::text IN ('new', 'needs_review', 'in_progress', 'active', 'paused')
  AND (archive_reason IS NULL OR archive_reason = '')
GROUP BY 1
ORDER BY 1;

\echo ''
\echo '============================================'
\echo '  Reality Guardrails Complete'
\echo '============================================'
