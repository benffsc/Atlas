-- MIG_2911: Fix Missing Trapper Roles from VH Approved Trappers
--
-- FFS-468: 6 VH Approved Trappers have trapper_profiles but only
-- volunteer/pending in person_roles — no trapper role. MIG_2907's
-- backfill skipped them because it checked for ANY role, not
-- specifically missing 'trapper' role.
--
-- Also:
--   - Barb Gray: trapper/inactive but still in VH Approved Trappers
--   - Lesley Cowley: display_name = "Hunter Creek Trail Santa Rosa" (ClinicHQ site name)
--
-- Created: 2026-03-12

\echo ''
\echo '=============================================='
\echo '  MIG_2911: Fix Missing Trapper Roles'
\echo '  FFS-468'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 0. PRE-CHECK: Show missing trappers
-- ============================================================================

\echo '0. VH Approved Trappers missing trapper role in person_roles:'
SELECT
  COALESCE(p.display_name, p.first_name || ' ' || p.last_name) as name,
  tp.trapper_type as profile_type,
  (SELECT string_agg(pr.role || '/' || pr.role_status, ', ')
   FROM sot.person_roles pr WHERE pr.person_id = p.person_id) as current_roles
FROM sot.trapper_profiles tp
JOIN sot.people p ON p.person_id = tp.person_id AND p.merged_into_person_id IS NULL
WHERE tp.is_active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM sot.person_roles pr
    WHERE pr.person_id = tp.person_id AND pr.role = 'trapper'
  )
ORDER BY p.display_name;

-- ============================================================================
-- 1. ADD TRAPPER ROLE FOR VH APPROVED TRAPPERS
-- ============================================================================

\echo ''
\echo '1. Adding trapper role for VH Approved Trappers missing it...'

-- Insert trapper role for anyone in trapper_profiles who has NO trapper role
-- (regardless of whether they have other roles like volunteer/pending)
INSERT INTO sot.person_roles (person_id, role, role_status, trapper_type, source_system, notes)
SELECT
  tp.person_id,
  'trapper',
  'active',
  'ffsc_trapper',
  'volunteerhub',
  'MIG_2911/FFS-468: VH Approved Trapper — role was missing from person_roles'
FROM sot.trapper_profiles tp
WHERE tp.is_active = TRUE
  AND tp.trapper_type IN ('ffsc_volunteer', 'ffsc_staff')
  AND NOT EXISTS (
    SELECT 1 FROM sot.person_roles pr
    WHERE pr.person_id = tp.person_id AND pr.role = 'trapper'
  )
ON CONFLICT (person_id, role) DO NOTHING;

\echo '   Added trapper roles'

-- Also activate any pending volunteer roles for these people
UPDATE sot.person_roles pr
SET role_status = 'active'
FROM sot.trapper_profiles tp
WHERE pr.person_id = tp.person_id
  AND tp.is_active = TRUE
  AND pr.role = 'volunteer'
  AND pr.role_status = 'pending';

\echo '   Activated pending volunteer roles'

-- ============================================================================
-- 2. REACTIVATE BARB GRAY
-- ============================================================================

\echo ''
\echo '2. Reactivating Barb Gray (still in VH Approved Trappers)...'

UPDATE sot.person_roles
SET role_status = 'active',
    source_system = 'volunteerhub',
    notes = COALESCE(notes, '') || ' MIG_2911: Reactivated — still in VH Approved Trappers'
WHERE person_id = '1419bf10-9649-4a8b-bf23-ca3bbd1644c4'
  AND role = 'trapper'
  AND role_status = 'inactive';

\echo '   Done'

-- ============================================================================
-- 3. FIX LESLEY COWLEY DISPLAY NAME
-- ============================================================================

\echo ''
\echo '3. Fixing Lesley Cowley display_name...'

-- Person 7117c83b has display_name = "Hunter Creek Trail Santa Rosa" from ClinicHQ
-- VH has her as "Lesley Cowley" — VH is authoritative for people
UPDATE sot.people
SET display_name = 'Lesley Cowley',
    first_name = 'Lesley',
    last_name = 'Cowley'
WHERE person_id = '7117c83b-39ae-4419-98ca-66fc34635976'
  AND display_name = 'Hunter Creek Trail Santa Rosa';

\echo '   Done'

-- ============================================================================
-- 4. VERIFICATION
-- ============================================================================

\echo ''
\echo '4. Verification...'

\echo 'All active trappers in person_roles:'
SELECT
  COALESCE(p.display_name, p.first_name || ' ' || p.last_name) as name,
  pr.role_status,
  pr.trapper_type,
  pr.source_system,
  EXISTS (SELECT 1 FROM sot.trapper_profiles tp WHERE tp.person_id = p.person_id AND tp.is_active) as has_profile
FROM sot.person_roles pr
JOIN sot.people p ON p.person_id = pr.person_id AND p.merged_into_person_id IS NULL
WHERE pr.role = 'trapper'
ORDER BY pr.role_status, p.display_name;

\echo ''
\echo 'Trappers still missing from person_roles (should be 0):'
SELECT
  COALESCE(p.display_name, p.first_name || ' ' || p.last_name) as name,
  tp.trapper_type
FROM sot.trapper_profiles tp
JOIN sot.people p ON p.person_id = tp.person_id AND p.merged_into_person_id IS NULL
WHERE tp.is_active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM sot.person_roles pr
    WHERE pr.person_id = tp.person_id AND pr.role = 'trapper'
  );

\echo ''
\echo 'Lesley Cowley display_name check:'
SELECT person_id, display_name, first_name, last_name
FROM sot.people
WHERE person_id = '7117c83b-39ae-4419-98ca-66fc34635976';

\echo ''
\echo '=============================================='
\echo '  MIG_2911 COMPLETE'
\echo '=============================================='
