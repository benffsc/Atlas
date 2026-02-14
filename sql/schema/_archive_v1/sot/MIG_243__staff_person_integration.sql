-- MIG_243: Staff-Person Integration
--
-- Ensures all staff members have:
-- 1. A linked person record (already done via person_id column)
-- 2. Proper identifiers (email/phone) in person_identifiers
-- 3. 'staff' role in person_role_history
-- 4. Trigger to sync new staff to people
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_243__staff_person_integration.sql

\echo ''
\echo 'MIG_243: Staff-Person Integration'
\echo '================================='
\echo ''

-- ============================================================
-- 1. Add 'staff' role to all current staff members
-- ============================================================

\echo 'Adding staff role to person_role_history...'

INSERT INTO trapper.person_role_history (person_id, role_type, status, source_system, notes)
SELECT
  s.person_id,
  'staff',
  CASE WHEN s.is_active THEN 'active' ELSE 'inactive' END,
  'staff_sync',
  'FFSC staff member: ' || s.role
FROM trapper.staff s
WHERE s.person_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_role_history prh
    WHERE prh.person_id = s.person_id
      AND prh.role_type = 'staff'
      AND prh.status = 'active'
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. Function to sync a staff record to person tables
-- ============================================================

\echo 'Creating sync_staff_to_person function...'

CREATE OR REPLACE FUNCTION trapper.sync_staff_to_person(p_staff_id UUID)
RETURNS UUID AS $$
DECLARE
  v_staff RECORD;
  v_person_id UUID;
  v_norm_email TEXT;
  v_norm_phone TEXT;
BEGIN
  SELECT * INTO v_staff FROM trapper.staff WHERE staff_id = p_staff_id;

  IF v_staff IS NULL THEN
    RETURN NULL;
  END IF;

  -- Normalize contact info
  v_norm_email := NULLIF(lower(trim(v_staff.email)), '');
  v_norm_phone := trapper.norm_phone_us(v_staff.phone);

  -- If staff already has person_id, use it
  IF v_staff.person_id IS NOT NULL THEN
    v_person_id := v_staff.person_id;
  ELSE
    -- Try to find existing person by email
    IF v_norm_email IS NOT NULL THEN
      SELECT pi.person_id INTO v_person_id
      FROM trapper.person_identifiers pi
      JOIN trapper.sot_people p ON p.person_id = pi.person_id
      WHERE pi.id_type = 'email'
        AND pi.id_value_norm = v_norm_email
        AND p.merged_into_person_id IS NULL
      LIMIT 1;
    END IF;

    -- Try phone if no email match
    IF v_person_id IS NULL AND v_norm_phone IS NOT NULL THEN
      SELECT pi.person_id INTO v_person_id
      FROM trapper.person_identifiers pi
      JOIN trapper.sot_people p ON p.person_id = pi.person_id
      WHERE pi.id_type = 'phone'
        AND pi.id_value_norm = v_norm_phone
        AND p.merged_into_person_id IS NULL
      LIMIT 1;
    END IF;

    -- Create new person if no match
    IF v_person_id IS NULL THEN
      INSERT INTO trapper.sot_people (display_name, data_source, created_at, updated_at)
      VALUES (v_staff.display_name, 'web_app', NOW(), NOW())
      RETURNING person_id INTO v_person_id;
    END IF;

    -- Link staff to person
    UPDATE trapper.staff SET person_id = v_person_id WHERE staff_id = p_staff_id;
  END IF;

  -- Ensure email identifier exists
  IF v_norm_email IS NOT NULL THEN
    INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, source_system)
    VALUES (v_person_id, 'email', v_staff.email, v_norm_email, 'staff_sync')
    ON CONFLICT (id_type, id_value_norm) DO NOTHING;
  END IF;

  -- Ensure phone identifier exists
  IF v_norm_phone IS NOT NULL THEN
    INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, source_system)
    VALUES (v_person_id, 'phone', v_staff.phone, v_norm_phone, 'staff_sync')
    ON CONFLICT (id_type, id_value_norm) DO NOTHING;
  END IF;

  -- Ensure staff role exists
  IF NOT EXISTS (
    SELECT 1 FROM trapper.person_role_history
    WHERE person_id = v_person_id AND role_type = 'staff' AND status = 'active' AND ended_at IS NULL
  ) THEN
    -- End any previous staff role
    UPDATE trapper.person_role_history
    SET ended_at = NOW(), status = 'replaced'
    WHERE person_id = v_person_id AND role_type = 'staff' AND ended_at IS NULL;

    -- Add new active role
    INSERT INTO trapper.person_role_history (person_id, role_type, status, source_system, notes)
    VALUES (v_person_id, 'staff', CASE WHEN v_staff.is_active THEN 'active' ELSE 'inactive' END, 'staff_sync', 'FFSC staff: ' || COALESCE(v_staff.role, 'unknown'));
  END IF;

  -- Update display name if person's is poor quality
  UPDATE trapper.sot_people
  SET display_name = v_staff.display_name, updated_at = NOW()
  WHERE person_id = v_person_id
    AND (display_name IS NULL OR display_name = 'Unknown' OR display_name ~ '^\d+$');

  RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.sync_staff_to_person IS
