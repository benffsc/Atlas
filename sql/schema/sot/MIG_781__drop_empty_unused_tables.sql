-- ============================================================================
-- MIG_781: Drop Empty Unused Feature Tables (DH_A003)
-- ============================================================================
-- TASK_LEDGER reference: DH_A003
-- ACTIVE Impact: No — neither table is referenced by ACTIVE flows
--
-- Drops 2 empty tables that have zero rows, zero inbound FKs, zero view
-- references, and zero function references:
--   1. automation_rules  — Automation feature never implemented
--   2. cat_reunifications — Reunification feature never implemented
--
-- 67 other empty tables were investigated but have FK, view, or function
-- references and are kept for now. See TASK_LEDGER for full audit.
-- ============================================================================

\echo '=== MIG_781: Drop Empty Unused Feature Tables (DH_A003) ==='

-- ============================================================================
-- Step 1: Pre-change state
-- ============================================================================

\echo ''
\echo 'Step 1: Pre-change state'

\echo 'Tables to drop (confirm 0 rows):'
SELECT 'automation_rules' AS table_name,
       (SELECT COUNT(*) FROM trapper.automation_rules) AS row_count
UNION ALL
SELECT 'cat_reunifications',
       (SELECT COUNT(*) FROM trapper.cat_reunifications);

\echo ''
\echo 'Inbound FK check (must be 0):'
SELECT conname, conrelid::regclass AS source, confrelid::regclass AS target
FROM pg_constraint
WHERE contype = 'f'
  AND confrelid IN (
    'trapper.automation_rules'::regclass,
    'trapper.cat_reunifications'::regclass
  );

-- ============================================================================
-- Step 2: Drop tables
-- ============================================================================

\echo ''
\echo 'Step 2: Dropping tables'

DROP TABLE IF EXISTS trapper.automation_rules CASCADE;
DROP TABLE IF EXISTS trapper.cat_reunifications CASCADE;

-- ============================================================================
-- Step 3: Post-change verification
-- ============================================================================

\echo ''
\echo 'Step 3: Verification'

\echo 'Confirm tables no longer exist:'
SELECT tablename
FROM pg_tables
WHERE schemaname = 'trapper'
  AND tablename IN ('automation_rules', 'cat_reunifications');

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
\echo '====== MIG_781 SUMMARY ======'
\echo 'Dropped 2 empty, unreferenced tables:'
\echo '  1. automation_rules (0 rows, 0 FK, 0 views, 0 functions)'
\echo '  2. cat_reunifications (0 rows, 0 FK, 0 views, 0 functions)'
\echo ''
\echo '67 other empty tables kept — they have FK, view, or function references.'
\echo 'See TASK_LEDGER DH_A003 for the full audit of all 69 empty tables.'
\echo ''
\echo 'Rollback: Not possible — tables are dropped. Both had 0 rows.'
\echo '=== MIG_781 Complete ==='
