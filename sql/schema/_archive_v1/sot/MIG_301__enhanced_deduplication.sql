-- MIG_301: Enhanced Deduplication System
--
-- Implements industry best practices for entity deduplication:
-- 1. Double Metaphone (better phonetic matching than Soundex)
-- 2. Name frequency weighting (common names contribute less)
-- 3. Enhanced address normalization with PostgreSQL-correct word boundaries
-- 4. Improved duplicate detection views with blocking for performance
-- 5. High-priority duplicates view for actionable results
--
-- Based on: docs/TECHNICAL_DEDUPLICATION.md
-- References: Splink (Fellegi-Sunter), libpostal patterns
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_301__enhanced_deduplication.sql

\echo ''
\echo '=============================================='
\echo 'MIG_301: Enhanced Deduplication System'
\echo '=============================================='
\echo ''

-- Ensure extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- ============================================
-- PART 1: Name Frequency Table
-- ============================================
\echo 'Creating name frequency table...'

CREATE TABLE IF NOT EXISTS trapper.name_frequencies (
    name_part TEXT PRIMARY KEY,
    name_type TEXT NOT NULL DEFAULT 'last',
    frequency INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.name_frequencies IS
'Frequency counts for names to weight matching (common names like Smith weighted lower)';

-- Populate from existing data - last names
INSERT INTO trapper.name_frequencies (name_part, name_type, frequency)
SELECT
    LOWER(TRIM(SPLIT_PART(display_name, ' ', 2))) AS name_part,
    'last' AS name_type,
    COUNT(*) AS frequency
FROM trapper.sot_people
WHERE display_name IS NOT NULL
  AND TRIM(SPLIT_PART(display_name, ' ', 2)) != ''
  AND merged_into_person_id IS NULL
GROUP BY 1
HAVING COUNT(*) >= 2
ON CONFLICT (name_part) DO UPDATE SET
    frequency = EXCLUDED.frequency,
    updated_at = NOW();

-- Populate first names
INSERT INTO trapper.name_frequencies (name_part, name_type, frequency)
SELECT
    LOWER(TRIM(SPLIT_PART(display_name, ' ', 1))) AS name_part,
    'first' AS name_type,
    COUNT(*) AS frequency
FROM trapper.sot_people
WHERE display_name IS NOT NULL
  AND TRIM(SPLIT_PART(display_name, ' ', 1)) != ''
  AND merged_into_person_id IS NULL
GROUP BY 1
HAVING COUNT(*) >= 2
ON CONFLICT (name_part) DO UPDATE SET
    frequency = GREATEST(trapper.name_frequencies.frequency, EXCLUDED.frequency),
    updated_at = NOW();

\echo 'Populated name frequencies'

-- ============================================
-- PART 2: Name Frequency Weight Function
-- ============================================
\echo 'Creating name weight function...'

CREATE OR REPLACE FUNCTION trapper.get_name_weight(p_name TEXT)
RETURNS FLOAT AS $$
DECLARE
    v_freq INT;
    v_max_freq INT;
BEGIN
    SELECT frequency INTO v_freq
    FROM trapper.name_frequencies
    WHERE name_part = LOWER(TRIM(p_name));

    SELECT MAX(frequency) INTO v_max_freq FROM trapper.name_frequencies;

    IF v_freq IS NULL OR v_max_freq IS NULL OR v_max_freq = 0 THEN
        RETURN 1.0;
    END IF;

    RETURN GREATEST(0.3, 1.0 - 0.7 * (LN(v_freq + 1) / LN(v_max_freq + 1)));
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.get_name_weight IS
'Returns weight for a name (0.3-1.0). Common names like Smith = ~0.3, rare names = ~1.0';

-- ============================================
-- PART 3: Enhanced Address Normalization
-- ============================================
\echo 'Creating enhanced address normalization...'

-- NOTE: PostgreSQL uses [[:<:]] and [[:>:]] for word boundaries, NOT \b
CREATE OR REPLACE FUNCTION trapper.normalize_address_enhanced(p_address TEXT)
RETURNS TEXT AS $$
DECLARE
    v_result TEXT;
BEGIN
    IF p_address IS NULL OR TRIM(p_address) = '' THEN
        RETURN NULL;
    END IF;

    v_result := LOWER(TRIM(p_address));

    -- Street type standardization (PostgreSQL word boundaries)
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]street[[:>:]]', 'st', 'gi');
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]st\.[[:>:]]', 'st', 'gi');
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]avenue[[:>:]]', 'ave', 'gi');
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]ave\.[[:>:]]', 'ave', 'gi');
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]boulevard[[:>:]]', 'blvd', 'gi');
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]drive[[:>:]]', 'dr', 'gi');
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]road[[:>:]]', 'rd', 'gi');
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]lane[[:>:]]', 'ln', 'gi');
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]court[[:>:]]', 'ct', 'gi');
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]circle[[:>:]]', 'cir', 'gi');
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]place[[:>:]]', 'pl', 'gi');
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]terrace[[:>:]]', 'ter', 'gi');
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]highway[[:>:]]', 'hwy', 'gi');
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]parkway[[:>:]]', 'pkwy', 'gi');

    -- Direction standardization
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]north[[:>:]]', 'n', 'gi');
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]south[[:>:]]', 's', 'gi');
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]east[[:>:]]', 'e', 'gi');
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]west[[:>:]]', 'w', 'gi');

    -- Unit/apartment standardization
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]apartment[[:>:]]', 'apt', 'gi');
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]unit[[:>:]]', 'apt', 'gi');
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]suite[[:>:]]', 'ste', 'gi');
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]floor[[:>:]]', 'fl', 'gi');
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]building[[:>:]]', 'bldg', 'gi');

    -- Remove # after apt/ste (apt #4 -> apt 4)
    v_result := REGEXP_REPLACE(v_result, '(apt|ste)\s*#\s*', '\1 ', 'gi');

    -- Convert standalone # to apt
    v_result := REGEXP_REPLACE(v_result, '(\d+[a-z]?\s+[a-z]+\s+[a-z]+)\s*#\s*(\d)', '\1 apt \2', 'gi');

    -- State standardization
    v_result := REGEXP_REPLACE(v_result, '[[:<:]]california[[:>:]]', 'ca', 'gi');

    -- Remove extra punctuation and whitespace
    v_result := REGEXP_REPLACE(v_result, '[,.]', ' ', 'g');
    v_result := REGEXP_REPLACE(v_result, '\s+', ' ', 'g');
    v_result := TRIM(v_result);

    RETURN v_result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.normalize_address_enhanced IS
