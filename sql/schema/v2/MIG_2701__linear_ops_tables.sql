-- MIG_2701: Linear Integration - OPS Tables
--
-- Creates processed/usable Linear data tables.
-- Denormalizes data for efficient querying in admin UI.
--
-- @see MIG_2700 for source layer
-- @see docs/DATA_FLOW_ARCHITECTURE.md
--
-- Created: 2026-02-28

\echo ''
\echo '=============================================='
\echo '  MIG_2701: Linear OPS Tables'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE ops.linear_issues TABLE
-- ============================================================================

\echo '1. Creating ops.linear_issues...'

CREATE TABLE IF NOT EXISTS ops.linear_issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    linear_id TEXT UNIQUE NOT NULL,
    identifier TEXT NOT NULL,        -- e.g., "ATL-123"
    title TEXT NOT NULL,
    description TEXT,

    -- State tracking
    state_id TEXT,
    state_name TEXT,
    state_type TEXT,                 -- 'backlog', 'unstarted', 'started', 'completed', 'canceled'

    -- Priority (1=urgent, 2=high, 3=normal, 4=low, 0=none)
    priority INTEGER,
    priority_label TEXT,

    -- Relationships
    project_id TEXT,
    project_name TEXT,
    cycle_id TEXT,
    cycle_name TEXT,
    assignee_id TEXT,
    assignee_name TEXT,
    creator_id TEXT,
    creator_name TEXT,

    -- Metadata
    labels JSONB DEFAULT '[]'::JSONB,  -- Array of {id, name, color}
    estimate INTEGER,                  -- Story points
    due_date DATE,

    -- Timestamps from Linear
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    canceled_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,

    -- Linear URL
    url TEXT,

    -- Atlas linking
    atlas_request_id UUID REFERENCES ops.requests(request_id),
    atlas_linked_at TIMESTAMPTZ,
    atlas_linked_by TEXT,

    -- Sync metadata
    source_raw_id UUID,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE ops.linear_issues IS
'Processed Linear issues with denormalized project/cycle/assignee names.
Used for admin UI display and Atlas request linking.';

CREATE INDEX IF NOT EXISTS idx_linear_issues_state ON ops.linear_issues(state_type);
CREATE INDEX IF NOT EXISTS idx_linear_issues_project ON ops.linear_issues(project_id);
CREATE INDEX IF NOT EXISTS idx_linear_issues_cycle ON ops.linear_issues(cycle_id);
CREATE INDEX IF NOT EXISTS idx_linear_issues_assignee ON ops.linear_issues(assignee_id);
CREATE INDEX IF NOT EXISTS idx_linear_issues_atlas ON ops.linear_issues(atlas_request_id) WHERE atlas_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_linear_issues_identifier ON ops.linear_issues(identifier);

\echo '   Created ops.linear_issues'

-- ============================================================================
-- 2. CREATE ops.linear_projects TABLE
-- ============================================================================

\echo '2. Creating ops.linear_projects...'

CREATE TABLE IF NOT EXISTS ops.linear_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    linear_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    state TEXT,                      -- 'planned', 'started', 'paused', 'completed', 'canceled'
    icon TEXT,
    color TEXT,
    slug_id TEXT,                    -- URL-safe identifier
    url TEXT,
    target_date DATE,
    start_date DATE,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE ops.linear_projects IS
'Processed Linear projects for grouping related issues.';

CREATE INDEX IF NOT EXISTS idx_linear_projects_state ON ops.linear_projects(state);

\echo '   Created ops.linear_projects'

-- ============================================================================
-- 3. CREATE ops.linear_cycles TABLE
-- ============================================================================

\echo '3. Creating ops.linear_cycles...'

CREATE TABLE IF NOT EXISTS ops.linear_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    linear_id TEXT UNIQUE NOT NULL,
    name TEXT,
    number INTEGER,                  -- Cycle number (1, 2, 3...)
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    progress NUMERIC(5,2),           -- Percentage complete
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE ops.linear_cycles IS
'Processed Linear cycles (sprints) for time-boxed work tracking.';

CREATE INDEX IF NOT EXISTS idx_linear_cycles_current
ON ops.linear_cycles(starts_at, ends_at)
WHERE completed_at IS NULL;

\echo '   Created ops.linear_cycles'

-- ============================================================================
-- 4. CREATE ops.linear_team_members TABLE
-- ============================================================================

\echo '4. Creating ops.linear_team_members...'

CREATE TABLE IF NOT EXISTS ops.linear_team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    linear_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    display_name TEXT,
    email TEXT,
    avatar_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE ops.linear_team_members IS
'Processed Linear team members for assignee display.';

CREATE INDEX IF NOT EXISTS idx_linear_team_active ON ops.linear_team_members(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_linear_team_email ON ops.linear_team_members(email) WHERE email IS NOT NULL;

\echo '   Created ops.linear_team_members'

-- ============================================================================
-- 5. CREATE ops.linear_labels TABLE
-- ============================================================================

\echo '5. Creating ops.linear_labels...'

CREATE TABLE IF NOT EXISTS ops.linear_labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    linear_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    color TEXT,
    description TEXT,
    parent_id TEXT,                  -- For hierarchical labels
    created_at TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE ops.linear_labels IS
'Processed Linear labels for issue categorization.';

\echo '   Created ops.linear_labels'

-- ============================================================================
-- 6. CREATE ops.linear_claude_sessions TABLE
-- ============================================================================

\echo '6. Creating ops.linear_claude_sessions...'

CREATE TABLE IF NOT EXISTS ops.linear_claude_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,        -- Claude Code session identifier
    linear_issue_id TEXT,            -- Links to ops.linear_issues.linear_id
    branch_name TEXT,
    commit_hashes TEXT[],            -- Array of associated commits
    pr_number INTEGER,
    pr_url TEXT,
    status TEXT CHECK (status IN ('active', 'paused', 'completed', 'abandoned')) DEFAULT 'active',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    summary TEXT,                    -- Work summary on completion
    files_changed TEXT[],            -- Array of modified file paths
    metadata JSONB DEFAULT '{}'::JSONB,
    CONSTRAINT fk_linear_claude_sessions_issue
        FOREIGN KEY (linear_issue_id) REFERENCES ops.linear_issues(linear_id)
        ON DELETE SET NULL
);

COMMENT ON TABLE ops.linear_claude_sessions IS
'Links Claude Code development sessions to Linear issues.
Tracks commits, PRs, and files changed during each session.';

CREATE INDEX IF NOT EXISTS idx_linear_sessions_issue ON ops.linear_claude_sessions(linear_issue_id);
CREATE INDEX IF NOT EXISTS idx_linear_sessions_session ON ops.linear_claude_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_linear_sessions_active ON ops.linear_claude_sessions(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_linear_sessions_branch ON ops.linear_claude_sessions(branch_name) WHERE branch_name IS NOT NULL;

\echo '   Created ops.linear_claude_sessions'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Tables created:'
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'ops'
  AND table_name LIKE 'linear%'
ORDER BY table_name;

\echo ''
\echo '=============================================='
\echo '  MIG_2701 Complete!'
\echo '=============================================='
\echo ''
