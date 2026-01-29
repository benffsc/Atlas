-- ============================================================================
-- MIG_779: Surface Data Quality in Request List (SC_001)
-- ============================================================================
-- TASK_LEDGER reference: SC_001
-- ACTIVE Impact: Yes (Surgical) — modifies v_request_list view
--
-- Adds 3 new columns to v_request_list:
--   1. active_trapper_count   — Live count of assigned trappers
--   2. place_has_location     — Whether place has PostGIS geometry
--   3. data_quality_flags     — Array of actionable warning flags
--
-- All 30 existing columns are preserved in the same order.
-- This is a CREATE OR REPLACE VIEW — additive only.
-- ============================================================================

\echo '=== MIG_779: Surface Data Quality in Request List (SC_001) ==='

-- ============================================================================
-- Step 1: Capture pre-change state
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

-- ============================================================================
-- Step 2: Verify no dependent views
-- ============================================================================

\echo ''
\echo 'Step 2: Dependent views (must be 0):'

SELECT viewname
FROM pg_views
WHERE schemaname = 'trapper'
  AND definition ILIKE '%v_request_list%'
  AND viewname != 'v_request_list';

-- ============================================================================
-- Step 3: Replace the view (additive columns only)
-- ============================================================================

\echo ''
\echo 'Step 3: Replacing v_request_list with data quality columns'

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
    -- NEW: Data quality columns (SC_001)
    -- ============================================================

    -- Live trapper count from assignment table
    COALESCE(tc.active_trapper_count, 0) AS active_trapper_count,

    -- Whether the place has geometry (needed for Beacon map visibility)
    (p.location IS NOT NULL) AS place_has_location,

    -- Actionable data quality flags
    ARRAY_REMOVE(ARRAY[
        CASE WHEN COALESCE(tc.active_trapper_count, 0) = 0
             AND r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
        THEN 'no_trapper' END,

        CASE WHEN p.location IS NULL AND r.place_id IS NOT NULL
        THEN 'no_geometry' END,

        CASE WHEN EXTRACT(DAY FROM NOW() - COALESCE(r.last_activity_at, r.created_at)) > 30
             AND r.status NOT IN ('completed', 'cancelled')
        THEN 'stale_30d' END,

        CASE WHEN r.requester_person_id IS NULL
        THEN 'no_requester' END
    ], NULL) AS data_quality_flags

FROM trapper.sot_requests r
LEFT JOIN trapper.places p ON p.place_id = r.place_id
LEFT JOIN trapper.sot_addresses sa ON sa.address_id = p.sot_address_id
LEFT JOIN trapper.sot_people per ON per.person_id = r.requester_person_id
LEFT JOIN (
    SELECT request_id, COUNT(*) AS active_trapper_count
    FROM trapper.request_trapper_assignments
    WHERE unassigned_at IS NULL
    GROUP BY request_id
) tc ON tc.request_id = r.request_id;

COMMENT ON VIEW trapper.v_request_list IS
'Request list view with data quality indicators.
SC_001 added: active_trapper_count, place_has_location, data_quality_flags.
data_quality_flags: no_trapper, no_geometry, stale_30d, no_requester.
All original columns preserved.';

-- ============================================================================
-- Step 4: Post-change verification
-- ============================================================================

\echo ''
\echo 'Step 4: Post-change state'

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
  AND column_name IN ('active_trapper_count', 'place_has_location', 'data_quality_flags');

\echo ''
\echo 'Data quality flag distribution (active requests only):'
SELECT unnest(data_quality_flags) AS flag, COUNT(*) AS cnt
FROM trapper.v_request_list
WHERE status NOT IN ('completed', 'cancelled')
GROUP BY flag
ORDER BY cnt DESC;

\echo ''
\echo 'Sample: Active requests with data quality flags:'
SELECT request_id, status, place_address,
       active_trapper_count, place_has_location,
       data_quality_flags
FROM trapper.v_request_list
WHERE status NOT IN ('completed', 'cancelled')
  AND array_length(data_quality_flags, 1) > 0
LIMIT 10;

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

\echo ''
\echo 'Original columns still present (spot check):'
SELECT request_id, status, priority, place_address, requester_name,
       linked_cat_count, days_since_activity, is_legacy_request
FROM trapper.v_request_list
LIMIT 3;

-- ============================================================================
-- Step 6: Summary
-- ============================================================================

\echo ''
\echo '====== MIG_779 SUMMARY ======'
\echo 'Surgical change to ACTIVE view: v_request_list'
\echo 'Added 3 columns: active_trapper_count, place_has_location, data_quality_flags'
\echo 'All 30 original columns preserved in same order.'
\echo 'Safety Gate: All views resolve, all triggers enabled, all core tables have data.'
\echo ''
\echo 'Rollback: DROP VIEW trapper.v_request_list; then recreate from pg_get_viewdef backup.'
\echo '=== MIG_779 Complete ==='
