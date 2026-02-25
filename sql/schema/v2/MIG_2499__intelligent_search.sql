-- MIG_2499__intelligent_search.sql
-- Intelligent Search with Clinic Account Aliases, Abbreviation Expansion, and Intent Detection
--
-- Problem: Searching "old stony pt rd" doesn't find the place at 2384 Stony Point Rd
--          because search only queries sot.places, not ops.clinic_accounts aliases.
--
-- Solution:
--   1. JOIN clinic_accounts to places so site_name/address accounts are searchable
--   2. Add abbreviation expansion (Pt → Point, Rd → Road)
--   3. Add query intent detection (boost place results for address patterns)
--   4. Show "Also known as: X" when matched via clinic account alias
--
-- Based on: docs/plans/intelligent-search-plan.md
-- Created: 2026-02-25

\echo ''
\echo '=============================================='
\echo '  MIG_2499: Intelligent Search System'
\echo '=============================================='
\echo ''

-- ============================================================================
-- PART 1: SEARCH ABBREVIATIONS TABLE
-- ============================================================================

\echo '1. Creating search abbreviations table...'

CREATE TABLE IF NOT EXISTS sot.search_abbreviations (
    abbrev TEXT PRIMARY KEY,
    expansion TEXT NOT NULL,
    category TEXT DEFAULT 'street'  -- street, direction, misc
);

COMMENT ON TABLE sot.search_abbreviations IS
'Street and direction abbreviation expansions for search normalization.
Used by sot.expand_abbreviations() to match "Pt" with "Point", etc.';

-- Seed with common street abbreviations
INSERT INTO sot.search_abbreviations (abbrev, expansion, category) VALUES
    -- Street types
    ('rd', 'road', 'street'),
    ('st', 'street', 'street'),
    ('ave', 'avenue', 'street'),
    ('blvd', 'boulevard', 'street'),
    ('dr', 'drive', 'street'),
    ('ln', 'lane', 'street'),
    ('ct', 'court', 'street'),
    ('pl', 'place', 'street'),
    ('pt', 'point', 'street'),
    ('hwy', 'highway', 'street'),
    ('pkwy', 'parkway', 'street'),
    ('cir', 'circle', 'street'),
    ('trl', 'trail', 'street'),
    ('ter', 'terrace', 'street'),
    ('way', 'way', 'street'),
    -- Directions
    ('n', 'north', 'direction'),
    ('s', 'south', 'direction'),
    ('e', 'east', 'direction'),
    ('w', 'west', 'direction'),
    ('ne', 'northeast', 'direction'),
    ('nw', 'northwest', 'direction'),
    ('se', 'southeast', 'direction'),
    ('sw', 'southwest', 'direction')
ON CONFLICT (abbrev) DO NOTHING;

\echo '   Created sot.search_abbreviations with ' || (SELECT COUNT(*) FROM sot.search_abbreviations) || ' entries';

-- ============================================================================
-- PART 2: ABBREVIATION EXPANSION FUNCTION
-- ============================================================================

\echo ''
\echo '2. Creating expand_abbreviations function...'

