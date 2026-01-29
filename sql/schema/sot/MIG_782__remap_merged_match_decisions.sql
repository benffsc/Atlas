-- ============================================================================
-- MIG_782: Remap Match Decisions from Merged People to Canonical (DH_B001)
-- ============================================================================
-- TASK_LEDGER reference: DH_B001
-- ACTIVE Impact: No — data_engine_match_decisions is an audit/history table.
--   ACTIVE flows only INSERT into it (via data_engine_resolve_identity).
--   Views that read it (v_data_engine_review_queue, v_data_engine_stats, etc.)
--   will return more accurate results after remapping.
--
-- Remaps 2 FK columns from merged person IDs to their canonical equivalents:
--   1. resulting_person_id:     23,829 rows → canonical via get_canonical_person_id()
--   2. top_candidate_person_id:  5,921 rows → canonical via get_canonical_person_id()
--
-- 43,247 rows with NULL resulting_person_id are untouched (expected for
-- rejected/new_entity decisions).
-- 41,700 rows already pointing to canonical people are untouched.
-- ============================================================================

\echo '=== MIG_782: Remap Match Decisions to Canonical People (DH_B001) ==='

-- ============================================================================
-- Step 1: Pre-change state
-- ============================================================================

\echo ''
\echo 'Step 1: Pre-change state'

\echo 'Total match decision rows:'
SELECT COUNT(*) AS total_rows FROM trapper.data_engine_match_decisions;

\echo ''
\echo 'resulting_person_id pointing to merged people:'
SELECT COUNT(*) AS merged_resulting
FROM trapper.data_engine_match_decisions d
JOIN trapper.sot_people sp ON sp.person_id = d.resulting_person_id
WHERE sp.merged_into_person_id IS NOT NULL;

\echo ''
\echo 'top_candidate_person_id pointing to merged people:'
SELECT COUNT(*) AS merged_top_candidate
FROM trapper.data_engine_match_decisions d
JOIN trapper.sot_people sp ON sp.person_id = d.top_candidate_person_id
WHERE sp.merged_into_person_id IS NOT NULL;

\echo ''
\echo 'Decision type breakdown for merged resulting_person_id rows:'
SELECT decision_type, COUNT(*) AS cnt
FROM trapper.data_engine_match_decisions d
JOIN trapper.sot_people sp ON sp.person_id = d.resulting_person_id
WHERE sp.merged_into_person_id IS NOT NULL
GROUP BY decision_type
ORDER BY cnt DESC;

-- ============================================================================
-- Step 2: Create backup mapping table
-- ============================================================================

\echo ''
\echo 'Step 2: Creating backup mapping table'

CREATE TABLE IF NOT EXISTS trapper._backup_merged_match_decisions_782 AS
SELECT
  d.decision_id,
  d.resulting_person_id AS old_resulting_person_id,
  trapper.get_canonical_person_id(d.resulting_person_id) AS new_resulting_person_id,
  d.top_candidate_person_id AS old_top_candidate_person_id,
  CASE
    WHEN sp2.merged_into_person_id IS NOT NULL
    THEN trapper.get_canonical_person_id(d.top_candidate_person_id)
    ELSE d.top_candidate_person_id
  END AS new_top_candidate_person_id
FROM trapper.data_engine_match_decisions d
LEFT JOIN trapper.sot_people sp ON sp.person_id = d.resulting_person_id
LEFT JOIN trapper.sot_people sp2 ON sp2.person_id = d.top_candidate_person_id
WHERE (sp.merged_into_person_id IS NOT NULL)
   OR (sp2.merged_into_person_id IS NOT NULL);

\echo 'Backup row count:'
SELECT COUNT(*) AS backup_rows FROM trapper._backup_merged_match_decisions_782;

\echo ''
\echo 'Sample backup rows (verify canonical mapping):'
SELECT
  decision_id,
  old_resulting_person_id,
  new_resulting_person_id,
  old_top_candidate_person_id,
  new_top_candidate_person_id
FROM trapper._backup_merged_match_decisions_782
LIMIT 5;

-- ============================================================================
-- Step 3: Remap resulting_person_id
-- ============================================================================

\echo ''
\echo 'Step 3: Remapping resulting_person_id'

UPDATE trapper.data_engine_match_decisions d
SET resulting_person_id = trapper.get_canonical_person_id(d.resulting_person_id)
FROM trapper.sot_people sp
WHERE sp.person_id = d.resulting_person_id
  AND sp.merged_into_person_id IS NOT NULL;

