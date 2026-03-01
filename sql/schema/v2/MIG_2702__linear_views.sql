-- MIG_2702: Linear Integration - Views
--
-- Creates dashboard and reporting views for Linear data.
--
-- @see MIG_2700, MIG_2701 for tables
--
-- Created: 2026-02-28

\echo ''
\echo '=============================================='
\echo '  MIG_2702: Linear Views'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE ops.v_linear_sync_status VIEW
-- ============================================================================

\echo '1. Creating ops.v_linear_sync_status...'

CREATE OR REPLACE VIEW ops.v_linear_sync_status AS
SELECT
    sync_type,
    last_sync_at,
    last_sync_cursor,
    records_synced,
    error_message,
    CASE
        WHEN error_message IS NOT NULL THEN 'error'
        WHEN last_sync_at IS NULL THEN 'never'
        WHEN last_sync_at < NOW() - INTERVAL '2 hours' THEN 'stale'
        ELSE 'healthy'
    END AS sync_health,
    updated_at
FROM source.linear_sync_state
ORDER BY sync_type;

COMMENT ON VIEW ops.v_linear_sync_status IS
'Dashboard view showing sync health for each Linear entity type.
Health states: healthy, stale (>2h old), error, never.';

\echo '   Created ops.v_linear_sync_status'

-- ============================================================================
-- 2. CREATE ops.v_linear_issue_summary VIEW
-- ============================================================================

\echo '2. Creating ops.v_linear_issue_summary...'

CREATE OR REPLACE VIEW ops.v_linear_issue_summary AS
SELECT
    state_type,
    COUNT(*) as issue_count,
    COUNT(*) FILTER (WHERE priority >= 3) as high_priority,
    COUNT(*) FILTER (WHERE atlas_request_id IS NOT NULL) as linked_to_atlas,
    COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND state_type NOT IN ('completed', 'canceled')) as overdue
FROM ops.linear_issues
WHERE archived_at IS NULL
GROUP BY state_type
ORDER BY
    CASE state_type
        WHEN 'backlog' THEN 1
        WHEN 'unstarted' THEN 2
        WHEN 'started' THEN 3
        WHEN 'completed' THEN 4
        WHEN 'canceled' THEN 5
        ELSE 6
    END;

COMMENT ON VIEW ops.v_linear_issue_summary IS
'Summary statistics for Linear issues by state type.
Used for dashboard metrics display.';

\echo '   Created ops.v_linear_issue_summary'

-- ============================================================================
-- 3. CREATE ops.v_linear_current_cycle VIEW
-- ============================================================================

\echo '3. Creating ops.v_linear_current_cycle...'

CREATE OR REPLACE VIEW ops.v_linear_current_cycle AS
SELECT
    c.id,
    c.linear_id,
    c.name,
    c.number,
    c.starts_at,
    c.ends_at,
    c.progress,
    COUNT(i.id) as total_issues,
    COUNT(*) FILTER (WHERE i.state_type = 'completed') as completed_issues,
    COUNT(*) FILTER (WHERE i.state_type = 'started') as in_progress_issues,
    COUNT(*) FILTER (WHERE i.state_type IN ('backlog', 'unstarted')) as todo_issues,
    EXTRACT(DAY FROM c.ends_at - NOW())::INT as days_remaining
FROM ops.linear_cycles c
LEFT JOIN ops.linear_issues i ON i.cycle_id = c.linear_id AND i.archived_at IS NULL
WHERE c.starts_at <= NOW()
  AND (c.ends_at > NOW() OR c.ends_at IS NULL)
  AND c.completed_at IS NULL
GROUP BY c.id;

COMMENT ON VIEW ops.v_linear_current_cycle IS
'Details for the currently active cycle including issue counts by state.';

\echo '   Created ops.v_linear_current_cycle'

-- ============================================================================
-- 4. CREATE ops.v_linear_claude_activity VIEW
-- ============================================================================

\echo '4. Creating ops.v_linear_claude_activity...'

