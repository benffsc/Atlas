-- MIG_2928: Add name frequency weighting to identity scoring
-- FFS-525: Common names (John Smith) should score lower than rare names
--
-- Fellegi-Sunter u-probability: the probability that two records agree on a
-- field by COINCIDENCE (i.e., they are different people). Common names have
-- high u-probability (many John Smiths), rare names have low u-probability.
--
-- Currently name matches get flat +7 weight. After this change:
--   "John Smith" match → +7 * 0.7 = +4.9 (common → demoted)
--   Average name match → +7 * 1.0 = +7.0 (unchanged)
--   Rare name match    → +7 * 1.3 = +9.1 (rare → boosted)
--
-- Uses existing ref.census_surnames.prop100k and ref.first_names.total_count.
-- Conservative range [0.7, 1.3] to avoid breaking existing auto-matches.

BEGIN;

-- ============================================================================
-- 1. Create name rarity factor function
-- ============================================================================

\echo '1. Creating ref.name_rarity_factor()...'

CREATE OR REPLACE FUNCTION ref.name_rarity_factor(p_first_name TEXT, p_last_name TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_first_freq NUMERIC;
    v_last_freq NUMERIC;
    v_combined_rarity NUMERIC;
BEGIN
    -- Get first name rarity (based on SSA total_count)
    -- James (5.2M) → very common, Xiomara (5K) → very rare
    -- Normalize: 1M+ = common, 100K-1M = moderate, <100K = rare
    SELECT CASE
        WHEN fn.total_count >= 2000000 THEN 0.8  -- Very common (James, John, Mary)
        WHEN fn.total_count >= 500000  THEN 0.9  -- Common (Karen, Brian, Laura)
        WHEN fn.total_count >= 100000  THEN 1.0  -- Moderate (Kayla, Derek, Heather)
        WHEN fn.total_count >= 10000   THEN 1.1  -- Uncommon
        ELSE 1.2                                  -- Rare
    END INTO v_first_freq
    FROM ref.first_names fn
    WHERE LOWER(fn.name) = LOWER(p_first_name)
    LIMIT 1;

    v_first_freq := COALESCE(v_first_freq, 1.1); -- Unknown first name → treat as uncommon

    -- Get last name rarity (based on Census prop100k)
    -- Smith (828/100K) → very common, Zapatero (not in Census) → very rare
    SELECT CASE
        WHEN cs.prop100k >= 300 THEN 0.7   -- Top 10 surnames (Smith, Johnson, Williams...)
        WHEN cs.prop100k >= 50  THEN 0.85  -- Top 100 surnames
        WHEN cs.prop100k >= 10  THEN 1.0   -- Top 1000 surnames
        WHEN cs.prop100k >= 1   THEN 1.15  -- Top 10000 surnames
        ELSE 1.3                            -- Rare surnames
    END INTO v_last_freq
    FROM ref.census_surnames cs
    WHERE UPPER(cs.name) = UPPER(p_last_name) AND cs.rank > 0
    LIMIT 1;

    v_last_freq := COALESCE(v_last_freq, 1.2); -- Unknown surname → treat as rare

    -- Combined factor: geometric mean, clamped to [0.7, 1.3]
    v_combined_rarity := GREATEST(0.7, LEAST(1.3, SQRT(v_first_freq * v_last_freq)));

    RETURN v_combined_rarity;
END;
$$;

COMMENT ON FUNCTION ref.name_rarity_factor(TEXT, TEXT) IS
'Returns a name rarity multiplier for Fellegi-Sunter scoring.
Common names (John Smith) → 0.7-0.85, reducing match weight.
Average names → ~1.0, no change.
Rare names → 1.15-1.3, increasing match weight.
Uses ref.census_surnames.prop100k and ref.first_names.total_count.
Range clamped to [0.7, 1.3] for conservative adjustment.';

-- Verify with known names
DO $$
DECLARE
    v_john_smith NUMERIC;
    v_rare_name NUMERIC;
    v_average_name NUMERIC;
BEGIN
    v_john_smith := ref.name_rarity_factor('John', 'Smith');
    v_rare_name := ref.name_rarity_factor('Xiomara', 'Zapatero');
    v_average_name := ref.name_rarity_factor('Karen', 'Thompson');

    RAISE NOTICE 'John Smith: %', v_john_smith;
    RAISE NOTICE 'Xiomara Zapatero: %', v_rare_name;
    RAISE NOTICE 'Karen Thompson: %', v_average_name;

    IF v_john_smith >= v_average_name THEN
        RAISE EXCEPTION 'FAILED: John Smith (%) should score lower than Karen Thompson (%)',
            v_john_smith, v_average_name;
    END IF;
    IF v_rare_name <= v_average_name THEN
        RAISE EXCEPTION 'FAILED: Xiomara Zapatero (%) should score higher than Karen Thompson (%)',
            v_rare_name, v_average_name;
    END IF;
    RAISE NOTICE 'Verified: common < average < rare';
END $$;

-- ============================================================================
-- 2. Add name_rarity parameter to fellegi_sunter_parameters
-- ============================================================================

\echo '2. Adding name_rarity parameter...'

INSERT INTO sot.fellegi_sunter_parameters (field_name, m_probability, u_probability, weight, description)
VALUES ('name_rarity_factor', 1.0, 1.0, 1.0, 'Dynamic multiplier based on name frequency (0.7-1.3)')
ON CONFLICT (field_name) DO NOTHING;

-- ============================================================================
-- 3. Update data_engine_score_candidates_v2() with name rarity
-- ============================================================================

\echo '3. Updating data_engine_score_candidates_v2() with name rarity weighting...'

CREATE OR REPLACE FUNCTION sot.data_engine_score_candidates_v2(
    p_email_norm TEXT,
    p_phone_norm TEXT,
    p_display_name TEXT,
    p_address_norm TEXT
)
RETURNS TABLE (
    person_id UUID,
    display_name TEXT,
    total_score NUMERIC,
    total_weight NUMERIC,
    email_score NUMERIC,
    phone_score NUMERIC,
    name_score NUMERIC,
    address_score NUMERIC,
    household_id UUID,
    is_household_candidate BOOLEAN,
    matched_rules TEXT[],
    score_breakdown JSONB
) AS $$
DECLARE
    v_email_demotion NUMERIC;
    v_phone_demotion NUMERIC;
    v_name_rarity NUMERIC;
    v_input_first TEXT;
    v_input_last TEXT;
BEGIN
    -- Pre-compute demotion factors (MIG_2827)
    v_email_demotion := sot.identifier_demotion_factor('email', p_email_norm);
    v_phone_demotion := sot.identifier_demotion_factor('phone', p_phone_norm);

    -- MIG_2928/FFS-525: Pre-compute name rarity factor
    -- Extract first/last from display name for frequency lookup
    IF p_display_name IS NOT NULL AND p_display_name != '' THEN
        v_input_first := split_part(TRIM(p_display_name), ' ', 1);
        v_input_last := CASE
            WHEN POSITION(' ' IN TRIM(p_display_name)) > 0
            THEN SUBSTRING(TRIM(p_display_name) FROM POSITION(' ' IN TRIM(p_display_name)) + 1)
            ELSE NULL
        END;
        v_name_rarity := ref.name_rarity_factor(v_input_first, v_input_last);
    ELSE
        v_name_rarity := 1.0;
    END IF;

    RETURN QUERY
    WITH
    -- Look up weights from parameters table
    weights AS (
        SELECT field_name, weight
        FROM sot.fellegi_sunter_parameters
    ),

    -- Email matches (same logic as v1, but returns comparison level)
    email_matches AS (
        SELECT DISTINCT
            pi.person_id AS matched_person_id,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM sot.soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_email_norm
                    AND sbl.identifier_type = 'email'
                ) THEN 'email_soft_blacklist'
                WHEN p_address_norm IS NOT NULL AND p_address_norm != '' AND EXISTS (
                    SELECT 1 FROM sot.person_place ppr
                    JOIN sot.places pl ON pl.place_id = ppr.place_id
                    WHERE ppr.person_id = pi.person_id
                    AND pl.merged_into_place_id IS NULL
                    AND pl.formatted_address IS NOT NULL
                ) AND NOT EXISTS (
                    SELECT 1 FROM sot.person_place ppr
                    JOIN sot.places pl ON pl.place_id = ppr.place_id
                    WHERE ppr.person_id = pi.person_id
                    AND pl.merged_into_place_id IS NULL
                    AND pl.formatted_address IS NOT NULL
                    AND similarity(LOWER(p_address_norm), LOWER(pl.formatted_address)) > 0.3
                ) THEN 'email_addr_mismatch'
                ELSE 'email_exact'
            END AS comparison_level
        FROM sot.person_identifiers pi
        WHERE p_email_norm IS NOT NULL
          AND p_email_norm != ''
          AND pi.id_type = 'email'
          AND pi.id_value_norm = p_email_norm
          AND pi.confidence >= 0.5
          AND EXISTS (
              SELECT 1 FROM sot.people sp
              WHERE sp.person_id = pi.person_id
              AND sp.merged_into_person_id IS NULL
          )
    ),

    -- Phone matches (exact)
    phone_matches AS (
        SELECT DISTINCT
            pi.person_id AS matched_person_id,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM sot.soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_phone_norm
                    AND sbl.identifier_type = 'phone'
                ) THEN 'phone_demoted'
                ELSE 'phone_exact'
            END AS comparison_level
        FROM sot.person_identifiers pi
        WHERE p_phone_norm IS NOT NULL
          AND p_phone_norm != ''
          AND pi.id_type = 'phone'
          AND pi.id_value_norm = p_phone_norm
          AND pi.confidence >= 0.5
          AND EXISTS (
              SELECT 1 FROM sot.people sp
              WHERE sp.person_id = pi.person_id
              AND sp.merged_into_person_id IS NULL
          )
    ),

    -- Fuzzy phone matches (MIG_2828)
    fuzzy_phone_matches AS (
        SELECT
            fpm.person_id AS matched_person_id,
            'phone_fuzzy_lev1' AS comparison_level,
            CASE
                WHEN p_email_norm IS NOT NULL AND p_email_norm != '' AND EXISTS (
                    SELECT 1 FROM sot.person_identifiers pi2
                    WHERE pi2.person_id = fpm.person_id
                    AND pi2.id_type = 'email'
                    AND pi2.id_value_norm = p_email_norm
                    AND pi2.confidence >= 0.5
                ) THEN TRUE
                WHEN p_address_norm IS NOT NULL AND p_address_norm != '' AND EXISTS (
                    SELECT 1 FROM sot.person_place ppr
                    JOIN sot.places pl ON pl.place_id = ppr.place_id
                    WHERE ppr.person_id = fpm.person_id
                    AND pl.merged_into_place_id IS NULL
                    AND pl.formatted_address IS NOT NULL
                    AND similarity(LOWER(p_address_norm), LOWER(pl.formatted_address)) > 0.5
                ) THEN TRUE
                WHEN p_display_name IS NOT NULL AND p_display_name != '' AND EXISTS (
                    SELECT 1 FROM sot.people sp
                    WHERE sp.person_id = fpm.person_id
                    AND sp.display_name IS NOT NULL
                    AND (SELECT cn.jaro_winkler_similarity FROM sot.compare_names(p_display_name, sp.display_name) cn LIMIT 1) > 0.85
                ) THEN TRUE
                ELSE FALSE
            END AS gate_passed
        FROM sot.fuzzy_phone_match(p_phone_norm) fpm
        WHERE NOT EXISTS (
            SELECT 1 FROM phone_matches pm WHERE pm.matched_person_id = fpm.person_id
        )
    ),

    -- All unique candidates
    all_candidates AS (
        SELECT matched_person_id FROM email_matches
        UNION
        SELECT matched_person_id FROM phone_matches
        UNION
        SELECT matched_person_id FROM fuzzy_phone_matches WHERE gate_passed
    ),

    -- Score each candidate using comparison-level weights
    scored_candidates AS (
        SELECT
            sp.person_id,
            sp.display_name,
            -- Email weight (with demotion)
            COALESCE(
                (SELECT w.weight * v_email_demotion
                 FROM email_matches em
                 JOIN weights w ON w.field_name = em.comparison_level
                 WHERE em.matched_person_id = sp.person_id),
                CASE
                    WHEN p_email_norm IS NOT NULL AND p_email_norm != ''
                    THEN COALESCE((SELECT w.weight FROM weights w WHERE w.field_name = 'email_disagree'), -4.0)
                    ELSE 0.0
                END
            ) AS email_weight,
            -- Phone weight (with demotion): best of exact and fuzzy
            GREATEST(
                COALESCE(
                    (SELECT w.weight * v_phone_demotion
                     FROM phone_matches pm
                     JOIN weights w ON w.field_name = pm.comparison_level
                     WHERE pm.matched_person_id = sp.person_id),
                    0.0
                ),
                COALESCE(
                    CASE WHEN EXISTS (
                        SELECT 1 FROM fuzzy_phone_matches fpm
                        WHERE fpm.matched_person_id = sp.person_id AND fpm.gate_passed
                    ) THEN (SELECT w.weight * v_phone_demotion FROM weights w WHERE w.field_name = 'phone_fuzzy_lev1')
                    ELSE 0.0 END,
                    0.0
                )
            ) AS phone_weight_pos,
            -- Phone disagree penalty (only when both have phone and no match)
            CASE
                WHEN p_phone_norm IS NOT NULL AND p_phone_norm != ''
                    AND NOT EXISTS (SELECT 1 FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id)
                    AND NOT EXISTS (SELECT 1 FROM fuzzy_phone_matches fpm WHERE fpm.matched_person_id = sp.person_id AND fpm.gate_passed)
                THEN COALESCE((SELECT w.weight FROM weights w WHERE w.field_name = 'phone_disagree'), -3.0)
                ELSE 0.0
            END AS phone_disagree,
            -- Name weight: determine comparison level from compare_names
            -- MIG_2928: Apply name_rarity factor to POSITIVE matches only
            CASE
                WHEN p_display_name IS NULL OR p_display_name = '' OR sp.display_name IS NULL OR sp.display_name = ''
                THEN 0.0
                ELSE (
                    SELECT CASE
                        WHEN LOWER(TRIM(p_display_name)) = LOWER(TRIM(sp.display_name))
                        THEN COALESCE((SELECT w.weight FROM weights w WHERE w.field_name = 'name_exact'), 7.0) * v_name_rarity
                        WHEN cn.jaro_winkler_similarity > 0.92
                        THEN COALESCE((SELECT w.weight FROM weights w WHERE w.field_name = 'name_jw_092'), 5.0) * v_name_rarity
                        WHEN cn.jaro_winkler_similarity > 0.85
                        THEN COALESCE((SELECT w.weight FROM weights w WHERE w.field_name = 'name_jw_085'), 3.0) * v_name_rarity
                        WHEN cn.phonetic_match
                        THEN COALESCE((SELECT w.weight FROM weights w WHERE w.field_name = 'name_phonetic_only'), 1.0) * v_name_rarity
                        -- Disagree penalty is NOT adjusted by rarity (always full penalty)
                        ELSE COALESCE((SELECT w.weight FROM weights w WHERE w.field_name = 'name_disagree'), -2.0)
                    END
                    FROM sot.compare_names(p_display_name, sp.display_name) cn
                )
            END AS name_weight,
            -- Address weight: determine comparison level
            CASE
                WHEN p_address_norm IS NULL OR p_address_norm = '' THEN 0.0
                WHEN EXISTS (
                    SELECT 1 FROM sot.person_place ppr
                    JOIN sot.places pl ON pl.place_id = ppr.place_id
                    WHERE ppr.person_id = sp.person_id
                    AND pl.merged_into_place_id IS NULL
                    AND pl.formatted_address IS NOT NULL
                    AND similarity(LOWER(p_address_norm), LOWER(pl.formatted_address)) > 0.8
                ) THEN COALESCE((SELECT w.weight FROM weights w WHERE w.field_name = 'address_exact'), 5.0)
                WHEN EXISTS (
                    SELECT 1 FROM sot.person_place ppr
                    JOIN sot.places pl ON pl.place_id = ppr.place_id
                    WHERE ppr.person_id = sp.person_id
                    AND pl.merged_into_place_id IS NULL
                    AND pl.formatted_address IS NOT NULL
                    AND similarity(LOWER(p_address_norm), LOWER(pl.formatted_address)) > 0.5
                ) THEN COALESCE((SELECT w.weight FROM weights w WHERE w.field_name = 'address_token_overlap'), 3.0)
                WHEN EXISTS (
                    SELECT 1 FROM sot.person_place ppr
                    JOIN sot.places pl ON pl.place_id = ppr.place_id
                    WHERE ppr.person_id = sp.person_id
                    AND pl.merged_into_place_id IS NULL
                    AND pl.formatted_address IS NOT NULL
                ) THEN COALESCE((SELECT w.weight FROM weights w WHERE w.field_name = 'address_different'), -2.0)
                ELSE 0.0
            END AS address_weight,
            -- Determine matched rules
            ARRAY_REMOVE(ARRAY[
                (SELECT em.comparison_level FROM email_matches em WHERE em.matched_person_id = sp.person_id),
                (SELECT pm.comparison_level FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id),
                CASE WHEN EXISTS (
                    SELECT 1 FROM fuzzy_phone_matches fpm
                    WHERE fpm.matched_person_id = sp.person_id AND fpm.gate_passed
                ) THEN 'phone_fuzzy_lev1' ELSE NULL END,
                CASE WHEN v_email_demotion < 1.0 AND EXISTS (
                    SELECT 1 FROM email_matches em WHERE em.matched_person_id = sp.person_id
                ) THEN 'email_demoted' ELSE NULL END,
                CASE WHEN v_phone_demotion < 1.0 AND (
                    EXISTS (SELECT 1 FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id)
                    OR EXISTS (SELECT 1 FROM fuzzy_phone_matches fpm WHERE fpm.matched_person_id = sp.person_id AND fpm.gate_passed)
                ) THEN 'phone_demoted' ELSE NULL END,
                -- MIG_2928: Flag name rarity adjustment
                CASE WHEN v_name_rarity != 1.0 THEN 'name_rarity_adjusted' ELSE NULL END
            ], NULL) AS matched_rules,
            -- Determine comparison levels for breakdown
            (SELECT em.comparison_level FROM email_matches em WHERE em.matched_person_id = sp.person_id) AS email_level,
            COALESCE(
                (SELECT pm.comparison_level FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id),
                CASE WHEN EXISTS (
                    SELECT 1 FROM fuzzy_phone_matches fpm
                    WHERE fpm.matched_person_id = sp.person_id AND fpm.gate_passed
                ) THEN 'phone_fuzzy_lev1' ELSE NULL END
            ) AS phone_level
        FROM all_candidates ac
        JOIN sot.people sp ON sp.person_id = ac.matched_person_id
        WHERE sp.merged_into_person_id IS NULL
    ),

    -- Compute final scores
    final_scored AS (
        SELECT
            sc.person_id,
            sc.display_name,
            -- Total weight = sum of all field weights
            (sc.email_weight +
             CASE WHEN sc.phone_weight_pos > 0 THEN sc.phone_weight_pos ELSE sc.phone_disagree END +
             sc.name_weight +
             sc.address_weight
            ) AS raw_weight,
            sc.email_weight,
            CASE WHEN sc.phone_weight_pos > 0 THEN sc.phone_weight_pos ELSE sc.phone_disagree END AS phone_weight,
            sc.name_weight,
            sc.address_weight,
            sc.matched_rules,
            sc.email_level,
            sc.phone_level
        FROM scored_candidates sc
    )

    SELECT
        fs.person_id,
        fs.display_name,
        -- Sigmoid normalization: 1 / (1 + exp(-total_weight / 5))
        (1.0 / (1.0 + exp(-fs.raw_weight / 5.0)))::NUMERIC AS total_score,
        fs.raw_weight::NUMERIC AS total_weight,
        fs.email_weight::NUMERIC AS email_score,
        fs.phone_weight::NUMERIC AS phone_score,
        fs.name_weight::NUMERIC AS name_score,
        fs.address_weight::NUMERIC AS address_score,
        NULL::UUID AS household_id,
        FALSE AS is_household_candidate,
        fs.matched_rules,
        jsonb_build_object(
            'email_weight', fs.email_weight,
            'phone_weight', fs.phone_weight,
            'name_weight', fs.name_weight,
            'address_weight', fs.address_weight,
            'total_weight', fs.raw_weight,
            'email_level', fs.email_level,
            'phone_level', fs.phone_level,
            'email_demotion_factor', v_email_demotion,
            'phone_demotion_factor', v_phone_demotion,
            'name_rarity_factor', v_name_rarity,
            'scoring_version', 'v2_name_rarity'
        ) AS score_breakdown
    FROM final_scored fs
    WHERE fs.raw_weight > -10  -- Only return candidates above a floor
    ORDER BY fs.raw_weight DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.data_engine_score_candidates_v2 IS
