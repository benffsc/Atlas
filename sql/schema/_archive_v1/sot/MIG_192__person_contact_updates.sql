-- MIG_192: Person Contact Update Trail
-- Tracks changes to person identifiers (phone, email) for audit
--
-- Problem: When a request is submitted with updated contact info
-- for an existing person, we need to track the change.

\echo '=============================================='
\echo 'MIG_192: Person Contact Update Trail'
\echo '=============================================='

-- ============================================
-- PART 1: Contact Update Audit Table
-- ============================================

\echo 'Creating person_identifier_updates table...'

CREATE TABLE IF NOT EXISTS trapper.person_identifier_updates (
  update_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),
  id_type trapper.identifier_type NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  old_value_normalized TEXT,
  new_value_normalized TEXT,
  source_request_id UUID REFERENCES trapper.sot_requests(request_id),
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  update_reason TEXT, -- 'request_submission', 'manual_edit', 'import_correction'
  was_applied BOOLEAN DEFAULT FALSE, -- Whether the change was actually applied to person_identifiers
  apply_notes TEXT -- Why it was or wasn't applied
);

CREATE INDEX IF NOT EXISTS idx_person_id_updates_person
  ON trapper.person_identifier_updates(person_id);

CREATE INDEX IF NOT EXISTS idx_person_id_updates_request
  ON trapper.person_identifier_updates(source_request_id)
  WHERE source_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_person_id_updates_time
  ON trapper.person_identifier_updates(updated_at DESC);

COMMENT ON TABLE trapper.person_identifier_updates IS
'Audit trail for all person contact info changes. Tracks both proposed and applied changes.';

-- ============================================
-- PART 2: Function to log contact update
-- ============================================

\echo 'Creating log_contact_update function...'

CREATE OR REPLACE FUNCTION trapper.log_contact_update(
  p_person_id UUID,
  p_id_type trapper.identifier_type,
  p_old_value TEXT,
  p_new_value TEXT,
  p_source_request_id UUID DEFAULT NULL,
  p_updated_by TEXT DEFAULT 'system',
  p_update_reason TEXT DEFAULT 'request_submission'
) RETURNS UUID AS $$
DECLARE
  v_update_id UUID;
  v_old_norm TEXT;
  v_new_norm TEXT;
BEGIN
  -- Normalize values
  IF p_id_type = 'email' THEN
    v_old_norm := trapper.norm_email(p_old_value);
    v_new_norm := trapper.norm_email(p_new_value);
  ELSIF p_id_type = 'phone' THEN
    v_old_norm := trapper.norm_phone_us(p_old_value);
    v_new_norm := trapper.norm_phone_us(p_new_value);
  ELSE
    v_old_norm := p_old_value;
    v_new_norm := p_new_value;
  END IF;

  -- Don't log if normalized values are the same
  IF v_old_norm IS NOT DISTINCT FROM v_new_norm THEN
    RETURN NULL;
  END IF;

  INSERT INTO trapper.person_identifier_updates (
    person_id, id_type, old_value, new_value,
    old_value_normalized, new_value_normalized,
    source_request_id, updated_by, update_reason
  ) VALUES (
    p_person_id, p_id_type, p_old_value, p_new_value,
    v_old_norm, v_new_norm,
    p_source_request_id, p_updated_by, p_update_reason
  )
  RETURNING update_id INTO v_update_id;

  RETURN v_update_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 3: Function to apply contact update
-- ============================================

\echo 'Creating apply_contact_update function...'

CREATE OR REPLACE FUNCTION trapper.apply_contact_update(
  p_update_id UUID,
  p_applied_by TEXT DEFAULT 'system'
) RETURNS BOOLEAN AS $$
DECLARE
  v_update RECORD;
  v_existing_person_id UUID;
