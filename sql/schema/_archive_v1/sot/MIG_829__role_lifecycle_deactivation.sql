-- ============================================================================
-- MIG_829: Role Lifecycle — Automated Deactivation of Orphaned Roles
-- ============================================================================
-- WORKING_LEDGER ref: DQ-001 (Holiday Duncan false positive badges)
--
-- PROBLEM:
-- When a VolunteerHub volunteer leaves ALL approved groups, their
-- volunteerhub_group_memberships.left_at is set, but person_roles.role_status
-- stays 'active' forever. No automated deactivation exists.
--
-- Result: Map pins show stale Foster/Trapper/Volunteer badges for people
-- who left the organization months or years ago.
--
-- FIX:
-- 1. deactivate_orphaned_vh_roles() — finds people with active VH-sourced
--    roles who have NO current group memberships, deactivates them.
-- 2. v_stale_volunteer_roles — view showing roles needing deactivation.
-- 3. v_role_without_volunteer — foster/trapper people missing volunteer role.
-- 4. Integration point for VH sync endpoint to call after each sync.
-- ============================================================================

\echo ''
\echo '============================================================'
\echo 'MIG_829: Role Lifecycle — Automated Deactivation'
\echo '============================================================'
\echo ''

-- ============================================================================
-- Step 1: Create reconciliation log table
-- ============================================================================

\echo 'Step 1: Creating role_reconciliation_log table...'

