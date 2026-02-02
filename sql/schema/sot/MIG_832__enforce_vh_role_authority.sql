-- ============================================================================
-- MIG_832: Enforce VolunteerHub as Single Source of Truth for Roles
-- ============================================================================
-- VolunteerHub group memberships are the sole authority for:
--   volunteer, foster, trapper (ffsc_trapper), caretaker, staff
--
-- Exceptions:
--   - community_trapper from Airtable (independent contractors, not FFSC)
--   - airtable_staff (separate authority)
--
-- This migration creates enforce_vh_role_authority() which deactivates any
-- active role NOT backed by a current VH group membership.
-- ============================================================================

\echo ''
\echo '============================================================'
\echo 'MIG_832: Enforce VH Role Authority'
\echo '============================================================'
\echo ''

-- ============================================================================
-- Step 1: Create enforce_vh_role_authority() function
-- ============================================================================

\echo 'Step 1: Creating enforce_vh_role_authority()...'

CREATE OR REPLACE FUNCTION trapper.enforce_vh_role_authority(
  p_dry_run BOOLEAN DEFAULT false
)
RETURNS JSONB AS $$
DECLARE
  v_rec RECORD;
  v_deactivated INT := 0;
  v_skipped INT := 0;
  v_details JSONB := '[]'::JSONB;
  v_has_backing BOOLEAN;