'Enhanced address normalization with USPS-style abbreviations. Uses PostgreSQL word boundaries.';

-- ============================================
-- PART 4: Double Metaphone Similarity
-- ============================================
\echo 'Creating double metaphone similarity function...'

-- Note: dmetaphone is in tiger schema (PostGIS geocoder)
CREATE OR REPLACE FUNCTION trapper.dmetaphone_similarity(s1 TEXT, s2 TEXT)
RETURNS FLOAT AS $$
DECLARE
    dm1_primary TEXT;
    dm1_alt TEXT;
    dm2_primary TEXT;
    dm2_alt TEXT;
BEGIN
    IF s1 IS NULL OR s2 IS NULL THEN
        RETURN 0.0;
    END IF;

    dm1_primary := tiger.dmetaphone(s1);
    dm1_alt := tiger.dmetaphone_alt(s1);
    dm2_primary := tiger.dmetaphone(s2);
    dm2_alt := tiger.dmetaphone_alt(s2);

    IF dm1_primary = dm2_primary THEN
        RETURN 1.0;
    ELSIF dm1_primary = dm2_alt OR dm1_alt = dm2_primary THEN
        RETURN 0.9;
    ELSIF dm1_alt = dm2_alt AND dm1_alt IS NOT NULL AND dm1_alt != '' THEN
        RETURN 0.8;
    END IF;

    RETURN 0.0;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.dmetaphone_similarity IS
'Compares two strings using Double Metaphone (better than Soundex for names)';

-- ============================================
-- PART 5: Combined Name Similarity Score
-- ============================================
\echo 'Creating combined name similarity function...'

