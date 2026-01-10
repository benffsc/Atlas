-- MIG_026__search_unified_v4_google_like.sql
-- Google-like Search with Ranking and Match Reasons
--
-- Creates:
--   - pg_trgm extension for fuzzy matching
--   - GIN indexes for trigram search performance
--   - trapper.search_unified(q, type, limit, offset) - ranked canonical search
--   - trapper.search_deep(q, limit) - search across raw/staged tables
--   - trapper.v_search_unified_v4 - view wrapper for function
--
-- Ranking policy:
--   Strong (100-90): exact match, prefix match on primary fields
--   Medium (89-50): token match, FTS match
--   Weak (49-1): trigram similarity, ILIKE fallback
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_026__search_unified_v4_google_like.sql

\echo '============================================'
\echo 'MIG_026: Google-like Search (v4)'
\echo '============================================'

-- ============================================
-- PART 1: Extensions
-- ============================================
\echo ''
\echo 'Enabling pg_trgm extension...'

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================
-- PART 2: Indexes for Search Performance
-- ============================================
\echo 'Creating trigram indexes for search...'

-- Cat display_name trigram index
CREATE INDEX IF NOT EXISTS idx_sot_cats_display_name_trgm
ON trapper.sot_cats USING gin (display_name gin_trgm_ops);

-- Person display_name trigram index
CREATE INDEX IF NOT EXISTS idx_sot_people_display_name_trgm
ON trapper.sot_people USING gin (display_name gin_trgm_ops);

