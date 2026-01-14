-- MIG_197: Entity Change Tracking
-- Provides audit trail for changes to places, cats, and requests
-- Complements existing person_identifier_updates table (MIG_192)
--
-- Philosophy:
-- - Entity IDs are stable identities that never change
-- - Attributes (address, name, etc.) CAN change with audit trail
-- - All changes are tracked for export compatibility and data lineage
-- - "Corrections" vs "Updates" are both valid - track the reason

\echo '=============================================='
\echo 'MIG_197: Entity Change Tracking'
\echo '=============================================='

-- ============================================
-- PART 1: Place change tracking
-- ============================================

\echo 'Creating place_changes table...'

CREATE TABLE IF NOT EXISTS trapper.place_changes (
  change_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id UUID NOT NULL REFERENCES trapper.places(place_id),

  -- What changed
  field_name TEXT NOT NULL,  -- 'formatted_address', 'display_name', 'latitude', etc.
  old_value TEXT,
  new_value TEXT,

  -- Context
  change_reason TEXT,  -- 'correction', 'refinement', 'data_entry_error', 'location_clarified'
  change_notes TEXT,   -- Free text explanation

  -- Who and when
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Optional: link to request that prompted the change
  related_request_id UUID REFERENCES trapper.sot_requests(request_id)
);

CREATE INDEX IF NOT EXISTS idx_place_changes_place ON trapper.place_changes(place_id);
CREATE INDEX IF NOT EXISTS idx_place_changes_date ON trapper.place_changes(changed_at DESC);

COMMENT ON TABLE trapper.place_changes IS
'Audit trail for place attribute changes. Place_id is stable identity; address/name can be corrected.';

-- ============================================
-- PART 2: Cat change tracking
-- ============================================

\echo 'Creating cat_changes table...'