BEGIN
  -- Get the update record
  SELECT * INTO v_update
  FROM trapper.person_identifier_updates
  WHERE update_id = p_update_id
    AND was_applied = FALSE;

  IF v_update IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Check if the new value is already assigned to another person
  SELECT person_id INTO v_existing_person_id
  FROM trapper.person_identifiers
  WHERE id_type = v_update.id_type
    AND id_value_norm = v_update.new_value_normalized
    AND person_id != v_update.person_id;

  IF v_existing_person_id IS NOT NULL THEN
    -- Can't apply - would create conflict
    UPDATE trapper.person_identifier_updates
    SET was_applied = FALSE,
        apply_notes = 'Blocked: value already belongs to person ' || v_existing_person_id::TEXT
    WHERE update_id = p_update_id;
    RETURN FALSE;
  END IF;

  -- Apply the update
  -- First try to update existing identifier
  UPDATE trapper.person_identifiers
  SET id_value_raw = v_update.new_value,
      id_value_norm = v_update.new_value_normalized,
      updated_at = NOW()
  WHERE person_id = v_update.person_id
    AND id_type = v_update.id_type;

  IF NOT FOUND THEN
    -- Insert new identifier
    INSERT INTO trapper.person_identifiers (
      person_id, id_type, id_value_raw, id_value_norm,
      source_system, confidence
    ) VALUES (
      v_update.person_id, v_update.id_type,
      v_update.new_value, v_update.new_value_normalized,
      'atlas_ui', 1.0
    )
    ON CONFLICT (id_type, id_value_norm) DO NOTHING;
  END IF;

  -- Mark as applied
  UPDATE trapper.person_identifier_updates
  SET was_applied = TRUE,
      apply_notes = 'Applied by ' || p_applied_by
  WHERE update_id = p_update_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 4: View for recent contact changes
-- ============================================

\echo 'Creating view for contact update history...'

CREATE OR REPLACE VIEW trapper.v_person_contact_history AS
SELECT
  u.update_id,
  u.person_id,
  p.display_name as person_name,
  u.id_type::TEXT,
  u.old_value,
  u.new_value,
  u.update_reason,
  u.was_applied,
  u.apply_notes,
  u.updated_by,
  u.updated_at,
  r.summary as source_request_summary
FROM trapper.person_identifier_updates u
JOIN trapper.sot_people p ON p.person_id = u.person_id
LEFT JOIN trapper.sot_requests r ON r.request_id = u.source_request_id
ORDER BY u.updated_at DESC;

-- ============================================
-- PART 5: Function to get person's contact history
-- ============================================

\echo 'Creating get_person_contact_history function...'

CREATE OR REPLACE FUNCTION trapper.get_person_contact_history(p_person_id UUID)
RETURNS TABLE(
  update_id UUID,
  id_type TEXT,
  old_value TEXT,
  new_value TEXT,
  update_reason TEXT,
  was_applied BOOLEAN,
  updated_by TEXT,
  updated_at TIMESTAMPTZ,
  source_request_summary TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.update_id,
    u.id_type::TEXT,
    u.old_value,
    u.new_value,
    u.update_reason,
    u.was_applied,
    u.updated_by,
    u.updated_at,
    r.summary
  FROM trapper.person_identifier_updates u
  LEFT JOIN trapper.sot_requests r ON r.request_id = u.source_request_id
  WHERE u.person_id = p_person_id
  ORDER BY u.updated_at DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 6: Include current identifiers in history
-- ============================================

\echo 'Creating comprehensive person contact view...'

CREATE OR REPLACE VIEW trapper.v_person_contacts_full AS
SELECT
  p.person_id,
  p.display_name,
  -- Current identifiers
  (SELECT ARRAY_AGG(id_value_raw ORDER BY confidence DESC)
   FROM trapper.person_identifiers
   WHERE person_id = p.person_id AND id_type = 'email') as current_emails,
  (SELECT ARRAY_AGG(id_value_raw ORDER BY confidence DESC)
   FROM trapper.person_identifiers
   WHERE person_id = p.person_id AND id_type = 'phone') as current_phones,
  -- History counts
  (SELECT COUNT(*)
   FROM trapper.person_identifier_updates
   WHERE person_id = p.person_id AND id_type = 'email') as email_change_count,
  (SELECT COUNT(*)
   FROM trapper.person_identifier_updates
   WHERE person_id = p.person_id AND id_type = 'phone') as phone_change_count,
  -- Last updated
  (SELECT MAX(updated_at)
   FROM trapper.person_identifier_updates
   WHERE person_id = p.person_id) as last_contact_update
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL;

\echo ''
\echo 'MIG_192 complete!'
\echo ''
\echo 'Created:'
\echo '  - Table: trapper.person_identifier_updates'
\echo '  - Function: trapper.log_contact_update()'
\echo '  - Function: trapper.apply_contact_update()'
\echo '  - Function: trapper.get_person_contact_history(person_id)'
\echo '  - View: trapper.v_person_contact_history (all changes)'
\echo '  - View: trapper.v_person_contacts_full (current + change counts)'
