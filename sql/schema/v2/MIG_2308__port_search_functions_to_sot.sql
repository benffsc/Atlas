-- MIG_2308__port_search_functions_to_sot.sql
-- Port V1 search functions from trapper schema to sot schema for V2 compatibility
--
-- V2 INVARIANT: All functions must use V2 schema references (sot.*, ops.*)
-- V2 INVARIANT: INV-13 - Must filter data_quality IN ('garbage', 'needs_review')
--
-- Creates:
--   - sot.search_unified(q, type, limit, offset)
--   - sot.search_unified_counts(q, type)
--   - sot.search_suggestions(q, limit)
--   - sot.search_deep(q, limit)
--   - sot.search_intake(q, limit)
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/v2/MIG_2308__port_search_functions_to_sot.sql

\echo '============================================'
\echo 'MIG_2308: Port Search Functions to SOT Schema'
\echo '============================================'

-- ============================================
-- PART 1: Ensure pg_trgm extension exists
-- ============================================
\echo ''
\echo 'Ensuring pg_trgm extension...'

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================
-- PART 2: Create trigram indexes on V2 tables
-- ============================================
\echo 'Creating trigram indexes on V2 tables...'

-- Cat name trigram index (V2 uses 'name' not 'display_name')
CREATE INDEX IF NOT EXISTS idx_sot_cats_name_trgm
ON sot.cats USING gin (name gin_trgm_ops);

-- Person display_name trigram index
CREATE INDEX IF NOT EXISTS idx_sot_people_display_name_trgm
ON sot.people USING gin (display_name gin_trgm_ops);

