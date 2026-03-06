-- MIG_2830__comparison_level_scoring.sql
-- FFS-180: Comparison-Level Weights (Fellegi-Sunter v2)
--
-- Replace flat percentage weights (email 40%, phone 25%, name 25%, address 10%)
-- with per-comparison-level log-likelihood weights following Fellegi-Sunter / Splink
-- best practices.
--
-- Approach: Create v2 scoring function that runs alongside v1 for shadow validation.
-- Once validated, update data_engine_resolve_identity to use v2.
--
-- Depends on: MIG_2828 (fuzzy phone), MIG_2827 (demotion), MIG_2545 (compare_names)

--------------------------------------------------------------------------------
-- 1. Update fellegi_sunter_parameters with comparison-level weights
--------------------------------------------------------------------------------

-- Add weight column values for existing rows and insert new comparison levels
INSERT INTO sot.fellegi_sunter_parameters (field_name, m_probability, u_probability, weight, description) VALUES
    -- Email levels
    ('email_addr_mismatch', 0.85, 0.01, 9.0, 'Email matches but addresses differ significantly'),
    ('email_soft_blacklist', 0.50, 0.05, 5.0, 'Email match on soft-blacklisted identifier'),
    ('email_disagree', 0.02, 0.99, -4.0, 'No email match when both parties have email'),
    -- Phone levels
    ('phone_fuzzy_lev1', 0.60, 0.02, 6.0, 'Phone within levenshtein distance 1 (same area code)'),
    ('phone_demoted', 0.50, 0.05, 5.0, 'Phone match on hub identifier (3+ people)'),
    ('phone_disagree', 0.05, 0.95, -3.0, 'No phone match when both parties have phone'),
    -- Name levels
    ('name_jw_092', 0.85, 0.03, 5.0, 'Name jaro-winkler similarity > 0.92'),
    ('name_jw_085', 0.70, 0.08, 3.0, 'Name jaro-winkler similarity > 0.85'),
    ('name_phonetic_only', 0.40, 0.15, 1.0, 'Phonetic match only (dmetaphone)'),
    ('name_disagree', 0.10, 0.80, -2.0, 'Name does not match'),
    -- Address levels
    ('address_token_overlap', 0.60, 0.10, 3.0, 'Address has significant token overlap'),
    ('address_same_city', 0.30, 0.20, 1.0, 'Same city but different address'),
    ('address_different', 0.05, 0.85, -2.0, 'Different addresses')
ON CONFLICT (field_name) DO UPDATE SET
    m_probability = EXCLUDED.m_probability,
    u_probability = EXCLUDED.u_probability,
    weight = EXCLUDED.weight,
    description = EXCLUDED.description,
    updated_at = NOW();

-- Update existing rows with proper weights
UPDATE sot.fellegi_sunter_parameters SET weight = 13.0 WHERE field_name = 'email_exact' AND (weight IS NULL OR weight != 13.0);
UPDATE sot.fellegi_sunter_parameters SET weight = 11.0 WHERE field_name = 'phone_exact' AND (weight IS NULL OR weight != 11.0);
UPDATE sot.fellegi_sunter_parameters SET weight = 7.0 WHERE field_name = 'name_exact' AND (weight IS NULL OR weight != 7.0);
UPDATE sot.fellegi_sunter_parameters SET weight = 5.0 WHERE field_name = 'address_exact' AND (weight IS NULL OR weight != 5.0);
UPDATE sot.fellegi_sunter_parameters SET weight = 3.0 WHERE field_name = 'name_fuzzy' AND (weight IS NULL OR weight != 3.0);