CREATE TABLE IF NOT EXISTS trapper.role_reconciliation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),
  role TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_system TEXT,
  evidence JSONB,
  -- e.g., {"left_groups": ["Approved Trappers"], "left_at": "2025-06-15"}
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_log_person
  ON trapper.role_reconciliation_log (person_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reconciliation_log_recent
  ON trapper.role_reconciliation_log (created_at DESC);

COMMENT ON TABLE trapper.role_reconciliation_log IS
'Audit log for automated role status changes.
Tracks when and why roles are deactivated by the reconciliation process.
Created by MIG_829.';

\echo 'Reconciliation log table created.'

-- ============================================================================
-- Step 2: Create deactivate_orphaned_vh_roles() function
-- ============================================================================

\echo ''
\echo 'Step 2: Creating deactivate_orphaned_vh_roles function...'

CREATE OR REPLACE FUNCTION trapper.deactivate_orphaned_vh_roles(
  p_grace_days INT DEFAULT 30,
  p_dry_run BOOLEAN DEFAULT false
)
RETURNS JSONB AS $$
DECLARE
  v_rec RECORD;
  v_deactivated INT := 0;
  v_skipped INT := 0;
  v_details JSONB := '[]'::JSONB;
BEGIN
  -- Find people with active VH-sourced roles who have NO current
  -- group memberships (all memberships have left_at set, and the most
  -- recent left_at is older than grace_days)
  FOR v_rec IN
    SELECT
      pr.role_id,
      pr.person_id,
      pr.role,
      pr.trapper_type,
      sp.display_name,
      -- Most recent departure from any VH group
      (
        SELECT MAX(vgm.left_at)
        FROM trapper.volunteerhub_group_memberships vgm
        JOIN trapper.volunteerhub_volunteers vv
          ON vv.volunteerhub_id = vgm.volunteerhub_id
        WHERE vv.matched_person_id = pr.person_id
      ) AS last_left_at,
      -- Groups they were in
      (
        SELECT ARRAY_AGG(DISTINCT vug.name ORDER BY vug.name)
        FROM trapper.volunteerhub_group_memberships vgm
        JOIN trapper.volunteerhub_user_groups vug
          ON vug.user_group_uid = vgm.user_group_uid
        JOIN trapper.volunteerhub_volunteers vv
          ON vv.volunteerhub_id = vgm.volunteerhub_id
        WHERE vv.matched_person_id = pr.person_id
          AND vgm.left_at IS NOT NULL
      ) AS left_groups
    FROM trapper.person_roles pr
    JOIN trapper.sot_people sp ON sp.person_id = pr.person_id
    WHERE pr.role_status = 'active'
      AND pr.source_system = 'volunteerhub'
      AND sp.merged_into_person_id IS NULL
      -- Person has a VH volunteer record
      AND EXISTS (
        SELECT 1 FROM trapper.volunteerhub_volunteers vv
        WHERE vv.matched_person_id = pr.person_id
      )
      -- Person has NO current (active) group memberships
      AND NOT EXISTS (
        SELECT 1
        FROM trapper.volunteerhub_group_memberships vgm
        JOIN trapper.volunteerhub_volunteers vv
          ON vv.volunteerhub_id = vgm.volunteerhub_id
        WHERE vv.matched_person_id = pr.person_id
          AND vgm.left_at IS NULL
      )
      -- Grace period: all departures happened more than N days ago
      AND NOT EXISTS (
        SELECT 1
        FROM trapper.volunteerhub_group_memberships vgm
        JOIN trapper.volunteerhub_volunteers vv
          ON vv.volunteerhub_id = vgm.volunteerhub_id
        WHERE vv.matched_person_id = pr.person_id
          AND vgm.left_at > NOW() - (p_grace_days || ' days')::INTERVAL
      )
    ORDER BY sp.display_name
  LOOP
    IF p_dry_run THEN
      v_skipped := v_skipped + 1;
      v_details := v_details || jsonb_build_object(
        'person', v_rec.display_name,
        'role', v_rec.role,
        'last_left_at', v_rec.last_left_at,
        'action', 'would_deactivate'
      );
      CONTINUE;
    END IF;

    -- Deactivate the role
    UPDATE trapper.person_roles
    SET role_status = 'inactive',
        ended_at = COALESCE(v_rec.last_left_at::date, CURRENT_DATE),
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
      'No active VH group memberships; all groups left ' || p_grace_days || '+ days ago',
      'volunteerhub',
      jsonb_build_object(
        'left_groups', COALESCE(to_jsonb(v_rec.left_groups), '[]'::jsonb),
        'last_left_at', v_rec.last_left_at,
        'grace_days', p_grace_days,
        'trapper_type', v_rec.trapper_type
      )
    );

    -- Log to entity_edits for standard audit trail
    INSERT INTO trapper.entity_edits (
      entity_type, entity_id, edit_type, field_name,
      old_value, new_value, reason,
      edit_source, edited_by
    ) VALUES (
      'person', v_rec.person_id, 'status_change', 'role_status',
      to_jsonb('active'::text), to_jsonb('inactive'::text),
      'Auto-deactivated: left all VH groups ' || p_grace_days || '+ days ago. Role: ' || v_rec.role,
      'system', 'mig_829_lifecycle'
    );

    v_deactivated := v_deactivated + 1;
    v_details := v_details || jsonb_build_object(
      'person', v_rec.display_name,
      'role', v_rec.role,
      'last_left_at', v_rec.last_left_at,
      'action', 'deactivated'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'deactivated', v_deactivated,
    'skipped', v_skipped,
    'dry_run', p_dry_run,
    'grace_days', p_grace_days,
    'details', v_details
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.deactivate_orphaned_vh_roles IS
'Deactivates person_roles for people whose VolunteerHub group memberships
have all ended (left_at set). Applies a grace period (default 30 days)
before deactivation. Logs all changes to role_reconciliation_log and
entity_edits for full audit trail. Use dry_run=true to preview changes.
Created by MIG_829.';

-- ============================================================================
-- Step 3: Create reconciliation views
-- ============================================================================

\echo ''
\echo 'Step 3: Creating reconciliation views...'

-- View 1: Stale volunteer roles (active role, no current VH membership)
CREATE OR REPLACE VIEW trapper.v_stale_volunteer_roles AS
SELECT
  pr.role_id,
  pr.person_id,
  sp.display_name,
  pr.role,
  pr.trapper_type,
  pr.role_status,
  pr.source_system,
  pr.created_at AS role_created_at,
  (
    SELECT MAX(vgm.left_at)
    FROM trapper.volunteerhub_group_memberships vgm
    JOIN trapper.volunteerhub_volunteers vv
      ON vv.volunteerhub_id = vgm.volunteerhub_id
    WHERE vv.matched_person_id = pr.person_id
  ) AS last_group_left_at,
  (
    SELECT ARRAY_AGG(DISTINCT vug.name)
    FROM trapper.volunteerhub_group_memberships vgm
    JOIN trapper.volunteerhub_user_groups vug
      ON vug.user_group_uid = vgm.user_group_uid
    JOIN trapper.volunteerhub_volunteers vv
      ON vv.volunteerhub_id = vgm.volunteerhub_id
    WHERE vv.matched_person_id = pr.person_id
      AND vgm.left_at IS NOT NULL
  ) AS groups_left,
  EXTRACT(DAY FROM NOW() - (
    SELECT MAX(vgm.left_at)
    FROM trapper.volunteerhub_group_memberships vgm
    JOIN trapper.volunteerhub_volunteers vv
      ON vv.volunteerhub_id = vgm.volunteerhub_id
    WHERE vv.matched_person_id = pr.person_id
  ))::INT AS days_since_departure
FROM trapper.person_roles pr
JOIN trapper.sot_people sp ON sp.person_id = pr.person_id
WHERE pr.role_status = 'active'
  AND pr.source_system = 'volunteerhub'
  AND sp.merged_into_person_id IS NULL
  -- Has VH record
  AND EXISTS (
    SELECT 1 FROM trapper.volunteerhub_volunteers vv
    WHERE vv.matched_person_id = pr.person_id
  )
  -- No current active membership
  AND NOT EXISTS (
    SELECT 1
    FROM trapper.volunteerhub_group_memberships vgm
    JOIN trapper.volunteerhub_volunteers vv
      ON vv.volunteerhub_id = vgm.volunteerhub_id
    WHERE vv.matched_person_id = pr.person_id
      AND vgm.left_at IS NULL
  )
ORDER BY last_group_left_at NULLS LAST, sp.display_name;

COMMENT ON VIEW trapper.v_stale_volunteer_roles IS
'People with active VH-sourced roles who have NO current group memberships.
These roles should be deactivated. Created by MIG_829.';

-- View 2: Foster/trapper without volunteer (business rule violation)
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
'People with active foster or trapper roles but NO active volunteer role.
Violates business rule: all fosters/trappers must be volunteers first.
Created by MIG_829.';

-- View 3: Source conflicts (different status in Atlas vs source system)
CREATE OR REPLACE VIEW trapper.v_role_source_conflicts AS
SELECT
  pr.person_id,
  sp.display_name,
  pr.role,
  pr.role_status AS atlas_status,
  pr.source_system,
  -- VH status
  CASE
    WHEN pr.source_system = 'volunteerhub' THEN
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM trapper.volunteerhub_group_memberships vgm
          JOIN trapper.volunteerhub_volunteers vv
            ON vv.volunteerhub_id = vgm.volunteerhub_id
          WHERE vv.matched_person_id = pr.person_id
            AND vgm.left_at IS NULL
        ) THEN 'active_in_vh'
        WHEN EXISTS (
          SELECT 1
          FROM trapper.volunteerhub_volunteers vv
          WHERE vv.matched_person_id = pr.person_id
        ) THEN 'departed_vh'
        ELSE 'no_vh_record'
      END
    WHEN pr.source_system = 'shelterluv' THEN 'shelterluv_sourced'
    WHEN pr.source_system = 'airtable' THEN 'airtable_sourced'
    ELSE 'other_source'
  END AS source_status,
  pr.created_at AS role_created_at,
  pr.ended_at
