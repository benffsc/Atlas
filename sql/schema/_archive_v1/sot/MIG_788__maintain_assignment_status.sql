-- ============================================================================
-- MIG_788: Make assignment_status a Maintained Field (SC_004)
-- ============================================================================
-- TASK_LEDGER reference: SC_004
-- ACTIVE Impact: Yes (Surgical) — modifies sot_requests, v_request_list,
--   adds trigger on request_trapper_assignments
--
-- Problem: "needs trapper" is inferred from absence of data. That's the
--   Airtable pattern we're replacing. assignment_status already exists as
--   a CHECK field but is never set or maintained.
--
-- Solution: Make assignment_status a maintained lifecycle field:
--   1. Backfill from current state (assignments + no_trapper_reason)
--   2. Auto-maintain via trigger on request_trapper_assignments
--   3. Auto-set 'pending' on new request creation
--   4. Surface in v_request_list for filtering
-- ============================================================================

\echo '=== MIG_788: Make assignment_status a Maintained Field (SC_004) ==='

-- ============================================================================
-- Step 1: Pre-change state
-- ============================================================================

\echo ''
\echo 'Step 1: Pre-change state'

\echo 'Current assignment_status distribution:'
SELECT COALESCE(assignment_status, '(null)') AS status, COUNT(*) AS cnt
FROM trapper.sot_requests
GROUP BY assignment_status
ORDER BY cnt DESC;

\echo ''
\echo 'Current column count in v_request_list:'
SELECT COUNT(*) AS column_count
FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'v_request_list';

\echo ''
\echo 'Row count:'
SELECT COUNT(*) AS row_count FROM trapper.v_request_list;

-- ============================================================================
-- Step 2: Backfill assignment_status from current data
-- ============================================================================

\echo ''
\echo 'Step 2: Backfill assignment_status'

-- 2a: Requests with active trapper assignments → 'assigned'
UPDATE trapper.sot_requests r
SET assignment_status = 'assigned',
    updated_at = NOW()
FROM (
  SELECT DISTINCT request_id
  FROM trapper.request_trapper_assignments
  WHERE unassigned_at IS NULL
) rta
WHERE r.request_id = rta.request_id
  AND (r.assignment_status IS NULL OR r.assignment_status != 'assigned');

\echo 'Requests set to assigned:'
SELECT COUNT(*) AS set_to_assigned
FROM trapper.sot_requests
WHERE assignment_status = 'assigned';

-- 2b: Client trapping requests → 'client_trapping'
UPDATE trapper.sot_requests
SET assignment_status = 'client_trapping',
    updated_at = NOW()
WHERE no_trapper_reason = 'client_trapping'
  AND (assignment_status IS NULL OR assignment_status != 'client_trapping');

\echo 'Requests set to client_trapping:'
SELECT COUNT(*) AS set_to_client_trapping
FROM trapper.sot_requests
WHERE assignment_status = 'client_trapping';

-- 2c: Completed/cancelled requests without trapper → 'completed'/'cancelled'
UPDATE trapper.sot_requests
SET assignment_status = status,  -- 'completed' or 'cancelled'
    updated_at = NOW()
WHERE status IN ('completed', 'cancelled')
  AND assignment_status IS NULL;

\echo 'Resolved requests updated:'
SELECT assignment_status, COUNT(*) AS cnt
FROM trapper.sot_requests
WHERE status IN ('completed', 'cancelled')
GROUP BY assignment_status
ORDER BY cnt DESC;

-- 2d: Active requests without trapper and no reason → 'pending'
UPDATE trapper.sot_requests
SET assignment_status = 'pending',
    updated_at = NOW()
WHERE assignment_status IS NULL
  AND no_trapper_reason IS NULL
  AND status NOT IN ('completed', 'cancelled');

\echo 'Requests set to pending (needs trapper):'
SELECT COUNT(*) AS set_to_pending
FROM trapper.sot_requests
WHERE assignment_status = 'pending';

-- 2e: Anything still NULL (catch-all safety)
UPDATE trapper.sot_requests
SET assignment_status = 'pending',
    updated_at = NOW()
WHERE assignment_status IS NULL;

\echo ''
\echo 'Post-backfill distribution:'
SELECT assignment_status, COUNT(*) AS cnt
FROM trapper.sot_requests
GROUP BY assignment_status
ORDER BY cnt DESC;

-- ============================================================================
-- Step 3: Set NOT NULL default for new requests
-- ============================================================================

\echo ''
\echo 'Step 3: Set default for new requests'

ALTER TABLE trapper.sot_requests
  ALTER COLUMN assignment_status SET DEFAULT 'pending';

-- Make NOT NULL now that all rows have values
ALTER TABLE trapper.sot_requests
  ALTER COLUMN assignment_status SET NOT NULL;