--------------------------------------------------------------------------------
-- 2. data_engine_score_candidates_v2: comparison-level weighted scoring
--------------------------------------------------------------------------------
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
BEGIN
    -- Pre-compute demotion factors (MIG_2827)
    v_email_demotion := sot.identifier_demotion_factor('email', p_email_norm);
    v_phone_demotion := sot.identifier_demotion_factor('phone', p_phone_norm);

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
            -- Compound gate (same as MIG_2828)
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
                    AND (sot.compare_names(p_display_name, sp.display_name)).jaro_winkler_similarity > 0.85
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
            CASE
                WHEN p_display_name IS NULL OR p_display_name = '' OR sp.display_name IS NULL OR sp.display_name = ''
                THEN 0.0
                ELSE (
                    SELECT CASE
                        WHEN LOWER(TRIM(p_display_name)) = LOWER(TRIM(sp.display_name))
                        THEN COALESCE((SELECT w.weight FROM weights w WHERE w.field_name = 'name_exact'), 7.0)
                        WHEN cn.jaro_winkler_similarity > 0.92
                        THEN COALESCE((SELECT w.weight FROM weights w WHERE w.field_name = 'name_jw_092'), 5.0)
                        WHEN cn.jaro_winkler_similarity > 0.85
                        THEN COALESCE((SELECT w.weight FROM weights w WHERE w.field_name = 'name_jw_085'), 3.0)
                        WHEN cn.phonetic_match
                        THEN COALESCE((SELECT w.weight FROM weights w WHERE w.field_name = 'name_phonetic_only'), 1.0)
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
                    AND pl.city IS NOT NULL
                    -- Same city check: extract city from address or use city column
                    AND similarity(LOWER(p_address_norm), LOWER(pl.city)) > 0.3
                ) THEN COALESCE((SELECT w.weight FROM weights w WHERE w.field_name = 'address_same_city'), 1.0)
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
                ) THEN 'phone_demoted' ELSE NULL END
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
        -- Maps weights to 0-1 score for backward compatibility
        -- Weight 20 → ~0.98, Weight 10 → ~0.88, Weight 0 → 0.50
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
            'scoring_version', 'v2_comparison_level'
        ) AS score_breakdown
    FROM final_scored fs
    WHERE fs.raw_weight > -10  -- Only return candidates above a floor
    ORDER BY fs.raw_weight DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.data_engine_score_candidates_v2 IS
'V2 scoring using comparison-level Fellegi-Sunter weights.
Each field has multiple comparison levels with distinct log-likelihood weights:
- Email: exact(+13), addr_mismatch(+9), soft_blacklist(+5), disagree(-4)
- Phone: exact(+11), fuzzy_lev1(+6), demoted(+5), disagree(-3)
- Name: exact(+7), jw>0.92(+5), jw>0.85(+3), phonetic_only(+1), disagree(-2)
- Address: exact(+5), token_overlap(+3), same_city(+1), different(-2)
Sigmoid normalization maps total weight to backward-compatible 0-1 score.
Includes dynamic identifier demotion (MIG_2827) and fuzzy phone (MIG_2828).';

--------------------------------------------------------------------------------
-- 3. Shadow validation query
-- Run this to compare v1 vs v2 on existing match_decisions.
-- Execute manually BEFORE switching to v2.
--------------------------------------------------------------------------------

-- To run shadow validation, execute:
--
-- SELECT
--     md.decision_id,
--     md.decision_type AS v1_decision,
--     md.top_candidate_score AS v1_score,
--     v2.total_score AS v2_score,
--     v2.total_weight AS v2_weight,
--     v2.score_breakdown AS v2_breakdown,
--     CASE
--         WHEN md.decision_type = 'auto_match' AND v2.total_weight <= 20 THEN 'REGRESSION'
--         WHEN md.decision_type = 'new_entity' AND v2.total_weight > 20 THEN 'NEW_MATCH'
--         WHEN md.decision_type = 'review_pending' AND v2.total_weight > 20 THEN 'UPGRADE'
--         ELSE 'CONSISTENT'
--     END AS comparison_result
-- FROM sot.match_decisions md
-- CROSS JOIN LATERAL (
--     SELECT * FROM sot.data_engine_score_candidates_v2(
--         md.incoming_email,
--         md.incoming_phone,
--         md.incoming_name,
--         md.incoming_address
--     )
--     LIMIT 1
-- ) v2
-- WHERE md.decision_type IN ('auto_match', 'new_entity', 'review_pending')
--   AND md.incoming_email IS NOT NULL
-- ORDER BY comparison_result, md.created_at DESC
-- LIMIT 1000;

--------------------------------------------------------------------------------
-- 4. Updated data_engine_resolve_identity using v2 scoring
-- Only activated after shadow validation confirms no regressions
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sot.data_engine_resolve_identity(
    p_email TEXT,
    p_phone TEXT,
    p_first_name TEXT,
    p_last_name TEXT,
    p_address TEXT,
    p_source_system TEXT
)
RETURNS TABLE(
    decision_type TEXT,
    resolved_person_id UUID,
    display_name TEXT,
    confidence NUMERIC,
    reason TEXT,
    match_details JSONB,
    decision_id UUID
) AS $$
DECLARE
    v_email_norm TEXT;
    v_phone_norm TEXT;
    v_display_name TEXT;
    v_address_norm TEXT;
    v_candidate RECORD;
    v_decision_type TEXT;
    v_reason TEXT;
    v_match_details JSONB;
    v_person_id UUID;
    v_decision_id UUID;
    v_existing_person_id UUID;
