-- MIG_101__data_issues_refresh.sql
-- Data Issues Refresh Function + Views for noise/messy data tracking
--
-- This migration creates:
-- 1. refresh_data_issues_from_ops() - Function to populate data_issues from v_ops_requests
-- 2. v_ops_data_issues_open - Open (unresolved) issues
-- 3. v_ops_data_issues_by_request - Issues joined back to requests
--
-- IMPORTANT: Depends on MIG_100 (data_issues table, v_ops_requests view)
--
-- APPLY MANUALLY:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_101__data_issues_refresh.sql

-- ============================================
-- PART 1: Refresh Function
-- ============================================

CREATE OR REPLACE FUNCTION trapper.refresh_data_issues_from_ops()
RETURNS TABLE (
    issue_type TEXT,
    inserted_count INT,
    updated_count INT
) AS $$
DECLARE
    v_inserted INT := 0;
    v_updated INT := 0;
    v_total_inserted INT := 0;
    v_total_updated INT := 0;
BEGIN
    -- ----------------------------------------
    -- Issue Type: needs_geo
    -- ----------------------------------------
    WITH issue_data AS (
        SELECT
            'request' AS entity_type,
            request_id AS entity_id,
            'needs_geo' AS issue_type,
            3 AS severity,  -- High: missing geolocation
            jsonb_build_object(
                'case_number', case_number,
                'display_name', display_name,
                'address_display', address_display,
                'status', status,
                'tnr_stage', tnr_stage,
                'snapshot_at', now()
            ) AS details
        FROM trapper.v_ops_requests
        WHERE needs_geo = true
          AND is_ops_active = true
    ),
    upserted AS (
        INSERT INTO trapper.data_issues (entity_type, entity_id, issue_type, severity, details)
        SELECT entity_type, entity_id, issue_type, severity, details
        FROM issue_data
        ON CONFLICT (entity_type, entity_id, issue_type) DO UPDATE SET
            last_seen_at = now(),
            details = EXCLUDED.details,
            severity = GREATEST(trapper.data_issues.severity, EXCLUDED.severity),
            is_resolved = false
        RETURNING (xmax = 0) AS was_inserted
    )
    SELECT
        COUNT(*) FILTER (WHERE was_inserted),
        COUNT(*) FILTER (WHERE NOT was_inserted)
    INTO v_inserted, v_updated
    FROM upserted;

    issue_type := 'needs_geo';
    inserted_count := v_inserted;
    updated_count := v_updated;
    RETURN NEXT;
    v_total_inserted := v_total_inserted + v_inserted;
    v_total_updated := v_total_updated + v_updated;

    -- ----------------------------------------
    -- Issue Type: raw_address_only
    -- ----------------------------------------
    WITH issue_data AS (
        SELECT
            'request' AS entity_type,
            request_id AS entity_id,
            'raw_address_only' AS issue_type,
            2 AS severity,  -- Medium: raw address only
            jsonb_build_object(
                'case_number', case_number,
                'display_name', display_name,
                'address_display', address_display,
                'place_raw_address', place_raw_address,
                'status', status,
                'tnr_stage', tnr_stage,
                'snapshot_at', now()
            ) AS details
        FROM trapper.v_ops_requests
        WHERE raw_address_only = true
          AND is_ops_active = true
    ),
    upserted AS (
        INSERT INTO trapper.data_issues (entity_type, entity_id, issue_type, severity, details)
        SELECT entity_type, entity_id, issue_type, severity, details
        FROM issue_data
        ON CONFLICT (entity_type, entity_id, issue_type) DO UPDATE SET
            last_seen_at = now(),
            details = EXCLUDED.details,
            severity = GREATEST(trapper.data_issues.severity, EXCLUDED.severity),
            is_resolved = false
        RETURNING (xmax = 0) AS was_inserted
    )
    SELECT
        COUNT(*) FILTER (WHERE was_inserted),
        COUNT(*) FILTER (WHERE NOT was_inserted)
    INTO v_inserted, v_updated
    FROM upserted;

    issue_type := 'raw_address_only';
    inserted_count := v_inserted;
    updated_count := v_updated;
    RETURN NEXT;
    v_total_inserted := v_total_inserted + v_inserted;
    v_total_updated := v_total_updated + v_updated;

    -- ----------------------------------------
    -- Issue Type: missing_contact
    -- ----------------------------------------
    WITH issue_data AS (
        SELECT
            'request' AS entity_type,
            request_id AS entity_id,
            'missing_contact' AS issue_type,
            2 AS severity,  -- Medium: missing contact info
            jsonb_build_object(
                'case_number', case_number,
                'display_name', display_name,
                'contact_name', contact_name,
                'contact_phone', contact_phone,
                'contact_email', contact_email,
                'status', status,
                'tnr_stage', tnr_stage,
                'snapshot_at', now()
            ) AS details
        FROM trapper.v_ops_requests
        WHERE missing_contact = true
          AND is_ops_active = true
    ),
    upserted AS (
        INSERT INTO trapper.data_issues (entity_type, entity_id, issue_type, severity, details)
        SELECT entity_type, entity_id, issue_type, severity, details
        FROM issue_data
        ON CONFLICT (entity_type, entity_id, issue_type) DO UPDATE SET
            last_seen_at = now(),
            details = EXCLUDED.details,
            severity = GREATEST(trapper.data_issues.severity, EXCLUDED.severity),
            is_resolved = false
        RETURNING (xmax = 0) AS was_inserted
    )
    SELECT
        COUNT(*) FILTER (WHERE was_inserted),
        COUNT(*) FILTER (WHERE NOT was_inserted)
    INTO v_inserted, v_updated
    FROM upserted;

    issue_type := 'missing_contact';
    inserted_count := v_inserted;
    updated_count := v_updated;
    RETURN NEXT;
    v_total_inserted := v_total_inserted + v_inserted;
    v_total_updated := v_total_updated + v_updated;

    -- ----------------------------------------
    -- Issue Type: unassigned
    -- ----------------------------------------
    WITH issue_data AS (
        SELECT
            'request' AS entity_type,
            request_id AS entity_id,
            'unassigned' AS issue_type,
            1 AS severity,  -- Low: unassigned (expected state for many)
            jsonb_build_object(
                'case_number', case_number,
                'display_name', display_name,
                'assigned_trapper_name', assigned_trapper_name,
                'status', status,
                'tnr_stage', tnr_stage,
                'snapshot_at', now()
            ) AS details
        FROM trapper.v_ops_requests
        WHERE unassigned = true
          AND is_ops_active = true
    ),
    upserted AS (
        INSERT INTO trapper.data_issues (entity_type, entity_id, issue_type, severity, details)
        SELECT entity_type, entity_id, issue_type, severity, details
        FROM issue_data
        ON CONFLICT (entity_type, entity_id, issue_type) DO UPDATE SET
            last_seen_at = now(),
            details = EXCLUDED.details,
            severity = GREATEST(trapper.data_issues.severity, EXCLUDED.severity),
            is_resolved = false
        RETURNING (xmax = 0) AS was_inserted
    )
    SELECT
        COUNT(*) FILTER (WHERE was_inserted),
        COUNT(*) FILTER (WHERE NOT was_inserted)
    INTO v_inserted, v_updated
    FROM upserted;

    issue_type := 'unassigned';
    inserted_count := v_inserted;
    updated_count := v_updated;
    RETURN NEXT;
    v_total_inserted := v_total_inserted + v_inserted;
    v_total_updated := v_total_updated + v_updated;

    -- ----------------------------------------
    -- Summary row
    -- ----------------------------------------
    issue_type := '_TOTAL';
    inserted_count := v_total_inserted;
    updated_count := v_total_updated;
    RETURN NEXT;

    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.refresh_data_issues_from_ops() IS