'Syncs a staff record to the person tables (sot_people, person_identifiers, person_role_history).
Call when creating or updating staff members.';

-- ============================================================
-- 3. Trigger to auto-sync new staff
-- ============================================================

\echo 'Creating trigger for new staff...'

CREATE OR REPLACE FUNCTION trapper.trigger_staff_sync()
RETURNS TRIGGER AS $$
BEGIN
  -- Sync on insert or when key fields change
  IF TG_OP = 'INSERT' OR
     (TG_OP = 'UPDATE' AND (
       NEW.email IS DISTINCT FROM OLD.email OR
       NEW.phone IS DISTINCT FROM OLD.phone OR
       NEW.display_name IS DISTINCT FROM OLD.display_name OR
       NEW.is_active IS DISTINCT FROM OLD.is_active
     ))
  THEN
    PERFORM trapper.sync_staff_to_person(NEW.staff_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_sync ON trapper.staff;
CREATE TRIGGER trg_staff_sync
  AFTER INSERT OR UPDATE ON trapper.staff
  FOR EACH ROW
  EXECUTE FUNCTION trapper.trigger_staff_sync();

-- ============================================================
-- 4. View: Staff with person profile info
-- ============================================================

\echo 'Creating v_staff_profile view...'

CREATE OR REPLACE VIEW trapper.v_staff_profile AS
SELECT
  s.staff_id,
  s.person_id,
  s.display_name,
  s.email,
  s.phone,
  s.role as staff_role,
  s.department,
  s.is_active,
  s.hired_date,
  -- From person profile
  p.atlas_id as person_atlas_id,
  (SELECT array_agg(DISTINCT role_type) FROM trapper.person_role_history WHERE person_id = s.person_id AND status = 'active' AND ended_at IS NULL) AS person_roles,
  (SELECT COUNT(*) FROM trapper.journal_entries WHERE created_by_staff_id = s.staff_id) AS journal_entries_created,
  (SELECT COUNT(*) FROM trapper.person_interactions WHERE metadata->>'staff_id' = s.staff_id::text) AS interactions_logged
FROM trapper.staff s
LEFT JOIN trapper.sot_people p ON p.person_id = s.person_id
ORDER BY s.display_name;

COMMENT ON VIEW trapper.v_staff_profile IS
'Staff members with their linked person profile info and activity counts.';

-- ============================================================
-- 5. Sync all existing staff (backfill)
-- ============================================================

\echo 'Syncing all existing staff to person tables...'

DO $$
DECLARE
  v_count INT := 0;
  v_staff RECORD;
BEGIN
  FOR v_staff IN SELECT staff_id FROM trapper.staff
  LOOP
    PERFORM trapper.sync_staff_to_person(v_staff.staff_id);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Synced % staff members', v_count;
END;
$$;

-- ============================================================
-- Summary
-- ============================================================

\echo ''
\echo 'MIG_243 Complete!'
\echo ''
\echo 'What happened:'
\echo '  - All staff now have "staff" role in person_role_history'
\echo '  - Staff identifiers synced to person_identifiers'
\echo '  - New staff will auto-sync via trigger'
\echo ''
\echo 'New function:'
\echo '  sync_staff_to_person(staff_id) - Manually sync a staff member'
\echo ''
\echo 'New view:'
\echo '  v_staff_profile - Staff with person profile info'
\echo ''