BEGIN
    -- Normalize inputs
    v_email_norm := sot.norm_email(p_email);
    v_phone_norm := sot.norm_phone_us(p_phone);
    v_display_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));
    v_address_norm := sot.normalize_address(COALESCE(p_address, ''));

    -- =========================================================================
    -- PHASE 0: CONSOLIDATED GATE (MIG_919)
    -- =========================================================================

    IF NOT sot.should_be_person(p_first_name, p_last_name, p_email, p_phone) THEN
        v_decision_type := 'rejected';
        v_reason := 'Failed should_be_person gate';
        v_match_details := jsonb_build_object(
            'first_name', p_first_name,
            'last_name', p_last_name,
            'email', p_email,
            'phone', p_phone
        );

        INSERT INTO sot.match_decisions (
            decision_type, decision_reason, score_breakdown, source_system
        ) VALUES (
            v_decision_type, v_reason, v_match_details, p_source_system
        )
        RETURNING sot.match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT
            v_decision_type,
            NULL::UUID,
            NULL::TEXT,
            0.0::NUMERIC,
            v_reason,
            v_match_details,
            v_decision_id;
        RETURN;
    END IF;

    -- No email AND no phone = reject
    IF (v_email_norm IS NULL OR v_email_norm = '') AND (v_phone_norm IS NULL OR v_phone_norm = '') THEN
        v_decision_type := 'rejected';
        v_reason := 'No valid email or phone provided';
        v_match_details := jsonb_build_object(
            'first_name', p_first_name,
            'last_name', p_last_name,
            'raw_email', p_email,
            'raw_phone', p_phone
        );

        INSERT INTO sot.match_decisions (
            decision_type, decision_reason, score_breakdown, source_system
        ) VALUES (
            v_decision_type, v_reason, v_match_details, p_source_system
        )
        RETURNING sot.match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT
            v_decision_type,
            NULL::UUID,
            NULL::TEXT,
            0.0::NUMERIC,
            v_reason,
            v_match_details,
            v_decision_id;
        RETURN;
    END IF;

    -- =========================================================================
    -- PHASE 0.5: DIRECT IDENTIFIER LOOKUP (MIG_2334)
    -- =========================================================================

    IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
        SELECT pi.person_id INTO v_existing_person_id
        FROM sot.person_identifiers pi
        JOIN sot.people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = v_email_norm
          AND p.merged_into_person_id IS NULL
        LIMIT 1;
    END IF;

    IF v_existing_person_id IS NULL AND v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
        SELECT pi.person_id INTO v_existing_person_id
        FROM sot.person_identifiers pi
        JOIN sot.people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'phone'
          AND pi.id_value_norm = v_phone_norm
          AND p.merged_into_person_id IS NULL
        LIMIT 1;
    END IF;

    IF v_existing_person_id IS NOT NULL THEN
        v_decision_type := 'auto_match';
        v_reason := 'Matched by existing identifier';
        v_person_id := v_existing_person_id;

        SELECT p.display_name INTO v_display_name
        FROM sot.people p WHERE p.person_id = v_person_id;

        v_match_details := jsonb_build_object(
            'matched_person_id', v_person_id,
            'matched_name', v_display_name,
            'match_type', 'direct_identifier_lookup'
        );

        IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_person_id, 'email', p_email, v_email_norm, 1.0, p_source_system)
            ON CONFLICT (id_type, id_value_norm) DO NOTHING;
        END IF;

        IF v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_person_id, 'phone', p_phone, v_phone_norm, 1.0, p_source_system)
            ON CONFLICT (id_type, id_value_norm) DO NOTHING;
        END IF;

        INSERT INTO sot.match_decisions (
            decision_type, resulting_person_id, top_candidate_score, decision_reason, score_breakdown, source_system
        ) VALUES (
            v_decision_type, v_person_id, 1.0, v_reason, v_match_details, p_source_system
        )
        RETURNING sot.match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT
            v_decision_type,
            v_person_id,
            v_display_name,
            1.0::NUMERIC,
            v_reason,
            v_match_details,
            v_decision_id;
        RETURN;
    END IF;

    -- =========================================================================
    -- PHASE 1+: V2 SCORING AND MATCHING (MIG_2830)
    -- Uses comparison-level weights instead of flat percentages
    -- =========================================================================

    SELECT * INTO v_candidate
    FROM sot.data_engine_score_candidates_v2(
        v_email_norm,
        v_phone_norm,
        v_display_name,
        v_address_norm
    )
    LIMIT 1;

    -- Decision logic based on total_weight (not total_score)
    -- total_weight > 20 → auto-match (replaces score >= 0.95)
    -- total_weight > 5  → review_pending (replaces score >= 0.50)
    -- otherwise         → new_entity
    IF v_candidate.person_id IS NOT NULL AND v_candidate.total_weight > 20 THEN
        v_decision_type := 'auto_match';
        v_reason := 'High confidence match (weight ' || ROUND(v_candidate.total_weight, 1)::TEXT ||
                     ', score ' || ROUND(v_candidate.total_score, 2)::TEXT || ')';
        v_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'total_weight', v_candidate.total_weight,
            'score_breakdown', v_candidate.score_breakdown,
            'scoring_version', 'v2'
        );

        IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_person_id, 'email', p_email, v_email_norm, 1.0, p_source_system)
            ON CONFLICT (id_type, id_value_norm) DO NOTHING;
        END IF;

        IF v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_person_id, 'phone', p_phone, v_phone_norm, 1.0, p_source_system)
            ON CONFLICT (id_type, id_value_norm) DO NOTHING;
        END IF;

    ELSIF v_candidate.person_id IS NOT NULL AND v_candidate.total_weight > 5 THEN
        v_decision_type := 'review_pending';
        v_reason := 'Medium confidence match (weight ' || ROUND(v_candidate.total_weight, 1)::TEXT ||
                     ', score ' || ROUND(v_candidate.total_score, 2)::TEXT || ') - needs verification';
        v_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'total_weight', v_candidate.total_weight,
            'score_breakdown', v_candidate.score_breakdown,
            'scoring_version', 'v2'
        );

    ELSE
        v_decision_type := 'new_entity';
        v_reason := CASE
            WHEN v_candidate.person_id IS NULL THEN 'No matching candidates found'
            ELSE 'Best match weight too low (' || ROUND(COALESCE(v_candidate.total_weight, 0), 1)::TEXT || ')'
        END;

        INSERT INTO sot.people (
            first_name,
            last_name,
            display_name,
            source_system
        )
        VALUES (
            NULLIF(TRIM(p_first_name), ''),
            NULLIF(TRIM(p_last_name), ''),
            NULLIF(v_display_name, ''),
            p_source_system
        )
        RETURNING sot.people.person_id INTO v_person_id;

        IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_person_id, 'email', p_email, v_email_norm, 1.0, p_source_system)
            ON CONFLICT (id_type, id_value_norm) DO NOTHING;
        END IF;

        IF v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_person_id, 'phone', p_phone, v_phone_norm, 1.0, p_source_system)
            ON CONFLICT (id_type, id_value_norm) DO NOTHING;
        END IF;

        v_match_details := jsonb_build_object(
            'created_person_id', v_person_id,
            'created_name', v_display_name,
            'best_candidate_weight', COALESCE(v_candidate.total_weight, 0),
            'best_candidate_score', COALESCE(v_candidate.total_score, 0),
            'scoring_version', 'v2'
        );
    END IF;

    -- Record decision in audit trail
    INSERT INTO sot.match_decisions (
        decision_type, resulting_person_id, top_candidate_score, decision_reason, score_breakdown, source_system
    ) VALUES (
        v_decision_type,
        v_person_id,
        COALESCE(v_candidate.total_score, 1.0),
        v_reason,
        v_match_details,
        p_source_system
    )
    RETURNING sot.match_decisions.decision_id INTO v_decision_id;

    RETURN QUERY SELECT
        v_decision_type,
        v_person_id,
        COALESCE(v_candidate.display_name, v_display_name),
        COALESCE(v_candidate.total_score, 1.0)::NUMERIC,
        v_reason,
        v_match_details,
        v_decision_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.data_engine_resolve_identity(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
'V3: Unified identity resolution using comparison-level Fellegi-Sunter scoring (MIG_2830).
Phase 0: should_be_person gate
Phase 0.5: Direct identifier lookup
Phase 1+: V2 comparison-level scoring with log-likelihood weights
Auto-match threshold: total_weight > 20 (replaces score >= 0.95)
Review threshold: total_weight > 5 (replaces score >= 0.50)
Creates new person below threshold.
Includes dynamic identifier demotion (MIG_2827) and fuzzy phone (MIG_2828).';
