-- ============================================================================
-- MIG_831: Cleanup False Positive Roles
-- ============================================================================
-- WORKING_LEDGER ref: DQ-001 (Holiday Duncan), DQ-004 through DQ-007
--
-- This migration audits and cleans up existing bad role data:
-- 1. ShelterLuv-sourced foster roles from name-only matching
-- 2. Foster/trapper roles without volunteer prerequisite
-- 3. Stale VH roles (departed volunteers with active status)
-- 4. Holiday Duncan specific fix
-- 5. Verify Wildhaven Campgrounds org-name fix (MIG_827)
--
-- ALL CHANGES ARE LOGGED to entity_edits and role_reconciliation_log.
-- Run the dry-run audit queries first before applying fixes.
-- ============================================================================

\echo ''
\echo '============================================================'
\echo 'MIG_831: Cleanup False Positive Roles'
\echo '============================================================'
\echo ''

-- ============================================================================
-- Step 1: AUDIT — ShelterLuv foster roles from name-only matching
-- ============================================================================

\echo 'Step 1: Audit ShelterLuv foster roles (name-only match suspects)...'
\echo ''
\echo 'ShelterLuv foster roles WITHOUT ShelterLuv email in person_identifiers:'

SELECT
  sp.person_id,
  sp.display_name,
  pr.role,
  pr.role_status,
  pr.created_at::date AS role_assigned,
  EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi
    WHERE pi.person_id = sp.person_id
      AND pi.id_type = 'email'
      AND pi.source_system = 'shelterluv'
  ) AS has_sl_email,
  EXISTS (
    SELECT 1 FROM trapper.person_roles pr2
    WHERE pr2.person_id = sp.person_id
      AND pr2.role = 'volunteer'
      AND pr2.role_status = 'active'
  ) AS has_volunteer,
  sp.data_source
FROM trapper.person_roles pr
JOIN trapper.sot_people sp ON sp.person_id = pr.person_id
WHERE pr.role = 'foster'
  AND pr.source_system = 'shelterluv'
  AND pr.role_status = 'active'
  AND sp.merged_into_person_id IS NULL
  -- Suspect: no ShelterLuv email = likely name-only match
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi
    WHERE pi.person_id = sp.person_id
      AND pi.id_type = 'email'
      AND pi.source_system = 'shelterluv'
  )
ORDER BY sp.display_name;

-- ============================================================================
-- Step 2: AUDIT — Foster/trapper without volunteer prerequisite
-- ============================================================================

\echo ''
\echo 'Step 2: Foster/trapper roles missing volunteer prerequisite:'

SELECT * FROM trapper.v_role_without_volunteer;

-- ============================================================================
-- Step 3: AUDIT — Stale VH roles (departed but still active)
-- ============================================================================

\echo ''
\echo 'Step 3: Stale VH roles (departed volunteers still showing active):'

SELECT
  display_name, role, trapper_type, days_since_departure, groups_left
FROM trapper.v_stale_volunteer_roles
LIMIT 30;

-- ============================================================================
-- Step 4: FIX — Deactivate ShelterLuv name-only foster roles
--         (people who are NOT VH volunteers should not have foster)
-- ============================================================================

\echo ''
\echo 'Step 4: Deactivating ShelterLuv name-only foster roles...'

-- Only deactivate if person:
--   1. Has foster role from shelterluv
--   2. Does NOT have a ShelterLuv email in identifiers (name-only match)
--   3. Does NOT have an active volunteer role (not a real VH volunteer)

WITH deactivated AS (
  UPDATE trapper.person_roles pr
  SET role_status = 'inactive',
      ended_at = CURRENT_DATE,
      notes = COALESCE(notes || '; ', '') || 'MIG_831: Deactivated — suspected name-only ShelterLuv match, no volunteer role',
      updated_at = NOW()
  FROM trapper.sot_people sp
  WHERE pr.person_id = sp.person_id
    AND pr.role = 'foster'
    AND pr.source_system = 'shelterluv'
    AND pr.role_status = 'active'
    AND sp.merged_into_person_id IS NULL
    -- No ShelterLuv email = name-only match
    AND NOT EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.person_id = sp.person_id
        AND pi.id_type = 'email'
        AND pi.source_system = 'shelterluv'
    )
    -- Not a VH volunteer
    AND NOT EXISTS (
      SELECT 1 FROM trapper.person_roles pr2
      WHERE pr2.person_id = sp.person_id
        AND pr2.role = 'volunteer'
        AND pr2.role_status = 'active'
    )
  RETURNING pr.person_id, sp.display_name, pr.role
)
-- Log each deactivation
INSERT INTO trapper.role_reconciliation_log (
  person_id, role, previous_status, new_status,
  reason, source_system, evidence
)
SELECT
  person_id,
  role,
  'active',
  'inactive',
  'MIG_831: ShelterLuv name-only foster match without volunteer role',
  'shelterluv',
  jsonb_build_object(
    'fix', 'mig_831_name_only_foster_cleanup',
    'display_name', display_name
  )
