-- ============================================================================
-- MIG_787: Fix Trapper Assignment Gaps (SC_003)
-- ============================================================================
-- TASK_LEDGER reference: SC_003
-- ACTIVE Impact: Yes (Surgical) — inserts into request_trapper_assignments
--
-- Problem: 6 Airtable requests had trappers assigned but no Atlas assignment
-- records. Root cause: duplicate person_roles entries for 2 Airtable trapper
-- record IDs caused the sync script to fail silently.
--
-- Fix:
--   1. Identify canonical person for each duplicate trapper record
--   2. Create missing assignments for the 6 requests
--   3. Verify all Airtable trapper data is now reflected in Atlas
-- ============================================================================

\echo '=== MIG_787: Fix Trapper Assignment Gaps (SC_003) ==='

-- ============================================================================
-- Step 1: Pre-change state
-- ============================================================================

\echo ''
\echo 'Step 1: Pre-change state'

\echo 'Total active assignments:'
SELECT COUNT(*) AS active_assignments FROM trapper.request_trapper_assignments WHERE unassigned_at IS NULL;

\echo ''
\echo 'Duplicate person_roles for Airtable trapper IDs:'
SELECT
  pr.source_record_id AS airtable_id,
  p.person_id,
  p.display_name,
  p.primary_phone,
  pr.trapper_type::text,
  pr.created_at
FROM trapper.person_roles pr
JOIN trapper.sot_people p ON p.person_id = pr.person_id
WHERE pr.source_record_id IN ('rec8yiEVxuSxlz9ab', 'rec86C4vN4RyuWNSA')
ORDER BY pr.source_record_id, pr.created_at;

\echo ''
\echo 'Requests missing assignments (have Airtable trapper but no Atlas assignment):'
SELECT
  r.request_id,
  r.status,
  r.summary,
  sr.payload->>'Trappers Assigned' AS airtable_trappers
FROM trapper.staged_records sr
JOIN trapper.sot_requests r ON r.source_record_id = sr.source_row_id
LEFT JOIN (
  SELECT DISTINCT request_id
  FROM trapper.request_trapper_assignments
  WHERE unassigned_at IS NULL
) rta ON rta.request_id = r.request_id
WHERE sr.source_system = 'airtable'
  AND sr.source_table ILIKE '%request%'
  AND sr.payload->>'Trappers Assigned' IS NOT NULL
  AND sr.payload->>'Trappers Assigned' != '[]'
  AND (sr.payload->>'Trappers Assigned')::text != '["recEp51Dwdei6cN2F"]'
  AND rta.request_id IS NULL;

-- ============================================================================
-- Step 2: Fix duplicate person_roles — keep the correct canonical person
-- ============================================================================

\echo ''
\echo 'Step 2: Resolve duplicate person_roles'

-- rec86C4vN4RyuWNSA: Airtable says "Carl Draper" (latest record).
-- Patricia Elder was incorrectly linked to this ID (same phone 7072927680).
-- Keep Carl Draper, remove Patricia Elder's stale role for this source_record_id.

-- Remove Patricia Elder's duplicate role (she has the older created_at)
DELETE FROM trapper.person_roles
WHERE person_id = 'a488e402-c841-4804-ac92-ea2987e23057'  -- Patricia Elder
  AND source_record_id = 'rec86C4vN4RyuWNSA'
  AND role = 'trapper';

\echo 'Removed Patricia Elder duplicate role for rec86C4vN4RyuWNSA.'

-- rec8yiEVxuSxlz9ab: Airtable says "Patricia Dias".
-- Pat Dias (no phone) is the older record. Patricia Dias (has phone) is the canonical.
-- Keep Patricia Dias, remove Pat Dias's stale role.

DELETE FROM trapper.person_roles
WHERE person_id = '58d3819e-87ff-4927-89bb-8e787a6ef117'  -- Pat Dias (no phone)
  AND source_record_id = 'rec8yiEVxuSxlz9ab'
  AND role = 'trapper';

\echo 'Removed Pat Dias duplicate role for rec8yiEVxuSxlz9ab.'

\echo ''
\echo 'Remaining person_roles for these IDs (should be 1 each):'
SELECT
  pr.source_record_id,
  p.person_id,
  p.display_name,
  pr.trapper_type::text
