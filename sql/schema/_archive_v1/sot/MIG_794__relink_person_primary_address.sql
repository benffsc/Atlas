\echo '=== MIG_794: relink_person_primary_address function ==='
\echo 'Atomically relinks a person''s primary address, maintaining person_place_relationships history'

-- Function to relink primary address with full audit trail
CREATE OR REPLACE FUNCTION trapper.relink_person_primary_address(
  p_person_id UUID,
  p_new_place_id UUID,
  p_new_address_id UUID,
  p_changed_by TEXT DEFAULT 'web_user'
) RETURNS UUID AS $$
DECLARE
  v_old_address_id UUID;
  v_relationship_id UUID;
BEGIN
  -- Get current primary address for audit logging
  SELECT primary_address_id INTO v_old_address_id
  FROM trapper.sot_people
  WHERE person_id = p_person_id;

  -- End any active resident relationships for this person
  UPDATE trapper.person_place_relationships
  SET valid_to = CURRENT_DATE
  WHERE person_id = p_person_id
    AND role = 'resident'
    AND valid_to IS NULL;

  -- Create new resident relationship (or reactivate if previously ended)
  INSERT INTO trapper.person_place_relationships (
    person_id, place_id, role, confidence, valid_from,
    source_system, created_by
  ) VALUES (
    p_person_id, p_new_place_id, 'resident', 1.0, CURRENT_DATE,
    'atlas_ui', p_changed_by
  )
  ON CONFLICT (person_id, place_id, role) DO UPDATE
  SET valid_from = CURRENT_DATE,
      valid_to = NULL,
      confidence = 1.0,
      source_system = 'atlas_ui',
      created_by = EXCLUDED.created_by
  RETURNING relationship_id INTO v_relationship_id;

  -- Update primary_address_id on sot_people
  UPDATE trapper.sot_people
  SET primary_address_id = p_new_address_id, updated_at = NOW()
  WHERE person_id = p_person_id;

  -- Audit log
  INSERT INTO trapper.entity_edits (
    entity_type, entity_id, edit_type, field_name,
    old_value, new_value,
    edited_by, edit_source, reason
  ) VALUES (
    'person', p_person_id, 'address_correction', 'primary_address_id',
    to_jsonb(v_old_address_id::text), to_jsonb(p_new_address_id::text),
    p_changed_by, 'web_ui', 'Address relinked via person profile'
  );

  RETURN v_relationship_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.relink_person_primary_address IS
  'Atomically relinks a person''s primary address: ends old resident relationship, creates new one, updates primary_address_id, logs to entity_edits.';

-- Companion: unlink (remove address without setting a new one)
CREATE OR REPLACE FUNCTION trapper.unlink_person_primary_address(
  p_person_id UUID,
  p_changed_by TEXT DEFAULT 'web_user'
) RETURNS VOID AS $$
DECLARE
  v_old_address_id UUID;
BEGIN
  SELECT primary_address_id INTO v_old_address_id
  FROM trapper.sot_people
  WHERE person_id = p_person_id;

  IF v_old_address_id IS NULL THEN
    RETURN;
  END IF;

  -- End active resident relationships
  UPDATE trapper.person_place_relationships
  SET valid_to = CURRENT_DATE
  WHERE person_id = p_person_id
    AND role = 'resident'
    AND valid_to IS NULL;

  -- Clear primary address
  UPDATE trapper.sot_people
  SET primary_address_id = NULL, updated_at = NOW()
  WHERE person_id = p_person_id;

  -- Audit log
  INSERT INTO trapper.entity_edits (
    entity_type, entity_id, edit_type, field_name,
    old_value, new_value,
    edited_by, edit_source, reason
  ) VALUES (
    'person', p_person_id, 'address_correction', 'primary_address_id',
    to_jsonb(v_old_address_id::text), 'null'::jsonb,
    p_changed_by, 'web_ui', 'Address removed via person profile'
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.unlink_person_primary_address IS
  'Removes a person''s primary address: ends resident relationship, clears primary_address_id, logs to entity_edits.';

\echo 'MIG_794 complete: relink_person_primary_address + unlink_person_primary_address'