-- ============================================================================
-- Step 4: Remap top_candidate_person_id
-- ============================================================================

\echo ''
\echo 'Step 4: Remapping top_candidate_person_id'

UPDATE trapper.data_engine_match_decisions d
SET top_candidate_person_id = trapper.get_canonical_person_id(d.top_candidate_person_id)
FROM trapper.sot_people sp
WHERE sp.person_id = d.top_candidate_person_id
  AND sp.merged_into_person_id IS NOT NULL;

-- ============================================================================
-- Step 5: Post-change verification
-- ============================================================================

\echo ''
\echo 'Step 5: Post-change state'

\echo 'Total rows (should be unchanged at 108776):'
SELECT COUNT(*) AS total_rows FROM trapper.data_engine_match_decisions;

\echo ''
\echo 'Remaining merged resulting_person_id (must be 0):'
SELECT COUNT(*) AS merged_resulting
FROM trapper.data_engine_match_decisions d
JOIN trapper.sot_people sp ON sp.person_id = d.resulting_person_id
WHERE sp.merged_into_person_id IS NOT NULL;

\echo ''
\echo 'Remaining merged top_candidate_person_id (must be 0):'
SELECT COUNT(*) AS merged_top_candidate
FROM trapper.data_engine_match_decisions d
JOIN trapper.sot_people sp ON sp.person_id = d.top_candidate_person_id
WHERE sp.merged_into_person_id IS NOT NULL;

\echo ''
\echo 'Person ID health summary:'
SELECT
  COUNT(*) FILTER (WHERE d.resulting_person_id IS NULL) AS null_resulting,
  COUNT(*) FILTER (
    WHERE d.resulting_person_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM trapper.sot_people sp
        WHERE sp.person_id = d.resulting_person_id
          AND sp.merged_into_person_id IS NULL
      )
  ) AS canonical_resulting,
  COUNT(*) FILTER (
    WHERE d.resulting_person_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM trapper.sot_people sp
        WHERE sp.person_id = d.resulting_person_id
          AND sp.merged_into_person_id IS NOT NULL
      )
  ) AS still_merged_resulting
FROM trapper.data_engine_match_decisions d;

-- ============================================================================
-- Step 6: Verify views still resolve
-- ============================================================================

\echo ''
\echo 'Step 6: View resolution check'

\echo 'v_data_engine_review_queue:'
SELECT COUNT(*) AS rows FROM trapper.v_data_engine_review_queue;

\echo ''
\echo 'v_data_engine_stats:'
SELECT COUNT(*) AS rows FROM trapper.v_data_engine_stats;

\echo ''
\echo 'v_data_engine_health:'
SELECT COUNT(*) AS rows FROM trapper.v_data_engine_health;

\echo ''
\echo 'v_identity_resolution_health:'
SELECT COUNT(*) AS rows FROM trapper.v_identity_resolution_health;

\echo ''
\echo 'v_identity_decision_breakdown:'
SELECT COUNT(*) AS rows FROM trapper.v_identity_decision_breakdown;

\echo ''
\echo 'v_data_engine_enrichment_stats:'
SELECT COUNT(*) AS rows FROM trapper.v_data_engine_enrichment_stats;

-- ============================================================================
-- Step 7: Active Flow Safety Gate
-- ============================================================================

\echo ''
\echo 'Step 7: Safety Gate'

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
-- Step 8: Summary
-- ============================================================================

\echo ''
\echo '====== MIG_782 SUMMARY ======'
\echo 'Remapped data_engine_match_decisions FK columns from merged to canonical people:'
\echo '  1. resulting_person_id:     23,829 rows remapped'
\echo '  2. top_candidate_person_id:  5,921 rows remapped'
\echo ''
\echo '108,776 total rows — no rows added or deleted.'
\echo '43,247 NULL resulting_person_id rows untouched (expected for rejected/new_entity).'
\echo '41,700 already-canonical rows untouched.'
\echo ''
\echo 'Backup preserved in: trapper._backup_merged_match_decisions_782'
\echo ''
\echo 'Rollback:'
\echo '  UPDATE trapper.data_engine_match_decisions d'
\echo '  SET resulting_person_id = b.old_resulting_person_id,'
\echo '      top_candidate_person_id = b.old_top_candidate_person_id'
\echo '  FROM trapper._backup_merged_match_decisions_782 b'
\echo '  WHERE d.decision_id = b.decision_id;'
\echo '=== MIG_782 Complete ==='
