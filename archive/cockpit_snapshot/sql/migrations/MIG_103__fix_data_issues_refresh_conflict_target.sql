-- MIG_103__fix_data_issues_refresh_conflict_target.sql
-- Fixes remaining ambiguity in refresh_data_issues_from_ops()
--
-- ROOT CAUSE:
--   ON CONFLICT (entity_type, entity_id, issue_type) still causes ambiguity
--   because PL/pgSQL output variable "issue_type" shadows the column name
--   in the conflict target list.
--
-- FIX:
--   Use ON CONFLICT ON CONSTRAINT data_issues_entity_type_entity_id_issue_type_key
--   instead of listing columns directly.
--   Also alias the INSERT target table (AS di) and qualify UPDATE refs.
--
-- EXTERNAL SIGNATURE: UNCHANGED
--   RETURNS TABLE (issue_type TEXT, inserted_count INT, updated_count INT)
--
-- APPLY:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_103__fix_data_issues_refresh_conflict_target.sql

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
            'needs_geo' AS issue_type_val,
            3 AS severity,
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
        INSERT INTO trapper.data_issues AS di (entity_type, entity_id, issue_type, severity, details)
        SELECT entity_type, entity_id, issue_type_val, severity, details
        FROM issue_data
        ON CONFLICT ON CONSTRAINT data_issues_entity_type_entity_id_issue_type_key DO UPDATE SET
            last_seen_at = now(),
            details = EXCLUDED.details,
            severity = GREATEST(di.severity, EXCLUDED.severity),
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
            'raw_address_only' AS issue_type_val,
            2 AS severity,
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
        INSERT INTO trapper.data_issues AS di (entity_type, entity_id, issue_type, severity, details)
        SELECT entity_type, entity_id, issue_type_val, severity, details
        FROM issue_data
        ON CONFLICT ON CONSTRAINT data_issues_entity_type_entity_id_issue_type_key DO UPDATE SET
            last_seen_at = now(),
            details = EXCLUDED.details,
            severity = GREATEST(di.severity, EXCLUDED.severity),
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
            'missing_contact' AS issue_type_val,
            2 AS severity,
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
        INSERT INTO trapper.data_issues AS di (entity_type, entity_id, issue_type, severity, details)
        SELECT entity_type, entity_id, issue_type_val, severity, details
        FROM issue_data
        ON CONFLICT ON CONSTRAINT data_issues_entity_type_entity_id_issue_type_key DO UPDATE SET
            last_seen_at = now(),
            details = EXCLUDED.details,
            severity = GREATEST(di.severity, EXCLUDED.severity),
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
            'unassigned' AS issue_type_val,
            1 AS severity,
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
        INSERT INTO trapper.data_issues AS di (entity_type, entity_id, issue_type, severity, details)
        SELECT entity_type, entity_id, issue_type_val, severity, details
        FROM issue_data
        ON CONFLICT ON CONSTRAINT data_issues_entity_type_entity_id_issue_type_key DO UPDATE SET
            last_seen_at = now(),
            details = EXCLUDED.details,
            severity = GREATEST(di.severity, EXCLUDED.severity),
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
Fixed in MIG_103: ON CONFLICT ON CONSTRAINT to avoid column name ambiguity.';

-- ============================================
-- VERIFICATION (run manually after applying)
-- ============================================
-- psql "$DATABASE_URL" -c "SELECT * FROM trapper.refresh_data_issues_from_ops();"
-- psql "$DATABASE_URL" -c "SELECT issue_type, COUNT(*) FROM trapper.data_issues WHERE NOT is_resolved GROUP BY 1 ORDER BY 2 DESC;"

\echo ''
\echo 'MIG_103 applied. Function signature unchanged.'
\echo ''
\echo 'Test with:'
\echo '  SELECT * FROM trapper.refresh_data_issues_from_ops();'
