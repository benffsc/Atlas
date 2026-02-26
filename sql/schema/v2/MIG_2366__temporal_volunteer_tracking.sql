-- MIG_2366: Temporal Volunteer Role Tracking
--
-- Purpose: Create ops.volunteer_roles table for tracking volunteer roles over time
-- This enables:
-- - Historical role queries (who was a trapper on date X?)
-- - Role tenure calculations
-- - Volunteer lifecycle analytics
--
-- Source: Joins source.volunteerhub_volunteers (matched_person_id)
--         with source.volunteerhub_group_memberships (joined_at, left_at)
--         and source.volunteerhub_user_groups (atlas_role)

-- Create the volunteer roles table
CREATE TABLE IF NOT EXISTS ops.volunteer_roles (
  volunteer_role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to canonical person
  person_id UUID NOT NULL REFERENCES sot.people(person_id),

  -- Role classification
  role_type TEXT NOT NULL CHECK (role_type IN (
    'trapper', 'foster', 'clinic_volunteer', 'coordinator',
    'board_member', 'staff', 'caretaker', 'donor', 'volunteer'
  )),

  -- Trapper subtype (only for role_type = 'trapper')
  trapper_type TEXT CHECK (trapper_type IS NULL OR trapper_type IN (
    'coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper'
  )),

  -- Temporal validity
  valid_from DATE NOT NULL,
  valid_to DATE,  -- NULL = currently active

  -- Source tracking
  source_system TEXT NOT NULL DEFAULT 'volunteerhub',
  source_record_id TEXT,  -- volunteerhub_id
  source_group_uid TEXT,  -- user_group_uid

  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_volunteer_roles_person
  ON ops.volunteer_roles(person_id);

CREATE INDEX IF NOT EXISTS idx_volunteer_roles_type
  ON ops.volunteer_roles(role_type);

CREATE INDEX IF NOT EXISTS idx_volunteer_roles_active
  ON ops.volunteer_roles(person_id)
  WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_volunteer_roles_valid_range
  ON ops.volunteer_roles(valid_from, valid_to);

-- Composite for temporal queries
CREATE INDEX IF NOT EXISTS idx_volunteer_roles_person_temporal
  ON ops.volunteer_roles(person_id, valid_from DESC, valid_to);

-- Comments
COMMENT ON TABLE ops.volunteer_roles IS
'Temporal tracking of volunteer roles. Each row represents a role assignment
with validity period (valid_from to valid_to). NULL valid_to = currently active.
Source: VolunteerHub group memberships.';

COMMENT ON COLUMN ops.volunteer_roles.role_type IS
'Primary role classification: trapper, foster, clinic_volunteer, coordinator,
board_member, staff, caretaker, donor, volunteer';

COMMENT ON COLUMN ops.volunteer_roles.trapper_type IS
'Trapper subclassification (FFSC hierarchy). Only set when role_type = trapper.
coordinator > head_trapper > ffsc_trapper > community_trapper';

COMMENT ON COLUMN ops.volunteer_roles.valid_from IS
'Date this role assignment became active (from VolunteerHub joined_at)';

COMMENT ON COLUMN ops.volunteer_roles.valid_to IS
'Date this role assignment ended (from VolunteerHub left_at). NULL = still active.';

-- View: Active volunteers by role
CREATE OR REPLACE VIEW ops.v_active_volunteers AS
SELECT
  vr.person_id,
  p.display_name,
  vr.role_type,
  vr.trapper_type,
  vr.valid_from,
  DATE_PART('day', NOW() - vr.valid_from::timestamp)::int as days_in_role
FROM ops.volunteer_roles vr
JOIN sot.people p ON p.person_id = vr.person_id
WHERE vr.valid_to IS NULL
  AND p.merged_into_person_id IS NULL
ORDER BY vr.role_type, p.display_name;

COMMENT ON VIEW ops.v_active_volunteers IS
'Currently active volunteers with their roles and tenure.';

-- View: Volunteer role history
CREATE OR REPLACE VIEW ops.v_volunteer_role_history AS
SELECT
  vr.person_id,
  p.display_name,
  vr.role_type,
  vr.trapper_type,
  vr.valid_from,
  vr.valid_to,
  CASE
    WHEN vr.valid_to IS NULL THEN DATE_PART('day', NOW() - vr.valid_from::timestamp)::int
    ELSE DATE_PART('day', vr.valid_to::timestamp - vr.valid_from::timestamp)::int
  END as days_in_role,
  vr.valid_to IS NULL as is_active
FROM ops.volunteer_roles vr
JOIN sot.people p ON p.person_id = vr.person_id
WHERE p.merged_into_person_id IS NULL
ORDER BY vr.person_id, vr.valid_from DESC;

COMMENT ON VIEW ops.v_volunteer_role_history IS
'Full role history for all volunteers, including past and current roles.';

-- View: Role counts over time
CREATE OR REPLACE VIEW ops.v_volunteer_role_counts AS
SELECT
  role_type,
  COUNT(*) FILTER (WHERE valid_to IS NULL) as active_count,
  COUNT(*) as total_ever,
  COUNT(*) FILTER (WHERE valid_to IS NOT NULL) as past_count,
  AVG(
    CASE
      WHEN valid_to IS NULL THEN DATE_PART('day', NOW() - valid_from::timestamp)
      ELSE DATE_PART('day', valid_to::timestamp - valid_from::timestamp)
    END
  )::int as avg_days_in_role
FROM ops.volunteer_roles
GROUP BY role_type
ORDER BY active_count DESC;

COMMENT ON VIEW ops.v_volunteer_role_counts IS
'Summary counts by role type: active, total ever, past, average tenure.';

-- Function: Check if person has role on a given date
CREATE OR REPLACE FUNCTION ops.person_had_role_on_date(
  p_person_id UUID,
  p_role_type TEXT,
  p_date DATE DEFAULT CURRENT_DATE
) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM ops.volunteer_roles
    WHERE person_id = p_person_id
      AND role_type = p_role_type
      AND valid_from <= p_date
      AND (valid_to IS NULL OR valid_to >= p_date)
  );
$$;

COMMENT ON FUNCTION ops.person_had_role_on_date IS
'Check if a person had a specific role on a given date. Defaults to today.';

-- Function: Get all roles for person on a given date
CREATE OR REPLACE FUNCTION ops.get_person_roles_on_date(
  p_person_id UUID,
  p_date DATE DEFAULT CURRENT_DATE
) RETURNS TABLE (
  role_type TEXT,
  trapper_type TEXT,
  valid_from DATE,
  valid_to DATE
)
LANGUAGE sql STABLE AS $$
  SELECT role_type, trapper_type, valid_from, valid_to
  FROM ops.volunteer_roles
  WHERE person_id = p_person_id
    AND valid_from <= p_date
    AND (valid_to IS NULL OR valid_to >= p_date)
  ORDER BY role_type;
$$;

COMMENT ON FUNCTION ops.get_person_roles_on_date IS
'Get all roles a person had on a given date. Defaults to today.';

-- Report
DO $$
BEGIN
  RAISE NOTICE 'MIG_2366: Temporal volunteer tracking created';
  RAISE NOTICE '  Table: ops.volunteer_roles';
  RAISE NOTICE '  Views: v_active_volunteers, v_volunteer_role_history, v_volunteer_role_counts';
  RAISE NOTICE '  Functions: person_had_role_on_date(), get_person_roles_on_date()';
END $$;
