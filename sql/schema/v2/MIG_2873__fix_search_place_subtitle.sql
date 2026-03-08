-- MIG_2873: Fix raw place_kind in search_unified() place subtitle
--
-- Problem: Place results show "residential_house - Santa Rosa" as subtitle,
-- exposing raw database enum values to staff.
--
-- Fix: Use formatted_address (or city fallback) instead of place_kind in subtitle.
-- place_kind is already in the metadata JSONB so no data is lost.
--
-- FFS-327
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/v2/MIG_2873__fix_search_place_subtitle.sql

\echo '============================================'
\echo 'MIG_2873: Fix Search Place Subtitle'
\echo '============================================'

CREATE OR REPLACE FUNCTION sot.search_unified(
    p_query TEXT,
    p_type TEXT DEFAULT NULL,
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
        WHERE c.merged_into_cat_id IS NULL
          AND COALESCE(c.data_quality, 'normal') NOT IN ('garbage', 'needs_review')
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
                'place_count', (SELECT COUNT(*) FROM sot.person_place ppr WHERE ppr.place_id = p.person_id),
                'is_merged', p.merged_into_person_id IS NOT NULL
            ) AS metadata
        FROM sot.people p
        WHERE p.merged_into_person_id IS NULL
          AND COALESCE(p.data_quality, 'normal') NOT IN ('garbage', 'needs_review')
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
            -- FFS-327: Use formatted_address instead of raw place_kind enum
            -- place_kind is in metadata JSONB, no data lost
            COALESCE(pl.formatted_address, sa.city, '') AS subtitle,
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
        WHERE pl.merged_into_place_id IS NULL
          AND COALESCE(pl.quality_tier, 'good') NOT IN ('garbage', 'needs_review')
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

\echo ''
\echo 'MIG_2873 complete. Place subtitles now show formatted_address instead of raw place_kind.'
\echo 'Verify: SELECT subtitle FROM sot.search_unified(''main'', ''place'', 5, 0);'
