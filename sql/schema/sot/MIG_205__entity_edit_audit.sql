-- MIG_205: Entity Edit Audit System
-- Comprehensive audit logging for all entity changes with full context
--
-- This creates a robust system for:
-- 1. Tracking ALL changes to entities (people, cats, places, requests)
-- 2. Recording WHO made the change and WHY
-- 3. Storing before/after values for rollback capability
-- 4. Linking related changes (e.g., ownership transfer affects both person and cat)

\echo '=============================================='
\echo 'MIG_205: Entity Edit Audit System'
\echo '=============================================='

-- ============================================
-- PART 1: Enhanced Audit Log Table
-- ============================================

\echo 'Creating entity_edits table...'

CREATE TABLE IF NOT EXISTS trapper.entity_edits (
  edit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What was edited
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'person', 'cat', 'place', 'request',
    'person_identifier', 'cat_identifier',
    'person_cat_relationship', 'person_place_relationship',
    'intake_submission'
  )),
  entity_id UUID NOT NULL,

  -- What changed
  edit_type TEXT NOT NULL CHECK (edit_type IN (
    'field_update',           -- Simple field change
    'ownership_transfer',     -- Cat moved to different person
    'identifier_change',      -- Microchip, phone, email changed
    'address_correction',     -- Place/location fix
    'merge',                  -- Two records merged
    'split',                  -- One record split into two
    'link',                   -- New relationship created
    'unlink',                 -- Relationship removed
    'create',                 -- New record created
    'delete',                 -- Record deleted (soft)
    'restore',                -- Record restored from deletion
    'status_change',          -- Request status updated
    'note_added',             -- Note appended to record
    'trapping_progress'       -- Trapping counts updated
  )),

  -- Field-level changes (JSON for flexibility)
  field_name TEXT,
  old_value JSONB,
  new_value JSONB,

  -- For complex changes (transfers, merges)
  related_entity_type TEXT,
  related_entity_id UUID,

  -- Context
  reason TEXT,                -- Why the change was made
  notes TEXT,                 -- Additional context

  -- Grouping for multi-step operations
  batch_id UUID,              -- Group related edits

  -- Who made the change
  edited_by TEXT NOT NULL,    -- User ID or 'system'
  edited_by_name TEXT,        -- Display name for UI
  edit_source TEXT NOT NULL DEFAULT 'web_ui' CHECK (edit_source IN (
    'web_ui', 'api', 'migration', 'script', 'system', 'import', 'trapper_report'
  )),

  -- When
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- For rollback capability
  is_rolled_back BOOLEAN DEFAULT FALSE,
  rolled_back_at TIMESTAMPTZ,
  rolled_back_by TEXT,
  rollback_edit_id UUID REFERENCES trapper.entity_edits(edit_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_entity_edits_entity
  ON trapper.entity_edits(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_edits_created
  ON trapper.entity_edits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entity_edits_batch
  ON trapper.entity_edits(batch_id);
CREATE INDEX IF NOT EXISTS idx_entity_edits_type
  ON trapper.entity_edits(edit_type);
CREATE INDEX IF NOT EXISTS idx_entity_edits_editor
  ON trapper.entity_edits(edited_by);

-- ============================================
-- PART 2: Edit Lock Table (prevent concurrent edits)
-- ============================================

\echo 'Creating entity_edit_locks table...'

CREATE TABLE IF NOT EXISTS trapper.entity_edit_locks (
  lock_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  locked_by TEXT NOT NULL,
  locked_by_name TEXT,
  locked_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '15 minutes',
  lock_reason TEXT,

  UNIQUE(entity_type, entity_id)
);

-- ============================================
-- PART 3: Pending Edits Table (for wizard flow)
-- ============================================

\echo 'Creating pending_edits table...'

CREATE TABLE IF NOT EXISTS trapper.pending_edits (
  pending_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What's being edited
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  edit_type TEXT NOT NULL,

  -- Proposed changes
  proposed_changes JSONB NOT NULL,

  -- Validation results
  validation_status TEXT DEFAULT 'pending' CHECK (validation_status IN (
    'pending', 'valid', 'warning', 'error'
  )),
  validation_messages JSONB,

  -- Suggestions computed by system
  suggestions JSONB,

  -- State
  status TEXT DEFAULT 'draft' CHECK (status IN (
    'draft', 'pending_review', 'approved', 'applied', 'cancelled'
  )),

  -- Who
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Applied reference
  applied_edit_id UUID REFERENCES trapper.entity_edits(edit_id)
);

CREATE INDEX IF NOT EXISTS idx_pending_edits_entity
  ON trapper.pending_edits(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_pending_edits_status
  ON trapper.pending_edits(status);

-- ============================================
-- PART 4: Functions for Safe Editing
-- ============================================

\echo 'Creating edit functions...'

-- Function to log a simple field edit
CREATE OR REPLACE FUNCTION trapper.log_field_edit(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_field_name TEXT,
  p_old_value JSONB,
  p_new_value JSONB,
  p_reason TEXT DEFAULT NULL,
  p_edited_by TEXT DEFAULT 'system',
  p_edited_by_name TEXT DEFAULT NULL,
  p_edit_source TEXT DEFAULT 'web_ui'
)
RETURNS UUID AS $$
DECLARE
  v_edit_id UUID;
BEGIN
  INSERT INTO trapper.entity_edits (
    entity_type, entity_id, edit_type,
    field_name, old_value, new_value,
    reason, edited_by, edited_by_name, edit_source
  ) VALUES (
    p_entity_type, p_entity_id, 'field_update',
    p_field_name, p_old_value, p_new_value,
    p_reason, p_edited_by, p_edited_by_name, p_edit_source
  ) RETURNING edit_id INTO v_edit_id;

  RETURN v_edit_id;
END;
$$ LANGUAGE plpgsql;

-- Function to log ownership transfer
CREATE OR REPLACE FUNCTION trapper.log_ownership_transfer(
  p_cat_id UUID,
  p_old_owner_id UUID,
  p_new_owner_id UUID,
  p_relationship_type TEXT DEFAULT 'owner',
  p_reason TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_edited_by TEXT DEFAULT 'system',
  p_edited_by_name TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_batch_id UUID := gen_random_uuid();
  v_edit_id UUID;
BEGIN
  -- Log the cat side
  INSERT INTO trapper.entity_edits (
    entity_type, entity_id, edit_type,
    field_name, old_value, new_value,
    related_entity_type, related_entity_id,
    reason, notes, batch_id, edited_by, edited_by_name
  ) VALUES (
    'cat', p_cat_id, 'ownership_transfer',
    'owner', to_jsonb(p_old_owner_id), to_jsonb(p_new_owner_id),
    'person', p_new_owner_id,
    p_reason, p_notes, v_batch_id, p_edited_by, p_edited_by_name
  ) RETURNING edit_id INTO v_edit_id;

  -- Log the old owner side (if exists)
  IF p_old_owner_id IS NOT NULL THEN
    INSERT INTO trapper.entity_edits (
      entity_type, entity_id, edit_type,
      field_name, old_value, new_value,
      related_entity_type, related_entity_id,
      reason, notes, batch_id, edited_by, edited_by_name
    ) VALUES (
      'person', p_old_owner_id, 'unlink',
      'cat_removed', to_jsonb(p_cat_id), NULL,
      'cat', p_cat_id,
      p_reason, p_notes, v_batch_id, p_edited_by, p_edited_by_name
    );
  END IF;

  -- Log the new owner side
  INSERT INTO trapper.entity_edits (
    entity_type, entity_id, edit_type,
    field_name, old_value, new_value,
    related_entity_type, related_entity_id,
    reason, notes, batch_id, edited_by, edited_by_name
  ) VALUES (
    'person', p_new_owner_id, 'link',
    'cat_added', NULL, to_jsonb(p_cat_id),
    'cat', p_cat_id,
    p_reason, p_notes, v_batch_id, p_edited_by, p_edited_by_name
  );

  RETURN v_edit_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get edit history for an entity
CREATE OR REPLACE FUNCTION trapper.get_entity_history(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_limit INT DEFAULT 50
)
RETURNS TABLE (
  edit_id UUID,
  edit_type TEXT,
  field_name TEXT,
  old_value JSONB,
  new_value JSONB,
  reason TEXT,
  edited_by_name TEXT,
  edit_source TEXT,
  created_at TIMESTAMPTZ,
  is_rolled_back BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.edit_id,
    e.edit_type,
    e.field_name,
    e.old_value,
    e.new_value,
    e.reason,
    COALESCE(e.edited_by_name, e.edited_by) as edited_by_name,
    e.edit_source,
    e.created_at,
    e.is_rolled_back
  FROM trapper.entity_edits e
  WHERE e.entity_type = p_entity_type
    AND e.entity_id = p_entity_id
  ORDER BY e.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to acquire edit lock
CREATE OR REPLACE FUNCTION trapper.acquire_edit_lock(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_user_id TEXT,
  p_user_name TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_existing RECORD;
BEGIN
  -- Clean up expired locks
  DELETE FROM trapper.entity_edit_locks
  WHERE expires_at < NOW();

  -- Check for existing lock
  SELECT * INTO v_existing
  FROM trapper.entity_edit_locks
  WHERE entity_type = p_entity_type
    AND entity_id = p_entity_id;

  IF v_existing IS NOT NULL THEN
    -- If same user, extend lock
    IF v_existing.locked_by = p_user_id THEN
      UPDATE trapper.entity_edit_locks
      SET expires_at = NOW() + INTERVAL '15 minutes'
      WHERE entity_type = p_entity_type
        AND entity_id = p_entity_id;
      RETURN TRUE;
    ELSE
      -- Someone else has the lock
      RETURN FALSE;
    END IF;
  END IF;

  -- Create new lock
  INSERT INTO trapper.entity_edit_locks (
    entity_type, entity_id, locked_by, locked_by_name, lock_reason
  ) VALUES (
    p_entity_type, p_entity_id, p_user_id, p_user_name, p_reason
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to release edit lock
CREATE OR REPLACE FUNCTION trapper.release_edit_lock(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_user_id TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  DELETE FROM trapper.entity_edit_locks
  WHERE entity_type = p_entity_type
    AND entity_id = p_entity_id
    AND locked_by = p_user_id;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 5: Views for History UI
-- ============================================

\echo 'Creating history views...'

-- View: Recent edits across all entities
CREATE OR REPLACE VIEW trapper.v_recent_edits AS
SELECT
  e.edit_id,
  e.entity_type,
  e.entity_id,
  e.edit_type,
  e.field_name,
  CASE e.entity_type
    WHEN 'person' THEN (SELECT display_name FROM trapper.sot_people WHERE person_id = e.entity_id)
    WHEN 'cat' THEN (SELECT display_name FROM trapper.sot_cats WHERE cat_id = e.entity_id)
    WHEN 'place' THEN (SELECT display_name FROM trapper.places WHERE place_id = e.entity_id)
    WHEN 'request' THEN (SELECT summary FROM trapper.sot_requests WHERE request_id = e.entity_id)
    ELSE NULL
  END as entity_name,
  e.old_value,
  e.new_value,
  e.reason,
  COALESCE(e.edited_by_name, e.edited_by) as editor,
  e.edit_source,
  e.created_at,
  e.is_rolled_back
FROM trapper.entity_edits e
ORDER BY e.created_at DESC;

-- View: Active edit locks
CREATE OR REPLACE VIEW trapper.v_active_locks AS
SELECT
  l.lock_id,
  l.entity_type,
  l.entity_id,
  CASE l.entity_type
    WHEN 'person' THEN (SELECT display_name FROM trapper.sot_people WHERE person_id = l.entity_id)
    WHEN 'cat' THEN (SELECT display_name FROM trapper.sot_cats WHERE cat_id = l.entity_id)
    WHEN 'place' THEN (SELECT display_name FROM trapper.places WHERE place_id = l.entity_id)
    WHEN 'request' THEN (SELECT summary FROM trapper.sot_requests WHERE request_id = l.entity_id)
    ELSE NULL
  END as entity_name,
  l.locked_by,
  l.locked_by_name,
  l.locked_at,
  l.expires_at,
  l.lock_reason,
  l.expires_at - NOW() as time_remaining
FROM trapper.entity_edit_locks l
WHERE l.expires_at > NOW()
ORDER BY l.locked_at DESC;

-- ============================================
-- PART 6: Migrate existing data_changes to entity_edits
-- ============================================

\echo 'Migrating existing data_changes...'

INSERT INTO trapper.entity_edits (
  entity_type, entity_id, edit_type,
  field_name, old_value, new_value,
  edited_by, edit_source, created_at
)
SELECT
  dc.entity_type,
  dc.entity_key::uuid,
  'field_update',
  dc.field_name,
  CASE WHEN dc.old_value IS NOT NULL THEN to_jsonb(dc.old_value) ELSE NULL END,
  CASE WHEN dc.new_value IS NOT NULL THEN to_jsonb(dc.new_value) ELSE NULL END,
  'system',
  COALESCE(dc.change_source, 'migration'),
  dc.created_at
FROM trapper.data_changes dc
WHERE dc.entity_key IS NOT NULL
  AND dc.entity_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
ON CONFLICT DO NOTHING;

\echo ''
\echo 'MIG_205 complete!'
\echo ''
\echo 'New tables:'
\echo '  - trapper.entity_edits (comprehensive audit log)'
\echo '  - trapper.entity_edit_locks (prevent concurrent edits)'
\echo '  - trapper.pending_edits (wizard flow support)'
\echo ''
\echo 'New functions:'
\echo '  - trapper.log_field_edit(...) - log simple field changes'
\echo '  - trapper.log_ownership_transfer(...) - log cat transfers'
\echo '  - trapper.get_entity_history(...) - get edit history'
\echo '  - trapper.acquire_edit_lock(...) - prevent concurrent edits'
\echo '  - trapper.release_edit_lock(...) - release edit lock'
\echo ''
\echo 'New views:'
\echo '  - trapper.v_recent_edits - all recent changes'
\echo '  - trapper.v_active_locks - current edit locks'
\echo ''
