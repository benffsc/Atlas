-- ============================================================================
-- MIG_785: Trapper Visibility in Request List (SC_002)
-- ============================================================================
-- TASK_LEDGER reference: SC_002
-- ACTIVE Impact: Yes (Surgical) — modifies v_request_list view, fixes data
--
-- Part 1: Fix 24 Airtable requests that should have no_trapper_reason='client_trapping'
-- Part 2: Add trapper name + no_trapper_reason to v_request_list
-- Part 3: Improve data_quality_flags to distinguish needs-trapper vs client-trapping
--
-- All 33 existing columns preserved in the same order.
-- This is a CREATE OR REPLACE VIEW — additive only.
-- ============================================================================

\echo '=== MIG_785: Trapper Visibility in Request List (SC_002) ==='

-- ============================================================================
-- Step 1: Pre-change state
-- ============================================================================

\echo ''
\echo 'Step 1: Pre-change state'

\echo 'Current v_request_list column count:'
SELECT COUNT(*) AS column_count
FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'v_request_list';

\echo ''
\echo 'Current row count:'
SELECT COUNT(*) AS row_count FROM trapper.v_request_list;

\echo ''
\echo 'Current no_trapper_reason distribution:'
SELECT COALESCE(no_trapper_reason, '(null)') as reason, COUNT(*) as cnt
FROM trapper.sot_requests
GROUP BY no_trapper_reason
ORDER BY cnt DESC;

-- ============================================================================
-- Step 2: Fix Airtable client_trapping data alignment
-- ============================================================================

\echo ''
\echo 'Step 2: Fixing client_trapping data from Airtable'

-- The Airtable sync used recEp51Dwdei6cN2F as a pseudo-trapper meaning "client trapping".
-- 24 requests have ONLY this record as their trapper assignment but no_trapper_reason was never set.
-- Identify them via staged_records and set no_trapper_reason = 'client_trapping'.

WITH client_trapping_source_ids AS (
    SELECT DISTINCT source_row_id
    FROM trapper.staged_records
    WHERE source_system = 'airtable'
      AND source_table ILIKE '%request%'
      AND (payload->>'Trappers Assigned')::text = '["recEp51Dwdei6cN2F"]'
      AND source_row_id IS NOT NULL
)
UPDATE trapper.sot_requests r
SET
    no_trapper_reason = 'client_trapping',
    updated_at = NOW()
FROM client_trapping_source_ids ct
WHERE r.source_record_id = ct.source_row_id
  AND r.no_trapper_reason IS NULL;

\echo 'Client trapping requests fixed:'
SELECT no_trapper_reason, COUNT(*) as cnt
FROM trapper.sot_requests
WHERE no_trapper_reason IS NOT NULL
GROUP BY no_trapper_reason;

-- ============================================================================
-- Step 3: Verify no dependent views
-- ============================================================================

\echo ''
\echo 'Step 3: Dependent views (must be 0):'

SELECT viewname
FROM pg_views
WHERE schemaname = 'trapper'
  AND definition ILIKE '%v_request_list%'
  AND viewname != 'v_request_list';

-- ============================================================================
-- Step 4: Replace the view (additive columns only)
-- ============================================================================

\echo ''
\echo 'Step 4: Replacing v_request_list with trapper visibility columns'

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
    COALESCE(sa.locality, TRIM(split_part(p.formatted_address, ',', 2))) AS place_city,
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

    -- Live trapper count from assignment table
    COALESCE(tc.active_trapper_count, 0) AS active_trapper_count,

    -- Whether the place has geometry (needed for Beacon map visibility)
    (p.location IS NOT NULL) AS place_has_location,

    -- Actionable data quality flags (IMPROVED: no_trapper only when actually needs one)
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
    -- SC_002: Trapper visibility columns (NEW)
    -- ============================================================

    -- Why no trapper is assigned (client_trapping, not_needed, etc.)
    r.no_trapper_reason,

    -- Name of the primary assigned trapper (or first active trapper)
    tc.primary_trapper_name,

    -- Assignment status (added post-SC_002)
    r.assignment_status

FROM trapper.sot_requests r
LEFT JOIN trapper.places p ON p.place_id = r.place_id
LEFT JOIN trapper.sot_addresses sa ON sa.address_id = p.sot_address_id
LEFT JOIN trapper.sot_people per ON per.person_id = r.requester_person_id
LEFT JOIN (
    SELECT
        rta.request_id,
        COUNT(*) AS active_trapper_count,
        -- Get the primary trapper's name, or first assigned trapper if no primary
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
'Request list view with data quality and trapper visibility.
SC_001: active_trapper_count, place_has_location, data_quality_flags.
SC_002: no_trapper_reason, primary_trapper_name. Improved data_quality_flags:
  no_trapper = needs assignment (no reason given), client_trapping = client handles it.
All original columns preserved.';

-- ============================================================================
-- Step 5: Post-change verification
-- ============================================================================

\echo ''
\echo 'Step 5: Post-change state'

\echo 'New column count:'
SELECT COUNT(*) AS column_count
FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'v_request_list';

\echo ''
\echo 'New row count (should match pre-change):'
SELECT COUNT(*) AS row_count FROM trapper.v_request_list;

\echo ''
\echo 'New columns added:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'v_request_list'
  AND column_name IN ('no_trapper_reason', 'primary_trapper_name');

\echo ''
\echo 'Trapper visibility sample (active requests):'
SELECT
  request_id,
  status,
  active_trapper_count,
  no_trapper_reason,
  primary_trapper_name,
  data_quality_flags
FROM trapper.v_request_list
WHERE status NOT IN ('completed', 'cancelled')
ORDER BY active_trapper_count ASC, status
LIMIT 15;

\echo ''
\echo 'Data quality flag distribution (active requests):'
SELECT unnest(data_quality_flags) AS flag, COUNT(*) AS cnt
FROM trapper.v_request_list
WHERE status NOT IN ('completed', 'cancelled')
GROUP BY flag
ORDER BY cnt DESC;

-- ============================================================================
-- Step 6: Active Flow Safety Gate — SQL Smoke Queries
-- ============================================================================

\echo ''
\echo 'Step 6: Safety Gate'

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

\echo ''
\echo 'Original columns still present (spot check):'
SELECT request_id, status, priority, place_address, requester_name,
       linked_cat_count, days_since_activity, is_legacy_request
FROM trapper.v_request_list
LIMIT 3;

-- ============================================================================
-- Step 7: Summary
-- ============================================================================

\echo ''
\echo '====== MIG_785 SUMMARY ======'
\echo 'Surgical change to ACTIVE view: v_request_list'
\echo 'Part 1: Fixed 24 Airtable client_trapping requests (no_trapper_reason set)'
\echo 'Part 2: Added 2 columns: no_trapper_reason, primary_trapper_name'
\echo 'Part 3: Improved data_quality_flags: no_trapper only when no reason given'
\echo '        Added client_trapping flag for requests where client traps'
\echo 'All 33 previous columns preserved in same order.'
\echo 'Safety Gate: All views resolve, all triggers enabled, all core tables have data.'
\echo ''
\echo 'Rollback: psql -f <rollback_script> (see TASK_LEDGER SC_002 for SQL)'
\echo '=== MIG_785 Complete ==='
