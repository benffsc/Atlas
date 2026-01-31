\echo '=== MIG_809: VolunteerHub User Groups + Temporal Memberships ==='
\echo 'VOL_001b: Schema for VH user group hierarchy, group→role mapping, and join/leave tracking.'
\echo ''

-- ============================================================================
-- PURPOSE
-- ============================================================================
-- VolunteerHub organizes volunteers into User Groups with a parent/child hierarchy.
-- The parent group "Approved Volunteers" contains ALL current FFSC volunteers.
-- Sub-groups (Approved Trappers, Approved Foster Parent, etc.) determine the
-- volunteer's role within FFSC.
--
-- This migration creates:
-- 1. volunteerhub_user_groups — mirrors VH group hierarchy with Atlas role mapping
-- 2. volunteerhub_group_memberships — temporal tracking (join/leave dates)
-- 3. ALTER volunteerhub_volunteers — adds columns for API sync and enriched data
-- 4. sync_volunteer_group_memberships() — compares and updates memberships
-- 5. v_volunteer_roster — active volunteers with groups and matched people
-- ============================================================================

-- ============================================================================
-- STEP 1: User Groups table
-- ============================================================================

\echo 'STEP 1: Creating volunteerhub_user_groups table...'

CREATE TABLE IF NOT EXISTS trapper.volunteerhub_user_groups (
  user_group_uid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  parent_user_group_uid TEXT REFERENCES trapper.volunteerhub_user_groups(user_group_uid),

  -- Atlas role mapping: what person_roles.role does this group correspond to?
  atlas_role TEXT CHECK (atlas_role IS NULL OR atlas_role IN (
    'trapper', 'foster', 'volunteer', 'staff', 'caretaker', 'board_member', 'donor'
  )),
  -- Only for trapper groups
  atlas_trapper_type TEXT CHECK (atlas_trapper_type IS NULL OR atlas_trapper_type IN (
    'coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper'
  )),

  -- Marks the "Approved Volunteers" parent group
  is_approved_parent BOOLEAN NOT NULL DEFAULT FALSE,

  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vh_user_groups_parent
  ON trapper.volunteerhub_user_groups(parent_user_group_uid);

COMMENT ON TABLE trapper.volunteerhub_user_groups IS
'Mirrors VolunteerHub user group hierarchy. atlas_role and atlas_trapper_type map each VH
group to the corresponding person_roles entry. Groups under "Approved Volunteers" represent
current FFSC volunteers. Synced via volunteerhub_api_sync.mjs.';

-- ============================================================================
-- STEP 2: Group Memberships table (temporal join/leave tracking)
-- ============================================================================

\echo 'STEP 2: Creating volunteerhub_group_memberships table...'

CREATE TABLE IF NOT EXISTS trapper.volunteerhub_group_memberships (
  membership_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  volunteerhub_id TEXT NOT NULL,
  user_group_uid TEXT NOT NULL REFERENCES trapper.volunteerhub_user_groups(user_group_uid),

  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,  -- NULL = still active

  source TEXT NOT NULL DEFAULT 'api_sync',  -- 'api_sync', 'xlsx_import', 'manual'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one active membership per volunteer per group
CREATE UNIQUE INDEX IF NOT EXISTS idx_vh_memberships_active
  ON trapper.volunteerhub_group_memberships(volunteerhub_id, user_group_uid)
  WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vh_memberships_volunteer
  ON trapper.volunteerhub_group_memberships(volunteerhub_id);

CREATE INDEX IF NOT EXISTS idx_vh_memberships_group
  ON trapper.volunteerhub_group_memberships(user_group_uid);

COMMENT ON TABLE trapper.volunteerhub_group_memberships IS
'Temporal tracking of volunteer group memberships. When a volunteer joins a VH group, a
row is created with left_at = NULL. When they leave, left_at is set. Full history preserved.
Used to track volunteer joins/departures over time.';

-- ============================================================================
-- STEP 3: Alter volunteerhub_volunteers — add API sync + enriched data columns
-- ============================================================================

\echo 'STEP 3: Adding columns to volunteerhub_volunteers...'

-- API sync tracking
ALTER TABLE trapper.volunteerhub_volunteers
  ADD COLUMN IF NOT EXISTS user_group_uids TEXT[],
  ADD COLUMN IF NOT EXISTS vh_version BIGINT,
  ADD COLUMN IF NOT EXISTS last_api_sync_at TIMESTAMPTZ;

-- Enriched data fields (from VH 52-field export)
ALTER TABLE trapper.volunteerhub_volunteers
  ADD COLUMN IF NOT EXISTS volunteer_notes TEXT,
  ADD COLUMN IF NOT EXISTS skills JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS volunteer_availability TEXT,
  ADD COLUMN IF NOT EXISTS languages TEXT,
  ADD COLUMN IF NOT EXISTS pronouns TEXT,
  ADD COLUMN IF NOT EXISTS occupation TEXT,
  ADD COLUMN IF NOT EXISTS how_heard TEXT,
  ADD COLUMN IF NOT EXISTS volunteer_motivation TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_raw TEXT,
  ADD COLUMN IF NOT EXISTS can_drive BOOLEAN,
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS volunteer_experience TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS event_count INT,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS waiver_status TEXT;

COMMENT ON COLUMN trapper.volunteerhub_volunteers.user_group_uids IS
'Raw array of VH UserGroupMembership GUIDs from the API. Used by sync to detect group changes.';

COMMENT ON COLUMN trapper.volunteerhub_volunteers.skills IS
'JSONB aggregation of all skill/interest fields from VH: trapping, fostering, colony_caretaking,
transportation, special_skills, spay_neuter_clinic, cat_reunification, cat_experience, laundry_angel, etc.';

-- ============================================================================
-- STEP 4: sync_volunteer_group_memberships() function
-- ============================================================================

\echo 'STEP 4: Creating sync_volunteer_group_memberships() function...'

CREATE OR REPLACE FUNCTION trapper.sync_volunteer_group_memberships(
  p_volunteerhub_id TEXT,
  p_current_group_uids TEXT[]
)
RETURNS JSONB AS $$
DECLARE
  v_joined TEXT[] := '{}';
  v_left TEXT[] := '{}';
  v_uid TEXT;
  v_group_name TEXT;
  v_person_id UUID;
BEGIN
  -- Get matched person for logging
  SELECT matched_person_id INTO v_person_id
  FROM trapper.volunteerhub_volunteers
  WHERE volunteerhub_id = p_volunteerhub_id;

  -- Find groups the volunteer has LEFT (active membership not in current list)
  FOR v_uid, v_group_name IN
    SELECT vgm.user_group_uid, vug.name
    FROM trapper.volunteerhub_group_memberships vgm
    JOIN trapper.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
    WHERE vgm.volunteerhub_id = p_volunteerhub_id
      AND vgm.left_at IS NULL
      AND vgm.user_group_uid != ALL(COALESCE(p_current_group_uids, '{}'))
  LOOP
    UPDATE trapper.volunteerhub_group_memberships
    SET left_at = NOW(), updated_at = NOW()
    WHERE volunteerhub_id = p_volunteerhub_id
      AND user_group_uid = v_uid
      AND left_at IS NULL;

    v_left := array_append(v_left, v_group_name);

    -- Log departure
    IF v_person_id IS NOT NULL THEN
      INSERT INTO trapper.entity_edits (
        entity_type, entity_id, field_name, old_value, new_value,
        edit_source, edit_reason, performed_by
      ) VALUES (
        'person', v_person_id,
        'volunteerhub_group_membership',
        v_group_name, NULL,
        'volunteerhub_sync',
        'Volunteer left VH group: ' || v_group_name,
        'system'
      );
    END IF;
  END LOOP;

  -- Find groups the volunteer has JOINED (in current list but no active membership)
  FOREACH v_uid IN ARRAY COALESCE(p_current_group_uids, '{}')
  LOOP
    -- Skip if group not in our table (might be a group we haven't synced yet)
    SELECT name INTO v_group_name
    FROM trapper.volunteerhub_user_groups
    WHERE user_group_uid = v_uid;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Check if already has active membership
    IF NOT EXISTS (
      SELECT 1 FROM trapper.volunteerhub_group_memberships
      WHERE volunteerhub_id = p_volunteerhub_id
        AND user_group_uid = v_uid
        AND left_at IS NULL
    ) THEN
      INSERT INTO trapper.volunteerhub_group_memberships (
        volunteerhub_id, user_group_uid, joined_at, source
      ) VALUES (
        p_volunteerhub_id, v_uid, NOW(), 'api_sync'
      );

      v_joined := array_append(v_joined, v_group_name);

      -- Log join
      IF v_person_id IS NOT NULL THEN
        INSERT INTO trapper.entity_edits (
          entity_type, entity_id, field_name, old_value, new_value,
          edit_source, edit_reason, performed_by
        ) VALUES (
          'person', v_person_id,
          'volunteerhub_group_membership',
          NULL, v_group_name,
          'volunteerhub_sync',
          'Volunteer joined VH group: ' || v_group_name,
          'system'
        );
      END IF;
    END IF;
  END LOOP;

  -- Update the raw array on the volunteer record
  UPDATE trapper.volunteerhub_volunteers
  SET user_group_uids = p_current_group_uids,
      last_api_sync_at = NOW()
  WHERE volunteerhub_id = p_volunteerhub_id;

  RETURN JSONB_BUILD_OBJECT(
    'joined', to_jsonb(v_joined),
    'left', to_jsonb(v_left)
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.sync_volunteer_group_memberships IS
'Compares a volunteer''s current VH group membership UIDs with their active memberships
in the database. Creates new memberships for joined groups, closes memberships for left
groups. All changes logged to entity_edits. Returns {joined: [], left: []}.';

-- ============================================================================
-- STEP 5: Volunteer Roster view
-- ============================================================================

\echo 'STEP 5: Creating v_volunteer_roster view...'

CREATE OR REPLACE VIEW trapper.v_volunteer_roster AS
SELECT
  vv.volunteerhub_id,
  vv.display_name,
  vv.email,
  vv.phone,
  vv.status,
  vv.is_active,
  vv.hours_logged,
  vv.event_count,
  vv.last_activity_at,
  vv.joined_at,
  vv.matched_person_id,
  vv.match_confidence,
  vv.volunteer_notes,
  vv.skills,
  vv.volunteer_availability,
  -- Active group names
  COALESCE(
    (SELECT ARRAY_AGG(vug.name ORDER BY vug.name)
     FROM trapper.volunteerhub_group_memberships vgm
     JOIN trapper.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
     WHERE vgm.volunteerhub_id = vv.volunteerhub_id
       AND vgm.left_at IS NULL),
    '{}'
  ) as active_groups,
  -- Mapped Atlas roles from active groups
  COALESCE(
    (SELECT ARRAY_AGG(DISTINCT vug.atlas_role)
     FROM trapper.volunteerhub_group_memberships vgm
     JOIN trapper.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
     WHERE vgm.volunteerhub_id = vv.volunteerhub_id
       AND vgm.left_at IS NULL
       AND vug.atlas_role IS NOT NULL),
    '{}'
  ) as mapped_roles,
  -- Person display name from SOT
  sp.display_name as atlas_display_name,
  -- Existing Atlas roles
  COALESCE(
    (SELECT ARRAY_AGG(DISTINCT pr.role || COALESCE('/' || pr.trapper_type, ''))
     FROM trapper.person_roles pr
     WHERE pr.person_id = vv.matched_person_id
       AND pr.role_status = 'active'),
    '{}'
  ) as atlas_roles
FROM trapper.volunteerhub_volunteers vv
LEFT JOIN trapper.sot_people sp ON sp.person_id = vv.matched_person_id
WHERE vv.sync_status != 'error'
ORDER BY vv.display_name;

COMMENT ON VIEW trapper.v_volunteer_roster IS
'All volunteers from VolunteerHub with their active group memberships, mapped Atlas roles,
and linked Atlas person info. Used for admin volunteer management and reconciliation.';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_809 Complete'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - volunteerhub_user_groups table (VH group hierarchy + Atlas role mapping)'
\echo '  - volunteerhub_group_memberships table (temporal join/leave tracking)'
\echo '  - Added 17 columns to volunteerhub_volunteers (API sync + enriched data)'
\echo '  - sync_volunteer_group_memberships() function'
\echo '  - v_volunteer_roster view'
\echo ''
\echo 'Next: Run MIG_810 for group-based role processing functions.'
\echo 'Then: Run volunteerhub_api_sync.mjs to populate from the VH API.'
\echo ''
