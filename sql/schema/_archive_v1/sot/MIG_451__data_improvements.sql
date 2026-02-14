\echo '=== MIG_451: Data Improvements Queue ==='
\echo 'Structured tracking of data issues for admin/Claude Code review'

-- Create data_improvements table
CREATE TABLE IF NOT EXISTS trapper.data_improvements (
  improvement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Issue description
  title TEXT NOT NULL,
  description TEXT NOT NULL,

  -- Entity reference (optional)
  entity_type TEXT CHECK (entity_type IN ('place', 'cat', 'person', 'request', 'global')),
  entity_id UUID,

  -- Categorization
  category TEXT NOT NULL CHECK (category IN (
    'data_correction',   -- Single field/record needs fixing
    'duplicate_entity',  -- Duplicate records need merging
    'missing_data',      -- Data should exist but doesn't
    'stale_data',        -- Data is outdated
    'schema_issue',      -- Database structure problem
    'business_rule',     -- Logic/calculation issue
    'other'
  )),

  priority TEXT DEFAULT 'normal' CHECK (priority IN ('critical', 'high', 'normal', 'low')),

  -- Suggested resolution
  suggested_fix JSONB,  -- Structured suggestion (e.g., {action: 'update', field: 'address', from: 'old', to: 'new'})
  fix_sql TEXT,         -- Optional SQL to fix (for Claude Code review)

  -- Source tracking
  source TEXT NOT NULL CHECK (source IN (
    'tippy_feedback',    -- From staff via Tippy
    'admin_report',      -- Admin manually created
    'claude_code',       -- Discovered during development
    'automated_check'    -- From data validation queries
  )),
  source_reference_id UUID, -- FK to source record (e.g., feedback_id)

  -- Workflow
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending',      -- Awaiting review
    'confirmed',    -- Issue confirmed, awaiting fix
    'in_progress',  -- Being worked on
    'resolved',     -- Fixed
    'rejected',     -- Not a real issue
    'wont_fix'      -- Valid issue but not worth fixing
  )),

  assigned_to UUID REFERENCES trapper.staff(staff_id),
  resolved_by UUID REFERENCES trapper.staff(staff_id),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add FK from tippy_feedback to data_improvements
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_tippy_feedback_data_improvement'
  ) THEN
    ALTER TABLE trapper.tippy_feedback
    ADD CONSTRAINT fk_tippy_feedback_data_improvement
    FOREIGN KEY (data_improvement_id) REFERENCES trapper.data_improvements(improvement_id);
  END IF;
END $$;

-- Index for pending issues
CREATE INDEX IF NOT EXISTS idx_data_improvements_status
  ON trapper.data_improvements(status) WHERE status IN ('pending', 'confirmed', 'in_progress');

-- Index for priority triage
CREATE INDEX IF NOT EXISTS idx_data_improvements_priority_status
  ON trapper.data_improvements(priority, status);

-- Index for entity lookup
CREATE INDEX IF NOT EXISTS idx_data_improvements_entity
  ON trapper.data_improvements(entity_type, entity_id) WHERE entity_id IS NOT NULL;

-- Index for source tracking
CREATE INDEX IF NOT EXISTS idx_data_improvements_source
  ON trapper.data_improvements(source, source_reference_id);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION trapper.update_data_improvements_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_data_improvements_updated ON trapper.data_improvements;
CREATE TRIGGER trg_data_improvements_updated
  BEFORE UPDATE ON trapper.data_improvements
  FOR EACH ROW
  EXECUTE FUNCTION trapper.update_data_improvements_timestamp();

COMMENT ON TABLE trapper.data_improvements IS 'Queue of data accuracy issues for admin/Claude Code review';
COMMENT ON COLUMN trapper.data_improvements.suggested_fix IS 'JSON structure describing the fix (for automation)';
COMMENT ON COLUMN trapper.data_improvements.fix_sql IS 'SQL statement to apply the fix (for Claude Code)';
COMMENT ON COLUMN trapper.data_improvements.source IS 'Where this issue was discovered';
COMMENT ON COLUMN trapper.data_improvements.source_reference_id IS 'ID of source record (feedback_id, etc.)';

\echo 'MIG_451 complete: data_improvements table created'