CREATE OR REPLACE FUNCTION trapper.name_match_score(
    p_name1 TEXT,
    p_name2 TEXT
)
RETURNS TABLE (
    total_score FLOAT,
    trigram_score FLOAT,
    phonetic_score FLOAT,
    frequency_weight FLOAT,
    match_components JSONB
) AS $$
DECLARE
    v_first1 TEXT;
    v_last1 TEXT;
    v_first2 TEXT;
    v_last2 TEXT;
    v_trgm_score FLOAT;
    v_phonetic_first FLOAT;
    v_phonetic_last FLOAT;
    v_phonetic_score FLOAT;
    v_freq_weight FLOAT;
    v_total FLOAT;
BEGIN
    v_first1 := TRIM(SPLIT_PART(p_name1, ' ', 1));
    v_last1 := TRIM(SPLIT_PART(p_name1, ' ', 2));
    v_first2 := TRIM(SPLIT_PART(p_name2, ' ', 1));
    v_last2 := TRIM(SPLIT_PART(p_name2, ' ', 2));

    v_trgm_score := similarity(LOWER(p_name1), LOWER(p_name2));
    v_phonetic_first := trapper.dmetaphone_similarity(v_first1, v_first2);
    v_phonetic_last := trapper.dmetaphone_similarity(v_last1, v_last2);
    v_phonetic_score := (v_phonetic_first + v_phonetic_last) / 2.0;
    v_freq_weight := (trapper.get_name_weight(v_last1) + trapper.get_name_weight(v_last2)) / 2.0;

    v_total := (
        (v_trgm_score * 0.5) +
        (v_phonetic_score * 0.3) +
        (CASE WHEN v_trgm_score > 0.6 AND v_phonetic_score > 0.7 THEN 0.2 ELSE 0 END)
    ) * v_freq_weight;

    IF v_phonetic_last >= 0.9 THEN
        v_total := v_total + (0.1 * v_freq_weight);
    END IF;

    RETURN QUERY SELECT
        LEAST(v_total, 1.0)::FLOAT,
        v_trgm_score::FLOAT,
        v_phonetic_score::FLOAT,
        v_freq_weight::FLOAT,
        jsonb_build_object(
            'first1', v_first1,
            'last1', v_last1,
            'first2', v_first2,
            'last2', v_last2,
            'phonetic_first', v_phonetic_first,
            'phonetic_last', v_phonetic_last
        );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.name_match_score IS
'Comprehensive name matching using trigrams, double metaphone, and frequency weighting';

-- ============================================
-- PART 6: Enhanced Duplicate People View (with blocking)
-- ============================================
\echo 'Creating enhanced duplicate people view...'

CREATE OR REPLACE VIEW trapper.v_potential_duplicate_people AS
WITH name_parsed AS (
    SELECT
        person_id,
        display_name,
        TRIM(SPLIT_PART(display_name, ' ', 1)) AS first_name,
        TRIM(SPLIT_PART(display_name, ' ', 2)) AS last_name,
        tiger.dmetaphone(TRIM(SPLIT_PART(display_name, ' ', 1))) AS first_dm,
        tiger.dmetaphone(TRIM(SPLIT_PART(display_name, ' ', 2))) AS last_dm
    FROM trapper.sot_people
    WHERE merged_into_person_id IS NULL
      AND display_name IS NOT NULL
      AND TRIM(display_name) != ''
      AND trapper.is_valid_person_name(display_name)
      AND TRIM(SPLIT_PART(display_name, ' ', 2)) != ''
),
candidate_pairs AS (
    SELECT
        a.person_id AS person_id_a,
        a.display_name AS name_a,
        b.person_id AS person_id_b,
        b.display_name AS name_b,
        similarity(LOWER(a.display_name), LOWER(b.display_name)) AS trigram_sim,
        trapper.dmetaphone_similarity(a.first_name, b.first_name) AS first_phonetic,
        trapper.dmetaphone_similarity(a.last_name, b.last_name) AS last_phonetic,
        (trapper.get_name_weight(a.last_name) + trapper.get_name_weight(b.last_name)) / 2.0 AS name_weight
    FROM name_parsed a
    JOIN name_parsed b ON a.person_id < b.person_id
        -- BLOCKING: Same last name phonetically (reduces O(n^2) to manageable)
        AND a.last_dm = b.last_dm
)
SELECT
    cp.person_id_a,
    cp.name_a,
    cp.person_id_b,
    cp.name_b,
    ROUND(cp.trigram_sim::NUMERIC, 3) AS name_similarity,
    CASE
        WHEN cp.first_phonetic >= 0.8 AND cp.last_phonetic >= 0.8 THEN 'phonetic_both'
        WHEN cp.last_phonetic >= 0.8 THEN 'phonetic_last'
        WHEN cp.trigram_sim > 0.7 THEN 'high_similarity'
        ELSE 'partial'
    END AS match_reason,
    ROUND(cp.name_weight::NUMERIC, 2) AS name_rarity_weight,
    ROUND(((
        (cp.trigram_sim * 0.4) +
        ((cp.first_phonetic + cp.last_phonetic) / 2.0 * 0.4) +
        (CASE WHEN cp.last_phonetic >= 0.8 THEN 0.2 ELSE 0 END)
    ) * cp.name_weight)::NUMERIC, 3) AS combined_score,
    EXISTS (
        SELECT 1 FROM trapper.person_identifiers pi_a
        JOIN trapper.person_identifiers pi_b
            ON pi_a.id_type = pi_b.id_type AND pi_a.id_value_norm = pi_b.id_value_norm
        WHERE pi_a.person_id = cp.person_id_a AND pi_b.person_id = cp.person_id_b
    ) AS shares_identifier,
    EXISTS (
        SELECT 1 FROM trapper.person_place_relationships ppr_a
        JOIN trapper.person_place_relationships ppr_b ON ppr_a.place_id = ppr_b.place_id
        WHERE ppr_a.person_id = cp.person_id_a AND ppr_b.person_id = cp.person_id_b
    ) AS shares_place
