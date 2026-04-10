-- MIG_3036: Port trapper.cross_reference_vh_trappers_with_airtable() → ops.*
-- with V2 table references (source.volunteerhub_*, sot.people, sot.person_roles)
--
-- FFS-1068

CREATE OR REPLACE FUNCTION ops.cross_reference_vh_trappers_with_airtable()
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  WITH
  -- VH trappers: volunteers in "Approved Trappers" group with matched person_id
  vh_trappers AS (
    SELECT DISTINCT vv.matched_person_id AS person_id, vv.display_name, vv.email
    FROM source.volunteerhub_volunteers vv
    JOIN source.volunteerhub_group_memberships vgm ON vgm.volunteerhub_id = vv.volunteerhub_id
    JOIN source.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
    WHERE vug.atlas_role = 'trapper'
      AND vgm.left_at IS NULL
      AND vv.matched_person_id IS NOT NULL
  ),
  -- Airtable trappers: person_roles with source_system='airtable' and role='trapper'
  at_trappers AS (
    SELECT DISTINCT pr.person_id, sp.display_name,
      pr.trapper_type, pr.role_status
    FROM sot.person_roles pr
    JOIN sot.people sp ON sp.person_id = pr.person_id
    WHERE pr.role = 'trapper'
      AND pr.source_system = 'airtable'
  ),
  -- Matched in both
  matched AS (
    SELECT vt.person_id, vt.display_name AS vh_name, at.display_name AS at_name,
      at.trapper_type, at.role_status
    FROM vh_trappers vt
    JOIN at_trappers at ON at.person_id = vt.person_id
  ),
  -- Only in VH
  only_vh AS (
    SELECT vt.person_id, vt.display_name, vt.email
    FROM vh_trappers vt
    LEFT JOIN at_trappers at ON at.person_id = vt.person_id
    WHERE at.person_id IS NULL
  ),
  -- Only in Airtable
  only_at AS (
    SELECT at.person_id, at.display_name, at.trapper_type, at.role_status
    FROM at_trappers at
    LEFT JOIN vh_trappers vt ON vt.person_id = at.person_id
    WHERE vt.person_id IS NULL
  )
  SELECT JSONB_BUILD_OBJECT(
    'matched_both', (SELECT COUNT(*) FROM matched),
    'only_in_vh', (SELECT COUNT(*) FROM only_vh),
    'only_in_airtable', (SELECT COUNT(*) FROM only_at),
    'matched_details', (SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
      'person_id', person_id, 'name', vh_name, 'airtable_type', trapper_type
    )), '[]') FROM matched),
    'vh_only_details', (SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
      'person_id', person_id, 'name', display_name, 'email', email
    )), '[]') FROM only_vh),
    'airtable_only_details', (SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
      'person_id', person_id, 'name', display_name, 'type', trapper_type, 'status', role_status
    )), '[]') FROM only_at)
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.cross_reference_vh_trappers_with_airtable IS
'Compares VolunteerHub "Approved Trappers" with Airtable trapper records.
Returns counts and details of: matched in both, only in VH, only in Airtable.
V2 port of trapper.cross_reference_vh_trappers_with_airtable() — uses source.* and sot.* schemas.';