FROM trapper.person_roles pr
JOIN trapper.sot_people sp ON sp.person_id = pr.person_id
WHERE sp.merged_into_person_id IS NULL
  AND (
    -- Active in Atlas but departed from VH
    (pr.role_status = 'active' AND pr.source_system = 'volunteerhub'
     AND NOT EXISTS (
       SELECT 1
       FROM trapper.volunteerhub_group_memberships vgm
       JOIN trapper.volunteerhub_volunteers vv
         ON vv.volunteerhub_id = vgm.volunteerhub_id
       WHERE vv.matched_person_id = pr.person_id
         AND vgm.left_at IS NULL
     )
     AND EXISTS (
       SELECT 1 FROM trapper.volunteerhub_volunteers vv
       WHERE vv.matched_person_id = pr.person_id
     ))
    OR
    -- ShelterLuv foster without volunteer (suspect name-only match)
    (pr.role = 'foster' AND pr.source_system = 'shelterluv'
     AND NOT EXISTS (
       SELECT 1 FROM trapper.person_roles pr2
       WHERE pr2.person_id = pr.person_id
         AND pr2.role = 'volunteer'
         AND pr2.role_status = 'active'
     ))
  )
ORDER BY sp.display_name, pr.role;

COMMENT ON VIEW trapper.v_role_source_conflicts IS
'Roles where Atlas status conflicts with source system status.
Includes: active in Atlas but departed VH, ShelterLuv fosters without volunteer.
Created by MIG_829.';

-- ============================================================================
-- Step 4: Dry run to show what would be deactivated
-- ============================================================================

\echo ''
\echo 'Step 4: Dry run — roles that would be deactivated (30-day grace):'

SELECT * FROM trapper.deactivate_orphaned_vh_roles(
  p_grace_days := 30,
  p_dry_run := true
);

\echo ''
\echo 'Stale volunteer roles (active role, no current VH membership):'
SELECT display_name, role, trapper_type, days_since_departure,
       groups_left
FROM trapper.v_stale_volunteer_roles
LIMIT 20;

\echo ''
\echo 'Foster/trapper without volunteer role:'
SELECT display_name, roles_without_volunteer, role_sources,
       has_vh_record, active_vh_groups
FROM trapper.v_role_without_volunteer
LIMIT 20;

\echo ''
\echo 'Role-source conflicts:'
SELECT display_name, role, atlas_status, source_status
FROM trapper.v_role_source_conflicts
LIMIT 20;

-- ============================================================================
-- Step 5: Summary
-- ============================================================================

\echo ''
\echo '============================================================'
\echo 'MIG_829 SUMMARY'
\echo '============================================================'
\echo ''
\echo 'CREATED:'
\echo '  1. role_reconciliation_log table (audit trail)'
\echo '  2. deactivate_orphaned_vh_roles(grace_days, dry_run) function'
\echo '  3. v_stale_volunteer_roles view'
\echo '  4. v_role_without_volunteer view'
\echo '  5. v_role_source_conflicts view'
\echo ''
\echo 'USAGE:'
\echo '  -- Preview what would be deactivated:'
\echo '  SELECT * FROM trapper.deactivate_orphaned_vh_roles(30, true);'
\echo ''
\echo '  -- Actually deactivate (30-day grace period):'
\echo '  SELECT * FROM trapper.deactivate_orphaned_vh_roles(30, false);'
\echo ''
\echo 'INTEGRATION:'
\echo '  Add to VH sync endpoint (POST /api/cron/volunteerhub-sync):'
\echo '    await query("SELECT trapper.deactivate_orphaned_vh_roles(30, false)");'
\echo ''
\echo 'NOTE: Dry run only. Apply deactivation in MIG_831 after review.'
\echo ''
\echo '=== MIG_829 Complete ==='