FROM candidate_pairs cp
WHERE (cp.trigram_sim > 0.4 OR cp.first_phonetic >= 0.7)
  AND NOT (cp.name_weight < 0.4 AND cp.trigram_sim < 0.6)
ORDER BY shares_identifier DESC, combined_score DESC;

COMMENT ON VIEW trapper.v_potential_duplicate_people IS
'Potential duplicate people with phonetic blocking for performance. 21K+ candidates in typical dataset.';

-- ============================================
-- PART 7: High Priority Duplicates View
-- ============================================
\echo 'Creating high-priority duplicates view...'

CREATE OR REPLACE VIEW trapper.v_high_priority_duplicates AS
SELECT
    person_id_a,
    name_a,
    person_id_b,
    name_b,
    combined_score,
    match_reason,
    shares_identifier,
    shares_place,
    CASE
        WHEN name_a = name_b THEN 'exact_name'
        WHEN combined_score > 0.8 THEN 'very_high_score'
        WHEN shares_identifier THEN 'shared_identifier'
        WHEN shares_place AND combined_score > 0.5 THEN 'shared_place'
        ELSE 'review'
    END AS priority_reason
FROM trapper.v_potential_duplicate_people
WHERE
    name_a = name_b
    OR combined_score > 0.7
    OR shares_identifier
    OR (shares_place AND combined_score > 0.5)
ORDER BY
    CASE
        WHEN shares_identifier THEN 1
        WHEN name_a = name_b THEN 2
        WHEN combined_score > 0.8 THEN 3
        ELSE 4
    END,
    combined_score DESC;

COMMENT ON VIEW trapper.v_high_priority_duplicates IS
'High-priority duplicates for review/auto-merge. Priority: shared_identifier > exact_name > high_score';

-- ============================================
-- PART 8: Duplicate Places View
-- ============================================
\echo 'Creating enhanced duplicate places view...'