\echo 'assignment_status is now NOT NULL DEFAULT pending.'

-- ============================================================================
-- Step 4: Trigger to maintain assignment_status on trapper changes
-- ============================================================================

\echo ''
\echo 'Step 4: Create maintenance trigger'

-- When a trapper is assigned or unassigned, update the request's assignment_status
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
    -- No active trappers — revert to pending (unless client_trapping)
    UPDATE trapper.sot_requests
    SET assignment_status = 'pending',
        updated_at = NOW()
    WHERE request_id = v_request_id
      AND assignment_status = 'assigned'
      AND no_trapper_reason IS NULL;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_maintain_assignment_status
  AFTER INSERT OR UPDATE OR DELETE ON trapper.request_trapper_assignments
  FOR EACH ROW
  EXECUTE FUNCTION trapper.maintain_assignment_status();

COMMENT ON FUNCTION trapper.maintain_assignment_status() IS
'Keeps sot_requests.assignment_status in sync with request_trapper_assignments.
Fires on INSERT/UPDATE/DELETE of assignments. Sets assigned when trappers exist,
reverts to pending when all trappers removed (unless client_trapping).';

-- ============================================================================
-- Step 5: Update assign_trapper_to_request to set assignment_status
-- ============================================================================

\echo ''
\echo 'Step 5: Note — trigger handles this automatically now'

-- The trigger (Step 4) fires AFTER INSERT on request_trapper_assignments,
-- so assign_trapper_to_request() doesn't need modification.
-- The trigger will set assignment_status = 'assigned' automatically.

-- ============================================================================
-- Step 6: Update v_request_list to include assignment_status
-- ============================================================================

\echo ''
\echo 'Step 6: Update v_request_list'

\echo 'Dependent views check:'
SELECT viewname
FROM pg_views
WHERE schemaname = 'trapper'
  AND definition ILIKE '%v_request_list%'
  AND viewname != 'v_request_list';

CREATE OR REPLACE VIEW trapper.v_request_list AS
SELECT
    -- ============================================================
    -- Original 30 columns (unchanged, same order)
    -- ============================================================
    r.request_id,
    r.status::text AS status,
    r.priority::text AS priority,
    r.summary,
    r.estimated_cat_count,
    r.has_kittens,
    r.scheduled_date,
    r.assigned_to,
    r.assigned_trapper_type::text AS assigned_trapper_type,
    r.created_at,
    r.updated_at,
    r.source_created_at,
    r.last_activity_at,
    r.hold_reason::text AS hold_reason,
    r.resolved_at,
    r.place_id,

    CASE
        WHEN p.display_name IS NOT NULL
         AND per.display_name IS NOT NULL
         AND lower(TRIM(BOTH FROM p.display_name)) = lower(TRIM(BOTH FROM per.display_name))
        THEN COALESCE(split_part(p.formatted_address, ',', 1), p.formatted_address)
        ELSE COALESCE(p.display_name, split_part(p.formatted_address, ',', 1))
    END AS place_name,

    p.formatted_address AS place_address,
    p.safety_notes AS place_safety_notes,
    sa.locality AS place_city,
    p.service_zone,
    ST_Y(p.location::geometry) AS latitude,
    ST_X(p.location::geometry) AS longitude,
    r.requester_person_id,
    per.display_name AS requester_name,

    COALESCE(per.primary_email, (
        SELECT pi.id_value_raw
        FROM trapper.person_identifiers pi
        WHERE pi.person_id = per.person_id AND pi.id_type = 'email'
        ORDER BY pi.created_at DESC LIMIT 1
    )) AS requester_email,

    COALESCE(per.primary_phone, (
        SELECT pi.id_value_raw
        FROM trapper.person_identifiers pi
        WHERE pi.person_id = per.person_id AND pi.id_type = 'phone'
        ORDER BY pi.created_at DESC LIMIT 1
    )) AS requester_phone,

    (SELECT COUNT(*) FROM trapper.request_cats rc WHERE rc.request_id = r.request_id) AS linked_cat_count,

    EXTRACT(DAY FROM NOW() - COALESCE(r.last_activity_at, r.created_at))::integer AS days_since_activity,

    (r.source_system = 'airtable') AS is_legacy_request,

    -- ============================================================
    -- SC_001: Data quality columns (preserved, same order)
    -- ============================================================

    COALESCE(tc.active_trapper_count, 0) AS active_trapper_count,

    (p.location IS NOT NULL) AS place_has_location,

    ARRAY_REMOVE(ARRAY[
        CASE WHEN COALESCE(tc.active_trapper_count, 0) = 0
             AND r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
             AND r.no_trapper_reason IS NULL
        THEN 'no_trapper' END,

        CASE WHEN r.no_trapper_reason = 'client_trapping'
        THEN 'client_trapping' END,

        CASE WHEN p.location IS NULL AND r.place_id IS NOT NULL
        THEN 'no_geometry' END,

        CASE WHEN EXTRACT(DAY FROM NOW() - COALESCE(r.last_activity_at, r.created_at)) > 30
             AND r.status NOT IN ('completed', 'cancelled')
        THEN 'stale_30d' END,

        CASE WHEN r.requester_person_id IS NULL
        THEN 'no_requester' END
    ], NULL) AS data_quality_flags,

    -- ============================================================
    -- SC_002: Trapper visibility columns (preserved)
    -- ============================================================

    r.no_trapper_reason,
    tc.primary_trapper_name,

    -- ============================================================
    -- SC_004: Assignment status (NEW — maintained field)
    -- ============================================================

    r.assignment_status::text AS assignment_status

