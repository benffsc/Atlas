-- ============================================================================
-- MIG_780: Delete Orphan Entity Edits (DH_A002)
-- ============================================================================
-- TASK_LEDGER reference: DH_A002
-- ACTIVE Impact: No — entity_edits is an audit log. ACTIVE flows only INSERT
--   into it (via logFieldEdits on request/person/cat/place PATCH). No ACTIVE
--   UI reads these specific orphan rows.
--
-- Deletes 140 entity_edits where entity_type='person' and the referenced
-- entity_id does not exist in sot_people. All 140 are MIG_572 deletion
-- audit ghosts (edit_type='delete', field_name='full_record').
--
-- 4 edits referencing merged (but still existing) people are NOT touched.
-- ============================================================================

\echo '=== MIG_780: Delete Orphan Entity Edits (DH_A002) ==='

-- ============================================================================
-- Step 1: Pre-change state
-- ============================================================================

\echo ''
\echo 'Step 1: Pre-change state'

\echo 'Total entity_edits rows:'
SELECT COUNT(*) AS total_rows FROM trapper.entity_edits;

\echo ''
\echo 'Orphan entity_edits (person entity_id not in sot_people):'
SELECT COUNT(*) AS orphan_count
FROM trapper.entity_edits ee
WHERE ee.entity_type = 'person'
  AND NOT EXISTS (
    SELECT 1 FROM trapper.sot_people sp WHERE sp.person_id = ee.entity_id
  );

\echo ''
\echo 'Orphan breakdown (should be 140 x delete/full_record/MIG_572):'
SELECT edit_type, field_name, edited_by, edit_source, COUNT(*) AS cnt
FROM trapper.entity_edits ee
WHERE ee.entity_type = 'person'
  AND NOT EXISTS (
    SELECT 1 FROM trapper.sot_people sp WHERE sp.person_id = ee.entity_id
  )
GROUP BY edit_type, field_name, edited_by, edit_source;

-- ============================================================================
-- Step 2: Verify no downstream references to orphan rows
-- ============================================================================

\echo ''
\echo 'Step 2: Safety checks'

\echo 'pending_edits referencing orphan entity_edits (must be 0):'
SELECT COUNT(*) AS pending_refs
FROM trapper.pending_edits pe
JOIN trapper.entity_edits ee ON pe.applied_edit_id = ee.edit_id
WHERE ee.entity_type = 'person'
  AND NOT EXISTS (
    SELECT 1 FROM trapper.sot_people sp WHERE sp.person_id = ee.entity_id
  );

\echo ''
\echo 'Orphan rows with rollback links (must be 0):'
SELECT COUNT(*) AS rollback_refs
FROM trapper.entity_edits ee
WHERE ee.entity_type = 'person'
  AND NOT EXISTS (
    SELECT 1 FROM trapper.sot_people sp WHERE sp.person_id = ee.entity_id
  )
  AND (ee.rollback_edit_id IS NOT NULL OR ee.is_rolled_back = TRUE);

\echo ''
\echo 'Other entity_edits referencing orphan rows via rollback_edit_id (must be 0):'
SELECT COUNT(*) AS reverse_rollback_refs
FROM trapper.entity_edits ee2
WHERE ee2.rollback_edit_id IN (
  SELECT ee.edit_id
  FROM trapper.entity_edits ee
  WHERE ee.entity_type = 'person'
    AND NOT EXISTS (
      SELECT 1 FROM trapper.sot_people sp WHERE sp.person_id = ee.entity_id
    )
);

-- ============================================================================
-- Step 3: Create backup
-- ============================================================================

\echo ''
\echo 'Step 3: Creating backup table'

CREATE TABLE IF NOT EXISTS trapper._backup_orphan_entity_edits_780 AS
SELECT *
FROM trapper.entity_edits
WHERE entity_type = 'person'
  AND NOT EXISTS (
    SELECT 1 FROM trapper.sot_people sp WHERE sp.person_id = entity_id
  );

\echo 'Backup row count:'
SELECT COUNT(*) AS backup_rows FROM trapper._backup_orphan_entity_edits_780;

-- ============================================================================
-- Step 4: Delete orphan rows
-- ============================================================================

\echo ''
\echo 'Step 4: Deleting orphan entity_edits'

DELETE FROM trapper.entity_edits
WHERE entity_type = 'person'
  AND NOT EXISTS (
    SELECT 1 FROM trapper.sot_people sp WHERE sp.person_id = entity_id
  );

-- ============================================================================
-- Step 5: Post-change verification
-- ============================================================================

\echo ''
\echo 'Step 5: Post-change state'

\echo 'Total entity_edits rows (should be 28):'
SELECT COUNT(*) AS total_rows FROM trapper.entity_edits;

\echo ''
\echo 'Remaining orphan count (must be 0):'
SELECT COUNT(*) AS remaining_orphans
FROM trapper.entity_edits ee
WHERE ee.entity_type = 'person'
  AND NOT EXISTS (
    SELECT 1 FROM trapper.sot_people sp WHERE sp.person_id = ee.entity_id
  );

\echo ''
\echo 'Remaining rows by entity_type:'
SELECT entity_type, COUNT(*) AS cnt
FROM trapper.entity_edits
GROUP BY entity_type
ORDER BY cnt DESC;

\echo ''
\echo 'Remaining rows by edit_type + source:'
SELECT edit_type, edit_source, COUNT(*) AS cnt
FROM trapper.entity_edits
GROUP BY edit_type, edit_source
ORDER BY cnt DESC;

-- ============================================================================
-- Step 6: Active Flow Safety Gate — SQL Smoke Queries
-- ============================================================================

\echo ''
\echo 'Step 6: Safety Gate'

\echo 'Views resolve:'
SELECT 'v_intake_triage_queue' AS view_name, COUNT(*) AS rows FROM trapper.v_intake_triage_queue
UNION ALL
SELECT 'v_request_list', COUNT(*) FROM trapper.v_request_list
UNION ALL
SELECT 'v_recent_edits', COUNT(*) FROM trapper.v_recent_edits;

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
-- Step 7: Summary
-- ============================================================================

\echo ''
\echo '====== MIG_780 SUMMARY ======'
\echo 'Deleted 140 orphan entity_edits (person entity_ids absent from sot_people).'
\echo 'All were MIG_572 deletion audit ghosts (edit_type=delete, field_name=full_record).'
\echo 'Zero downstream references (no pending_edits, no rollback chains).'
\echo 'Backup preserved in: trapper._backup_orphan_entity_edits_780'
\echo ''
\echo 'Rollback:'
\echo '  INSERT INTO trapper.entity_edits'
\echo '  SELECT * FROM trapper._backup_orphan_entity_edits_780;'
\echo '=== MIG_780 Complete ==='
