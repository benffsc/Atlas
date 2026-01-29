-- ============================================================================
-- MIG_784: Clean Stale Person Duplicate Flags (DH_C001)
-- ============================================================================
-- TASK_LEDGER reference: DH_C001
-- ACTIVE Impact: No — potential_person_duplicates is a review/audit table.
--   ACTIVE flows only INSERT into it (via data_engine_resolve_identity).
--   The view v_pending_person_duplicates will return fewer (more accurate) rows.
--   Functions resolve_person_duplicate and data_engine_resolve_review operate
--   on individual rows by ID and are unaffected.
--
-- Background: TASK_005 flagged 494 people sharing identifiers and created
-- entries in potential_person_duplicates. TASK_002 then flattened merge chains,
-- which resolved those shared identifiers (now 0). This left 20,543 rows
-- where person_id or potential_match_id points to a merged person — these
-- flags are moot since the merge already happened.
--
-- Deletes 20,543 stale duplicate flags where at least one side (person_id
-- or potential_match_id) points to a merged person.
-- Keeps 227 rows where both sides are canonical (legitimate pending reviews).
-- ============================================================================

\echo '=== MIG_784: Clean Stale Person Duplicate Flags (DH_C001) ==='

-- ============================================================================
-- Step 1: Pre-change state
-- ============================================================================

\echo ''
\echo 'Step 1: Pre-change state'

\echo 'Total potential_person_duplicates:'
SELECT COUNT(*) AS total_rows FROM trapper.potential_person_duplicates;

\echo ''
\echo 'Status breakdown:'
SELECT status, COUNT(*) AS cnt
FROM trapper.potential_person_duplicates
GROUP BY status
ORDER BY cnt DESC;

\echo ''
\echo 'Match type breakdown:'
SELECT match_type, COUNT(*) AS cnt
FROM trapper.potential_person_duplicates
GROUP BY match_type
ORDER BY cnt DESC;

\echo ''
\echo 'Reference health:'
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE sp1.merged_into_person_id IS NOT NULL) AS person_merged,
  COUNT(*) FILTER (WHERE sp2.merged_into_person_id IS NOT NULL) AS match_merged,
  COUNT(*) FILTER (
    WHERE sp1.merged_into_person_id IS NOT NULL
       OR sp2.merged_into_person_id IS NOT NULL
  ) AS either_merged,
  COUNT(*) FILTER (
    WHERE sp1.merged_into_person_id IS NULL
      AND sp2.merged_into_person_id IS NULL
  ) AS both_canonical
FROM trapper.potential_person_duplicates ppd
JOIN trapper.sot_people sp1 ON sp1.person_id = ppd.person_id
JOIN trapper.sot_people sp2 ON sp2.person_id = ppd.potential_match_id;

\echo ''
\echo 'Both-canonical breakdown (these are kept):'
SELECT ppd.match_type, ppd.status, COUNT(*) AS cnt
FROM trapper.potential_person_duplicates ppd
JOIN trapper.sot_people sp1 ON sp1.person_id = ppd.person_id
JOIN trapper.sot_people sp2 ON sp2.person_id = ppd.potential_match_id
WHERE sp1.merged_into_person_id IS NULL AND sp2.merged_into_person_id IS NULL
GROUP BY ppd.match_type, ppd.status
ORDER BY cnt DESC;

\echo ''
\echo 'Shared identifiers among canonical people (should be 0):'
SELECT COUNT(DISTINCT pi.person_id) AS people_sharing_identifiers
FROM trapper.person_identifiers pi
JOIN (
  SELECT pi2.id_type, pi2.id_value_norm
  FROM trapper.person_identifiers pi2
  JOIN trapper.sot_people sp ON sp.person_id = pi2.person_id
  WHERE sp.merged_into_person_id IS NULL
  GROUP BY pi2.id_type, pi2.id_value_norm
  HAVING COUNT(DISTINCT pi2.person_id) > 1
) shared ON shared.id_type = pi.id_type AND shared.id_value_norm = pi.id_value_norm
JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
WHERE sp.merged_into_person_id IS NULL;