'Populates data_issues table from v_ops_requests flags.
Returns count of inserted and updated issues per type.
Does NOT auto-resolve issues that disappeared (safe, no surprises).
Call via: SELECT * FROM trapper.refresh_data_issues_from_ops();';

-- ============================================
-- PART 2: Open Issues View
-- ============================================

DROP VIEW IF EXISTS trapper.v_ops_data_issues_open;

CREATE VIEW trapper.v_ops_data_issues_open AS
SELECT
    id,
    entity_type,
    entity_id,
    issue_type,
    severity,
    first_seen_at,
    last_seen_at,
    details,
    -- Computed fields for convenience
    details->>'case_number' AS case_number,
    details->>'display_name' AS display_name,
    details->>'status' AS status,
    details->>'tnr_stage' AS tnr_stage,
    -- Age of issue
    EXTRACT(EPOCH FROM (now() - first_seen_at)) / 86400.0 AS days_open
FROM trapper.data_issues
WHERE is_resolved = false
ORDER BY
    severity DESC,
    last_seen_at DESC;

COMMENT ON VIEW trapper.v_ops_data_issues_open IS
'Open (unresolved) data issues. Includes extracted case_number and display_name from details.';

-- ============================================
-- PART 3: Issues by Request View
-- ============================================

DROP VIEW IF EXISTS trapper.v_ops_data_issues_by_request;