CREATE OR REPLACE FUNCTION sot.expand_abbreviations(p_query TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_result TEXT := LOWER(TRIM(p_query));
    r RECORD;
BEGIN
    -- Replace word-boundary abbreviations with their expansions
    -- Uses \m and \M for word boundaries (PostgreSQL regex)
    FOR r IN SELECT abbrev, expansion FROM sot.search_abbreviations LOOP
        v_result := regexp_replace(v_result, '\m' || r.abbrev || '\M', r.expansion, 'gi');
    END LOOP;
    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION sot.expand_abbreviations IS
'Expands common street/direction abbreviations for search matching.
Example: "old stony pt rd" → "old stony point road"

Used in search to match abbreviated queries against full addresses.';

-- Test the function
\echo ''
\echo '   Testing expand_abbreviations:'
SELECT
    test_query,
    sot.expand_abbreviations(test_query) as expanded
FROM (VALUES
    ('old stony pt rd'),
    ('123 main st'),
    ('n main ave'),
    ('2384 stony point road')
) AS t(test_query);

-- ============================================================================
-- PART 3: QUERY INTENT DETECTION FUNCTION
-- ============================================================================

\echo ''
\echo '3. Creating detect_query_intent function...'

CREATE OR REPLACE FUNCTION sot.detect_query_intent(p_query TEXT)
RETURNS TEXT  -- Returns 'place', 'person', 'cat', or 'unknown'
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_lower TEXT := LOWER(TRIM(p_query));
BEGIN
    -- =========================
    -- PLACE SIGNALS (strongest)
    -- =========================

    -- Starts with number (likely address)
    IF v_lower ~ '^\d+\s+\w' THEN RETURN 'place'; END IF;

    -- Contains street abbreviations
    IF v_lower ~ '\m(rd|st|ave|blvd|dr|ln|ct|way|hwy|pkwy|cir|trl)\M' THEN RETURN 'place'; END IF;

    -- Contains site name keywords
    IF v_lower ~ '\m(ranch|farm|vineyard|winery|estate|estates|park|trail|colony|site|location)\M' THEN RETURN 'place'; END IF;

    -- Contains point/road/avenue etc (expanded forms)
    IF v_lower ~ '\m(road|street|avenue|boulevard|drive|lane|court|highway)\M' THEN RETURN 'place'; END IF;

    -- =========================
    -- CAT SIGNALS
    -- =========================

    -- Microchip pattern (9-15 digits)
    IF v_lower ~ '^\d{9,15}$' THEN RETURN 'cat'; END IF;

    -- ClinicHQ ID pattern (e.g., 21-118, 23-001)
    IF v_lower ~ '^\d{2}-\d{3,4}$' THEN RETURN 'cat'; END IF;

    -- =========================
    -- PERSON SIGNALS (weakest - most names could be anything)
    -- =========================

    -- Two words, short length, no place indicators
    IF v_lower ~ '^[a-z]+\s+[a-z]+$' AND LENGTH(v_lower) < 30 THEN
        -- But check if it looks like a place first
        IF NOT (v_lower ~ '\m(ranch|farm|center|plaza|court|manor|generation|supply|depot)\M') THEN
            RETURN 'person';
        END IF;
    END IF;

    RETURN 'unknown';
END;
$$;

COMMENT ON FUNCTION sot.detect_query_intent IS
'Detects likely query intent based on pattern matching.

Returns:
- "place": Query contains address patterns, street abbreviations, site keywords
- "cat": Query looks like microchip number or ClinicHQ ID
- "person": Query looks like a two-word name
- "unknown": No clear pattern detected

Used to boost relevant entity types in search results.';

-- Test the function
\echo ''
\echo '   Testing detect_query_intent:'
SELECT
    test_query,
    sot.detect_query_intent(test_query) as detected_intent
FROM (VALUES
    ('old stony pt rd'),
    ('silveira ranch'),
    ('123 main st'),
    ('john smith'),
    ('21-118'),
    ('985112006530498'),
    ('grow generation'),
    ('petaluma')
) AS t(test_query);

-- ============================================================================
-- PART 4: CREATE TRIGRAM INDEX ON CLINIC_ACCOUNTS DISPLAY_NAME
-- ============================================================================

\echo ''
\echo '4. Creating trigram index on clinic_accounts display_name...'

-- Ensure index exists for fuzzy matching
CREATE INDEX IF NOT EXISTS idx_clinic_accounts_display_name_search_trgm
ON ops.clinic_accounts USING gin (display_name gin_trgm_ops)
WHERE merged_into_account_id IS NULL
  AND account_type IN ('site_name', 'address');

\echo '   Index created';

-- ============================================================================
-- PART 5: UPDATED SEARCH_UNIFIED WITH ALIAS MATCHING
-- ============================================================================

\echo ''
\echo '5. Updating search_unified function with alias matching...'

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
    v_query_expanded TEXT := sot.expand_abbreviations(p_query);
    v_query_pattern TEXT := '%' || v_query_lower || '%';
    v_query_prefix TEXT := v_query_lower || '%';
    v_expanded_pattern TEXT := '%' || v_query_expanded || '%';
    v_tokens TEXT[];
    v_intent TEXT := sot.detect_query_intent(p_query);
    v_intent_boost INT := 0;
BEGIN
    -- Set intent boost
    v_intent_boost := CASE v_intent WHEN 'unknown' THEN 0 ELSE 15 END;

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
            END
            -- Add intent boost for cat queries
            + CASE WHEN v_intent = 'cat' THEN v_intent_boost ELSE 0 END
            AS score,
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
            END
            -- Add intent boost for person queries
            + CASE WHEN v_intent = 'person' THEN v_intent_boost ELSE 0 END
            AS score,
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
        WHERE p.merged_into_person_id IS NULL
          AND COALESCE(p.data_quality, 'normal') NOT IN ('garbage', 'needs_review')
          AND (p_type IS NULL OR p_type = 'person')
          AND (
              LOWER(p.display_name) LIKE v_query_pattern
              OR similarity(p.display_name, p_query) >= 0.3
          )

        UNION ALL

        -- ========== PLACES (with clinic account alias matching) ==========
        SELECT
            'place'::TEXT AS entity_type,
            pl.place_id::TEXT AS entity_id,
            pl.display_name,
            -- If matched via alias, show it in subtitle
            CASE
                WHEN ca.display_name IS NOT NULL
                     AND (LOWER(ca.display_name) LIKE v_query_pattern
                          OR LOWER(ca.display_name) LIKE v_expanded_pattern
                          OR similarity(ca.display_name, p_query) >= 0.3)
                THEN 'Also known as: ' || ca.display_name || ' - ' || COALESCE(sa.city, '')
                ELSE COALESCE(pl.place_kind::TEXT, 'place') || ' - ' || COALESCE(sa.city, '')
            END AS subtitle,
            -- Score: MAX of place score OR alias score (with popularity boost)
            GREATEST(
                -- Place name/address scoring
                CASE
                    WHEN LOWER(pl.display_name) = v_query_lower THEN 100
                    WHEN LOWER(pl.formatted_address) = v_query_lower THEN 99
                    WHEN LOWER(pl.display_name) = v_query_expanded THEN 98
                    WHEN LOWER(pl.formatted_address) = v_query_expanded THEN 97
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
                    -- Expanded query matching
                    WHEN LOWER(pl.formatted_address) LIKE v_expanded_pattern THEN 50
                    WHEN LOWER(pl.display_name) LIKE v_query_pattern THEN 40
                    WHEN LOWER(pl.formatted_address) LIKE v_query_pattern THEN 35
                    WHEN LOWER(sa.city) LIKE v_query_pattern THEN 30
                    ELSE 0
                END,
                -- Clinic account alias scoring (with popularity boost from appointment_count)
                CASE
                    WHEN ca.display_name IS NOT NULL AND LOWER(ca.display_name) = v_query_lower
                        THEN 100 + LEAST(COALESCE(ca.appointment_count, 0), 20)
                    WHEN ca.display_name IS NOT NULL AND LOWER(ca.display_name) = v_query_expanded
                        THEN 98 + LEAST(COALESCE(ca.appointment_count, 0), 18)
                    WHEN ca.display_name IS NOT NULL AND LOWER(ca.display_name) LIKE v_query_prefix
                        THEN 95 + LEAST(COALESCE(ca.appointment_count, 0), 15)
                    WHEN ca.display_name IS NOT NULL AND similarity(ca.display_name, p_query) >= 0.5
                        THEN 60 + (similarity(ca.display_name, p_query) * 30)::INT + LEAST(COALESCE(ca.appointment_count, 0), 10)
                    WHEN ca.display_name IS NOT NULL AND LOWER(ca.display_name) LIKE v_query_pattern
                        THEN 40 + LEAST(COALESCE(ca.appointment_count, 0), 10)
                    WHEN ca.display_name IS NOT NULL AND LOWER(ca.display_name) LIKE v_expanded_pattern
                        THEN 45 + LEAST(COALESCE(ca.appointment_count, 0), 10)
                    ELSE 0
                END
            )
            -- Add intent boost for place queries
            + CASE WHEN v_intent = 'place' THEN v_intent_boost ELSE 0 END
            AS score,
            -- Match reason
            CASE
                -- Alias matches take precedence in match_reason when alias score is higher
                WHEN ca.display_name IS NOT NULL AND (
                    LOWER(ca.display_name) = v_query_lower
                    OR LOWER(ca.display_name) = v_query_expanded
                    OR LOWER(ca.display_name) LIKE v_query_prefix
                    OR LOWER(ca.display_name) LIKE v_query_pattern
                    OR LOWER(ca.display_name) LIKE v_expanded_pattern
                    OR similarity(ca.display_name, p_query) >= 0.3
                ) THEN 'alias_match'
                WHEN LOWER(pl.display_name) = v_query_lower THEN 'exact_name'
                WHEN LOWER(pl.formatted_address) = v_query_lower THEN 'exact_address'
                WHEN LOWER(pl.display_name) LIKE v_query_prefix THEN 'prefix_name'
                WHEN LOWER(pl.formatted_address) LIKE v_query_prefix THEN 'prefix_address'
                WHEN similarity(pl.display_name, p_query) >= 0.5 THEN 'similar_name'
                WHEN similarity(pl.formatted_address, p_query) >= 0.5 THEN 'similar_address'
                WHEN LOWER(pl.formatted_address) LIKE v_expanded_pattern THEN 'expanded_address'
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
                'is_address_backed', pl.is_address_backed,
                -- Alias metadata (when matched via clinic account)
                'alias_matched', ca.display_name IS NOT NULL AND (
                    LOWER(ca.display_name) LIKE v_query_pattern
                    OR LOWER(ca.display_name) LIKE v_expanded_pattern
                    OR similarity(ca.display_name, p_query) >= 0.3
                ),
                'alias_name', ca.display_name,
                'alias_appointment_count', ca.appointment_count
            ) AS metadata
        FROM sot.places pl
        LEFT JOIN sot.addresses sa ON sa.address_id = pl.sot_address_id
        -- JOIN clinic accounts that resolve to this place (site_name or address type)
        LEFT JOIN ops.clinic_accounts ca ON ca.resolved_place_id = pl.place_id
            AND ca.merged_into_account_id IS NULL
            AND ca.account_type IN ('site_name', 'address')
        WHERE pl.merged_into_place_id IS NULL
          AND COALESCE(pl.quality_tier, 'good') NOT IN ('garbage', 'needs_review')
          AND (p_type IS NULL OR p_type = 'place')
          AND (
              -- Match on place fields
              LOWER(pl.display_name) LIKE v_query_pattern
              OR LOWER(pl.formatted_address) LIKE v_query_pattern
              OR LOWER(sa.city) LIKE v_query_pattern
              OR similarity(pl.display_name, p_query) >= 0.3
              OR similarity(pl.formatted_address, p_query) >= 0.3
              -- Match on expanded query (abbreviation handling)
              OR LOWER(pl.formatted_address) LIKE v_expanded_pattern
              -- OR match on clinic account alias
              OR (ca.display_name IS NOT NULL AND LOWER(ca.display_name) LIKE v_query_pattern)
              OR (ca.display_name IS NOT NULL AND LOWER(ca.display_name) LIKE v_expanded_pattern)
              OR (ca.display_name IS NOT NULL AND similarity(ca.display_name, p_query) >= 0.3)
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
'V2 Intelligent search across cats, people, and places.

Features:
- Clinic account alias matching (site_name, address accounts)
- Abbreviation expansion (Pt → Point, Rd → Road)
- Query intent detection (boosts relevant entity types)
- Popularity boost from appointment_count

Returns ranked results with match strength and reason.
Score 90+: strong, 50-89: medium, <50: weak.

Respects INV-13: filters garbage/needs_review data.';

-- ============================================================================
-- PART 6: VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  MIG_2499 Verification'
\echo '=============================================='

\echo ''
\echo '6.1 Testing "old stony pt rd" search (should find alias match):'
SELECT
    entity_type,
    display_name,
    subtitle,
    match_strength,
    match_reason,
    score,
    metadata->>'alias_matched' as alias_matched,
    metadata->>'alias_name' as alias_name
FROM sot.search_unified('old stony pt rd', 'place', 5, 0);

\echo ''
\echo '6.2 Testing "silveira ranch" search:'
SELECT
    entity_type,
    display_name,
    subtitle,
    match_strength,
    match_reason,
    score
FROM sot.search_unified('silveira ranch', 'place', 5, 0);

\echo ''
\echo '6.3 Testing "stony point" (abbreviation expansion):'
SELECT
    entity_type,
    display_name,
    subtitle,
    match_strength,
    match_reason,
    score
FROM sot.search_unified('stony point', 'place', 5, 0);

\echo ''
\echo '6.4 Testing "grow generation" search:'
SELECT
    entity_type,
    display_name,
    subtitle,
    match_strength,
    match_reason,
    score
FROM sot.search_unified('grow generation', NULL, 5, 0);

\echo ''
\echo '6.5 Testing intent detection boost (21-118 should detect as cat):'
SELECT
    entity_type,
    display_name,
    subtitle,
    match_strength,
    match_reason,
    score,
    sot.detect_query_intent('21-118') as detected_intent
FROM sot.search_unified('21-118', NULL, 5, 0);

\echo ''
\echo '6.6 Checking clinic accounts with resolved places that can now be searched:'
SELECT
    ca.display_name as alias,
    ca.account_type,
    ca.appointment_count,
    pl.display_name as resolved_place,
    pl.formatted_address
FROM ops.clinic_accounts ca
JOIN sot.places pl ON pl.place_id = ca.resolved_place_id
WHERE ca.merged_into_account_id IS NULL
  AND ca.account_type IN ('site_name', 'address')
ORDER BY ca.appointment_count DESC NULLS LAST
LIMIT 10;

\echo ''
\echo '=============================================='
\echo '  MIG_2499 Complete'
\echo '=============================================='
\echo ''
\echo 'Intelligent Search System installed:'
\echo '  1. sot.search_abbreviations table - street/direction abbreviations'
\echo '  2. sot.expand_abbreviations() - expands Pt→Point, Rd→Road, etc.'
\echo '  3. sot.detect_query_intent() - detects place/person/cat intent'
\echo '  4. sot.search_unified() - now includes clinic account alias matching'
\echo ''
\echo 'Key improvements:'
\echo '  - "old stony pt rd" now finds 2384 Stony Point Rd via alias'
\echo '  - Site names like "Silveira Ranch" are searchable'
\echo '  - Intent boost: address patterns boost place results'
\echo '  - Popularity boost: high-appointment sites rank higher'
\echo ''