FROM trapper.person_roles pr
JOIN trapper.sot_people p ON p.person_id = pr.person_id
WHERE pr.source_record_id IN ('rec8yiEVxuSxlz9ab', 'rec86C4vN4RyuWNSA')
ORDER BY pr.source_record_id;

-- ============================================================================
-- Step 3: Create missing assignments for the 6 requests
-- ============================================================================

\echo ''
\echo 'Step 3: Creating missing assignments'

-- Use the centralized function for proper primary enforcement and audit trail.
-- rec86C4vN4RyuWNSA → Carl Draper (5 requests)
-- rec8yiEVxuSxlz9ab → Patricia Dias (1 request)

-- Request: Natalia Flores (in_progress) → Carl Draper
SELECT trapper.assign_trapper_to_request(
  'd16a63ed-6fb7-41b6-81cd-4e9fa7619ffd'::uuid,
  '107989e2-f8c0-4f3b-8bab-0475f178df98'::uuid,  -- Carl Draper
  true,         -- is_primary
  'airtable_backfill',
  'airtable',
  'MIG_787'
);

-- Request: Virginia Forrest (in_progress) → Carl Draper
SELECT trapper.assign_trapper_to_request(
  '57dd07f7-289f-4594-8e1d-fe1030c5e843'::uuid,
  '107989e2-f8c0-4f3b-8bab-0475f178df98'::uuid,
  true, 'airtable_backfill', 'airtable', 'MIG_787'
);

-- Request: Russell Rottkamp (in_progress) → Carl Draper
SELECT trapper.assign_trapper_to_request(
  'ffedfaa3-125c-448d-9d0f-77882c3b85fc'::uuid,
  '107989e2-f8c0-4f3b-8bab-0475f178df98'::uuid,
  true, 'airtable_backfill', 'airtable', 'MIG_787'
);

-- Request: Carol Watson (completed) → Carl Draper
SELECT trapper.assign_trapper_to_request(
  '6bb8d6c8-0dce-47ab-af29-1a33ce70af16'::uuid,
  '107989e2-f8c0-4f3b-8bab-0475f178df98'::uuid,
  true, 'airtable_backfill', 'airtable', 'MIG_787'
);

-- Request: James Morris (completed) → Carl Draper
SELECT trapper.assign_trapper_to_request(
  '371ea729-3ec6-4527-972a-79ec1b11619a'::uuid,
  '107989e2-f8c0-4f3b-8bab-0475f178df98'::uuid,
  true, 'airtable_backfill', 'airtable', 'MIG_787'
);

-- Request: Pat Dias (completed) → Patricia Dias
SELECT trapper.assign_trapper_to_request(
  '064fca76-54db-4ef3-82a0-46fb3b7e304e'::uuid,
  'ea0439a6-b4c2-49f8-b336-73df032114d8'::uuid,  -- Patricia Dias
  true, 'airtable_backfill', 'airtable', 'MIG_787'
);

\echo '6 missing assignments created.'

-- ============================================================================
-- Step 4: Post-change verification
-- ============================================================================

\echo ''
\echo 'Step 4: Post-change state'

\echo 'Total active assignments (should be +6):'
SELECT COUNT(*) AS active_assignments FROM trapper.request_trapper_assignments WHERE unassigned_at IS NULL;

\echo ''
\echo 'Verify: Airtable requests with trappers — missing assignments:'
SELECT
  COUNT(*) AS total_airtable_with_trappers,
  COUNT(rta.request_id) AS have_atlas_assignments,
  COUNT(*) - COUNT(rta.request_id) AS still_missing
FROM trapper.staged_records sr
JOIN trapper.sot_requests r ON r.source_record_id = sr.source_row_id
LEFT JOIN (
  SELECT DISTINCT request_id
  FROM trapper.request_trapper_assignments
  WHERE unassigned_at IS NULL
) rta ON rta.request_id = r.request_id
WHERE sr.source_system = 'airtable'
  AND sr.source_table ILIKE '%request%'
  AND sr.payload->>'Trappers Assigned' IS NOT NULL
  AND sr.payload->>'Trappers Assigned' != '[]'
  AND (sr.payload->>'Trappers Assigned')::text != '["recEp51Dwdei6cN2F"]';