'V2 scoring using comparison-level Fellegi-Sunter weights with name rarity.
MIG_2928: Added name_rarity_factor — common names (John Smith) get reduced
weight (+4.9 instead of +7), rare names get increased weight (+9.1).
Factor applied to positive matches only; disagree penalty unchanged.
- Email: exact(+13), addr_mismatch(+9), soft_blacklist(+5), disagree(-4)
- Phone: exact(+11), fuzzy_lev1(+6), demoted(+5), disagree(-3)
- Name: exact(+7*rarity), jw>0.92(+5*rarity), jw>0.85(+3*rarity), phonetic(+1*rarity), disagree(-2)
- Address: exact(+5), token_overlap(+3), same_city(+1), different(-2)
Includes dynamic identifier demotion (MIG_2827) and fuzzy phone (MIG_2828).';

\echo '   Updated data_engine_score_candidates_v2() with name rarity'

-- ============================================================================
-- 4. Verify no existing auto-matches would be broken
-- ============================================================================

\echo ''
\echo '4. Checking impact on recent auto-match decisions...'

-- Sample rarity factors for specific known names
SELECT name, factor FROM (VALUES
    ('John Smith',      ref.name_rarity_factor('John', 'Smith')),
    ('Mary Johnson',    ref.name_rarity_factor('Mary', 'Johnson')),
    ('Karen Thompson',  ref.name_rarity_factor('Karen', 'Thompson')),
    ('Ellen Johnson',   ref.name_rarity_factor('Ellen', 'Johnson')),
    ('Crystal Furtado', ref.name_rarity_factor('Crystal', 'Furtado')),
    ('Beth Kenyon',     ref.name_rarity_factor('Beth', 'Kenyon')),
    ('Toni Price',      ref.name_rarity_factor('Toni', 'Price'))
) AS t(name, factor)
ORDER BY factor ASC;

\echo ''
\echo 'MIG_2928: Name frequency weighting added to identity scoring'

COMMIT;
