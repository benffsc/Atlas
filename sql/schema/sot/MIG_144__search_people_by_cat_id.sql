-- MIG_144__search_people_by_cat_id.sql
-- Enable searching for people by their cats' microchips in search_unified function
--
-- Problem:
--   Searching for microchip 981020053084012 only matches the cat record,
--   not the person (Dee Anne Thom) who brought that cat in.
--
-- Solution:
--   Add microchip matching for people in the search_unified function.
--   When a person matches via cat microchip, boost their score and mark the match reason.
--
-- MANUAL APPLY:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_144__search_people_by_cat_id.sql

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
    v_is_microchip_query BOOLEAN;
BEGIN
    -- Parse query into tokens for token matching
    v_tokens := regexp_split_to_array(v_query_lower, '\s+');

    -- Detect if query looks like a microchip (15+ digit number)
    v_is_microchip_query := v_query_lower ~ '^[0-9]{10,}$';

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
            -- Base scoring logic
            CASE
                WHEN LOWER(c.display_name) = v_query_lower THEN 100
                WHEN LOWER(c.display_name) LIKE v_query_prefix THEN 95
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id
                      AND LOWER(ci.id_value) = v_query_lower
                ) THEN 98
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id
                      AND LOWER(ci.id_value) LIKE v_query_prefix
                ) THEN 90
                WHEN (
                    SELECT bool_and(LOWER(c.display_name) LIKE '%' || token || '%')
                    FROM unnest(v_tokens) AS token
                    WHERE LENGTH(token) >= 2
                ) THEN 75
                WHEN similarity(c.display_name, p_query) >= 0.5 THEN 60 + (similarity(c.display_name, p_query) * 30)::INT
                WHEN LOWER(c.display_name) LIKE v_query_pattern THEN 40
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id
                      AND LOWER(ci.id_value) LIKE v_query_pattern
                ) THEN 35
                ELSE 0
            END AS base_score,
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
            0 AS penalty,
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
                    AND (LOWER(ci.id_value) LIKE v_query_pattern
                         OR similarity(ci.id_value, p_query) >= 0.4)
              )
          )

        UNION ALL

        -- ========== PEOPLE (now matches by cat microchip too!) ==========
        SELECT
            'person'::TEXT AS entity_type,
            p.person_id::TEXT AS entity_id,
            p.display_name,
            -- Show ClinicHQ cat count in subtitle
            COALESCE(
                (SELECT
                    CASE
                        WHEN COUNT(*) FILTER (WHERE cat.data_source = 'clinichq') > 0 THEN
                            COUNT(*) FILTER (WHERE cat.data_source = 'clinichq')::TEXT || ' ClinicHQ cats'
                        ELSE
                            COUNT(*)::TEXT || ' cats'
                    END
                 FROM trapper.person_cat_relationships pcr
                 JOIN trapper.sot_cats cat ON cat.cat_id = pcr.cat_id
                 WHERE pcr.person_id = p.person_id),
                ''
            ) AS subtitle,
            -- Base scoring - includes microchip matching for people
            CASE
                -- Name matches
                WHEN LOWER(p.display_name) = v_query_lower THEN 100
                WHEN LOWER(p.display_name) LIKE v_query_prefix THEN 95
                -- NEW: Exact microchip match via linked cat - BOOST to 99 (just below exact name)
                WHEN EXISTS (
                    SELECT 1
                    FROM trapper.person_cat_relationships pcr
                    JOIN trapper.cat_identifiers ci ON ci.cat_id = pcr.cat_id
                    WHERE pcr.person_id = p.person_id
                      AND ci.id_type = 'microchip'
                      AND LOWER(ci.id_value) = v_query_lower
                ) THEN 99
                -- NEW: Prefix microchip match via linked cat
                WHEN EXISTS (
                    SELECT 1
                    FROM trapper.person_cat_relationships pcr
                    JOIN trapper.cat_identifiers ci ON ci.cat_id = pcr.cat_id
                    WHERE pcr.person_id = p.person_id
                      AND ci.id_type = 'microchip'
                      AND LOWER(ci.id_value) LIKE v_query_prefix
                ) THEN 92
                -- Token matching for names
                WHEN (
                    SELECT bool_and(LOWER(p.display_name) LIKE '%' || token || '%')
                    FROM unnest(v_tokens) AS token
                    WHERE LENGTH(token) >= 2
                ) THEN 75
                WHEN similarity(p.display_name, p_query) >= 0.5 THEN 60 + (similarity(p.display_name, p_query) * 30)::INT
                WHEN LOWER(p.display_name) LIKE v_query_pattern THEN 40
                ELSE 0
            END AS base_score,
            -- Match reason
            CASE
                WHEN LOWER(p.display_name) = v_query_lower THEN 'exact_name'
                WHEN LOWER(p.display_name) LIKE v_query_prefix THEN 'prefix_name'
                -- NEW: Microchip match reasons
                WHEN EXISTS (
                    SELECT 1
                    FROM trapper.person_cat_relationships pcr
                    JOIN trapper.cat_identifiers ci ON ci.cat_id = pcr.cat_id
                    WHERE pcr.person_id = p.person_id
                      AND ci.id_type = 'microchip'
                      AND LOWER(ci.id_value) = v_query_lower
                ) THEN 'cat_microchip'
                WHEN EXISTS (
                    SELECT 1
                    FROM trapper.person_cat_relationships pcr
                    JOIN trapper.cat_identifiers ci ON ci.cat_id = pcr.cat_id
                    WHERE pcr.person_id = p.person_id
                      AND ci.id_type = 'microchip'
                      AND LOWER(ci.id_value) LIKE v_query_prefix
                ) THEN 'cat_microchip_prefix'
                WHEN similarity(p.display_name, p_query) >= 0.5 THEN 'similar_name'
                WHEN LOWER(p.display_name) LIKE v_query_pattern THEN 'contains_name'
                ELSE 'trigram'
            END AS match_reason,
            -- Penalty rules (skip for microchip matches - they found the person via a cat)
            CASE
                WHEN LOWER(p.display_name) = v_query_lower THEN 0
                -- No penalty for microchip matches
                WHEN EXISTS (
                    SELECT 1
                    FROM trapper.person_cat_relationships pcr
                    JOIN trapper.cat_identifiers ci ON ci.cat_id = pcr.cat_id
                    WHERE pcr.person_id = p.person_id
                      AND ci.id_type = 'microchip'
                      AND LOWER(ci.id_value) LIKE v_query_pattern
                ) THEN 0
                ELSE
                    (CASE WHEN (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id) = 0
                               AND (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id) = 0
                          THEN 30
                          ELSE 0
                     END)
                    +
                    (CASE WHEN NOT EXISTS (SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id)
                          THEN 10
                          ELSE 0
                     END)
            END AS penalty,
            jsonb_build_object(
                'cat_count', (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id),
                'clinichq_cat_count', (SELECT COUNT(*)
                                       FROM trapper.person_cat_relationships pcr
                                       JOIN trapper.sot_cats cat ON cat.cat_id = pcr.cat_id
                                       WHERE pcr.person_id = p.person_id AND cat.data_source = 'clinichq'),
                'place_count', (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id),
                'has_identifiers', EXISTS (SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id),
                'is_merged', p.merged_into_person_id IS NOT NULL,
                'matched_via_microchip', EXISTS (
                    SELECT 1
                    FROM trapper.person_cat_relationships pcr
                    JOIN trapper.cat_identifiers ci ON ci.cat_id = pcr.cat_id
                    WHERE pcr.person_id = p.person_id
                      AND ci.id_type = 'microchip'
                      AND LOWER(ci.id_value) LIKE v_query_pattern
                )
            ) AS metadata
        FROM trapper.sot_people p
        WHERE p.merged_into_person_id IS NULL
          AND (p_type IS NULL OR p_type = 'person')
          AND (
              -- Name matching
              LOWER(p.display_name) LIKE v_query_pattern
              OR similarity(p.display_name, p_query) >= 0.3
              -- NEW: Microchip matching via linked cats
              OR EXISTS (
                  SELECT 1
                  FROM trapper.person_cat_relationships pcr
                  JOIN trapper.cat_identifiers ci ON ci.cat_id = pcr.cat_id
                  WHERE pcr.person_id = p.person_id
                    AND ci.id_type = 'microchip'
                    AND LOWER(ci.id_value) LIKE v_query_pattern
              )
          )

        UNION ALL

        -- ========== PLACES ==========
        SELECT
            'place'::TEXT AS entity_type,
            pl.place_id::TEXT AS entity_id,
            pl.display_name,
            COALESCE(pl.place_kind::TEXT, 'place') || ' • ' || COALESCE(sa.locality, '') AS subtitle,
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
            END AS base_score,
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
            0 AS penalty,
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
            WHEN (r.base_score - r.penalty) >= 90 THEN 'strong'
            WHEN (r.base_score - r.penalty) >= 50 THEN 'medium'
            ELSE 'weak'
        END AS match_strength,
        r.match_reason,
        GREATEST(1, r.base_score - r.penalty)::NUMERIC AS score,
        r.metadata
    FROM ranked_results r
    WHERE r.base_score > 0
    -- NEW: When query is microchip-like, prioritize people (they're usually what staff want)
    ORDER BY
        CASE
            WHEN v_is_microchip_query AND r.entity_type = 'person' AND r.match_reason LIKE 'cat_microchip%' THEN 1000
            ELSE 0
        END + (r.base_score - r.penalty) DESC,
        r.display_name ASC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.search_unified IS
'Google-like search across cats, people, and places.

NEW in MIG_144: People are now searchable by their cats'' microchips.
When searching for a microchip, the person who owns that cat appears FIRST.

SCORING:
  - Score 90+: strong (exact/prefix match)
  - Score 50-89: medium (tokens/similarity)
  - Score <50: weak (ILIKE fallback)

MICROCHIP PRIORITY:
  - When query looks like microchip (10+ digits), people matched via cat microchip
    are prioritized over the cat record itself (staff usually want the person).

Metadata now includes:
  - clinichq_cat_count: How many of their cats have been to clinic
  - matched_via_microchip: Boolean indicating if person was found via cat microchip';

-- ============================================================
-- Verification
-- ============================================================

SELECT 'MIG_144 Complete' AS status;

\echo ''
\echo 'Testing microchip search (person should appear FIRST now):'
SELECT entity_type, display_name, match_reason, score::INT
FROM trapper.search_unified('981020053084012', NULL, 10, 0)
ORDER BY score DESC;
