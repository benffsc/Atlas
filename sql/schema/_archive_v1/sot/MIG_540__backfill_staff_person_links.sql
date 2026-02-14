\echo ''
\echo '=============================================='
\echo 'MIG_540: Backfill Staff Person Links'
\echo '=============================================='
\echo ''
\echo 'Ensures all active staff members have linked person records.'
\echo 'Creates person records where missing and adds staff role.'
\echo ''

-- ============================================================================
-- PART 1: Check current state
-- ============================================================================

\echo 'Checking current staff-person linkage state...'

DO $$
DECLARE
  v_total_staff INT;
  v_linked_staff INT;
  v_unlinked_staff INT;
BEGIN
  SELECT COUNT(*) INTO v_total_staff FROM trapper.staff WHERE is_active = TRUE;
  SELECT COUNT(*) INTO v_linked_staff FROM trapper.staff WHERE is_active = TRUE AND person_id IS NOT NULL;
  v_unlinked_staff := v_total_staff - v_linked_staff;

  RAISE NOTICE 'Total active staff: %', v_total_staff;
  RAISE NOTICE 'Already linked: %', v_linked_staff;
  RAISE NOTICE 'Need linking: %', v_unlinked_staff;
END $$;

-- ============================================================================
-- PART 2: Backfill person records for unlinked staff
-- ============================================================================

\echo 'Backfilling person records for unlinked staff...'

DO $$
DECLARE
  r RECORD;
  v_person_id UUID;
  v_linked_count INT := 0;
  v_created_count INT := 0;
BEGIN
  FOR r IN (
    SELECT staff_id, first_name, last_name, email, phone, display_name
    FROM trapper.staff
    WHERE is_active = TRUE AND person_id IS NULL
  )
  LOOP
    -- Try to find or create person using their contact info
    v_person_id := trapper.find_or_create_person(
      p_email := r.email,
      p_phone := r.phone,
      p_first_name := r.first_name,
      p_last_name := r.last_name,
      p_address := NULL,
      p_source_system := 'staff_backfill'
    );

    IF v_person_id IS NOT NULL THEN
      -- Link person to staff record
      UPDATE trapper.staff
      SET person_id = v_person_id, updated_at = NOW()
      WHERE staff_id = r.staff_id;

      v_linked_count := v_linked_count + 1;

      -- Add staff role to person_roles if not exists
      INSERT INTO trapper.person_roles (person_id, role, role_status, source_system)
      VALUES (v_person_id, 'staff', 'active', 'staff_backfill')
      ON CONFLICT (person_id, role) DO UPDATE
      SET role_status = 'active', updated_at = NOW();

      RAISE NOTICE 'Linked staff % (%) to person %', r.display_name, r.staff_id, v_person_id;
    ELSE
      RAISE WARNING 'Could not create person for staff % (%)', r.display_name, r.staff_id;
    END IF;
  END LOOP;

  RAISE NOTICE 'Backfill complete: % staff members linked', v_linked_count;
END $$;

-- ============================================================================
-- PART 3: Verify results
-- ============================================================================

\echo 'Verifying backfill results...'

DO $$
DECLARE
  v_total_staff INT;
  v_linked_staff INT;
  v_unlinked_staff INT;
BEGIN
  SELECT COUNT(*) INTO v_total_staff FROM trapper.staff WHERE is_active = TRUE;
  SELECT COUNT(*) INTO v_linked_staff FROM trapper.staff WHERE is_active = TRUE AND person_id IS NOT NULL;
  v_unlinked_staff := v_total_staff - v_linked_staff;

  RAISE NOTICE 'After backfill:';
  RAISE NOTICE '  Total active staff: %', v_total_staff;
  RAISE NOTICE '  Linked: %', v_linked_staff;
  RAISE NOTICE '  Still unlinked: %', v_unlinked_staff;

  IF v_unlinked_staff > 0 THEN
    RAISE WARNING '% staff members could not be linked (may need manual review)', v_unlinked_staff;
  END IF;
END $$;

-- ============================================================================
-- PART 4: Create view for staff with person details
-- ============================================================================

\echo 'Creating v_staff_with_person view...'

CREATE OR REPLACE VIEW trapper.v_staff_with_person AS
SELECT
  s.staff_id,
  s.display_name AS staff_name,
  s.email AS staff_email,
  s.phone AS staff_phone,
  s.role AS job_role,
  s.department,
  s.auth_role,
  s.is_active,
  s.person_id,
  p.display_name AS person_name,
  p.person_id IS NOT NULL AS has_person_profile,
  -- Person contact info (may differ from staff record)
  (SELECT id_value FROM trapper.person_identifiers
   WHERE person_id = p.person_id AND id_type = 'email' LIMIT 1) AS person_email,
  (SELECT id_value FROM trapper.person_identifiers
   WHERE person_id = p.person_id AND id_type = 'phone' LIMIT 1) AS person_phone
FROM trapper.staff s
LEFT JOIN trapper.sot_people p ON p.person_id = s.person_id;

COMMENT ON VIEW trapper.v_staff_with_person IS
'Staff members with their linked person profile details';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_540 Complete!'
\echo '=============================================='
\echo ''
\echo 'Backfill complete:'
\echo '  - Created person records for staff without them'
\echo '  - Linked staff.person_id to sot_people.person_id'
\echo '  - Added staff role to person_roles table'
\echo '  - Created v_staff_with_person view'
\echo ''
\echo 'Staff members can now be accessed both as:'
\echo '  - Staff (for authentication, roles, permissions)'
\echo '  - People (for journal entries, relationships, history)'
\echo ''