-- Places display_name and formatted_address trigram indexes
CREATE INDEX IF NOT EXISTS idx_sot_places_display_name_trgm
ON sot.places USING gin (display_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_sot_places_formatted_address_trgm
ON sot.places USING gin (formatted_address gin_trgm_ops)
WHERE formatted_address IS NOT NULL;

-- Cat identifiers value index (for microchip search)
CREATE INDEX IF NOT EXISTS idx_sot_cat_identifiers_value_trgm
ON sot.cat_identifiers USING gin (id_value gin_trgm_ops);

-- Addresses city index
CREATE INDEX IF NOT EXISTS idx_sot_addresses_city_trgm
ON sot.addresses USING gin (city gin_trgm_ops)
WHERE city IS NOT NULL;

\echo 'Indexes created.'

-- ============================================
-- PART 3: Search Unified Function (V2)
-- ============================================
\echo ''
\echo 'Creating sot.search_unified function...'

CREATE OR REPLACE FUNCTION sot.search_unified(
    p_query TEXT,
    p_type TEXT DEFAULT NULL,  -- 'cat', 'person', 'place', or NULL for all
    p_limit INT DEFAULT 25,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    entity_type TEXT,
    entity_id TEXT,
    display_name TEXT,
    subtitle TEXT,
    match_strength TEXT,
    match_reason TEXT,
    score NUMERIC,
    metadata JSONB
) AS $$
DECLARE
    v_query_lower TEXT := LOWER(TRIM(p_query));
    v_query_pattern TEXT := '%' || v_query_lower || '%';
    v_query_prefix TEXT := v_query_lower || '%';
    v_tokens TEXT[];
BEGIN
    -- Parse query into tokens for token matching
    v_tokens := regexp_split_to_array(v_query_lower, '\s+');

    RETURN QUERY
    WITH ranked_results AS (
        -- ========== CATS ==========
        SELECT
            'cat'::TEXT AS entity_type,
            c.cat_id::TEXT AS entity_id,
            c.name AS display_name,
            COALESCE(
                (SELECT 'Microchip: ' || ci.id_value
                 FROM sot.cat_identifiers ci
                 WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
                 LIMIT 1),
                TRIM(COALESCE(c.sex, '') || ' ' || COALESCE(c.altered_status, '') || ' ' || COALESCE(c.breed, ''))
            ) AS subtitle,
            -- Scoring logic
            CASE
                WHEN LOWER(c.name) = v_query_lower THEN 100
                WHEN LOWER(c.name) LIKE v_query_prefix THEN 95
                WHEN EXISTS (
                    SELECT 1 FROM sot.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id
                      AND LOWER(ci.id_value) = v_query_lower
                ) THEN 98
                WHEN EXISTS (
                    SELECT 1 FROM sot.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id
                      AND LOWER(ci.id_value) LIKE v_query_prefix
                ) THEN 90
                WHEN (
                    SELECT bool_and(LOWER(c.name) LIKE '%' || token || '%')
                    FROM unnest(v_tokens) AS token
                    WHERE LENGTH(token) >= 2
                ) THEN 75
                WHEN similarity(c.name, p_query) >= 0.5 THEN 60 + (similarity(c.name, p_query) * 30)::INT
                WHEN LOWER(c.name) LIKE v_query_pattern THEN 40
                WHEN EXISTS (
                    SELECT 1 FROM sot.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id
                      AND LOWER(ci.id_value) LIKE v_query_pattern
                ) THEN 35
                ELSE 0
            END AS score,
            -- Match reason
            CASE
                WHEN LOWER(c.name) = v_query_lower THEN 'exact_name'
                WHEN LOWER(c.name) LIKE v_query_prefix THEN 'prefix_name'
                WHEN EXISTS (
                    SELECT 1 FROM sot.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) = v_query_lower
                ) THEN 'exact_microchip'
                WHEN EXISTS (
                    SELECT 1 FROM sot.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) LIKE v_query_prefix
                ) THEN 'prefix_microchip'
                WHEN similarity(c.name, p_query) >= 0.5 THEN 'similar_name'
                WHEN LOWER(c.name) LIKE v_query_pattern THEN 'contains_name'
                WHEN EXISTS (
                    SELECT 1 FROM sot.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) LIKE v_query_pattern
                ) THEN 'contains_identifier'
                ELSE 'trigram'
            END AS match_reason,
            jsonb_build_object(
                'sex', c.sex,
                'altered_status', c.altered_status,
                'breed', c.breed,
                'has_place', EXISTS (SELECT 1 FROM sot.cat_place cpr WHERE cpr.cat_id = c.cat_id),
                'owner_count', (SELECT COUNT(DISTINCT pcr.person_id)
                                FROM sot.person_cat pcr
                                WHERE pcr.cat_id = c.cat_id AND pcr.relationship_type = 'owner')
            ) AS metadata
        FROM sot.cats c
        WHERE c.merged_into_cat_id IS NULL  -- V2: Only canonical cats
          AND COALESCE(c.data_quality, 'normal') NOT IN ('garbage', 'needs_review')  -- INV-13
          AND (p_type IS NULL OR p_type = 'cat')
          AND (
              LOWER(c.name) LIKE v_query_pattern
              OR similarity(c.name, p_query) >= 0.3
              OR EXISTS (
                  SELECT 1 FROM sot.cat_identifiers ci
                  WHERE ci.cat_id = c.cat_id
                    AND (LOWER(ci.id_value) LIKE v_query_pattern
                         OR similarity(ci.id_value, p_query) >= 0.4)
              )
          )

        UNION ALL

        -- ========== PEOPLE ==========
        SELECT
            'person'::TEXT AS entity_type,
            p.person_id::TEXT AS entity_id,
            p.display_name,
            COALESCE(
                (SELECT pr.role FROM sot.person_roles pr WHERE pr.person_id = p.person_id AND pr.role_status = 'active' LIMIT 1),
                (SELECT 'Cats: ' || COUNT(*)::TEXT
                 FROM sot.person_cat pcr
                 WHERE pcr.person_id = p.person_id)
            ) AS subtitle,
            CASE
                WHEN LOWER(p.display_name) = v_query_lower THEN 100
                WHEN LOWER(p.display_name) LIKE v_query_prefix THEN 95
                WHEN (
                    SELECT bool_and(LOWER(p.display_name) LIKE '%' || token || '%')
                    FROM unnest(v_tokens) AS token
                    WHERE LENGTH(token) >= 2
                ) THEN 75
                WHEN similarity(p.display_name, p_query) >= 0.5 THEN 60 + (similarity(p.display_name, p_query) * 30)::INT
                WHEN LOWER(p.display_name) LIKE v_query_pattern THEN 40
                ELSE 0
            END AS score,
            CASE
                WHEN LOWER(p.display_name) = v_query_lower THEN 'exact_name'
                WHEN LOWER(p.display_name) LIKE v_query_prefix THEN 'prefix_name'
                WHEN similarity(p.display_name, p_query) >= 0.5 THEN 'similar_name'
                WHEN LOWER(p.display_name) LIKE v_query_pattern THEN 'contains_name'
                ELSE 'trigram'
            END AS match_reason,
            jsonb_build_object(
                'cat_count', (SELECT COUNT(*) FROM sot.person_cat pcr WHERE pcr.person_id = p.person_id),
                'place_count', (SELECT COUNT(*) FROM sot.person_place ppr WHERE ppr.person_id = p.person_id),
                'is_merged', p.merged_into_person_id IS NOT NULL
            ) AS metadata
        FROM sot.people p
        WHERE p.merged_into_person_id IS NULL  -- V2: Only canonical people
          AND COALESCE(p.data_quality, 'normal') NOT IN ('garbage', 'needs_review')  -- INV-13
          AND (p_type IS NULL OR p_type = 'person')
          AND (
              LOWER(p.display_name) LIKE v_query_pattern
              OR similarity(p.display_name, p_query) >= 0.3
          )

        UNION ALL

        -- ========== PLACES ==========
        SELECT
            'place'::TEXT AS entity_type,
            pl.place_id::TEXT AS entity_id,
            pl.display_name,
            COALESCE(pl.place_kind::TEXT, 'place') || ' - ' || COALESCE(sa.city, '') AS subtitle,
            CASE
                WHEN LOWER(pl.display_name) = v_query_lower THEN 100
                WHEN LOWER(pl.formatted_address) = v_query_lower THEN 99
                WHEN LOWER(pl.display_name) LIKE v_query_prefix THEN 95
                WHEN LOWER(pl.formatted_address) LIKE v_query_prefix THEN 92
                WHEN (
                    SELECT bool_and(
                        LOWER(COALESCE(pl.display_name, '') || ' ' || COALESCE(pl.formatted_address, '')) LIKE '%' || token || '%'
                    )
                    FROM unnest(v_tokens) AS token
                    WHERE LENGTH(token) >= 2
                ) THEN 75
                WHEN similarity(pl.display_name, p_query) >= 0.5 THEN 60 + (similarity(pl.display_name, p_query) * 30)::INT
                WHEN similarity(pl.formatted_address, p_query) >= 0.5 THEN 55 + (similarity(pl.formatted_address, p_query) * 30)::INT
                WHEN LOWER(pl.display_name) LIKE v_query_pattern THEN 40
                WHEN LOWER(pl.formatted_address) LIKE v_query_pattern THEN 35
                WHEN LOWER(sa.city) LIKE v_query_pattern THEN 30
                ELSE 0
            END AS score,
            CASE
                WHEN LOWER(pl.display_name) = v_query_lower THEN 'exact_name'
                WHEN LOWER(pl.formatted_address) = v_query_lower THEN 'exact_address'
                WHEN LOWER(pl.display_name) LIKE v_query_prefix THEN 'prefix_name'
                WHEN LOWER(pl.formatted_address) LIKE v_query_prefix THEN 'prefix_address'
                WHEN similarity(pl.display_name, p_query) >= 0.5 THEN 'similar_name'
                WHEN similarity(pl.formatted_address, p_query) >= 0.5 THEN 'similar_address'
                WHEN LOWER(pl.display_name) LIKE v_query_pattern THEN 'contains_name'
                WHEN LOWER(pl.formatted_address) LIKE v_query_pattern THEN 'contains_address'
                WHEN LOWER(sa.city) LIKE v_query_pattern THEN 'contains_locality'
                ELSE 'trigram'
            END AS match_reason,
            jsonb_build_object(
                'place_kind', pl.place_kind,
                'locality', sa.city,
                'postal_code', sa.postal_code,
                'cat_count', (SELECT COUNT(*) FROM sot.cat_place cpr WHERE cpr.place_id = pl.place_id),
                'person_count', (SELECT COUNT(*) FROM sot.person_place ppr WHERE ppr.place_id = pl.place_id),
                'is_address_backed', pl.is_address_backed
            ) AS metadata
        FROM sot.places pl
        LEFT JOIN sot.addresses sa ON sa.address_id = pl.sot_address_id
        WHERE pl.merged_into_place_id IS NULL  -- V2: Only canonical places
          AND COALESCE(pl.quality_tier, 'good') NOT IN ('garbage', 'needs_review')  -- INV-13 (places use quality_tier)
          AND (p_type IS NULL OR p_type = 'place')
          AND (
              LOWER(pl.display_name) LIKE v_query_pattern
              OR LOWER(pl.formatted_address) LIKE v_query_pattern
              OR LOWER(sa.city) LIKE v_query_pattern
              OR similarity(pl.display_name, p_query) >= 0.3
              OR similarity(pl.formatted_address, p_query) >= 0.3
          )
    )
    SELECT
        r.entity_type,
        r.entity_id,
        r.display_name,
        r.subtitle,
        CASE
            WHEN r.score >= 90 THEN 'strong'
            WHEN r.score >= 50 THEN 'medium'
            ELSE 'weak'
        END AS match_strength,
        r.match_reason,
        r.score::NUMERIC,
        r.metadata
    FROM ranked_results r
    WHERE r.score > 0
    ORDER BY r.score DESC, r.display_name ASC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.search_unified IS
