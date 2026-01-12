-- MIG_048__search_ranking_penalties.sql
-- Search Ranking Penalties for Empty Records
--
-- ISSUE: Records with no meaningful data (like "William Broyles" with no cats,
--        places, or contact info) rank equally high as rich records
--
-- SOLUTION: Apply penalties to "empty" records unless exact match
--
-- PENALTY RULES (documented for agentic LLM discovery):
--   - Person with 0 cats + 0 places: -30 points penalty
--   - Person with no identifiers (email/phone): -10 points penalty
--   - Exception: Exact name matches (score=100) receive NO penalty
--   - Minimum score floor: 1 (never fully hide, just rank lower)
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_048__search_ranking_penalties.sql

\echo '============================================'
\echo 'MIG_048: Search Ranking Penalties'
\echo '============================================'

-- ============================================
-- PART 1: Update search_unified Function
-- ============================================
\echo ''
\echo 'Updating search_unified function with ranking penalties...'

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
            -- Base scoring logic
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
            END AS base_score,
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
            -- Penalty calculation for cats (no penalties currently)
            0 AS penalty,
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

        -- ========== PEOPLE (with penalties for empty records) ==========
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
            -- Base scoring logic
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
            END AS base_score,
            CASE
                WHEN LOWER(p.display_name) = v_query_lower THEN 'exact_name'
                WHEN LOWER(p.display_name) LIKE v_query_prefix THEN 'prefix_name'
                WHEN similarity(p.display_name, p_query) >= 0.5 THEN 'similar_name'
                WHEN LOWER(p.display_name) LIKE v_query_pattern THEN 'contains_name'
                ELSE 'trigram'
            END AS match_reason,
            -- ========== PENALTY RULES FOR PEOPLE ==========
            -- RULE 1: If exact match (base_score=100), NO penalty
            -- RULE 2: No cats AND no places = -30 penalty ("shell record")
            -- RULE 3: No identifiers (email/phone) = -10 penalty
            -- RULE 4: Floor at 1 (never completely hide)
            CASE
                -- Exact matches get no penalty
                WHEN LOWER(p.display_name) = v_query_lower THEN 0
                ELSE
                    -- Shell record penalty (no cats AND no places)
                    (CASE WHEN (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id) = 0
                               AND (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id) = 0
                          THEN 30
                          ELSE 0
                     END)
                    +
                    -- No identifiers penalty
                    (CASE WHEN NOT EXISTS (SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id)
                          THEN 10
                          ELSE 0
                     END)
            END AS penalty,
            jsonb_build_object(
                'cat_count', (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id),
                'place_count', (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id),
                'has_identifiers', EXISTS (SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id),
                'is_merged', p.merged_into_person_id IS NOT NULL,
                'is_empty', (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id) = 0
                            AND (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id) = 0
                            AND NOT EXISTS (SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id)
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
            -- No penalties for places currently
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
        -- Apply penalty with floor at 1
        GREATEST(1, r.base_score - r.penalty)::NUMERIC AS score,
        r.metadata
    FROM ranked_results r
    WHERE r.base_score > 0
    ORDER BY (r.base_score - r.penalty) DESC, r.display_name ASC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.search_unified IS
'Google-like search across cats, people, and places with ranking penalties.

SCORING:
  - Score 90+: strong (exact/prefix match)
  - Score 50-89: medium (tokens/similarity)
  - Score <50: weak (ILIKE fallback)

PENALTY RULES (apply to non-exact matches):
  - Person with 0 cats + 0 places: -30 points ("shell record")
  - Person with no identifiers: -10 points
  - Exact matches (score=100) receive NO penalty
  - Minimum score floor: 1 (records still appear, just ranked lower)

Use p_type to filter by entity type (cat/person/place).
Metadata includes is_empty flag for UI indication.';

-- ============================================
-- PART 2: Documentation View
-- ============================================
\echo ''
\echo 'Creating search ranking rules documentation view...'

CREATE OR REPLACE VIEW trapper.v_search_ranking_rules AS
SELECT
    'person_shell_record' AS rule_id,
    'Person with 0 cats AND 0 places' AS condition,
    -30 AS penalty_points,
    'Shell records should rank lower than people with relationships' AS rationale,
    'Exact name match exempted' AS exemption
UNION ALL SELECT
    'person_no_identifiers', 'Person with no email or phone', -10,
    'Records without contact info are less useful', 'Exact name match exempted'
UNION ALL SELECT
    'exact_match_exemption', 'Any record with exact name match (score=100)', 0,
    'User searching for exact name probably wants that specific record', 'N/A'
UNION ALL SELECT
    'minimum_score_floor', 'All records after penalty applied', 1,
    'Never completely hide records, just rank them lower', 'N/A';

COMMENT ON VIEW trapper.v_search_ranking_rules IS
'Documents search ranking penalty rules. Query this view to understand how search ranking works.
For agentic LLM discovery: SELECT * FROM trapper.v_search_ranking_rules;';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_048 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Search ranking rules:'
SELECT * FROM trapper.v_search_ranking_rules;

\echo ''
\echo 'Test: Search for common name, check for empty records:'
SELECT
    entity_type,
    display_name,
    match_reason,
    score,
    metadata->>'cat_count' AS cat_count,
    metadata->>'place_count' AS place_count,
    metadata->>'is_empty' AS is_empty
FROM trapper.search_unified('smith', 'person', 10, 0);

\echo ''
\echo 'Test: Exact match should not be penalized:'
-- Find a person with few relationships and search by exact name
SELECT
    p.display_name,
    (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id) AS cat_count,
    (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id) AS place_count
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
ORDER BY cat_count ASC, place_count ASC
LIMIT 3;

\echo ''
\echo 'MIG_048 applied. Empty records now rank lower unless exact match.'
\echo ''
