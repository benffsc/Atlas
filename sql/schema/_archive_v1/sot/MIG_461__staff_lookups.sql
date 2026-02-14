-- MIG_461: Staff Lookups for Tippy Personal Assistant
-- Research lookups saved by staff via Tippy
--
\echo '=== MIG_461: Staff Lookups ==='

-- Create staff lookups table
CREATE TABLE IF NOT EXISTS trapper.staff_lookups (
  lookup_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owner
  staff_id UUID NOT NULL REFERENCES trapper.staff(staff_id) ON DELETE CASCADE,

  -- Content
  title TEXT NOT NULL,
  query_text TEXT NOT NULL,      -- Original question/search asked to Tippy
  summary TEXT,                   -- AI-generated summary of findings
  result_data JSONB NOT NULL DEFAULT '{}',  -- Structured data from queries

  -- Entity reference (primary subject of lookup)
  entity_type TEXT CHECK (entity_type IS NULL OR entity_type IN ('place', 'cat', 'person', 'request', 'intake')),
  entity_id UUID,

  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN (
    'active',    -- Visible in dashboard
    'archived',  -- Hidden but retained
    'deleted'    -- Soft deleted
  )),

  -- Tool tracking (which Tippy tools were used to gather data)
  tool_calls JSONB,  -- Array of { tool: string, input: object, result_summary: string }

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

-- Index for listing staff's active lookups
CREATE INDEX IF NOT EXISTS idx_staff_lookups_staff_active
  ON trapper.staff_lookups(staff_id, created_at DESC)
  WHERE status = 'active';

-- Index for entity lookups
CREATE INDEX IF NOT EXISTS idx_staff_lookups_entity
  ON trapper.staff_lookups(entity_type, entity_id)
  WHERE entity_id IS NOT NULL;

-- Full-text search on title and summary
CREATE INDEX IF NOT EXISTS idx_staff_lookups_search
  ON trapper.staff_lookups USING gin(to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(summary, '')));

COMMENT ON TABLE trapper.staff_lookups IS
'Research lookups saved by staff via Tippy AI assistant. Contains compiled query results for later reference.';

COMMENT ON COLUMN trapper.staff_lookups.query_text IS
'The original question or search phrase the staff member asked Tippy';

COMMENT ON COLUMN trapper.staff_lookups.result_data IS
'Structured JSON data containing the query results (place info, cats, requests, etc.)';

COMMENT ON COLUMN trapper.staff_lookups.tool_calls IS
'Record of which Tippy tools were used to gather the data';

\echo 'MIG_461 complete: Staff lookups table created'
