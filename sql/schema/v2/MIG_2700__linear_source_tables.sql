-- MIG_2700: Linear Integration - Source Tables
--
-- Creates immutable raw storage layer for Linear API data.
-- Follows the established 3-layer pattern:
--   source.* (raw) → ops.* (processed) → sot.* (not used - Linear is external)
--
-- @see docs/DATA_FLOW_ARCHITECTURE.md
--
-- Created: 2026-02-28

\echo ''
\echo '=============================================='
\echo '  MIG_2700: Linear Source Tables'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE source.linear_raw TABLE
-- ============================================================================

\echo '1. Creating source.linear_raw...'

CREATE TABLE IF NOT EXISTS source.linear_raw (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_type TEXT NOT NULL CHECK (record_type IN (
        'issue', 'project', 'cycle', 'label', 'team',
        'user', 'comment', 'workflow_state'
    )),
    source_record_id TEXT NOT NULL,  -- Linear UUID
    payload JSONB NOT NULL,
    row_hash TEXT NOT NULL,          -- MD5 of payload for dedup
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_run_id UUID,                -- Links to ops.ingest_runs
    UNIQUE (record_type, source_record_id, row_hash)
);

COMMENT ON TABLE source.linear_raw IS
'Immutable raw storage for Linear API responses.
Each unique (record_type, source_record_id, row_hash) is stored once.
Hash-based dedup ensures we only store when data changes.';

CREATE INDEX IF NOT EXISTS idx_linear_raw_type_id
ON source.linear_raw(record_type, source_record_id);

CREATE INDEX IF NOT EXISTS idx_linear_raw_fetched
ON source.linear_raw(fetched_at DESC);

\echo '   Created source.linear_raw'

-- ============================================================================
-- 2. CREATE source.linear_sync_state TABLE
-- ============================================================================

\echo '2. Creating source.linear_sync_state...'

CREATE TABLE IF NOT EXISTS source.linear_sync_state (
    sync_type TEXT PRIMARY KEY,
    last_sync_cursor TEXT,           -- Cursor for pagination
    last_sync_at TIMESTAMPTZ,
    records_synced INTEGER DEFAULT 0,
    error_message TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE source.linear_sync_state IS
'Tracks incremental sync state for each Linear entity type.
Stores cursor for pagination and last successful sync timestamp.';

-- Seed initial sync types
INSERT INTO source.linear_sync_state (sync_type)
VALUES ('issues'), ('projects'), ('cycles'), ('labels'), ('team_members')
ON CONFLICT (sync_type) DO NOTHING;

\echo '   Created source.linear_sync_state'

-- ============================================================================
-- 3. CREATE source.linear_webhook_events TABLE
-- ============================================================================

\echo '3. Creating source.linear_webhook_events...'

CREATE TABLE IF NOT EXISTS source.linear_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,        -- 'Issue', 'Comment', 'Project', etc.
    action TEXT NOT NULL,            -- 'create', 'update', 'remove'
    payload JSONB NOT NULL,          -- Full webhook payload
    signature TEXT,                  -- HMAC signature for verification
    verified BOOLEAN DEFAULT FALSE,  -- Whether signature was verified
    processed_at TIMESTAMPTZ,        -- NULL until processed
    received_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE source.linear_webhook_events IS
'Stores incoming Linear webhook events for processing.
Events are verified via HMAC signature before processing.
processed_at is set after successful processing to ops.* tables.';

CREATE INDEX IF NOT EXISTS idx_linear_webhooks_unprocessed
ON source.linear_webhook_events(received_at)
WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_linear_webhooks_type
ON source.linear_webhook_events(event_type, action);

\echo '   Created source.linear_webhook_events'

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
WHERE table_schema = 'source'
  AND table_name LIKE 'linear%'
ORDER BY table_name;

\echo ''
\echo 'Sync state initialized:'
SELECT * FROM source.linear_sync_state;

\echo ''
\echo '=============================================='
\echo '  MIG_2700 Complete!'
\echo '=============================================='
\echo ''