-- ============================================================================
-- Step 2: Create backup table
-- ============================================================================

\echo ''
\echo 'Step 2: Creating backup table'

CREATE TABLE IF NOT EXISTS trapper._backup_stale_person_duplicates_784 AS
SELECT ppd.*
FROM trapper.potential_person_duplicates ppd
JOIN trapper.sot_people sp1 ON sp1.person_id = ppd.person_id
JOIN trapper.sot_people sp2 ON sp2.person_id = ppd.potential_match_id
WHERE sp1.merged_into_person_id IS NOT NULL
   OR sp2.merged_into_person_id IS NOT NULL;

\echo 'Backup row count:'
SELECT COUNT(*) AS backup_rows FROM trapper._backup_stale_person_duplicates_784;

-- ============================================================================
-- Step 3: Delete stale duplicate flags
-- ============================================================================

\echo ''
\echo 'Step 3: Deleting stale duplicate flags (either side merged)'

DELETE FROM trapper.potential_person_duplicates
WHERE duplicate_id IN (
  SELECT ppd.duplicate_id
  FROM trapper.potential_person_duplicates ppd
  JOIN trapper.sot_people sp1 ON sp1.person_id = ppd.person_id
  JOIN trapper.sot_people sp2 ON sp2.person_id = ppd.potential_match_id
  WHERE sp1.merged_into_person_id IS NOT NULL
     OR sp2.merged_into_person_id IS NOT NULL
);

-- ============================================================================
-- Step 4: Post-change verification
-- ============================================================================

\echo ''
\echo 'Step 4: Post-change state'

\echo 'Total remaining rows:'
SELECT COUNT(*) AS total_rows FROM trapper.potential_person_duplicates;

\echo ''
\echo 'Remaining status breakdown:'
SELECT status, COUNT(*) AS cnt
FROM trapper.potential_person_duplicates
GROUP BY status
ORDER BY cnt DESC;

\echo ''
\echo 'Remaining match type breakdown:'
SELECT match_type, COUNT(*) AS cnt
FROM trapper.potential_person_duplicates
GROUP BY match_type
ORDER BY cnt DESC;

\echo ''
\echo 'Remaining merged references (must be 0):'
SELECT
  COUNT(*) FILTER (WHERE sp1.merged_into_person_id IS NOT NULL) AS person_merged,
  COUNT(*) FILTER (WHERE sp2.merged_into_person_id IS NOT NULL) AS match_merged
FROM trapper.potential_person_duplicates ppd
JOIN trapper.sot_people sp1 ON sp1.person_id = ppd.person_id
JOIN trapper.sot_people sp2 ON sp2.person_id = ppd.potential_match_id;

\echo ''
\echo 'v_pending_person_duplicates resolves:'
SELECT COUNT(*) AS pending_rows FROM trapper.v_pending_person_duplicates;

-- ============================================================================
-- Step 5: Active Flow Safety Gate
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
\echo '====== MIG_784 SUMMARY ======'
\echo 'Cleaned stale person duplicate flags from potential_person_duplicates:'
\echo '  Deleted: ~20,543 rows (either person_id or potential_match_id → merged person)'
\echo '  Kept: 227 rows (both sides canonical — legitimate pending reviews)'
\echo ''
\echo 'Background: TASK_005 flagged 494 people sharing identifiers.'
\echo '  TASK_002 merge chain fixes resolved all shared identifiers (now 0).'
\echo '  The 20,543 deleted flags referenced already-merged people — moot.'
\echo ''
\echo 'Backup preserved in: trapper._backup_stale_person_duplicates_784'
\echo ''
\echo 'Rollback:'
\echo '  INSERT INTO trapper.potential_person_duplicates SELECT * FROM trapper._backup_stale_person_duplicates_784;'
\echo '=== MIG_784 Complete ==='