CREATE OR REPLACE VIEW ops.v_linear_claude_activity AS
SELECT
    cs.id,
    cs.session_id,
    cs.branch_name,
    cs.status,
    cs.started_at,
    cs.completed_at,
    cs.pr_number,
    cs.pr_url,
    cs.summary,
    array_length(cs.commit_hashes, 1) as commit_count,
    array_length(cs.files_changed, 1) as files_count,
    i.linear_id as issue_linear_id,
    i.identifier as issue_identifier,
    i.title as issue_title,
    i.state_name as issue_state,
    i.url as issue_url,
    p.name as project_name,
    EXTRACT(EPOCH FROM (COALESCE(cs.completed_at, NOW()) - cs.started_at)) / 3600 as duration_hours
FROM ops.linear_claude_sessions cs
LEFT JOIN ops.linear_issues i ON i.linear_id = cs.linear_issue_id
LEFT JOIN ops.linear_projects p ON p.linear_id = i.project_id
ORDER BY cs.started_at DESC;

COMMENT ON VIEW ops.v_linear_claude_activity IS
'Claude Code session activity with linked issue details.
Used for tracking development work on Linear issues.';

\echo '   Created ops.v_linear_claude_activity'

-- ============================================================================
-- 5. CREATE ops.v_linear_project_progress VIEW
-- ============================================================================

\echo '5. Creating ops.v_linear_project_progress...'

CREATE OR REPLACE VIEW ops.v_linear_project_progress AS
SELECT
    p.id,
    p.linear_id,
    p.name,
    p.state,
    p.start_date,
    p.target_date,
    p.url,
    COUNT(i.id) as total_issues,
    COUNT(*) FILTER (WHERE i.state_type = 'completed') as completed_issues,
    COUNT(*) FILTER (WHERE i.state_type = 'started') as in_progress_issues,
    COUNT(*) FILTER (WHERE i.state_type IN ('backlog', 'unstarted')) as todo_issues,
    CASE
        WHEN COUNT(i.id) = 0 THEN 0
        ELSE ROUND(COUNT(*) FILTER (WHERE i.state_type = 'completed') * 100.0 / COUNT(i.id), 1)
    END as completion_percentage
FROM ops.linear_projects p
LEFT JOIN ops.linear_issues i ON i.project_id = p.linear_id AND i.archived_at IS NULL
WHERE p.state NOT IN ('canceled', 'completed')
GROUP BY p.id
ORDER BY p.target_date NULLS LAST, p.name;

COMMENT ON VIEW ops.v_linear_project_progress IS
'Project progress summary with issue completion percentages.';

\echo '   Created ops.v_linear_project_progress'

-- ============================================================================
-- 6. CREATE ops.v_linear_team_workload VIEW
-- ============================================================================

\echo '6. Creating ops.v_linear_team_workload...'

CREATE OR REPLACE VIEW ops.v_linear_team_workload AS
SELECT
    tm.id,
    tm.linear_id,
    tm.name,
    tm.display_name,
    tm.avatar_url,
    COUNT(i.id) FILTER (WHERE i.state_type = 'started') as in_progress,
    COUNT(i.id) FILTER (WHERE i.state_type IN ('backlog', 'unstarted')) as assigned_todo,
    COUNT(i.id) FILTER (WHERE i.due_date < CURRENT_DATE AND i.state_type NOT IN ('completed', 'canceled')) as overdue,
    SUM(i.estimate) FILTER (WHERE i.state_type IN ('started', 'unstarted', 'backlog')) as total_estimate
FROM ops.linear_team_members tm
LEFT JOIN ops.linear_issues i ON i.assignee_id = tm.linear_id AND i.archived_at IS NULL
WHERE tm.is_active = TRUE
GROUP BY tm.id
ORDER BY tm.name;

COMMENT ON VIEW ops.v_linear_team_workload IS
'Team member workload summary showing assigned issues and estimates.';

\echo '   Created ops.v_linear_team_workload'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Views created:'
SELECT table_schema, table_name, view_definition IS NOT NULL as is_view
FROM information_schema.tables
WHERE table_schema = 'ops'
  AND table_name LIKE 'v_linear%'
ORDER BY table_name;

\echo ''
\echo 'Testing views (should return empty):'
SELECT * FROM ops.v_linear_sync_status;
SELECT * FROM ops.v_linear_issue_summary;

\echo ''
\echo '=============================================='
\echo '  MIG_2702 Complete!'
\echo '=============================================='
\echo ''