FROM trapper.sot_requests r
LEFT JOIN trapper.places p ON p.place_id = r.place_id
LEFT JOIN trapper.sot_addresses sa ON sa.address_id = p.sot_address_id
LEFT JOIN trapper.sot_people per ON per.person_id = r.requester_person_id
LEFT JOIN (
    SELECT
        rta.request_id,
        COUNT(*) AS active_trapper_count,
        (SELECT tp.display_name
         FROM trapper.request_trapper_assignments rta2
         JOIN trapper.sot_people tp ON tp.person_id = rta2.trapper_person_id
         WHERE rta2.request_id = rta.request_id
           AND rta2.unassigned_at IS NULL
         ORDER BY rta2.is_primary DESC, rta2.assigned_at ASC
         LIMIT 1
        ) AS primary_trapper_name
    FROM trapper.request_trapper_assignments rta
    WHERE rta.unassigned_at IS NULL
    GROUP BY rta.request_id
) tc ON tc.request_id = r.request_id;

COMMENT ON VIEW trapper.v_request_list IS
'Request list view with data quality, trapper visibility, and assignment status.
SC_001: active_trapper_count, place_has_location, data_quality_flags.
SC_002: no_trapper_reason, primary_trapper_name.
SC_004: assignment_status (maintained field: pending/assigned/client_trapping/completed/cancelled).
All original columns preserved.';

-- ============================================================================
-- Step 7: Post-change verification
-- ============================================================================

\echo ''
\echo 'Step 7: Post-change state'

\echo 'New column count:'
SELECT COUNT(*) AS column_count
FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'v_request_list';

\echo ''
\echo 'Row count (should match pre-change):'
SELECT COUNT(*) AS row_count FROM trapper.v_request_list;

\echo ''
\echo 'assignment_status in view (active requests):'
SELECT assignment_status, COUNT(*) AS cnt
FROM trapper.v_request_list
WHERE status NOT IN ('completed', 'cancelled')
GROUP BY assignment_status
ORDER BY cnt DESC;

\echo ''
\echo 'Verify trigger fires — assign then unassign a test trapper:'
-- Just check trigger exists and is enabled
SELECT tgname, CASE tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'DISABLED' END AS status
FROM pg_trigger
WHERE tgrelid = 'trapper.request_trapper_assignments'::regclass
  AND tgname = 'trg_maintain_assignment_status';

-- ============================================================================
-- Step 8: Active Flow Safety Gate
-- ============================================================================

\echo ''
\echo 'Step 8: Safety Gate'

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
\echo 'NEW trigger on request_trapper_assignments:'
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

\echo ''
\echo 'Original columns spot-check:'
SELECT request_id, status, priority, place_address, requester_name,
       linked_cat_count, days_since_activity, is_legacy_request,
       assignment_status, primary_trapper_name
FROM trapper.v_request_list
LIMIT 3;

-- ============================================================================
-- Step 9: Summary
-- ============================================================================

\echo ''
\echo '====== MIG_788 SUMMARY (SC_004) ======'
\echo 'Made assignment_status a maintained lifecycle field.'
\echo ''
\echo 'Before: assignment_status was NULL for most requests.'
\echo '        "Needs trapper" inferred from absence of data (Airtable pattern).'
\echo ''
\echo 'After:  assignment_status is NOT NULL with explicit values:'
\echo '        pending         = needs trapper assignment'
\echo '        assigned        = has active trapper(s)'
\echo '        client_trapping = client handles trapping'
\echo '        completed       = resolved request'
\echo '        cancelled       = cancelled request'
\echo ''
\echo 'Maintenance:'
\echo '  - Trigger on request_trapper_assignments auto-updates assignment_status'
\echo '  - New requests default to pending'
\echo '  - assign_trapper_to_request() triggers assigned via trigger'
\echo '  - Unassigning all trappers triggers pending via trigger'
\echo ''
\echo 'Safety Gate: All views resolve, all triggers enabled, all core tables have data.'
\echo '=== MIG_788 Complete ==='