CREATE VIEW trapper.v_ops_data_issues_by_request AS
SELECT
    r.id AS request_id,
    r.case_number,
    COALESCE(
        p.full_name,
        CONCAT_WS(' ', p.first_name, p.last_name),
        pl.name,
        'Case #' || r.case_number
    ) AS display_name,
    r.status::text,
    di.id AS issue_id,
    di.issue_type,
    di.severity,
    di.first_seen_at,
    di.last_seen_at,
    di.details,
    di.is_resolved,
    EXTRACT(EPOCH FROM (now() - di.first_seen_at)) / 86400.0 AS days_open
FROM trapper.data_issues di
JOIN trapper.requests r ON r.id = di.entity_id AND di.entity_type = 'request'
LEFT JOIN trapper.places pl ON pl.id = COALESCE(r.primary_place_id, r.place_id)
LEFT JOIN trapper.people p ON p.id = COALESCE(r.primary_contact_person_id, r.person_id)
ORDER BY
    r.case_number,
    di.severity DESC,
    di.last_seen_at DESC;

COMMENT ON VIEW trapper.v_ops_data_issues_by_request IS
'Data issues joined back to requests. Shows all issues (resolved and unresolved) for each request.';

-- ============================================
-- PART 4: Issue Counts View (for dashboard)
-- ============================================

DROP VIEW IF EXISTS trapper.v_ops_data_issues_counts;

CREATE VIEW trapper.v_ops_data_issues_counts AS
SELECT
    issue_type,
    COUNT(*) FILTER (WHERE NOT is_resolved) AS open_count,
    COUNT(*) FILTER (WHERE is_resolved) AS resolved_count,
    COUNT(*) AS total_count,
    MAX(last_seen_at) FILTER (WHERE NOT is_resolved) AS last_seen_open,
    AVG(EXTRACT(EPOCH FROM (now() - first_seen_at)) / 86400.0) FILTER (WHERE NOT is_resolved) AS avg_days_open
FROM trapper.data_issues
GROUP BY issue_type
ORDER BY
    CASE issue_type
        WHEN 'needs_geo' THEN 1
        WHEN 'raw_address_only' THEN 2
        WHEN 'missing_contact' THEN 3
        WHEN 'unassigned' THEN 4
        ELSE 5
    END;

COMMENT ON VIEW trapper.v_ops_data_issues_counts IS
'Issue counts by type for dashboard display. Shows open, resolved, and total counts.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'MIG_101 complete. Verifying:'
\echo ''

\echo 'Function created:'
SELECT proname, prosrc IS NOT NULL AS has_body
FROM pg_proc
WHERE proname = 'refresh_data_issues_from_ops'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper');

\echo ''
\echo 'Views created:'
SELECT table_name FROM information_schema.views
WHERE table_schema = 'trapper'
  AND table_name LIKE 'v_ops_data_issues%'
ORDER BY table_name;

\echo ''
\echo 'To populate data_issues, run:'
\echo 'SELECT * FROM trapper.refresh_data_issues_from_ops();'
\echo ''
\echo 'Then verify with:'
\echo 'SELECT issue_type, COUNT(*) FROM trapper.data_issues WHERE NOT is_resolved GROUP BY 1;'
\echo 'SELECT * FROM trapper.v_ops_data_issues_open LIMIT 20;'
