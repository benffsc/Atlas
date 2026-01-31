\echo '=== MIG_810: VolunteerHub Group-Based Role Processing ==='
\echo 'VOL_001c: Maps VH group memberships to Atlas person_roles.'
\echo ''

-- ============================================================================
-- PURPOSE
-- ============================================================================
-- After MIG_809 establishes the group schema, this migration creates functions
-- to translate VH group memberships into Atlas person_roles.
--
-- Key rules:
-- - "Approved Trappers" → role='trapper', trapper_type='ffsc_trapper'
-- - Foster groups → role='foster'
-- - Admin/Office → role='staff'
-- - Colony Caretakers → role='caretaker'
-- - All others under "Approved Volunteers" → role='volunteer'
-- - Atlas manual designations (head_trapper, coordinator) are PRESERVED
-- - Community trappers come from Airtable/JotForm, NOT VolunteerHub
-- ============================================================================

-- ============================================================================
-- STEP 1: process_volunteerhub_group_roles()
-- ============================================================================

\echo 'STEP 1: Creating process_volunteerhub_group_roles()...'

CREATE OR REPLACE FUNCTION trapper.process_volunteerhub_group_roles(
  p_person_id UUID,
  p_volunteerhub_id TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_group RECORD;
  v_roles_assigned TEXT[] := '{}';
  v_existing_trapper_type TEXT;
  v_existing_source TEXT;
BEGIN
  -- Validate inputs
  IF p_person_id IS NULL OR p_volunteerhub_id IS NULL THEN
    RETURN JSONB_BUILD_OBJECT('error', 'person_id and volunteerhub_id are required');
  END IF;

  -- Check if person already has a manually-set trapper designation (head_trapper, coordinator)
  SELECT trapper_type, source_system
  INTO v_existing_trapper_type, v_existing_source
  FROM trapper.person_roles
  WHERE person_id = p_person_id
    AND role = 'trapper'
    AND role_status = 'active';

  -- Process each active group membership
  FOR v_group IN
    SELECT vug.user_group_uid, vug.name, vug.atlas_role, vug.atlas_trapper_type
    FROM trapper.volunteerhub_group_memberships vgm
    JOIN trapper.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
    WHERE vgm.volunteerhub_id = p_volunteerhub_id
      AND vgm.left_at IS NULL
      AND vug.atlas_role IS NOT NULL
  LOOP
    IF v_group.atlas_role = 'trapper' THEN
      -- TRAPPER: "Approved Trappers" group
      IF v_existing_trapper_type IN ('head_trapper', 'coordinator') THEN
        -- Preserve Atlas manual designation — don't overwrite with ffsc_trapper
        -- Just ensure the role is active
        UPDATE trapper.person_roles
        SET role_status = 'active', updated_at = NOW()
        WHERE person_id = p_person_id AND role = 'trapper' AND role_status != 'active';
      ELSE
        -- Assign or update as ffsc_trapper from VH
        INSERT INTO trapper.person_roles (
          person_id, role, trapper_type, role_status, source_system, source_record_id, started_at, notes
        ) VALUES (
          p_person_id, 'trapper', 'ffsc_trapper', 'active', 'volunteerhub', p_volunteerhub_id,
          CURRENT_DATE, 'VH group: ' || v_group.name
        )
        ON CONFLICT (person_id, role) DO UPDATE SET
          role_status = 'active',
          -- Only update trapper_type if not a manual Atlas designation
          trapper_type = CASE
            WHEN person_roles.trapper_type IN ('head_trapper', 'coordinator')
            THEN person_roles.trapper_type
            ELSE 'ffsc_trapper'
          END,
          source_system = CASE
            WHEN person_roles.source_system = 'volunteerhub' OR person_roles.trapper_type NOT IN ('head_trapper', 'coordinator')
            THEN 'volunteerhub'
            ELSE person_roles.source_system
          END,
          updated_at = NOW();
      END IF;
      v_roles_assigned := array_append(v_roles_assigned, 'trapper/ffsc_trapper');

    ELSE
      -- NON-TRAPPER ROLES: foster, staff, caretaker, volunteer
      INSERT INTO trapper.person_roles (
        person_id, role, role_status, source_system, source_record_id, started_at, notes
      ) VALUES (
        p_person_id, v_group.atlas_role, 'active', 'volunteerhub', p_volunteerhub_id,
        CURRENT_DATE, 'VH group: ' || v_group.name
      )
      ON CONFLICT (person_id, role) DO UPDATE SET
        role_status = 'active',
        -- Update source to VH if it was already VH, otherwise keep existing
        source_system = CASE
          WHEN person_roles.source_system = 'volunteerhub' THEN 'volunteerhub'
          ELSE person_roles.source_system
        END,
        notes = CASE
          WHEN person_roles.notes IS NULL THEN 'VH group: ' || v_group.name
          WHEN person_roles.notes NOT LIKE '%VH group:%' THEN person_roles.notes || '; VH group: ' || v_group.name
          ELSE person_roles.notes
        END,
        updated_at = NOW();

      v_roles_assigned := array_append(v_roles_assigned, v_group.atlas_role);
    END IF;
  END LOOP;

  -- Always ensure the master 'volunteer' role exists if they're in ANY approved group
  IF array_length(v_roles_assigned, 1) > 0 THEN
    INSERT INTO trapper.person_roles (
      person_id, role, role_status, source_system, source_record_id, started_at, notes
    ) VALUES (
      p_person_id, 'volunteer', 'active', 'volunteerhub', p_volunteerhub_id,
      CURRENT_DATE, 'FFSC Approved Volunteer via VolunteerHub'
    )
    ON CONFLICT (person_id, role) DO UPDATE SET
      role_status = 'active',
      updated_at = NOW();
  END IF;

  RETURN JSONB_BUILD_OBJECT(
    'person_id', p_person_id,
    'volunteerhub_id', p_volunteerhub_id,
    'roles_assigned', to_jsonb(v_roles_assigned),
    'existing_trapper_type', v_existing_trapper_type
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_volunteerhub_group_roles IS
'Maps a volunteer''s active VH group memberships to Atlas person_roles.
"Approved Trappers" → ffsc_trapper (preserving head_trapper/coordinator if manually set).
Foster groups → foster. Admin/Office → staff. Others → volunteer.
Always ensures master ''volunteer'' role exists for any approved VH member.';

-- ============================================================================
-- STEP 2: cross_reference_vh_trappers_with_airtable()
-- ============================================================================

\echo 'STEP 2: Creating cross_reference_vh_trappers_with_airtable()...'

CREATE OR REPLACE FUNCTION trapper.cross_reference_vh_trappers_with_airtable()
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  WITH
  -- VH trappers: volunteers in "Approved Trappers" group with matched person_id
  vh_trappers AS (
    SELECT DISTINCT vv.matched_person_id as person_id, vv.display_name, vv.email
    FROM trapper.volunteerhub_volunteers vv
    JOIN trapper.volunteerhub_group_memberships vgm ON vgm.volunteerhub_id = vv.volunteerhub_id
    JOIN trapper.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
    WHERE vug.atlas_role = 'trapper'
      AND vgm.left_at IS NULL
      AND vv.matched_person_id IS NOT NULL
  ),
  -- Airtable trappers: person_roles with source_system='airtable' and role='trapper'
  at_trappers AS (
    SELECT DISTINCT pr.person_id, sp.display_name,
      pr.trapper_type, pr.role_status
    FROM trapper.person_roles pr
    JOIN trapper.sot_people sp ON sp.person_id = pr.person_id
    WHERE pr.role = 'trapper'
      AND pr.source_system = 'airtable'
  ),
  -- Matched in both
  matched AS (
    SELECT vt.person_id, vt.display_name as vh_name, at.display_name as at_name,
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

COMMENT ON FUNCTION trapper.cross_reference_vh_trappers_with_airtable IS
'Compares VolunteerHub "Approved Trappers" with Airtable trapper records (as reference).
Returns counts and details of: matched in both, only in VH, only in Airtable.
"Only in Airtable" may indicate volunteers who left VH but weren''t removed from Airtable.';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_810 Complete'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - process_volunteerhub_group_roles(person_id, volunteerhub_id)'
\echo '    Maps active VH group memberships to Atlas person_roles'
\echo '  - cross_reference_vh_trappers_with_airtable()'
\echo '    Reconciliation report between VH and Airtable trapper data'
\echo ''
\echo 'Role mapping rules:'
\echo '  - Approved Trappers → trapper/ffsc_trapper (head_trapper/coordinator preserved)'
\echo '  - Foster groups → foster'
\echo '  - Admin/Office → staff'
\echo '  - Colony Caretakers → caretaker'
\echo '  - All others → volunteer'
\echo '  - Master volunteer role always assigned for any approved VH member'
\echo '  - Community trappers come from Airtable/JotForm only (not VH)'
\echo ''