FROM deactivated;

\echo 'ShelterLuv name-only foster roles deactivated.'

-- ============================================================================
-- Step 5: FIX — Run automated VH orphan deactivation (30-day grace)
-- ============================================================================

\echo ''
\echo 'Step 5: Running deactivate_orphaned_vh_roles (30-day grace)...'

SELECT * FROM trapper.deactivate_orphaned_vh_roles(
  p_grace_days := 30,
  p_dry_run := false
);

\echo 'Orphaned VH roles deactivated.'

-- ============================================================================
-- Step 6: FIX — Holiday Duncan specifically
-- ============================================================================

\echo ''
\echo 'Step 6: Checking Holiday Duncan...'

-- Check current status
SELECT sp.person_id, sp.display_name,
       pr.role, pr.role_status, pr.source_system
FROM trapper.sot_people sp
LEFT JOIN trapper.person_roles pr ON pr.person_id = sp.person_id
WHERE sp.display_name ILIKE '%Holiday%Duncan%'
  AND sp.merged_into_person_id IS NULL;

-- If still active foster/trapper, deactivate explicitly
WITH hd_fix AS (
  UPDATE trapper.person_roles pr
  SET role_status = 'inactive',
      ended_at = CURRENT_DATE,
      notes = COALESCE(notes || '; ', '') || 'MIG_831: DQ-001 fix — ClinicHQ client, not a volunteer',
      updated_at = NOW()
  FROM trapper.sot_people sp
  WHERE pr.person_id = sp.person_id
    AND sp.display_name ILIKE '%Holiday%Duncan%'
    AND sp.merged_into_person_id IS NULL
    AND pr.role IN ('foster', 'trapper')
    AND pr.role_status = 'active'
  RETURNING pr.person_id, sp.display_name, pr.role
)
INSERT INTO trapper.entity_edits (
  entity_type, entity_id, edit_type, field_name,
  old_value, new_value, reason,
  edit_source, edited_by
)
SELECT
  'person', person_id, 'status_change', 'role_status',
  to_jsonb('active'::text), to_jsonb('inactive'::text),
  'DQ-001: Holiday Duncan is a ClinicHQ clinic client, not a VH volunteer. ' ||
  role || ' role incorrectly assigned via ShelterLuv name-only match.',
  'migration', 'mig_831'
FROM hd_fix;

\echo 'Holiday Duncan fix applied.'

-- ============================================================================
-- Step 7: VERIFY — Wildhaven Campgrounds (MIG_827)
-- ============================================================================

\echo ''
\echo 'Step 7: Verifying Wildhaven Campgrounds org-name fix...'

SELECT sp.person_id, sp.display_name, sp.is_system_account,
       trapper.is_organization_name(sp.display_name) AS detected_as_org
FROM trapper.sot_people sp
WHERE sp.display_name ILIKE '%Wildhaven%'
  AND sp.merged_into_person_id IS NULL;

-- ============================================================================
-- Step 8: POST-FIX AUDIT — Verify cleanup
-- ============================================================================

\echo ''
\echo 'Step 8: Post-fix verification...'

\echo ''
\echo 'Remaining active foster/trapper without volunteer:'
SELECT COUNT(*) AS remaining_violations
FROM trapper.v_role_without_volunteer;

\echo ''
\echo 'Remaining stale VH roles:'
SELECT COUNT(*) AS remaining_stale
FROM trapper.v_stale_volunteer_roles;

\echo ''
\echo 'Total role reconciliation log entries:'
SELECT COUNT(*) AS total_entries FROM trapper.role_reconciliation_log;

\echo ''
\echo 'Unmatched fosters queue:'
SELECT match_attempt, COUNT(*) AS count
FROM trapper.shelterluv_unmatched_fosters
WHERE resolved_at IS NULL
GROUP BY match_attempt;

-- ============================================================================
-- Step 9: Summary
-- ============================================================================

\echo ''
\echo '============================================================'
\echo 'MIG_831 SUMMARY'
\echo '============================================================'
\echo ''
\echo 'FIXES APPLIED:'
\echo '  1. Deactivated ShelterLuv name-only foster roles (no VH volunteer)'
\echo '  2. Deactivated orphaned VH roles (30-day grace period)'
\echo '  3. Fixed Holiday Duncan — removed incorrect foster/trapper badges'
\echo '  4. Verified Wildhaven Campgrounds org-name detection'
\echo ''
\echo 'ALL CHANGES LOGGED TO:'
\echo '  - trapper.role_reconciliation_log (role lifecycle audit)'
\echo '  - trapper.entity_edits (standard audit trail)'
\echo ''
\echo 'NEXT STEPS:'
\echo '  1. Apply MIG_828 to stop new name-only matches going forward'
\echo '  2. Add deactivate_orphaned_vh_roles() to VH sync cron endpoint'
\echo '  3. Monitor /admin/role-audit for remaining issues'
\echo ''
\echo '=== MIG_831 Complete ==='