BEGIN
  -- Find all active roles that should be VH-governed
  FOR v_rec IN
    SELECT
      pr.role_id,
      pr.person_id,
      pr.role,
      pr.trapper_type,
      pr.source_system,
      sp.display_name
    FROM trapper.person_roles pr
    JOIN trapper.sot_people sp ON sp.person_id = pr.person_id
    WHERE pr.role_status = 'active'
      AND sp.merged_into_person_id IS NULL
      -- VH-governed roles
      AND pr.role IN ('volunteer', 'foster', 'trapper', 'caretaker', 'staff')
      -- Exception: community_trapper from Airtable is NOT VH-governed
      AND NOT (pr.role = 'trapper' AND pr.trapper_type = 'community_trapper')
      -- Exception: airtable_staff is separately managed
      AND pr.source_system != 'airtable_staff'
    ORDER BY sp.display_name, pr.role
  LOOP
    -- Check: does this person have a current VH group that backs this role?
    --
    -- For 'volunteer': ANY current VH group membership counts
    --   (because process_volunteerhub_group_roles always adds volunteer
    --    for anyone in any approved group)
    -- For specific roles: need a group with matching atlas_role
    IF v_rec.role = 'volunteer' THEN
      -- Volunteer is backed by being in ANY current VH group
      SELECT EXISTS (
        SELECT 1
        FROM trapper.volunteerhub_volunteers vv
        JOIN trapper.volunteerhub_group_memberships vgm
          ON vgm.volunteerhub_id = vv.volunteerhub_id
        WHERE vv.matched_person_id = v_rec.person_id
          AND vgm.left_at IS NULL
      ) INTO v_has_backing;
    ELSE
      -- Specific role needs a group with atlas_role matching
      SELECT EXISTS (
        SELECT 1
        FROM trapper.volunteerhub_volunteers vv
        JOIN trapper.volunteerhub_group_memberships vgm
          ON vgm.volunteerhub_id = vv.volunteerhub_id
        JOIN trapper.volunteerhub_user_groups vug
          ON vug.user_group_uid = vgm.user_group_uid
        WHERE vv.matched_person_id = v_rec.person_id
          AND vgm.left_at IS NULL
          AND vug.atlas_role = v_rec.role
      ) INTO v_has_backing;
    END IF;

    IF v_has_backing THEN
      -- Role is properly backed by VH group membership
      CONTINUE;
    END IF;

    -- Role is NOT backed — deactivate it
    IF p_dry_run THEN
      v_skipped := v_skipped + 1;
      v_details := v_details || jsonb_build_object(
        'person', v_rec.display_name,
        'role', v_rec.role,
        'trapper_type', v_rec.trapper_type,
        'source', v_rec.source_system,
        'action', 'would_deactivate'
      );
      CONTINUE;
    END IF;

    -- Deactivate
    UPDATE trapper.person_roles
    SET role_status = 'inactive',
        ended_at = CURRENT_DATE,
        notes = COALESCE(notes || '; ', '') ||
          'MIG_832: Deactivated — not backed by current VH group membership',
        updated_at = NOW()
    WHERE role_id = v_rec.role_id;

    -- Log to reconciliation log
    INSERT INTO trapper.role_reconciliation_log (
      person_id, role, previous_status, new_status,
      reason, source_system, evidence
    ) VALUES (
      v_rec.person_id,
      v_rec.role,
      'active',
      'inactive',
      'enforce_vh_role_authority: No current VH group backs this role',
      v_rec.source_system,
      jsonb_build_object(
        'trapper_type', v_rec.trapper_type,
        'original_source', v_rec.source_system,
        'display_name', v_rec.display_name
      )
    );

    -- Log to entity_edits
    INSERT INTO trapper.entity_edits (
      entity_type, entity_id, edit_type, field_name,
      old_value, new_value, reason,
      edit_source, edited_by
    ) VALUES (
      'person', v_rec.person_id, 'status_change', 'role_status',
      to_jsonb('active'::text), to_jsonb('inactive'::text),
      'VH authority: ' || v_rec.role || ' role deactivated — no current VH group with atlas_role=''' || v_rec.role || '''',
      'system', 'enforce_vh_role_authority'
    );

    v_deactivated := v_deactivated + 1;
    v_details := v_details || jsonb_build_object(
      'person', v_rec.display_name,
      'role', v_rec.role,
      'trapper_type', v_rec.trapper_type,
      'source', v_rec.source_system,
      'action', 'deactivated'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'deactivated', v_deactivated,
    'skipped', v_skipped,
    'dry_run', p_dry_run,
    'details', v_details
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.enforce_vh_role_authority IS
'Enforces VolunteerHub as the single source of truth for roles.
Deactivates any active volunteer/foster/trapper(ffsc)/caretaker/staff role
not backed by a current VH group membership.
Exceptions: community_trapper (Airtable), airtable_staff.
Run after each VH sync to maintain accuracy.
Created by MIG_832.';

-- ============================================================================
-- Step 2: Update v_role_without_volunteer to exclude community_trapper
-- ============================================================================

\echo ''
\echo 'Step 2: Updating v_role_without_volunteer to exclude community_trapper...'

CREATE OR REPLACE VIEW trapper.v_role_without_volunteer AS
SELECT
  pr.person_id,
  sp.display_name,
  ARRAY_AGG(DISTINCT pr.role ORDER BY pr.role) AS roles_without_volunteer,
  ARRAY_AGG(DISTINCT pr.source_system) AS role_sources,
  sp.data_source AS person_source,
  EXISTS (
    SELECT 1 FROM trapper.volunteerhub_volunteers vv
    WHERE vv.matched_person_id = pr.person_id
  ) AS has_vh_record,
  (
    SELECT ARRAY_AGG(DISTINCT vug.name)
    FROM trapper.volunteerhub_group_memberships vgm
    JOIN trapper.volunteerhub_user_groups vug
      ON vug.user_group_uid = vgm.user_group_uid
    JOIN trapper.volunteerhub_volunteers vv
      ON vv.volunteerhub_id = vgm.volunteerhub_id
    WHERE vv.matched_person_id = pr.person_id
      AND vgm.left_at IS NULL
  ) AS active_vh_groups
FROM trapper.person_roles pr
JOIN trapper.sot_people sp ON sp.person_id = pr.person_id
WHERE pr.role IN ('foster', 'trapper')
  AND pr.role_status = 'active'
  AND sp.merged_into_person_id IS NULL
  -- Exclude community_trapper: they legitimately don't need volunteer role
  AND NOT (pr.role = 'trapper' AND pr.trapper_type = 'community_trapper')
  -- Does NOT have active volunteer role
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_roles pr2
    WHERE pr2.person_id = pr.person_id
      AND pr2.role = 'volunteer'
      AND pr2.role_status = 'active'
  )
GROUP BY pr.person_id, sp.display_name, sp.data_source
ORDER BY sp.display_name;

COMMENT ON VIEW trapper.v_role_without_volunteer IS
'People with active foster or trapper (non-community) roles but NO active volunteer role.
Excludes community_trapper since they are not FFSC volunteers.
Created by MIG_829, updated by MIG_832.';

-- ============================================================================
-- Step 3: Dry run preview
-- ============================================================================

\echo ''
\echo 'Step 3: Dry run — roles that would be deactivated:'

SELECT * FROM trapper.enforce_vh_role_authority(p_dry_run := true);

-- ============================================================================
-- Step 4: Apply enforcement
-- ============================================================================

\echo ''
\echo 'Step 4: Applying VH role authority enforcement...'

SELECT * FROM trapper.enforce_vh_role_authority(p_dry_run := false);

-- ============================================================================
-- Step 5: Post-fix verification
-- ============================================================================

\echo ''
\echo 'Step 5: Post-fix verification...'

\echo ''
\echo 'Active roles by source (after cleanup):'
SELECT role, trapper_type, source_system, COUNT(*)
FROM trapper.person_roles
WHERE role_status = 'active'
GROUP BY role, trapper_type, source_system
ORDER BY role, source_system;

\echo ''
\echo 'Foster/trapper without volunteer (excluding community_trapper):'
SELECT COUNT(*) AS remaining_violations
FROM trapper.v_role_without_volunteer;

\echo ''
\echo 'Stale VH roles (active but no current group):'
SELECT COUNT(*) AS remaining_stale
FROM trapper.v_stale_volunteer_roles;

\echo ''
\echo 'Source conflicts:'
SELECT COUNT(*) AS remaining_conflicts
FROM trapper.v_role_source_conflicts;

-- ============================================================================
-- Step 6: Summary
-- ============================================================================

\echo ''
\echo '============================================================'
\echo 'MIG_832 SUMMARY'
\echo '============================================================'
\echo ''
\echo 'CREATED:'
\echo '  - enforce_vh_role_authority(dry_run) function'
\echo '  - Updated v_role_without_volunteer to exclude community_trapper'
\echo ''
\echo 'PRINCIPLE:'
\echo '  VH group memberships = sole authority for:'
\echo '    volunteer, foster, trapper (ffsc), caretaker, staff'
\echo '  Exceptions: community_trapper (Airtable), airtable_staff'
\echo ''
\echo 'INTEGRATION:'
\echo '  Add to VH sync endpoint after each sync:'
\echo '    SELECT trapper.enforce_vh_role_authority(false)'
\echo ''
\echo '=== MIG_832 Complete ==='
