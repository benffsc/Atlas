\echo '=== MIG_570: Google Maps Person Linking Schema ==='
\echo 'Adds columns for MANUAL person linking from Google Maps entries'
\echo ''
\echo 'IMPORTANT: This does NOT automatically link people based on names.'
\echo 'Google Maps data is informal - name matching is too risky for auto-linking.'
\echo 'Links should only be created through verified identity (email/phone) via Data Engine.'

-- ============================================================================
-- DESIGN PRINCIPLE:
-- Google Maps entries show as HISTORICAL DOTS on the map.
-- They display the kml_name (person name) in the popup for context.
-- But they do NOT automatically create person-place relationships.
--
-- WHY:
-- - Google Maps kml_name is informal, unverified text
-- - "Jose Valencia" in Google Maps could be a different Jose Valencia
-- - Name matching alone has too many false positives
-- - Better to let the person come through properly (clinic visit, request)
--   and then manually merge if appropriate
--
-- THE FLOW:
-- 1. Historical dots show on map with kml_name visible
-- 2. If that person later makes a request or visits clinic,
--    Data Engine creates proper person record with email/phone
-- 3. Staff can then manually link the historical dot to the verified person
-- ============================================================================

-- Add columns for optional MANUAL person linking
ALTER TABLE trapper.google_map_entries
  ADD COLUMN IF NOT EXISTS person_linked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS linked_person_id UUID REFERENCES trapper.sot_people(person_id);

COMMENT ON COLUMN trapper.google_map_entries.person_linked_at IS
'When a staff member MANUALLY linked this entry to a verified person';

COMMENT ON COLUMN trapper.google_map_entries.linked_person_id IS
'Person ID if MANUALLY linked by staff (not auto-linked by name matching)';

-- Function for MANUAL linking only (requires staff to explicitly link)
CREATE OR REPLACE FUNCTION trapper.manual_link_google_entry_to_person(
  p_entry_id UUID,
  p_person_id UUID,
  p_linked_by TEXT DEFAULT 'staff'
)
RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  v_place_id UUID;
BEGIN
  -- Get the place this entry is linked to
  SELECT COALESCE(linked_place_id, place_id) INTO v_place_id
  FROM trapper.google_map_entries
  WHERE entry_id = p_entry_id;

  IF v_place_id IS NULL THEN
    RAISE NOTICE 'Entry % has no linked place', p_entry_id;
    RETURN FALSE;
  END IF;

  -- Update the entry
  UPDATE trapper.google_map_entries
  SET
    linked_person_id = p_person_id,
    person_linked_at = NOW()
  WHERE entry_id = p_entry_id;

  -- Create person-place relationship
  INSERT INTO trapper.person_place_relationships (
    person_id, place_id, role, confidence, source_system, source_table
  ) VALUES (
    p_person_id, v_place_id, 'contact', 0.70, 'atlas_ui', 'google_map_entries'
  )
  ON CONFLICT (person_id, place_id, role) DO NOTHING;

  -- Log the manual link
  INSERT INTO trapper.entity_edits (
    entity_type, entity_id, field_name, new_value, edited_by, edit_reason
  ) VALUES (
    'google_map_entry', p_entry_id, 'linked_person_id', p_person_id::TEXT,
    p_linked_by, 'Manual link from Google Maps entry'
  );

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION trapper.manual_link_google_entry_to_person IS
'MANUALLY link a Google Maps entry to a verified person. For staff use only.';

\echo ''
\echo '=== MIG_570 Complete ==='
\echo ''
\echo 'Google Maps entries will show as historical dots on the map.'
\echo 'The kml_name is visible in popups for context.'
\echo ''
\echo 'To MANUALLY link an entry to a verified person:'
\echo '  SELECT trapper.manual_link_google_entry_to_person(entry_id, person_id);'
\echo ''
\echo 'IMPORTANT: Do NOT auto-link based on names - too risky!'