CREATE OR REPLACE VIEW trapper.v_potential_duplicate_places AS
WITH place_normalized AS (
    SELECT
        p.place_id,
        p.display_name,
        p.formatted_address,
        p.normalized_address,
        trapper.normalize_address_enhanced(p.formatted_address) AS enhanced_normalized,
        a.lat AS latitude,
        a.lng AS longitude
    FROM trapper.places p
    LEFT JOIN trapper.sot_addresses a ON p.sot_address_id = a.address_id
    WHERE p.merged_into_place_id IS NULL
      AND p.formatted_address IS NOT NULL
)
SELECT
    a.place_id AS place_id_a,
    a.display_name AS name_a,
    a.formatted_address AS address_a,
    b.place_id AS place_id_b,
    b.display_name AS name_b,
    b.formatted_address AS address_b,
    similarity(a.enhanced_normalized, b.enhanced_normalized) AS address_similarity,
    CASE
        WHEN a.latitude IS NOT NULL AND b.latitude IS NOT NULL THEN
            ROUND((
                6371000 * acos(
                    LEAST(1.0, GREATEST(-1.0,
                        cos(radians(a.latitude)) * cos(radians(b.latitude)) *
                        cos(radians(b.longitude) - radians(a.longitude)) +
                        sin(radians(a.latitude)) * sin(radians(b.latitude))
                    ))
                )
            )::NUMERIC, 0)
        ELSE NULL
    END AS distance_meters,
    CASE
        WHEN a.enhanced_normalized = b.enhanced_normalized THEN 'exact_match'
        WHEN similarity(a.enhanced_normalized, b.enhanced_normalized) > 0.9 THEN 'very_similar'
        WHEN similarity(a.enhanced_normalized, b.enhanced_normalized) > 0.7 THEN 'similar'
        ELSE 'partial'
    END AS match_type
FROM place_normalized a
JOIN place_normalized b ON a.place_id < b.place_id
WHERE
    a.enhanced_normalized = b.enhanced_normalized
    OR similarity(a.enhanced_normalized, b.enhanced_normalized) > 0.85
    OR (
        a.latitude IS NOT NULL AND b.latitude IS NOT NULL
        AND (
            6371000 * acos(
                LEAST(1.0, GREATEST(-1.0,
                    cos(radians(a.latitude)) * cos(radians(b.latitude)) *
                    cos(radians(b.longitude) - radians(a.longitude)) +
                    sin(radians(a.latitude)) * sin(radians(b.latitude))
                ))
            )
        ) < 50
    )
ORDER BY
    CASE WHEN a.enhanced_normalized = b.enhanced_normalized THEN 0 ELSE 1 END,
    address_similarity DESC;

COMMENT ON VIEW trapper.v_potential_duplicate_places IS
'Potential duplicate places using enhanced normalization and coordinate proximity (<50m)';

-- ============================================
-- PART 9: Stats Function
-- ============================================
\echo 'Creating deduplication stats function...'

CREATE OR REPLACE FUNCTION trapper.get_dedup_stats()
RETURNS TABLE (
    entity_type TEXT,
    total_records BIGINT,
    potential_duplicates BIGINT,
    high_confidence_dupes BIGINT,
    exact_name_dupes BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        'people'::TEXT,
        (SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL),
        (SELECT COUNT(*) FROM trapper.v_potential_duplicate_people),
        (SELECT COUNT(*) FROM trapper.v_high_priority_duplicates),
        (SELECT COUNT(*) FROM trapper.v_high_priority_duplicates WHERE priority_reason = 'exact_name');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.get_dedup_stats IS
'Returns summary statistics for deduplication candidates';

-- ============================================
-- PART 10: Indexes
-- ============================================
\echo 'Creating indexes...'

CREATE INDEX IF NOT EXISTS idx_people_display_name_trgm
    ON trapper.sot_people USING gin (LOWER(display_name) gin_trgm_ops)
    WHERE merged_into_person_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_places_enhanced_normalized
    ON trapper.places USING gin (trapper.normalize_address_enhanced(formatted_address) gin_trgm_ops)
    WHERE merged_into_place_id IS NULL;

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '=============================================='
\echo 'MIG_301 Complete!'
\echo '=============================================='
\echo ''

\echo 'Testing address normalization:'
SELECT trapper.normalize_address_enhanced('123 Main Street, Apartment #4, Santa Rosa, California 95401') as test;

\echo ''
\echo 'Testing phonetic similarity:'
SELECT trapper.dmetaphone_similarity('Catherine', 'Katherine') as test1,
       trapper.dmetaphone_similarity('Smith', 'Smyth') as test2;

\echo ''
\echo 'Name frequency weights (top 5 most common):'
SELECT name_part, frequency, ROUND(trapper.get_name_weight(name_part)::NUMERIC, 3) as weight
FROM trapper.name_frequencies
ORDER BY frequency DESC
LIMIT 5;

\echo ''
\echo 'High-priority duplicate summary:'
SELECT priority_reason, COUNT(*) as count
FROM trapper.v_high_priority_duplicates
GROUP BY priority_reason
ORDER BY count DESC;
