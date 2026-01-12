-- MIG_053__fix_intake_contact_fields.sql
-- Fix contact field extraction in search_intake function
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_053__fix_intake_contact_fields.sql

\echo '============================================'
\echo 'MIG_053: Fix Intake Contact Fields'
\echo '============================================'

CREATE OR REPLACE FUNCTION trapper.search_intake(
    p_query TEXT,
    p_limit INT DEFAULT 25
)
RETURNS TABLE (
    record_type TEXT,
    record_id TEXT,
    display_name TEXT,
    subtitle TEXT,
    address TEXT,
    phone TEXT,
    email TEXT,
    submitted_at TIMESTAMPTZ,
    status TEXT,
    score NUMERIC,
    metadata JSONB
) AS $$
DECLARE
    v_query_lower TEXT := LOWER(TRIM(p_query));
    v_query_pattern TEXT := '%' || v_query_lower || '%';
BEGIN
    RETURN QUERY
    WITH intake_results AS (
        -- ========== APPOINTMENT REQUESTS ==========
        SELECT
            'appointment_request'::TEXT AS record_type,
            ar.id::TEXT AS record_id,
            COALESCE(
                NULLIF(TRIM(COALESCE(ar.first_name, '') || ' ' || COALESCE(ar.last_name, '')), ''),
                NULLIF(TRIM(ar.requester_name), ''),
                'Unknown'
            ) AS display_name,
            COALESCE(ar.situation_description, 'Appointment request') AS subtitle,
            COALESCE(ar.cats_address_clean, ar.cats_address, ar.requester_address) AS address,
            ar.phone,
            ar.email,
            ar.submitted_at,
            ar.submission_status AS status,
            CASE
                WHEN LOWER(COALESCE(ar.first_name, '') || ' ' || COALESCE(ar.last_name, '')) = v_query_lower THEN 100
                WHEN LOWER(ar.requester_name) = v_query_lower THEN 98
                WHEN LOWER(ar.email) = v_query_lower THEN 95
                WHEN LOWER(ar.phone) LIKE v_query_pattern THEN 90
                WHEN LOWER(COALESCE(ar.first_name, '') || ' ' || COALESCE(ar.last_name, '')) LIKE v_query_pattern THEN 75
                WHEN LOWER(ar.requester_name) LIKE v_query_pattern THEN 70
                WHEN LOWER(ar.email) LIKE v_query_pattern THEN 65
                WHEN LOWER(ar.cats_address) LIKE v_query_pattern THEN 50
                WHEN LOWER(ar.requester_address) LIKE v_query_pattern THEN 45
                WHEN LOWER(ar.situation_description) LIKE v_query_pattern THEN 30
                ELSE 0
            END::NUMERIC AS score,
            jsonb_build_object(
                'source', 'airtable',
                'cat_count', ar.cat_count_estimate,
                'county', ar.county,
                'has_appointment', ar.appointment_date IS NOT NULL
            ) AS metadata
        FROM trapper.appointment_requests ar
        WHERE
            LOWER(ar.requester_name) LIKE v_query_pattern
            OR LOWER(ar.first_name || ' ' || COALESCE(ar.last_name, '')) LIKE v_query_pattern
            OR LOWER(ar.email) LIKE v_query_pattern
            OR LOWER(ar.phone) LIKE v_query_pattern
            OR LOWER(ar.cats_address) LIKE v_query_pattern
            OR LOWER(ar.requester_address) LIKE v_query_pattern
            OR LOWER(ar.situation_description) LIKE v_query_pattern

        UNION ALL

        -- ========== TRAPPING REQUESTS (from staged_records) ==========
        SELECT
            'trapping_request'::TEXT AS record_type,
            sr.id::TEXT AS record_id,
            COALESCE(
                NULLIF(TRIM(COALESCE(sr.payload->>'First Name', '') || ' ' || COALESCE(sr.payload->>'Last Name', '')), ''),
                NULLIF(TRIM(sr.payload->>'Name'), ''),
                NULLIF(TRIM(sr.payload->>'Requester Name'), ''),
                NULLIF(TRIM(sr.payload->>'Client Name'), ''),
                'Unknown'
            ) AS display_name,
            COALESCE(
                sr.payload->>'Case Info',
                sr.payload->>'Notes',
                sr.payload->>'Situation',
                sr.payload->>'Description',
                'Trapping request'
            ) AS subtitle,
            COALESCE(
                sr.payload->>'Address',
                sr.payload->>'Street Address',
                sr.payload->>'Cats Address',
                sr.payload->>'Trapping Address',
                sr.payload->>'Location Address'
            ) AS address,
            -- Phone: try multiple field names
            COALESCE(
                NULLIF(TRIM(sr.payload->>'Clean Phone'), ''),
                NULLIF(TRIM(sr.payload->>'Client Number'), ''),
                NULLIF(TRIM(sr.payload->>'Client Phone (LK)'), ''),
                NULLIF(TRIM(sr.payload->>'Phone'), ''),
                NULLIF(TRIM(sr.payload->>'Phone Number'), ''),
                NULLIF(TRIM(sr.payload->>'Cell Phone'), ''),
                NULLIF(TRIM(sr.payload->>'Business Phone'), ''),
                NULLIF(TRIM(sr.payload->>'Requester Phone'), '')
            ) AS phone,
            -- Email: try multiple field names
            COALESCE(
                NULLIF(TRIM(sr.payload->>'Email'), ''),
                NULLIF(TRIM(sr.payload->>'Contact Email'), ''),
                NULLIF(TRIM(sr.payload->>'Requester Email'), ''),
                NULLIF(TRIM(sr.payload->>'Business Email'), '')
            ) AS email,
            sr.created_at AS submitted_at,
            COALESCE(sr.payload->>'Case Status', sr.payload->>'Status') AS status,
            CASE
                WHEN LOWER(COALESCE(sr.payload->>'First Name', '') || ' ' || COALESCE(sr.payload->>'Last Name', '')) = v_query_lower THEN 100
                WHEN LOWER(sr.payload->>'Name') = v_query_lower THEN 98
                WHEN LOWER(sr.payload->>'Client Name') = v_query_lower THEN 96
                WHEN LOWER(sr.payload->>'Email') = v_query_lower THEN 95
                WHEN LOWER(COALESCE(sr.payload->>'Clean Phone', sr.payload->>'Client Number', '')) LIKE v_query_pattern THEN 90
                WHEN LOWER(COALESCE(sr.payload->>'First Name', '') || ' ' || COALESCE(sr.payload->>'Last Name', '')) LIKE v_query_pattern THEN 75
                WHEN LOWER(sr.payload->>'Name') LIKE v_query_pattern THEN 70
                WHEN LOWER(sr.payload->>'Client Name') LIKE v_query_pattern THEN 68
                WHEN LOWER(sr.payload->>'Requester Name') LIKE v_query_pattern THEN 66
                WHEN LOWER(sr.payload->>'Email') LIKE v_query_pattern THEN 65
                WHEN LOWER(COALESCE(sr.payload->>'Address', sr.payload->>'Street Address', '')) LIKE v_query_pattern THEN 50
                WHEN LOWER(sr.payload->>'Case Info') LIKE v_query_pattern THEN 40
                WHEN LOWER(sr.payload->>'Notes') LIKE v_query_pattern THEN 30
                ELSE 0
            END::NUMERIC AS score,
            jsonb_build_object(
                'source', sr.source_system,
                'source_table', sr.source_table,
                'is_processed', sr.is_processed,
                'case_number', sr.payload->>'Case Number',
                'total_cats', sr.payload->>'Total Cats',
                'cats_trapped', sr.payload->>'Cats Trapped'
            ) AS metadata
        FROM trapper.staged_records sr
        WHERE sr.source_table = 'trapping_requests'
          AND (
              sr.payload::text ILIKE v_query_pattern
          )
    )
    SELECT
        ir.record_type,
        ir.record_id,
        ir.display_name,
        ir.subtitle,
        ir.address,
        ir.phone,
        ir.email,
        ir.submitted_at,
        ir.status,
        ir.score,
        ir.metadata
    FROM intake_results ir
    WHERE ir.score > 0
    ORDER BY ir.score DESC, ir.submitted_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

\echo ''
\echo 'Function updated. Test with:'
\echo '  SELECT display_name, phone, email, address FROM trapper.search_intake(''Lorie Obal'', 5);'
\echo ''