'V2 Google-like search across cats, people, and places.
Returns ranked results with match strength and reason.
Score 90+: strong, 50-89: medium, <50: weak.
Respects INV-13: filters garbage/needs_review data.';

-- ============================================
-- PART 4: Search Counts Helper
-- ============================================
\echo 'Creating sot.search_unified_counts function...'

CREATE OR REPLACE FUNCTION sot.search_unified_counts(
    p_query TEXT,
    p_type TEXT DEFAULT NULL
)
RETURNS TABLE (
    entity_type TEXT,
    count BIGINT,
    strong_count BIGINT,
    medium_count BIGINT,
    weak_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH results AS (
        SELECT s.entity_type, s.score
        FROM sot.search_unified(p_query, p_type, 1000, 0) s
    )
    SELECT
        r.entity_type,
        COUNT(*)::BIGINT AS count,
        COUNT(*) FILTER (WHERE r.score >= 90)::BIGINT AS strong_count,
        COUNT(*) FILTER (WHERE r.score >= 50 AND r.score < 90)::BIGINT AS medium_count,
        COUNT(*) FILTER (WHERE r.score < 50)::BIGINT AS weak_count
    FROM results r
    GROUP BY r.entity_type
    ORDER BY r.entity_type;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.search_unified_counts IS
'Returns count breakdowns by entity type and match strength for a search query.';

-- ============================================
-- PART 5: Search Suggestions (Typeahead)
-- ============================================
\echo ''
\echo 'Creating sot.search_suggestions function...'

CREATE OR REPLACE FUNCTION sot.search_suggestions(
    p_query TEXT,
    p_limit INT DEFAULT 8
)
RETURNS TABLE (
    entity_type TEXT,
    entity_id TEXT,
    display_name TEXT,
    subtitle TEXT,
    match_strength TEXT,
    match_reason TEXT,
    score NUMERIC,
    metadata JSONB
) AS $$
BEGIN
    -- Return top results biased toward strong matches
    RETURN QUERY
    SELECT
        s.entity_type,
        s.entity_id,
        s.display_name,
        s.subtitle,
        s.match_strength,
        s.match_reason,
        s.score,
        s.metadata
    FROM sot.search_unified(p_query, NULL, p_limit * 3, 0) s
    WHERE s.score >= 40  -- Only medium+ matches for suggestions
    ORDER BY s.score DESC, s.display_name ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.search_suggestions IS
'Returns top suggestions for typeahead/autocomplete.
Biased toward strong and medium matches.';

-- ============================================
-- PART 6: Deep Search (Source Tables)
-- ============================================
\echo ''
\echo 'Creating sot.search_deep function...'

CREATE OR REPLACE FUNCTION sot.search_deep(
    p_query TEXT,
    p_limit INT DEFAULT 50
)
RETURNS TABLE (
    source_table TEXT,
    source_row_id TEXT,
    match_field TEXT,
    match_value TEXT,
    snippet JSONB,
    score NUMERIC
) AS $$
DECLARE
    v_query_lower TEXT := LOWER(TRIM(p_query));
    v_query_pattern TEXT := '%' || v_query_lower || '%';
BEGIN
    RETURN QUERY
    WITH deep_results AS (
        -- Source ClinicHQ Appointments (V2 source layer)
        SELECT
            'source.clinichq_appointments'::TEXT AS source_table,
            sa.appointment_id::TEXT AS source_row_id,
            CASE
                WHEN LOWER(sa.payload->>'Animal Name') LIKE v_query_pattern THEN 'animal_name'
                WHEN LOWER(sa.payload->>'Microchip Number') LIKE v_query_pattern THEN 'microchip'
                WHEN LOWER(sa.payload->>'Owner Email') LIKE v_query_pattern THEN 'email'
                ELSE 'multiple'
            END AS match_field,
            COALESCE(sa.payload->>'Animal Name', sa.payload->>'Microchip Number', 'Unknown') AS match_value,
            jsonb_build_object(
                'animal_name', sa.payload->>'Animal Name',
                'microchip', sa.payload->>'Microchip Number',
                'owner_name', COALESCE(sa.payload->>'Owner First Name', '') || ' ' || COALESCE(sa.payload->>'Owner Last Name', ''),
                'appt_date', sa.appointment_date
            ) AS snippet,
            CASE
                WHEN LOWER(sa.payload->>'Microchip Number') = v_query_lower THEN 95
                WHEN LOWER(sa.payload->>'Animal Name') = v_query_lower THEN 90
                WHEN LOWER(sa.payload->>'Microchip Number') LIKE v_query_pattern THEN 70
                WHEN LOWER(sa.payload->>'Animal Name') LIKE v_query_pattern THEN 65
                ELSE 30
            END::NUMERIC AS score
        FROM source.clinichq_appointments sa
        WHERE LOWER(sa.payload->>'Animal Name') LIKE v_query_pattern
           OR LOWER(sa.payload->>'Microchip Number') LIKE v_query_pattern
           OR LOWER(sa.payload->>'Owner Email') LIKE v_query_pattern
           OR LOWER(COALESCE(sa.payload->>'Owner First Name', '') || ' ' || COALESCE(sa.payload->>'Owner Last Name', '')) LIKE v_query_pattern
    )
    SELECT
        dr.source_table,
        dr.source_row_id,
        dr.match_field,
        dr.match_value,
        dr.snippet,
        dr.score
    FROM deep_results dr
    ORDER BY dr.score DESC, dr.match_value ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.search_deep IS
'V2 Deep search across source tables.
Returns raw data snippets for debugging and reconciliation.';

-- ============================================
-- PART 7: Search Intake Records
-- ============================================
\echo ''
\echo 'Creating sot.search_intake function...'

CREATE OR REPLACE FUNCTION sot.search_intake(
    p_query TEXT,
    p_limit INT DEFAULT 10
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
    SELECT
        'intake'::TEXT AS record_type,
        i.submission_id::TEXT AS record_id,
        COALESCE(TRIM(i.first_name || ' ' || i.last_name), 'Unknown') AS display_name,
        COALESCE(i.triage_category, i.status::TEXT) AS subtitle,
        i.cats_address AS address,
        i.phone,
        i.email,
        i.submitted_at,
        i.status::TEXT,
        CASE
            WHEN LOWER(TRIM(i.first_name || ' ' || i.last_name)) = v_query_lower THEN 100
            WHEN LOWER(i.email) = v_query_lower THEN 95
            WHEN LOWER(i.cats_address) LIKE v_query_pattern THEN 70
            WHEN LOWER(TRIM(i.first_name || ' ' || i.last_name)) LIKE v_query_pattern THEN 60
            ELSE 30
        END::NUMERIC AS score,
        jsonb_build_object(
            'city', i.cats_city,
            'cat_count', i.cat_count_total
        ) AS metadata
    FROM ops.intake_submissions i
    WHERE LOWER(TRIM(i.first_name || ' ' || i.last_name)) LIKE v_query_pattern
       OR LOWER(i.email) LIKE v_query_pattern
       OR LOWER(i.phone) LIKE v_query_pattern
       OR LOWER(i.cats_address) LIKE v_query_pattern
    ORDER BY score DESC, i.submitted_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.search_intake IS
'Search intake submissions for identity matching.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_2308 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Functions created in sot schema:'
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'sot'
  AND routine_name IN ('search_unified', 'search_unified_counts', 'search_deep', 'search_suggestions', 'search_intake')
ORDER BY routine_name;

\echo ''
\echo 'Test search (places with "petaluma"):'
SELECT entity_type, display_name, match_strength, score
FROM sot.search_unified('petaluma', 'place', 5, 0);

\echo ''
\echo 'Test suggestions:'
SELECT entity_type, display_name, score
FROM sot.search_suggestions('main', 5);

\echo ''
\echo 'MIG_2308 complete.'