CREATE TABLE IF NOT EXISTS trapper.cat_changes (
  change_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),

  -- What changed
  field_name TEXT NOT NULL,  -- 'name', 'sex', 'is_eartipped', 'color_pattern', etc.
  old_value TEXT,
  new_value TEXT,

  -- Context
  change_reason TEXT,  -- 'correction', 'vet_confirmed', 'name_update', 'merge_resolution'
  change_notes TEXT,

  -- Who and when
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Optional links
  related_request_id UUID REFERENCES trapper.sot_requests(request_id),
  related_appointment_id UUID REFERENCES trapper.sot_appointments(appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_cat_changes_cat ON trapper.cat_changes(cat_id);
CREATE INDEX IF NOT EXISTS idx_cat_changes_date ON trapper.cat_changes(changed_at DESC);

COMMENT ON TABLE trapper.cat_changes IS
'Audit trail for cat attribute changes. Sex corrections after vet visit, name updates, etc.';

-- ============================================
-- PART 3: Request change tracking
-- ============================================

\echo 'Creating request_changes table...'

CREATE TABLE IF NOT EXISTS trapper.request_changes (
  change_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES trapper.sot_requests(request_id),

  -- What changed
  field_name TEXT NOT NULL,  -- 'status', 'priority', 'assigned_to', 'notes', etc.
  old_value TEXT,
  new_value TEXT,

  -- Context
  change_reason TEXT,  -- 'status_update', 'triage', 'case_development', 'error_correction'
  change_notes TEXT,

  -- Who and when
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_request_changes_request ON trapper.request_changes(request_id);
CREATE INDEX IF NOT EXISTS idx_request_changes_date ON trapper.request_changes(changed_at DESC);

COMMENT ON TABLE trapper.request_changes IS
'Audit trail for request changes. Status transitions, priority changes, field updates.';

-- ============================================
-- PART 4: Generic update function for places
-- ============================================

\echo 'Creating place update function...'

CREATE OR REPLACE FUNCTION trapper.update_place_with_audit(
  p_place_id UUID,
  p_field_name TEXT,
  p_new_value TEXT,
  p_changed_by TEXT,
  p_change_reason TEXT DEFAULT NULL,
  p_change_notes TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_old_value TEXT;
  v_sql TEXT;
BEGIN
  -- Get current value
  EXECUTE format('SELECT %I::TEXT FROM trapper.places WHERE place_id = $1', p_field_name)
    INTO v_old_value
    USING p_place_id;

  -- Skip if no change
  IF v_old_value IS NOT DISTINCT FROM p_new_value THEN
    RETURN FALSE;
  END IF;

  -- Log the change
  INSERT INTO trapper.place_changes (
    place_id, field_name, old_value, new_value,
    change_reason, change_notes, changed_by
  ) VALUES (
    p_place_id, p_field_name, v_old_value, p_new_value,
    p_change_reason, p_change_notes, p_changed_by
  );

  -- Apply the change
  EXECUTE format('UPDATE trapper.places SET %I = $1, updated_at = NOW() WHERE place_id = $2', p_field_name)
    USING p_new_value, p_place_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 5: Generic update function for cats
-- ============================================

\echo 'Creating cat update function...'

CREATE OR REPLACE FUNCTION trapper.update_cat_with_audit(
  p_cat_id UUID,
  p_field_name TEXT,
  p_new_value TEXT,
  p_changed_by TEXT,
  p_change_reason TEXT DEFAULT NULL,
  p_change_notes TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_old_value TEXT;
BEGIN
  -- Get current value
  EXECUTE format('SELECT %I::TEXT FROM trapper.sot_cats WHERE cat_id = $1', p_field_name)
    INTO v_old_value
    USING p_cat_id;

  -- Skip if no change
  IF v_old_value IS NOT DISTINCT FROM p_new_value THEN
    RETURN FALSE;
  END IF;

  -- Log the change
  INSERT INTO trapper.cat_changes (
    cat_id, field_name, old_value, new_value,
    change_reason, change_notes, changed_by
  ) VALUES (
    p_cat_id, p_field_name, v_old_value, p_new_value,
    p_change_reason, p_change_notes, p_changed_by
  );

  -- Apply the change
  EXECUTE format('UPDATE trapper.sot_cats SET %I = $1, updated_at = NOW() WHERE cat_id = $2', p_field_name)
    USING p_new_value, p_cat_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 6: Generic update function for requests
-- ============================================

\echo 'Creating request update function...'

CREATE OR REPLACE FUNCTION trapper.update_request_with_audit(
  p_request_id UUID,
  p_field_name TEXT,
  p_new_value TEXT,
  p_changed_by TEXT,
  p_change_reason TEXT DEFAULT NULL,
  p_change_notes TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_old_value TEXT;
BEGIN
  -- Get current value
  EXECUTE format('SELECT %I::TEXT FROM trapper.sot_requests WHERE request_id = $1', p_field_name)
    INTO v_old_value
    USING p_request_id;

  -- Skip if no change
  IF v_old_value IS NOT DISTINCT FROM p_new_value THEN
    RETURN FALSE;
  END IF;

  -- Log the change
  INSERT INTO trapper.request_changes (
    request_id, field_name, old_value, new_value,
    change_reason, change_notes, changed_by
  ) VALUES (
    p_request_id, p_field_name, v_old_value, p_new_value,
    p_change_reason, p_change_notes, p_changed_by
  );

  -- Apply the change
  EXECUTE format('UPDATE trapper.sot_requests SET %I = $1, updated_at = NOW() WHERE request_id = $2', p_field_name)
    USING p_new_value, p_request_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 7: Person identifier update (enhance existing)
-- ============================================

\echo 'Creating person identifier update function...'

CREATE OR REPLACE FUNCTION trapper.update_person_identifier_with_audit(
  p_person_id UUID,
  p_id_type trapper.identifier_type,
  p_new_value TEXT,
  p_changed_by TEXT,
  p_change_reason TEXT DEFAULT 'manual_update'
) RETURNS BOOLEAN AS $$
DECLARE
  v_old_value TEXT;
  v_identifier_id UUID;
BEGIN
  -- Get current value
  SELECT id_value, identifier_id INTO v_old_value, v_identifier_id
  FROM trapper.person_identifiers
  WHERE person_id = p_person_id AND id_type = p_id_type
  LIMIT 1;

  -- If no existing identifier and new value provided, create it
  IF v_identifier_id IS NULL AND p_new_value IS NOT NULL AND p_new_value != '' THEN
    INSERT INTO trapper.person_identifiers (person_id, id_type, id_value)
    VALUES (p_person_id, p_id_type, p_new_value);

    INSERT INTO trapper.person_identifier_updates (
      person_id, id_type, old_value, new_value,
      updated_by, update_reason
    ) VALUES (
      p_person_id, p_id_type, NULL, p_new_value,
      p_changed_by, p_change_reason
    );

    RETURN TRUE;
  END IF;

  -- Skip if no change
  IF v_old_value IS NOT DISTINCT FROM p_new_value THEN
    RETURN FALSE;
  END IF;

  -- Log the change
  INSERT INTO trapper.person_identifier_updates (
    person_id, id_type, old_value, new_value,
    updated_by, update_reason
  ) VALUES (
    p_person_id, p_id_type, v_old_value, p_new_value,
    p_changed_by, p_change_reason
  );

  -- Apply the change
  UPDATE trapper.person_identifiers
  SET id_value = p_new_value,
      updated_at = NOW()
  WHERE identifier_id = v_identifier_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 8: Views for change history
-- ============================================

\echo 'Creating change history views...'

CREATE OR REPLACE VIEW trapper.v_place_change_history AS
SELECT
  pc.change_id,
  pc.place_id,
  p.display_name AS place_name,
  pc.field_name,
  pc.old_value,
  pc.new_value,
  pc.change_reason,
  pc.change_notes,
  pc.changed_by,
  pc.changed_at
FROM trapper.place_changes pc
JOIN trapper.places p ON p.place_id = pc.place_id
ORDER BY pc.changed_at DESC;

CREATE OR REPLACE VIEW trapper.v_cat_change_history AS
SELECT
  cc.change_id,
  cc.cat_id,
  c.name AS cat_name,
  cc.field_name,
  cc.old_value,
  cc.new_value,
  cc.change_reason,
  cc.change_notes,
  cc.changed_by,
  cc.changed_at
FROM trapper.cat_changes cc
JOIN trapper.sot_cats c ON c.cat_id = cc.cat_id
ORDER BY cc.changed_at DESC;

CREATE OR REPLACE VIEW trapper.v_request_change_history AS
SELECT
  rc.change_id,
  rc.request_id,
  r.summary AS request_summary,
  rc.field_name,
  rc.old_value,
  rc.new_value,
  rc.change_reason,
  rc.change_notes,
  rc.changed_by,
  rc.changed_at
FROM trapper.request_changes rc
JOIN trapper.sot_requests r ON r.request_id = rc.request_id
ORDER BY rc.changed_at DESC;

\echo ''
\echo 'MIG_197 complete!'
\echo ''
\echo 'Created:'
\echo '  - Table: trapper.place_changes'
\echo '  - Table: trapper.cat_changes'
\echo '  - Table: trapper.request_changes'
\echo '  - Function: trapper.update_place_with_audit()'
\echo '  - Function: trapper.update_cat_with_audit()'
\echo '  - Function: trapper.update_request_with_audit()'
\echo '  - Function: trapper.update_person_identifier_with_audit()'
\echo '  - Views: v_place_change_history, v_cat_change_history, v_request_change_history'
\echo ''
\echo 'Usage:'
\echo '  -- Update a place address with audit:'
\echo '  SELECT trapper.update_place_with_audit('
\echo '    place_id, ''formatted_address'', ''123 New Address'','
\echo '    ''ben'', ''location_clarified'', ''Cats actually come from behind the fence'''
\echo '  );'
\echo ''
\echo '  -- Update a person phone with audit:'
\echo '  SELECT trapper.update_person_identifier_with_audit('
\echo '    person_id, ''phone'', ''707-555-1234'', ''ben'', ''contact_update'''
\echo '  );'
