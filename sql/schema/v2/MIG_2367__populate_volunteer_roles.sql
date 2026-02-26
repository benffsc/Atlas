-- MIG_2367: Populate Volunteer Roles from VolunteerHub
--
-- Purpose: Populate ops.volunteer_roles from source.volunteerhub_* tables
--
-- Data Flow:
-- 1. source.volunteerhub_volunteers (matched_person_id) -> person link
-- 2. source.volunteerhub_group_memberships (joined_at, left_at) -> temporal
-- 3. source.volunteerhub_user_groups (atlas_role, atlas_trapper_type) -> role classification

-- Step 1: Insert volunteer roles from matched VolunteerHub data
INSERT INTO ops.volunteer_roles (
  person_id,
  role_type,
  trapper_type,
  valid_from,
  valid_to,
  source_system,
  source_record_id,
  source_group_uid
)
SELECT DISTINCT
  v.matched_person_id as person_id,
  COALESCE(ug.atlas_role, 'volunteer') as role_type,
  ug.atlas_trapper_type as trapper_type,
  COALESCE(gm.joined_at::date, v.created_at::date, CURRENT_DATE) as valid_from,
  gm.left_at::date as valid_to,
  'volunteerhub' as source_system,
  v.volunteerhub_id as source_record_id,
  ug.user_group_uid as source_group_uid
FROM source.volunteerhub_volunteers v
JOIN source.volunteerhub_group_memberships gm ON gm.volunteerhub_id = v.volunteerhub_id
JOIN source.volunteerhub_user_groups ug ON ug.user_group_uid = gm.user_group_uid
WHERE v.matched_person_id IS NOT NULL
  -- Only include groups with mapped atlas_role
  AND ug.atlas_role IS NOT NULL
  -- Avoid duplicates if re-running
  AND NOT EXISTS (
    SELECT 1 FROM ops.volunteer_roles vr
    WHERE vr.person_id = v.matched_person_id
      AND vr.source_group_uid = ug.user_group_uid
      AND vr.source_record_id = v.volunteerhub_id
  );

-- Step 2: For volunteers without group memberships, create a default 'volunteer' role
INSERT INTO ops.volunteer_roles (
  person_id,
  role_type,
  valid_from,
  source_system,
  source_record_id
)
SELECT DISTINCT
  v.matched_person_id as person_id,
  'volunteer' as role_type,
  COALESCE(v.created_at::date, CURRENT_DATE) as valid_from,
  'volunteerhub' as source_system,
  v.volunteerhub_id as source_record_id
FROM source.volunteerhub_volunteers v
WHERE v.matched_person_id IS NOT NULL
  -- Only if they have no memberships
  AND NOT EXISTS (
    SELECT 1 FROM source.volunteerhub_group_memberships gm
    WHERE gm.volunteerhub_id = v.volunteerhub_id
  )
  -- And no existing role records
  AND NOT EXISTS (
    SELECT 1 FROM ops.volunteer_roles vr
    WHERE vr.person_id = v.matched_person_id
      AND vr.source_record_id = v.volunteerhub_id
  );

-- Step 3: Create function to refresh volunteer roles
CREATE OR REPLACE FUNCTION ops.refresh_volunteer_roles()
RETURNS TABLE (
  inserted INT,
  updated INT,
  total INT
)
LANGUAGE plpgsql AS $$
DECLARE
  v_inserted INT := 0;
  v_updated INT := 0;
  v_total INT;
BEGIN
  -- Insert new role assignments
  WITH new_roles AS (
    INSERT INTO ops.volunteer_roles (
      person_id,
      role_type,
      trapper_type,
      valid_from,
      valid_to,
      source_system,
      source_record_id,
      source_group_uid
    )
    SELECT DISTINCT
      v.matched_person_id,
      COALESCE(ug.atlas_role, 'volunteer'),
      ug.atlas_trapper_type,
      COALESCE(gm.joined_at::date, v.created_at::date, CURRENT_DATE),
      gm.left_at::date,
      'volunteerhub',
      v.volunteerhub_id,
      ug.user_group_uid
    FROM source.volunteerhub_volunteers v
    JOIN source.volunteerhub_group_memberships gm ON gm.volunteerhub_id = v.volunteerhub_id
    JOIN source.volunteerhub_user_groups ug ON ug.user_group_uid = gm.user_group_uid
    WHERE v.matched_person_id IS NOT NULL
      AND ug.atlas_role IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM ops.volunteer_roles vr
        WHERE vr.person_id = v.matched_person_id
          AND vr.source_group_uid = ug.user_group_uid
          AND vr.source_record_id = v.volunteerhub_id
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM new_roles;

  -- Update ended roles (left_at changed from NULL to a date)
  WITH updated_roles AS (
    UPDATE ops.volunteer_roles vr
    SET
      valid_to = gm.left_at::date,
      updated_at = NOW()
    FROM source.volunteerhub_group_memberships gm
    WHERE vr.source_record_id = gm.volunteerhub_id
      AND vr.source_group_uid = gm.user_group_uid
      AND vr.valid_to IS NULL
      AND gm.left_at IS NOT NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_updated FROM updated_roles;

  SELECT COUNT(*) INTO v_total FROM ops.volunteer_roles;

  RETURN QUERY SELECT v_inserted, v_updated, v_total;
END;
$$;

COMMENT ON FUNCTION ops.refresh_volunteer_roles IS
'Refresh volunteer roles from VolunteerHub source tables.
Inserts new roles, updates ended roles. Returns counts.';

-- Report results
DO $$
DECLARE
  v_role_count INT;
  v_active_count INT;
  v_person_count INT;
BEGIN
  SELECT COUNT(*) INTO v_role_count FROM ops.volunteer_roles;
  SELECT COUNT(*) INTO v_active_count FROM ops.volunteer_roles WHERE valid_to IS NULL;
  SELECT COUNT(DISTINCT person_id) INTO v_person_count FROM ops.volunteer_roles;

  RAISE NOTICE 'MIG_2367: Volunteer roles populated';
  RAISE NOTICE '  Total role records: %', v_role_count;
  RAISE NOTICE '  Active roles: %', v_active_count;
  RAISE NOTICE '  Unique people with roles: %', v_person_count;
END $$;

-- Show role distribution
DO $$
DECLARE
  rec RECORD;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Role distribution:';
  FOR rec IN
    SELECT role_type, COUNT(*) as total,
           COUNT(*) FILTER (WHERE valid_to IS NULL) as active
    FROM ops.volunteer_roles
    GROUP BY role_type
    ORDER BY total DESC
  LOOP
    RAISE NOTICE '  %: % total, % active', rec.role_type, rec.total, rec.active;
  END LOOP;
END $$;