-- Places display_name and formatted_address trigram indexes
CREATE INDEX IF NOT EXISTS idx_places_display_name_trgm
ON trapper.places USING gin (display_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_places_formatted_address_trgm
ON trapper.places USING gin (formatted_address gin_trgm_ops)
WHERE formatted_address IS NOT NULL;

-- Cat identifiers value index (for microchip search)
CREATE INDEX IF NOT EXISTS idx_cat_identifiers_value_trgm
ON trapper.cat_identifiers USING gin (id_value gin_trgm_ops);

-- Addresses locality index
CREATE INDEX IF NOT EXISTS idx_sot_addresses_locality_trgm
ON trapper.sot_addresses USING gin (locality gin_trgm_ops)
WHERE locality IS NOT NULL;

\echo 'Indexes created.'

-- ============================================
-- PART 3: Search Unified Function
-- ============================================
\echo ''
\echo 'Creating search_unified function...'

CREATE OR REPLACE FUNCTION trapper.search_unified(
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
            c.display_name,
            COALESCE(
                (SELECT 'Microchip: ' || ci.id_value
                 FROM trapper.cat_identifiers ci
                 WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
                 LIMIT 1),
                TRIM(COALESCE(c.sex, '') || ' ' || COALESCE(c.altered_status, '') || ' ' || COALESCE(c.breed, ''))
            ) AS subtitle,
            -- Scoring logic
            CASE
                -- Exact name match (case-insensitive)
                WHEN LOWER(c.display_name) = v_query_lower THEN 100
                -- Prefix name match
                WHEN LOWER(c.display_name) LIKE v_query_prefix THEN 95
                -- Exact microchip match
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id
                      AND LOWER(ci.id_value) = v_query_lower
                ) THEN 98
                -- Prefix microchip match
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id
                      AND LOWER(ci.id_value) LIKE v_query_prefix
                ) THEN 90
                -- All tokens present in name
                WHEN (
                    SELECT bool_and(LOWER(c.display_name) LIKE '%' || token || '%')
                    FROM unnest(v_tokens) AS token
                    WHERE LENGTH(token) >= 2
                ) THEN 75
                -- Trigram similarity (strong)
                WHEN similarity(c.display_name, p_query) >= 0.5 THEN 60 + (similarity(c.display_name, p_query) * 30)::INT
                -- ILIKE fallback
                WHEN LOWER(c.display_name) LIKE v_query_pattern THEN 40
                -- Identifier ILIKE
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id
                      AND LOWER(ci.id_value) LIKE v_query_pattern
                ) THEN 35
                ELSE 0
            END AS score,
            -- Match reason
            CASE
                WHEN LOWER(c.display_name) = v_query_lower THEN 'exact_name'
                WHEN LOWER(c.display_name) LIKE v_query_prefix THEN 'prefix_name'
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) = v_query_lower
                ) THEN 'exact_microchip'
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) LIKE v_query_prefix
                ) THEN 'prefix_microchip'
                WHEN similarity(c.display_name, p_query) >= 0.5 THEN 'similar_name'
                WHEN LOWER(c.display_name) LIKE v_query_pattern THEN 'contains_name'
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) LIKE v_query_pattern
                ) THEN 'contains_identifier'
                ELSE 'trigram'
            END AS match_reason,
            jsonb_build_object(
                'sex', c.sex,
                'altered_status', c.altered_status,
                'breed', c.breed,
                'has_place', EXISTS (SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.cat_id = c.cat_id),
                'owner_count', (SELECT COUNT(DISTINCT trapper.canonical_person_id(pcr.person_id))
                                FROM trapper.person_cat_relationships pcr
                                WHERE pcr.cat_id = c.cat_id AND pcr.relationship_type = 'owner')
            ) AS metadata
        FROM trapper.sot_cats c
        WHERE (p_type IS NULL OR p_type = 'cat')
          AND (
              -- Name matches
              LOWER(c.display_name) LIKE v_query_pattern
              OR similarity(c.display_name, p_query) >= 0.3
              -- Identifier matches
              OR EXISTS (
                  SELECT 1 FROM trapper.cat_identifiers ci
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
                (SELECT 'Cats: ' || COUNT(*)::TEXT
                 FROM trapper.person_cat_relationships pcr
                 WHERE pcr.person_id = p.person_id),
                ''
            ) AS subtitle,
            -- Scoring logic
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
                'cat_count', (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id),
                'place_count', (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id),
                'is_merged', p.merged_into_person_id IS NOT NULL
            ) AS metadata
        FROM trapper.sot_people p
        WHERE p.merged_into_person_id IS NULL  -- Only canonical people
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
            COALESCE(pl.place_kind::TEXT, 'place') || ' • ' || COALESCE(sa.locality, '') AS subtitle,
            -- Scoring logic
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
                WHEN LOWER(sa.locality) LIKE v_query_pattern THEN 30
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
                WHEN LOWER(sa.locality) LIKE v_query_pattern THEN 'contains_locality'
                ELSE 'trigram'
            END AS match_reason,
            jsonb_build_object(
                'place_kind', pl.place_kind,
                'locality', sa.locality,
                'postal_code', sa.postal_code,
                'cat_count', (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = pl.place_id),
                'person_count', (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.place_id = pl.place_id),
                'is_address_backed', pl.is_address_backed
            ) AS metadata
        FROM trapper.places pl
        JOIN trapper.sot_addresses sa ON sa.address_id = pl.sot_address_id
        WHERE pl.is_address_backed = true
          AND (p_type IS NULL OR p_type = 'place')
          AND (
              LOWER(pl.display_name) LIKE v_query_pattern
              OR LOWER(pl.formatted_address) LIKE v_query_pattern
              OR LOWER(sa.locality) LIKE v_query_pattern
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

COMMENT ON FUNCTION trapper.search_unified IS
'Google-like search across cats, people, and places.
Returns ranked results with match strength and reason.
Score 90+: strong (exact/prefix), 50-89: medium (tokens/similarity), <50: weak (ILIKE fallback).
Use p_type to filter by entity type.';

-- ============================================
-- PART 4: Search Counts Helper
-- ============================================
\echo 'Creating search_unified_counts function...'

CREATE OR REPLACE FUNCTION trapper.search_unified_counts(
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
        FROM trapper.search_unified(p_query, p_type, 1000, 0) s
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

COMMENT ON FUNCTION trapper.search_unified_counts IS
'Returns count breakdowns by entity type and match strength for a search query.';

-- ============================================
-- PART 5: Deep Search Function (Raw/Staged)
-- ============================================
\echo ''
\echo 'Creating search_deep function...'

CREATE OR REPLACE FUNCTION trapper.search_deep(
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
        -- ClinicHQ Historical Cats
        SELECT
            'clinichq_hist_cats'::TEXT AS source_table,
            chc.id::TEXT AS source_row_id,
            CASE
                WHEN LOWER(chc.animal_name) LIKE v_query_pattern THEN 'animal_name'
                WHEN LOWER(chc.microchip_number) LIKE v_query_pattern THEN 'microchip_number'
                WHEN LOWER(chc.breed) LIKE v_query_pattern THEN 'breed'
                ELSE 'multiple'
            END AS match_field,
            COALESCE(chc.animal_name, chc.microchip_number, 'Unknown') AS match_value,
            jsonb_build_object(
                'animal_name', chc.animal_name,
                'microchip_number', chc.microchip_number,
                'breed', chc.breed,
                'sex', chc.sex,
                'appt_date', chc.appt_date,
                'appt_number', chc.appt_number
            ) AS snippet,
            CASE
                WHEN LOWER(chc.microchip_number) = v_query_lower THEN 95
                WHEN LOWER(chc.animal_name) = v_query_lower THEN 90
                WHEN LOWER(chc.microchip_number) LIKE v_query_pattern THEN 70
                WHEN LOWER(chc.animal_name) LIKE v_query_pattern THEN 65
                ELSE 30
            END::NUMERIC AS score
        FROM trapper.clinichq_hist_cats chc
        WHERE LOWER(chc.animal_name) LIKE v_query_pattern
           OR LOWER(chc.microchip_number) LIKE v_query_pattern
           OR LOWER(chc.breed) LIKE v_query_pattern

        UNION ALL

        -- ClinicHQ Historical Owners
        SELECT
            'clinichq_hist_owners'::TEXT AS source_table,
            cho.id::TEXT AS source_row_id,
            CASE
                WHEN LOWER(cho.owner_first_name || ' ' || cho.owner_last_name) LIKE v_query_pattern THEN 'owner_name'
                WHEN LOWER(cho.owner_email) LIKE v_query_pattern THEN 'owner_email'
                WHEN LOWER(cho.owner_address) LIKE v_query_pattern THEN 'owner_address'
                WHEN LOWER(cho.animal_name) LIKE v_query_pattern THEN 'animal_name'
                WHEN LOWER(cho.phone_normalized) LIKE v_query_pattern THEN 'phone'
                ELSE 'multiple'
            END AS match_field,
            COALESCE(
                TRIM(cho.owner_first_name || ' ' || cho.owner_last_name),
                cho.owner_email,
                cho.animal_name,
                'Unknown'
            ) AS match_value,
            jsonb_build_object(
                'owner_name', TRIM(COALESCE(cho.owner_first_name, '') || ' ' || COALESCE(cho.owner_last_name, '')),
                'owner_email', cho.owner_email,
                'owner_address', cho.owner_address,
                'animal_name', cho.animal_name,
                'appt_date', cho.appt_date
            ) AS snippet,
            CASE
                WHEN LOWER(cho.owner_email) = v_query_lower THEN 95
                WHEN LOWER(TRIM(cho.owner_first_name || ' ' || cho.owner_last_name)) = v_query_lower THEN 90
                WHEN LOWER(cho.phone_normalized) LIKE v_query_pattern THEN 80
                WHEN LOWER(cho.owner_email) LIKE v_query_pattern THEN 70
                WHEN LOWER(cho.owner_address) LIKE v_query_pattern THEN 60
                ELSE 30
            END::NUMERIC AS score
        FROM trapper.clinichq_hist_owners cho
        WHERE LOWER(cho.owner_first_name || ' ' || COALESCE(cho.owner_last_name, '')) LIKE v_query_pattern
           OR LOWER(cho.owner_last_name) LIKE v_query_pattern
           OR LOWER(cho.owner_email) LIKE v_query_pattern
           OR LOWER(cho.owner_address) LIKE v_query_pattern
           OR LOWER(cho.animal_name) LIKE v_query_pattern
           OR LOWER(cho.phone_normalized) LIKE v_query_pattern

        UNION ALL

        -- ClinicHQ Historical Appointments
        SELECT
            'clinichq_hist_appts'::TEXT AS source_table,
            cha.id::TEXT AS source_row_id,
            CASE
                WHEN LOWER(cha.animal_name) LIKE v_query_pattern THEN 'animal_name'
                WHEN LOWER(cha.microchip_number) LIKE v_query_pattern THEN 'microchip_number'
                ELSE 'multiple'
            END AS match_field,
            COALESCE(cha.animal_name, cha.microchip_number, 'Appt #' || cha.appt_number::TEXT) AS match_value,
            jsonb_build_object(
                'animal_name', cha.animal_name,
                'microchip_number', cha.microchip_number,
                'appt_date', cha.appt_date,
                'appt_number', cha.appt_number,
                'vet_name', cha.vet_name,
                'had_surgery', (cha.neuter OR cha.spay)
            ) AS snippet,
            CASE
                WHEN LOWER(cha.microchip_number) = v_query_lower THEN 95
                WHEN LOWER(cha.animal_name) = v_query_lower THEN 90
                WHEN LOWER(cha.microchip_number) LIKE v_query_pattern THEN 70
                WHEN LOWER(cha.animal_name) LIKE v_query_pattern THEN 65
                ELSE 30
            END::NUMERIC AS score
        FROM trapper.clinichq_hist_appts cha
        WHERE LOWER(cha.animal_name) LIKE v_query_pattern
           OR LOWER(cha.microchip_number) LIKE v_query_pattern
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

COMMENT ON FUNCTION trapper.search_deep IS
'Search across raw/staged tables (clinichq_hist_*).
Returns source information and snippets for debugging and reconciliation.
Does not return canonical entities - use search_unified for that.';

-- ============================================
-- PART 6: View Wrapper (compatibility)
-- ============================================
\echo ''
\echo 'Creating v_search_unified_v4 convenience view...'

-- Note: Cannot create a view directly from a function with parameters.
-- Instead, provide example usage in the comment.

-- For typeahead, we'll create a helper function
CREATE OR REPLACE FUNCTION trapper.search_suggestions(
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
    score NUMERIC
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
        s.score
    FROM trapper.search_unified(p_query, NULL, p_limit * 3, 0) s
    WHERE s.score >= 40  -- Only medium+ matches for suggestions
    ORDER BY s.score DESC, s.display_name ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.search_suggestions IS
'Returns top suggestions for typeahead/autocomplete.
Biased toward strong and medium matches. Use for dropdown suggestions.';

-- ============================================
-- PART 7: Person/Place Detail Views
-- ============================================
\echo ''
\echo 'Creating v_person_detail view...'

CREATE OR REPLACE VIEW trapper.v_person_detail AS
SELECT
    p.person_id,
    p.display_name,
    p.merged_into_person_id,
    p.created_at,
    p.updated_at,
    -- Cat relationships
    (SELECT jsonb_agg(jsonb_build_object(
        'cat_id', pcr.cat_id,
        'cat_name', c.display_name,
        'relationship_type', pcr.relationship_type,
        'confidence', pcr.confidence,
        'source_system', pcr.source_system
    ) ORDER BY pcr.relationship_type, c.display_name)
     FROM trapper.person_cat_relationships pcr
     JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
     WHERE pcr.person_id = p.person_id) AS cats,
    -- Place relationships
    (SELECT jsonb_agg(jsonb_build_object(
        'place_id', ppr.place_id,
        'place_name', pl.display_name,
        'formatted_address', pl.formatted_address,
        'place_kind', pl.place_kind,
        'role', ppr.role,
        'confidence', ppr.confidence
    ) ORDER BY ppr.role, pl.display_name)
     FROM trapper.person_place_relationships ppr
     JOIN trapper.places pl ON pl.place_id = ppr.place_id
     WHERE ppr.person_id = p.person_id) AS places,
    -- Person relationships (from edges)
    (SELECT jsonb_agg(jsonb_build_object(
        'person_id', CASE WHEN ppe.person_id_a = p.person_id THEN ppe.person_id_b ELSE ppe.person_id_a END,
        'person_name', CASE WHEN ppe.person_id_a = p.person_id THEN p2.display_name ELSE p1.display_name END,
        'relationship_type', rt.code,
        'relationship_label', rt.label,
        'confidence', ppe.confidence
    ) ORDER BY rt.label)
     FROM trapper.person_person_edges ppe
     JOIN trapper.relationship_types rt ON rt.id = ppe.relationship_type_id
     LEFT JOIN trapper.sot_people p1 ON p1.person_id = ppe.person_id_a
     LEFT JOIN trapper.sot_people p2 ON p2.person_id = ppe.person_id_b
     WHERE ppe.person_id_a = p.person_id OR ppe.person_id_b = p.person_id) AS person_relationships,
    -- Stats
    (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id) AS cat_count,
    (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id) AS place_count
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL;

COMMENT ON VIEW trapper.v_person_detail IS
'Full person detail for API including cats, places, and person relationships as JSONB arrays.';

\echo 'Creating v_place_detail view...'

CREATE OR REPLACE VIEW trapper.v_place_detail AS
SELECT
    pl.place_id,
    pl.display_name,
    pl.formatted_address,
    pl.place_kind,
    pl.is_address_backed,
    pl.has_cat_activity,
    sa.locality,
    sa.postal_code,
    sa.admin_area_1 AS state_province,  -- admin_area_1 = state in sot_addresses
    CASE WHEN pl.location IS NOT NULL THEN
        jsonb_build_object(
            'lat', ST_Y(pl.location::geometry),
            'lng', ST_X(pl.location::geometry)
        )
    ELSE NULL END AS coordinates,
    pl.created_at,
    pl.updated_at,
    -- Cats at this place
    (SELECT jsonb_agg(jsonb_build_object(
        'cat_id', cpr.cat_id,
        'cat_name', c.display_name,
        'relationship_type', cpr.relationship_type,
        'confidence', cpr.confidence
    ) ORDER BY c.display_name)
     FROM trapper.cat_place_relationships cpr
     JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
     WHERE cpr.place_id = pl.place_id) AS cats,
    -- People at this place
    (SELECT jsonb_agg(jsonb_build_object(
        'person_id', ppr.person_id,
        'person_name', p.display_name,
        'role', ppr.role,
        'confidence', ppr.confidence
    ) ORDER BY p.display_name)
     FROM trapper.person_place_relationships ppr
     JOIN trapper.sot_people p ON p.person_id = ppr.person_id
     WHERE ppr.place_id = pl.place_id
       AND p.merged_into_person_id IS NULL) AS people,
    -- Place relationships (from edges)
    (SELECT jsonb_agg(jsonb_build_object(
        'place_id', CASE WHEN ppe.place_id_a = pl.place_id THEN ppe.place_id_b ELSE ppe.place_id_a END,
        'place_name', CASE WHEN ppe.place_id_a = pl.place_id THEN pl2.display_name ELSE pl1.display_name END,
        'relationship_type', rt.code,
        'relationship_label', rt.label
    ) ORDER BY rt.label)
     FROM trapper.place_place_edges ppe
     JOIN trapper.relationship_types rt ON rt.id = ppe.relationship_type_id
     LEFT JOIN trapper.places pl1 ON pl1.place_id = ppe.place_id_a
     LEFT JOIN trapper.places pl2 ON pl2.place_id = ppe.place_id_b
     WHERE ppe.place_id_a = pl.place_id OR ppe.place_id_b = pl.place_id) AS place_relationships,
    -- Stats
    (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = pl.place_id) AS cat_count,
    (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.place_id = pl.place_id) AS person_count
FROM trapper.places pl
LEFT JOIN trapper.sot_addresses sa ON sa.address_id = pl.sot_address_id
WHERE pl.is_address_backed = true;

COMMENT ON VIEW trapper.v_place_detail IS
'Full place detail for API including cats, people, and place relationships as JSONB arrays.';

-- ============================================
-- PART 8: List Views for People and Places
-- ============================================
\echo ''
\echo 'Creating v_person_list view...'

CREATE OR REPLACE VIEW trapper.v_person_list AS
SELECT
    p.person_id,
    p.display_name,
    (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id) AS cat_count,
    (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id) AS place_count,
    (SELECT string_agg(DISTINCT c.display_name, ', ' ORDER BY c.display_name)
     FROM trapper.person_cat_relationships pcr
     JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
     WHERE pcr.person_id = p.person_id
     LIMIT 3) AS cat_names,
    (SELECT pl.display_name
     FROM trapper.person_place_relationships ppr
     JOIN trapper.places pl ON pl.place_id = ppr.place_id
     WHERE ppr.person_id = p.person_id
     ORDER BY ppr.created_at DESC
     LIMIT 1) AS primary_place,
    p.created_at
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL;

COMMENT ON VIEW trapper.v_person_list IS
'Person list view for API/UI with cat and place counts.';

\echo 'Creating v_place_list view...'

CREATE OR REPLACE VIEW trapper.v_place_list AS
SELECT
    pl.place_id,
    pl.display_name,
    pl.formatted_address,
    pl.place_kind,
    sa.locality,
    sa.postal_code,
    (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = pl.place_id) AS cat_count,
    (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.place_id = pl.place_id) AS person_count,
    pl.has_cat_activity,
    pl.created_at
FROM trapper.places pl
LEFT JOIN trapper.sot_addresses sa ON sa.address_id = pl.sot_address_id
WHERE pl.is_address_backed = true;

COMMENT ON VIEW trapper.v_place_list IS
'Place list view for API/UI with cat and person counts.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_026 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Extension status:'
SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_trgm';

\echo ''
\echo 'Indexes created:'
SELECT indexname FROM pg_indexes
WHERE schemaname = 'trapper'
  AND indexname LIKE '%trgm%'
ORDER BY indexname;

\echo ''
\echo 'Functions created:'
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'trapper'
  AND routine_name IN ('search_unified', 'search_unified_counts', 'search_deep', 'search_suggestions')
ORDER BY routine_name;

\echo ''
\echo 'Views created:'
SELECT table_name FROM information_schema.views
WHERE table_schema = 'trapper'
  AND table_name IN ('v_person_detail', 'v_place_detail', 'v_person_list', 'v_place_list')
ORDER BY table_name;

\echo ''
\echo 'Test search (cats with "whiskers"):'
SELECT entity_type, display_name, match_strength, match_reason, score
FROM trapper.search_unified('whiskers', NULL, 5, 0);

\echo ''
\echo 'Test suggestions:'
SELECT entity_type, display_name, match_reason, score
FROM trapper.search_suggestions('main', 5);

\echo ''
\echo 'Next steps:'
\echo '  1. Search: SELECT * FROM trapper.search_unified(''fluffy'', NULL, 25, 0);'
\echo '  2. Type filter: SELECT * FROM trapper.search_unified(''main st'', ''place'', 25, 0);'
\echo '  3. Suggestions: SELECT * FROM trapper.search_suggestions(''smi'', 8);'
\echo '  4. Deep search: SELECT * FROM trapper.search_deep(''12345'', 20);'
\echo '  5. Counts: SELECT * FROM trapper.search_unified_counts(''cat'');'
\echo ''
