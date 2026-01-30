-- MIG_792__search_unified_add_coordinates.sql
-- Add lat/lng to search_unified metadata for people and places
-- This enables the map to navigate to search results
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_792__search_unified_add_coordinates.sql

\echo ''
\echo '=== MIG_792: Add coordinates to search_unified metadata ==='
\echo 'Adds lat/lng to place and person metadata so map can navigate to results'
\echo ''

CREATE OR REPLACE FUNCTION trapper.search_unified(
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
            CASE
                WHEN LOWER(c.display_name) = v_query_lower THEN 100
                WHEN LOWER(c.display_name) LIKE v_query_prefix THEN 95
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) = v_query_lower
                ) THEN 98
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) LIKE v_query_prefix
                ) THEN 90
                WHEN (SELECT bool_and(LOWER(c.display_name) LIKE '%' || token || '%')
                      FROM unnest(v_tokens) AS token WHERE LENGTH(token) >= 2) THEN 75
                WHEN similarity(c.display_name, p_query) >= 0.5 THEN 60 + (similarity(c.display_name, p_query) * 30)::INT
                WHEN LOWER(c.display_name) LIKE v_query_pattern THEN 40
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) LIKE v_query_pattern
                ) THEN 35
                ELSE 0
            END AS score,
            CASE
                WHEN LOWER(c.display_name) = v_query_lower THEN 'exact_name'
                WHEN LOWER(c.display_name) LIKE v_query_prefix THEN 'prefix_name'
                WHEN EXISTS (SELECT 1 FROM trapper.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) = v_query_lower) THEN 'exact_microchip'
                WHEN EXISTS (SELECT 1 FROM trapper.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) LIKE v_query_prefix) THEN 'prefix_microchip'
                WHEN similarity(c.display_name, p_query) >= 0.5 THEN 'similar_name'
                WHEN LOWER(c.display_name) LIKE v_query_pattern THEN 'contains_name'
                ELSE 'other'
            END AS match_reason,
            jsonb_build_object(
                'sex', c.sex,
                'altered_status', c.altered_status,
                'breed', c.breed,
                'data_source', c.data_source,
                'has_place', EXISTS (SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.cat_id = c.cat_id),
                'owner_count', (SELECT COUNT(DISTINCT trapper.canonical_person_id(pcr.person_id))
                                FROM trapper.person_cat_relationships pcr
                                WHERE pcr.cat_id = c.cat_id AND pcr.relationship_type = 'owner')
            ) AS metadata
        FROM trapper.sot_cats c
        WHERE (p_type IS NULL OR p_type = 'cat')
          AND (
              LOWER(c.display_name) LIKE v_query_pattern
              OR similarity(c.display_name, p_query) >= 0.3
              OR EXISTS (
                  SELECT 1 FROM trapper.cat_identifiers ci
                  WHERE ci.cat_id = c.cat_id
                    AND (LOWER(ci.id_value) LIKE v_query_pattern OR similarity(ci.id_value, p_query) >= 0.4)
              )
          )

        UNION ALL

        -- ========== PEOPLE (with alias search) ==========
        SELECT
            'person'::TEXT AS entity_type,
            p.person_id::TEXT AS entity_id,
            p.display_name,
            CASE
                WHEN p.entity_type = 'site' THEN 'Site - ' || (SELECT COUNT(*) FROM trapper.person_aliases pa WHERE pa.person_id = p.person_id)::TEXT || ' aliases'
                WHEN p.entity_type = 'unknown' THEN 'Needs Review'
                ELSE (SELECT COUNT(*)::TEXT || ' cats' FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id)
            END AS subtitle,
            CASE
                -- Exact display_name match
                WHEN LOWER(p.display_name) = v_query_lower THEN 100
                -- Exact alias match
                WHEN EXISTS (SELECT 1 FROM trapper.person_aliases pa WHERE pa.person_id = p.person_id AND LOWER(pa.name_raw) = v_query_lower) THEN 95
                -- Prefix display_name match
                WHEN LOWER(p.display_name) LIKE v_query_prefix THEN 90
                -- Prefix alias match
                WHEN EXISTS (SELECT 1 FROM trapper.person_aliases pa WHERE pa.person_id = p.person_id AND LOWER(pa.name_raw) LIKE v_query_prefix) THEN 85
                -- Contains in display_name
                WHEN LOWER(p.display_name) LIKE v_query_pattern THEN 70
                -- Contains in alias
                WHEN EXISTS (SELECT 1 FROM trapper.person_aliases pa WHERE pa.person_id = p.person_id AND LOWER(pa.name_raw) LIKE v_query_pattern) THEN 65
                -- Similarity on display_name
                WHEN similarity(p.display_name, p_query) >= 0.5 THEN 60 + (similarity(p.display_name, p_query) * 30)::INT
                -- Cat microchip match
                WHEN EXISTS (
                    SELECT 1 FROM trapper.person_cat_relationships pcr
                    JOIN trapper.cat_identifiers ci ON ci.cat_id = pcr.cat_id AND ci.id_type = 'microchip'
                    WHERE pcr.person_id = p.person_id AND LOWER(ci.id_value) = v_query_lower
                ) THEN 99
                ELSE 0
            END AS score,
            CASE
                WHEN LOWER(p.display_name) = v_query_lower THEN 'exact_name'
                WHEN EXISTS (SELECT 1 FROM trapper.person_aliases pa WHERE pa.person_id = p.person_id AND LOWER(pa.name_raw) = v_query_lower) THEN 'exact_alias'
                WHEN LOWER(p.display_name) LIKE v_query_prefix THEN 'prefix_name'
                WHEN EXISTS (SELECT 1 FROM trapper.person_aliases pa WHERE pa.person_id = p.person_id AND LOWER(pa.name_raw) LIKE v_query_prefix) THEN 'prefix_alias'
                WHEN LOWER(p.display_name) LIKE v_query_pattern THEN 'contains_name'
                WHEN EXISTS (SELECT 1 FROM trapper.person_aliases pa WHERE pa.person_id = p.person_id AND LOWER(pa.name_raw) LIKE v_query_pattern) THEN 'contains_alias'
                WHEN EXISTS (
                    SELECT 1 FROM trapper.person_cat_relationships pcr
                    JOIN trapper.cat_identifiers ci ON ci.cat_id = pcr.cat_id AND ci.id_type = 'microchip'
                    WHERE pcr.person_id = p.person_id AND LOWER(ci.id_value) = v_query_lower
                ) THEN 'cat_microchip'
                ELSE 'other'
            END AS match_reason,
            jsonb_build_object(
                'entity_type', p.entity_type,
                'data_source', p.data_source,
                'cat_count', (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id),
                'alias_count', (SELECT COUNT(*) FROM trapper.person_aliases pa WHERE pa.person_id = p.person_id),
                'is_merged', p.merged_into_person_id IS NOT NULL,
                'place_count', (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id),
                'has_identifiers', EXISTS (SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id),
                -- Include matched alias if match was via alias
                'matched_alias', (SELECT pa.name_raw FROM trapper.person_aliases pa WHERE pa.person_id = p.person_id AND LOWER(pa.name_raw) LIKE v_query_pattern LIMIT 1),
                -- Coordinates from linked place (for map navigation)
                -- Uses LATERAL join to guarantee lat/lng from the same place row
                'lat', person_loc.lat,
                'lng', person_loc.lng
            ) AS metadata
        FROM trapper.sot_people p
        LEFT JOIN LATERAL (
            SELECT ST_Y(pl2.location::geometry) AS lat, ST_X(pl2.location::geometry) AS lng
            FROM trapper.person_place_relationships ppr2
            JOIN trapper.places pl2 ON pl2.place_id = ppr2.place_id
            WHERE ppr2.person_id = p.person_id AND pl2.location IS NOT NULL
            ORDER BY ppr2.created_at DESC LIMIT 1
        ) person_loc ON true
        WHERE (p_type IS NULL OR p_type = 'person')
          AND p.merged_into_person_id IS NULL
          AND (
              -- Match on display_name
              LOWER(p.display_name) LIKE v_query_pattern
              OR similarity(p.display_name, p_query) >= 0.3
              -- Match on alias
              OR EXISTS (
                  SELECT 1 FROM trapper.person_aliases pa
                  WHERE pa.person_id = p.person_id
                    AND (LOWER(pa.name_raw) LIKE v_query_pattern OR similarity(pa.name_raw, p_query) >= 0.4)
              )
              -- Match on cat microchip
              OR EXISTS (
                  SELECT 1 FROM trapper.person_cat_relationships pcr
                  JOIN trapper.cat_identifiers ci ON ci.cat_id = pcr.cat_id AND ci.id_type = 'microchip'
                  WHERE pcr.person_id = p.person_id
                    AND (LOWER(ci.id_value) LIKE v_query_pattern OR LOWER(ci.id_value) = v_query_lower)
              )
          )

        UNION ALL

        -- ========== PLACES ==========
        SELECT
            'place'::TEXT AS entity_type,
            pl.place_id::TEXT AS entity_id,
            COALESCE(pl.display_name, pl.formatted_address, 'Unknown Place') AS display_name,
            COALESCE(pl.formatted_address, '') AS subtitle,
            CASE
                WHEN LOWER(COALESCE(pl.display_name, '')) = v_query_lower THEN 100
                WHEN LOWER(COALESCE(pl.formatted_address, '')) = v_query_lower THEN 95
                WHEN LOWER(COALESCE(pl.display_name, '')) LIKE v_query_prefix THEN 90
                WHEN LOWER(COALESCE(pl.display_name, '')) LIKE v_query_pattern THEN 70
                WHEN LOWER(COALESCE(pl.formatted_address, '')) LIKE v_query_pattern THEN 65
                WHEN similarity(COALESCE(pl.display_name, ''), p_query) >= 0.5 THEN 60 + (similarity(pl.display_name, p_query) * 30)::INT
                ELSE 0
            END AS score,
            CASE
                WHEN LOWER(COALESCE(pl.display_name, '')) = v_query_lower THEN 'exact_name'
                WHEN LOWER(COALESCE(pl.display_name, '')) LIKE v_query_pattern THEN 'contains_name'
                WHEN LOWER(COALESCE(pl.formatted_address, '')) LIKE v_query_pattern THEN 'contains_address'
                ELSE 'other'
            END AS match_reason,
            jsonb_build_object(
                'place_kind', pl.place_kind,
                'effective_type', pl.effective_type,
                'has_activity', pl.has_trapping_activity OR pl.has_appointment_activity OR pl.has_cat_activity,
                -- Coordinates for map navigation
                'lat', CASE WHEN pl.location IS NOT NULL THEN ST_Y(pl.location::geometry) END,
                'lng', CASE WHEN pl.location IS NOT NULL THEN ST_X(pl.location::geometry) END
            ) AS metadata
        FROM trapper.places pl
        WHERE (p_type IS NULL OR p_type = 'place')
          AND (
              LOWER(COALESCE(pl.display_name, '')) LIKE v_query_pattern
              OR LOWER(COALESCE(pl.formatted_address, '')) LIKE v_query_pattern
              OR similarity(COALESCE(pl.display_name, ''), p_query) >= 0.3
          )
    )
    SELECT
        rr.entity_type,
        rr.entity_id,
        rr.display_name,
        rr.subtitle,
        CASE
            WHEN rr.score >= 90 THEN 'strong'
            WHEN rr.score >= 50 THEN 'medium'
            ELSE 'weak'
        END AS match_strength,
        rr.match_reason,
        rr.score,
        rr.metadata
    FROM ranked_results rr
    WHERE rr.score > 0
    ORDER BY rr.score DESC, rr.display_name
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.search_unified IS
'Unified search across cats, people (including aliases), and places. Returns ranked results with coordinates in metadata for map navigation.';

\echo ''
\echo '=== MIG_792 Complete ==='
\echo 'Added lat/lng to place metadata (from places.location)'
\echo 'Added lat/lng to person metadata (from linked place via person_place_relationships)'
\echo 'Map search can now navigate to both place and person results'