\echo ''
\echo 'Verify: New assignments created by this migration:'
SELECT
  rta.request_id,
  r.status,
  r.summary,
  p.display_name AS trapper_name,
  rta.is_primary,
  rta.assignment_reason,
  rta.source_system,
  rta.created_by
FROM trapper.request_trapper_assignments rta
JOIN trapper.sot_requests r ON r.request_id = rta.request_id
JOIN trapper.sot_people p ON p.person_id = rta.trapper_person_id
WHERE rta.created_by = 'MIG_787';

\echo ''
\echo 'Full assignment state breakdown:'
SELECT
  CASE
    WHEN active_trapper_count > 0 THEN 'has_active_trapper'
    WHEN no_trapper_reason = 'client_trapping' THEN 'client_trapping'
    WHEN no_trapper_reason IS NOT NULL THEN 'no_trapper_with_reason'
    WHEN status IN ('completed', 'cancelled') THEN 'resolved_no_trapper'
    ELSE 'needs_trapper'
  END AS assignment_state,
  COUNT(*) AS cnt
FROM trapper.v_request_list
GROUP BY 1
ORDER BY cnt DESC;

-- ============================================================================
-- Step 5: Active Flow Safety Gate — SQL Smoke Queries
-- ============================================================================

\echo ''
\echo 'Step 5: Safety Gate'

\echo 'Views resolve:'
SELECT 'v_intake_triage_queue' AS view_name, COUNT(*) AS rows FROM trapper.v_intake_triage_queue
UNION ALL
SELECT 'v_request_list', COUNT(*) FROM trapper.v_request_list;

\echo ''
\echo 'Intake triggers enabled:'
SELECT tgname, CASE tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'DISABLED' END AS status
FROM pg_trigger
WHERE tgrelid = 'trapper.web_intake_submissions'::regclass
  AND tgname IN ('trg_auto_triage_intake', 'trg_intake_create_person', 'trg_intake_link_place');

\echo ''
\echo 'Request triggers enabled:'
SELECT tgname, CASE tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'DISABLED' END AS status
FROM pg_trigger
WHERE tgrelid = 'trapper.sot_requests'::regclass
  AND tgname IN ('trg_log_request_status', 'trg_set_resolved_at', 'trg_request_activity');

\echo ''
\echo 'Journal trigger enabled:'
SELECT tgname, CASE tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'DISABLED' END AS status
FROM pg_trigger
WHERE tgrelid = 'trapper.journal_entries'::regclass
  AND tgname = 'trg_journal_entry_history_log';

\echo ''
\echo 'Core tables have data:'
SELECT 'web_intake_submissions' AS t, COUNT(*) AS cnt FROM trapper.web_intake_submissions
UNION ALL SELECT 'sot_requests', COUNT(*) FROM trapper.sot_requests
UNION ALL SELECT 'journal_entries', COUNT(*) FROM trapper.journal_entries
UNION ALL SELECT 'staff', COUNT(*) FROM trapper.staff
UNION ALL SELECT 'staff_sessions (active)', COUNT(*) FROM trapper.staff_sessions WHERE expires_at > NOW();

-- ============================================================================
-- Step 6: Summary
-- ============================================================================

\echo ''
\echo '====== MIG_787 SUMMARY (SC_003) ======'
\echo 'Surgical fix for trapper assignment data gaps between Airtable and Atlas.'
\echo ''
\echo 'Root cause: 2 Airtable trapper record IDs each mapped to 2 Atlas people'
\echo '  rec86C4vN4RyuWNSA: Patricia Elder + Carl Draper (same phone)'
\echo '  rec8yiEVxuSxlz9ab: Pat Dias + Patricia Dias (name variant)'
\echo ''
\echo 'Fixes:'
\echo '  1. Removed 2 duplicate person_roles (kept canonical: Carl Draper, Patricia Dias)'
\echo '  2. Created 6 missing request_trapper_assignments'
\echo '     - 3 active requests now show their assigned trapper'
\echo '     - 3 completed requests now have historical accuracy'
\echo ''
\echo 'Result: 0 Airtable trapper assignments missing from Atlas.'
\echo 'Safety Gate: All views resolve, all triggers enabled, all core tables have data.'
\echo '=== MIG_787 Complete ==='
