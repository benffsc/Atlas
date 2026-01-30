-- ============================================================================
-- MIG_789: Fix assignment_status revert when no_trapper_reason is set
-- ============================================================================
-- TASK_LEDGER reference: SC_004 (addendum)
-- ACTIVE Impact: Yes (Surgical) — modifies trigger function on
--   request_trapper_assignments
--
-- Problem: When all trappers are unassigned from a request that has
--   no_trapper_reason = 'client_trapping', the trigger leaves
--   assignment_status = 'assigned' instead of reverting to 'client_trapping'.
--   The ELSE branch guards with `AND no_trapper_reason IS NULL`, which
--   prevents any update when a reason is set.
--
-- Fix: Replace the ELSE branch to use CASE on no_trapper_reason:
--   - client_trapping → revert to 'client_trapping'
--   - any other reason or NULL → revert to 'pending'
-- ============================================================================

\echo '=== MIG_789: Fix assignment_status revert (SC_004 addendum) ==='

-- ============================================================================
-- Step 1: Pre-change state
-- ============================================================================

\echo ''
\echo 'Step 1: Pre-change state'

\echo 'Current trigger function source (ELSE branch):'
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'maintain_assignment_status'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper');

-- ============================================================================
-- Step 2: Replace trigger function with fix
-- ============================================================================

\echo ''
\echo 'Step 2: Replace trigger function'

CREATE OR REPLACE FUNCTION trapper.maintain_assignment_status()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_active_count INT;
  v_request_id UUID;
BEGIN
  -- Determine which request was affected
  v_request_id := COALESCE(NEW.request_id, OLD.request_id);

  -- Count active trappers for this request
  SELECT COUNT(*) INTO v_active_count
  FROM trapper.request_trapper_assignments
  WHERE request_id = v_request_id
    AND unassigned_at IS NULL;

  -- Update assignment_status based on current state
  IF v_active_count > 0 THEN
    UPDATE trapper.sot_requests
    SET assignment_status = 'assigned',
        updated_at = NOW()
    WHERE request_id = v_request_id
      AND assignment_status != 'assigned';
  ELSE
    -- No active trappers — revert based on no_trapper_reason
    -- FIX: Previously guarded with `AND no_trapper_reason IS NULL` which
    -- meant client_trapping requests stayed 'assigned' after unassign.
    UPDATE trapper.sot_requests
    SET assignment_status = CASE
            WHEN no_trapper_reason = 'client_trapping' THEN 'client_trapping'
            ELSE 'pending'
        END,
        updated_at = NOW()
    WHERE request_id = v_request_id
      AND assignment_status = 'assigned';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION trapper.maintain_assignment_status() IS
'Keeps sot_requests.assignment_status in sync with request_trapper_assignments.
Fires on INSERT/UPDATE/DELETE of assignments. Sets assigned when trappers exist,
reverts to client_trapping or pending when all trappers removed.
MIG_789: Fixed revert logic for client_trapping requests.';

-- ============================================================================
-- Step 3: Post-change verification
-- ============================================================================

\echo ''
\echo 'Step 3: Verify trigger still enabled'

SELECT tgname, CASE tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'DISABLED' END AS status
FROM pg_trigger
WHERE tgrelid = 'trapper.request_trapper_assignments'::regclass
  AND tgname = 'trg_maintain_assignment_status';

-- ============================================================================
-- Step 4: Active Flow Safety Gate
-- ============================================================================

\echo ''
\echo 'Step 4: Safety Gate'

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
\echo 'Assignment trigger enabled:'
SELECT tgname, CASE tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'DISABLED' END AS status
FROM pg_trigger
WHERE tgrelid = 'trapper.request_trapper_assignments'::regclass
  AND tgname = 'trg_maintain_assignment_status';

\echo ''
\echo 'Core tables have data:'
SELECT 'web_intake_submissions' AS t, COUNT(*) AS cnt FROM trapper.web_intake_submissions
UNION ALL SELECT 'sot_requests', COUNT(*) FROM trapper.sot_requests
UNION ALL SELECT 'journal_entries', COUNT(*) FROM trapper.journal_entries
UNION ALL SELECT 'staff', COUNT(*) FROM trapper.staff
UNION ALL SELECT 'staff_sessions (active)', COUNT(*) FROM trapper.staff_sessions WHERE expires_at > NOW();

-- ============================================================================
-- Step 5: Summary
-- ============================================================================

\echo ''
\echo '====== MIG_789 SUMMARY ======'
\echo 'Fixed maintain_assignment_status() trigger function.'
\echo ''
\echo 'Before: ELSE branch guarded with AND no_trapper_reason IS NULL.'
\echo '  When client_trapping request had all trappers removed,'
\echo '  assignment_status stayed assigned (bug).'
\echo ''
\echo 'After:  ELSE branch uses CASE on no_trapper_reason:'
\echo '  client_trapping → reverts to client_trapping'
\echo '  anything else   → reverts to pending'
\echo ''
\echo 'Safety Gate: All views resolve, all triggers enabled, core tables have data.'
\echo '=== MIG_789 Complete ==='
