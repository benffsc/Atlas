-- MIG_052__search_intake_records.sql
-- Add search function for unlinked intake records (appointment requests, trapping requests)
--
-- PURPOSE:
--   Surface appointment requests and trapping requests in search results
--   These are low-detail records that need review for canonicalization
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_052__search_intake_records.sql

\echo '============================================'
\echo 'MIG_052: Search Intake Records'
\echo '============================================'

-- ============================================
-- PART 1: Trigram indexes for intake tables
-- ============================================
\echo ''
\echo 'Creating trigram indexes for intake tables...'

-- Appointment requests name index
CREATE INDEX IF NOT EXISTS idx_appointment_requests_name_trgm
ON trapper.appointment_requests USING gin (requester_name gin_trgm_ops)
WHERE requester_name IS NOT NULL;

-- Appointment requests address index
CREATE INDEX IF NOT EXISTS idx_appointment_requests_address_trgm
ON trapper.appointment_requests USING gin (cats_address gin_trgm_ops)
WHERE cats_address IS NOT NULL;

-- Staged records payload index (for trapping requests)
CREATE INDEX IF NOT EXISTS idx_staged_records_payload_gin
ON trapper.staged_records USING gin (payload);

\echo 'Indexes created.'

-- ============================================
-- PART 2: Search Intake Records Function
-- ============================================
\echo ''
\echo 'Creating search_intake function...'

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
                'Unknown'
            ) AS display_name,
            COALESCE(
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
            COALESCE(
                sr.payload->>'Phone',
                sr.payload->>'Phone Number',
                sr.payload->>'Cell Phone'
            ) AS phone,
            sr.payload->>'Email' AS email,
            sr.created_at AS submitted_at,
            sr.payload->>'Status' AS status,
            CASE
                WHEN LOWER(COALESCE(sr.payload->>'First Name', '') || ' ' || COALESCE(sr.payload->>'Last Name', '')) = v_query_lower THEN 100
                WHEN LOWER(sr.payload->>'Name') = v_query_lower THEN 98
                WHEN LOWER(sr.payload->>'Email') = v_query_lower THEN 95
                WHEN LOWER(sr.payload->>'Phone') LIKE v_query_pattern THEN 90
                WHEN LOWER(COALESCE(sr.payload->>'First Name', '') || ' ' || COALESCE(sr.payload->>'Last Name', '')) LIKE v_query_pattern THEN 75
                WHEN LOWER(sr.payload->>'Name') LIKE v_query_pattern THEN 70
                WHEN LOWER(sr.payload->>'Requester Name') LIKE v_query_pattern THEN 68
                WHEN LOWER(sr.payload->>'Email') LIKE v_query_pattern THEN 65
                WHEN LOWER(COALESCE(sr.payload->>'Address', sr.payload->>'Street Address', '')) LIKE v_query_pattern THEN 50
                WHEN LOWER(sr.payload->>'Notes') LIKE v_query_pattern THEN 30
                ELSE 0
            END::NUMERIC AS score,
            jsonb_build_object(
                'source', sr.source_system,
                'source_table', sr.source_table,
                'is_processed', sr.is_processed
            ) AS metadata
        FROM trapper.staged_records sr
        WHERE sr.source_table = 'trapping_requests'
          AND (
              sr.payload::TEXT ILIKE v_query_pattern
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

COMMENT ON FUNCTION trapper.search_intake IS
'Search unlinked intake records (appointment requests, trapping requests).
Returns records that need review for canonicalization.
Use this to find people/places that exist in intake data but not yet in canonical tables.';

-- ============================================
-- PART 3: Unified Search including Intake
-- ============================================
\echo ''
\echo 'Creating search_all function (canonical + intake)...'

CREATE OR REPLACE FUNCTION trapper.search_all(
    p_query TEXT,
    p_type TEXT DEFAULT NULL,  -- 'cat', 'person', 'place', 'intake', or NULL for all
    p_limit INT DEFAULT 25,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    result_category TEXT,
    entity_type TEXT,
    entity_id TEXT,
    display_name TEXT,
    subtitle TEXT,
    match_strength TEXT,
    score NUMERIC,
    metadata JSONB
) AS $$
BEGIN
    -- Canonical results
    IF p_type IS NULL OR p_type IN ('cat', 'person', 'place') THEN
        RETURN QUERY
        SELECT
            'canonical'::TEXT AS result_category,
            s.entity_type,
            s.entity_id,
            s.display_name,
            s.subtitle,
            s.match_strength,
            s.score,
            s.metadata
        FROM trapper.search_unified(p_query, p_type, p_limit, p_offset) s;
    END IF;

    -- Intake results (unlinked)
    IF p_type IS NULL OR p_type = 'intake' THEN
        RETURN QUERY
        SELECT
            'intake'::TEXT AS result_category,
            i.record_type AS entity_type,
            i.record_id AS entity_id,
            i.display_name,
            COALESCE(i.address, i.subtitle) AS subtitle,
            CASE
                WHEN i.score >= 90 THEN 'strong'
                WHEN i.score >= 50 THEN 'medium'
                ELSE 'weak'
            END AS match_strength,
            i.score,
            jsonb_build_object(
                'phone', i.phone,
                'email', i.email,
                'status', i.status,
                'submitted_at', i.submitted_at
            ) || i.metadata AS metadata
        FROM trapper.search_intake(p_query, p_limit) i;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.search_all IS
'Combined search across canonical entities AND intake records.
result_category distinguishes "canonical" (linked entities) from "intake" (unlinked records).
Use p_type=''intake'' to search only intake records.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_052 Complete'
\echo '============================================'

\echo ''
\echo 'Functions created:'
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'trapper'
  AND routine_name IN ('search_intake', 'search_all')
ORDER BY routine_name;

\echo ''
\echo 'Usage:'
\echo '  -- Search intake records only:'
\echo '  SELECT * FROM trapper.search_intake(''Adan Alvarado'', 10);'
\echo ''
\echo '  -- Search everything (canonical + intake):'
\echo '  SELECT * FROM trapper.search_all(''Smith'', NULL, 25, 0);'
\echo ''
\echo '  -- Search only intake:'
\echo '  SELECT * FROM trapper.search_all(''Main St'', ''intake'', 25, 0);'
\echo ''
