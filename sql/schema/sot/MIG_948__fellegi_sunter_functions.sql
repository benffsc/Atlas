\echo ''
\echo '=============================================='
\echo 'MIG_948: Fellegi-Sunter Scoring Functions'
\echo '=============================================='
\echo ''
\echo 'Creates F-S scoring functions:'
\echo '  - fs_compute_field_weight(): Log-odds for single field'
\echo '  - fs_compare_records(): Compare all fields'
\echo '  - data_engine_score_candidates_fs(): Main scoring function'
\echo ''

-- ============================================================================
-- PART 1: fs_compute_field_weight()
-- ============================================================================

\echo '1. Creating fs_compute_field_weight()...'

CREATE OR REPLACE FUNCTION trapper.fs_compute_field_weight(
    p_field_name TEXT,
    p_comparison_result TEXT  -- 'agree', 'disagree', 'missing', or NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_params RECORD;
BEGIN
    -- Missing data = neutral contribution (weight 0)
    -- This is the key F-S principle for handling incomplete records
    IF p_comparison_result IS NULL OR p_comparison_result = 'missing' THEN
        RETURN 0;
    END IF;

    -- Look up parameters for this field
    SELECT agreement_weight, disagreement_weight
    INTO v_params
    FROM trapper.fellegi_sunter_parameters
    WHERE field_name = p_field_name AND is_active = TRUE;

    IF v_params IS NULL THEN
        RETURN 0;  -- Unknown field = neutral
    END IF;

    IF p_comparison_result = 'agree' THEN
        RETURN v_params.agreement_weight;
    ELSIF p_comparison_result = 'disagree' THEN
        RETURN v_params.disagreement_weight;
    ELSE
        RETURN 0;  -- Unknown comparison result = neutral
    END IF;
END;
$$;

COMMENT ON FUNCTION trapper.fs_compute_field_weight IS
'Computes log-odds weight for a single field comparison.

Parameters:
  p_field_name: Name of field (must exist in fellegi_sunter_parameters)
  p_comparison_result: agree, disagree, or missing

Returns:
  agree: Positive weight (log2(M/U))
  disagree: Negative weight (log2((1-M)/(1-U)))
  missing: 0 (neutral - key F-S principle for incomplete data)';

-- ============================================================================
-- PART 2: fs_compare_records() - Compare all fields
-- ============================================================================

\echo ''
\echo '2. Creating fs_compare_records()...'

CREATE OR REPLACE FUNCTION trapper.fs_compare_records(
    p_candidate_person_id UUID,
    p_email_norm TEXT,
    p_phone_norm TEXT,
    p_display_name TEXT,
    p_address_norm TEXT
)
RETURNS TABLE (
    field_name TEXT,
    comparison_result TEXT,
    similarity_value NUMERIC,
    log_odds_weight NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_cand RECORD;
    v_cand_emails TEXT[];
    v_cand_phones TEXT[];
    v_cand_addresses TEXT[];
    v_phone_is_blacklisted BOOLEAN;
    v_name_sim NUMERIC;
BEGIN
    -- Get candidate's data
    SELECT
        sp.display_name,
        ARRAY_AGG(DISTINCT CASE WHEN pi.id_type = 'email' THEN pi.id_value_norm END)
            FILTER (WHERE pi.id_type = 'email' AND pi.confidence >= 0.5) AS emails,
        ARRAY_AGG(DISTINCT CASE WHEN pi.id_type = 'phone' THEN pi.id_value_norm END)
            FILTER (WHERE pi.id_type = 'phone' AND pi.confidence >= 0.5) AS phones,
        ARRAY_AGG(DISTINCT pl.normalized_address)
            FILTER (WHERE pl.normalized_address IS NOT NULL) AS addresses
    INTO v_cand
    FROM trapper.sot_people sp
    LEFT JOIN trapper.person_identifiers pi ON pi.person_id = sp.person_id
    LEFT JOIN trapper.person_place_relationships ppr ON ppr.person_id = sp.person_id
    LEFT JOIN trapper.places pl ON pl.place_id = ppr.place_id AND pl.merged_into_place_id IS NULL
    WHERE sp.person_id = p_candidate_person_id
      AND sp.merged_into_person_id IS NULL
    GROUP BY sp.display_name;

    IF v_cand IS NULL THEN
        RETURN;  -- Candidate not found
    END IF;

    v_cand_emails := COALESCE(v_cand.emails, ARRAY[]::TEXT[]);
    v_cand_phones := COALESCE(v_cand.phones, ARRAY[]::TEXT[]);
    v_cand_addresses := COALESCE(v_cand.addresses, ARRAY[]::TEXT[]);

    -- Check if phone is soft-blacklisted
    v_phone_is_blacklisted := EXISTS (
        SELECT 1 FROM trapper.data_engine_soft_blacklist
        WHERE identifier_type = 'phone' AND identifier_norm = p_phone_norm
    );

    -- Email comparison
    IF p_email_norm IS NULL OR p_email_norm = '' THEN
        field_name := 'email_exact';
        comparison_result := 'missing';
        similarity_value := NULL;
    ELSIF array_length(v_cand_emails, 1) IS NULL OR array_length(v_cand_emails, 1) = 0 THEN
        field_name := 'email_exact';
        comparison_result := 'missing';
        similarity_value := NULL;
    ELSIF p_email_norm = ANY(v_cand_emails) THEN
        field_name := 'email_exact';
        comparison_result := 'agree';
        similarity_value := 1.0;
    ELSE
        field_name := 'email_exact';
        comparison_result := 'disagree';
        similarity_value := 0.0;
    END IF;
    log_odds_weight := trapper.fs_compute_field_weight(field_name, comparison_result);
    RETURN NEXT;

    -- Phone comparison (with soft blacklist handling)
    IF p_phone_norm IS NULL OR p_phone_norm = '' THEN
        field_name := 'phone_exact';
        comparison_result := 'missing';
        similarity_value := NULL;
    ELSIF array_length(v_cand_phones, 1) IS NULL OR array_length(v_cand_phones, 1) = 0 THEN
        field_name := 'phone_exact';
        comparison_result := 'missing';
        similarity_value := NULL;
    ELSIF p_phone_norm = ANY(v_cand_phones) THEN
        IF v_phone_is_blacklisted THEN
            field_name := 'phone_softblacklist';
            comparison_result := 'agree';
            similarity_value := 0.5;
        ELSE
            field_name := 'phone_exact';
            comparison_result := 'agree';
            similarity_value := 1.0;
        END IF;
    ELSE
        field_name := 'phone_exact';
        comparison_result := 'disagree';
        similarity_value := 0.0;
    END IF;
    log_odds_weight := trapper.fs_compute_field_weight(field_name, comparison_result);
    RETURN NEXT;

    -- Name comparison (with similarity levels)
    IF p_display_name IS NULL OR p_display_name = '' THEN
        field_name := 'name_exact';
        comparison_result := 'missing';
        similarity_value := NULL;
        log_odds_weight := 0;
        RETURN NEXT;
    ELSIF v_cand.display_name IS NULL OR v_cand.display_name = '' THEN
        field_name := 'name_exact';
        comparison_result := 'missing';
        similarity_value := NULL;
        log_odds_weight := 0;
        RETURN NEXT;
    ELSE
        -- Calculate name similarity
        v_name_sim := trapper.name_similarity(p_display_name, v_cand.display_name);

        IF LOWER(TRIM(p_display_name)) = LOWER(TRIM(v_cand.display_name)) THEN
            field_name := 'name_exact';
            comparison_result := 'agree';
            similarity_value := 1.0;
        ELSIF v_name_sim >= 0.8 THEN
            field_name := 'name_similar_high';
            comparison_result := 'agree';
            similarity_value := v_name_sim;
        ELSIF v_name_sim >= 0.5 THEN
            field_name := 'name_similar_med';
            comparison_result := 'agree';
            similarity_value := v_name_sim;
        ELSE
            field_name := 'name_similar_med';
            comparison_result := 'disagree';
            similarity_value := v_name_sim;
        END IF;
        log_odds_weight := trapper.fs_compute_field_weight(field_name, comparison_result);
        RETURN NEXT;
    END IF;

    -- Address comparison
    IF p_address_norm IS NULL OR p_address_norm = '' THEN
        field_name := 'address_exact';
        comparison_result := 'missing';
        similarity_value := NULL;
    ELSIF array_length(v_cand_addresses, 1) IS NULL OR array_length(v_cand_addresses, 1) = 0 THEN
        field_name := 'address_exact';
        comparison_result := 'missing';
        similarity_value := NULL;
    ELSIF p_address_norm = ANY(v_cand_addresses) THEN
        field_name := 'address_exact';
        comparison_result := 'agree';
        similarity_value := 1.0;
    ELSE
        field_name := 'address_exact';
        comparison_result := 'disagree';
        similarity_value := 0.0;
    END IF;
    log_odds_weight := trapper.fs_compute_field_weight(field_name, comparison_result);
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION trapper.fs_compare_records IS
'Compares input data against a candidate person record using Fellegi-Sunter methodology.

Returns one row per field with:
  - field_name: The F-S parameter used (e.g., email_exact, name_similar_high)
  - comparison_result: agree, disagree, or missing
  - similarity_value: Numeric similarity (0-1) where applicable
  - log_odds_weight: The F-S log-odds contribution

Missing data is treated as neutral (weight = 0) per F-S principles.';

-- ============================================================================
-- PART 3: data_engine_score_candidates_fs() - Main scoring function
-- ============================================================================

\echo ''
\echo '3. Creating data_engine_score_candidates_fs()...'

CREATE OR REPLACE FUNCTION trapper.data_engine_score_candidates_fs(
    p_email_norm TEXT,
    p_phone_norm TEXT,
    p_display_name TEXT,
    p_address_norm TEXT
)
RETURNS TABLE (
    candidate_person_id UUID,
    candidate_display_name TEXT,
    composite_score NUMERIC,           -- Sum of log-odds weights
    match_probability NUMERIC,          -- Posterior probability (0-1)
    field_scores JSONB,                 -- Individual field contributions
    comparison_vector JSONB,            -- What matched/disagreed/missing
    household_id UUID,
    is_household_candidate BOOLEAN,
    name_similarity NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN QUERY
    WITH
    -- Find all potential candidates via email
    email_candidates AS (
        SELECT DISTINCT pi.person_id AS cand_id
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
            AND sp.merged_into_person_id IS NULL
            AND sp.data_quality NOT IN ('garbage', 'orphan_no_identifiers')
        WHERE p_email_norm IS NOT NULL AND p_email_norm != ''
          AND pi.id_type = 'email'
          AND pi.id_value_norm = p_email_norm
          AND pi.confidence >= 0.5
    ),

    -- Find candidates via phone
    phone_candidates AS (
        SELECT DISTINCT pi.person_id AS cand_id
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
            AND sp.merged_into_person_id IS NULL
            AND sp.data_quality NOT IN ('garbage', 'orphan_no_identifiers')
        WHERE p_phone_norm IS NOT NULL AND p_phone_norm != ''
          AND pi.id_type = 'phone'
          AND pi.id_value_norm = p_phone_norm
          AND NOT EXISTS (
              SELECT 1 FROM trapper.identity_phone_blacklist bl
              WHERE bl.phone_norm = p_phone_norm AND bl.allow_with_name_match = FALSE
          )
    ),

    -- Find candidates via address (only if we have address)
    address_candidates AS (
        SELECT DISTINCT ppr.person_id AS cand_id
        FROM trapper.person_place_relationships ppr
        JOIN trapper.places pl ON pl.place_id = ppr.place_id
            AND pl.merged_into_place_id IS NULL
        JOIN trapper.sot_people sp ON sp.person_id = ppr.person_id
            AND sp.merged_into_person_id IS NULL
            AND sp.data_quality NOT IN ('garbage', 'orphan_no_identifiers')
        WHERE p_address_norm IS NOT NULL AND p_address_norm != ''
          AND pl.normalized_address = p_address_norm
    ),

    -- Combine all candidates
    all_candidates AS (
        SELECT cand_id FROM email_candidates
        UNION
        SELECT cand_id FROM phone_candidates
        UNION
        SELECT cand_id FROM address_candidates
    ),

    -- Score each candidate using F-S methodology
    scored AS (
        SELECT
            ac.cand_id,
            sp.display_name AS cand_name,
            -- Compute composite score: sum of all field weights
            COALESCE(SUM(fc.log_odds_weight), 0) AS comp_score,
            -- Build field_scores JSONB
            jsonb_object_agg(fc.field_name, ROUND(fc.log_odds_weight::NUMERIC, 2)) AS f_scores,
            -- Build comparison_vector JSONB
            jsonb_object_agg(fc.field_name, fc.comparison_result) AS comp_vector,
            -- Get household info
            hm.household_id AS hh_id,
            -- Calculate name similarity for household detection
            trapper.name_similarity(p_display_name, sp.display_name) AS name_sim
        FROM all_candidates ac
        JOIN trapper.sot_people sp ON sp.person_id = ac.cand_id
        CROSS JOIN LATERAL trapper.fs_compare_records(
            ac.cand_id, p_email_norm, p_phone_norm, p_display_name, p_address_norm
        ) fc
        LEFT JOIN trapper.household_members hm ON hm.person_id = ac.cand_id
            AND hm.valid_to IS NULL
        GROUP BY ac.cand_id, sp.display_name, hm.household_id
    )

    SELECT
        s.cand_id AS candidate_person_id,
        s.cand_name AS candidate_display_name,
        s.comp_score AS composite_score,
        -- Convert log-odds to probability: P = 1 / (1 + 2^(-score))
        CASE
            WHEN s.comp_score >= 20 THEN 0.999999::NUMERIC
            WHEN s.comp_score <= -20 THEN 0.000001::NUMERIC
            ELSE ROUND((1.0 / (1.0 + POWER(2::NUMERIC, -s.comp_score)))::NUMERIC, 6)
        END AS match_probability,
        COALESCE(s.f_scores, '{}'::JSONB) AS field_scores,
        COALESCE(s.comp_vector, '{}'::JSONB) AS comparison_vector,
        s.hh_id AS household_id,
        (s.hh_id IS NOT NULL) AS is_household_candidate,
        s.name_sim AS name_similarity
    FROM scored s
    WHERE s.comp_score > -10  -- Filter out very unlikely matches
    ORDER BY s.comp_score DESC;
END;
$$;

COMMENT ON FUNCTION trapper.data_engine_score_candidates_fs IS
'Main Fellegi-Sunter scoring function. Finds and scores all candidate matches.

Returns candidates ordered by composite_score (highest first) with:
  - composite_score: Sum of log-odds weights (positive = more likely match)
  - match_probability: Posterior probability (0-1) derived from log-odds
  - field_scores: JSONB with per-field contributions
  - comparison_vector: JSONB showing agree/disagree/missing per field

Key F-S principles applied:
  1. Missing data is neutral (weight = 0), not penalizing
  2. Log-odds are additive, allowing principled combination
  3. Probability is derived from log-odds for interpretability';

-- ============================================================================
-- PART 4: Helper view for testing
-- ============================================================================

\echo ''
\echo '4. Creating v_fs_parameters_summary view...'

CREATE OR REPLACE VIEW trapper.v_fs_parameters_summary AS
SELECT
    field_name,
    field_type,
    m_probability AS m,
    u_probability AS u,
    ROUND(agreement_weight::NUMERIC, 2) AS agree_weight,
    ROUND(disagreement_weight::NUMERIC, 2) AS disagree_weight,
    -- Interpret: how much does agreement increase probability?
    ROUND((1.0 / (1.0 + POWER(2::NUMERIC, -agreement_weight)))::NUMERIC, 3) AS agree_to_prob,
    is_active
FROM trapper.fellegi_sunter_parameters
ORDER BY agreement_weight DESC;

COMMENT ON VIEW trapper.v_fs_parameters_summary IS
'Summary view of Fellegi-Sunter parameters with computed weights and probability impact.';

-- ============================================================================
-- PART 5: Verification
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Testing fs_compute_field_weight()...'
SELECT
    'email_exact agree' AS test,
    trapper.fs_compute_field_weight('email_exact', 'agree') AS weight,
    '~13.14 expected' AS expected
UNION ALL SELECT
    'email_exact disagree',
    trapper.fs_compute_field_weight('email_exact', 'disagree'),
    '~-3.32 expected'
UNION ALL SELECT
    'email_exact missing',
    trapper.fs_compute_field_weight('email_exact', 'missing'),
    '0 expected (neutral)'
UNION ALL SELECT
    'phone_softblacklist agree',
    trapper.fs_compute_field_weight('phone_softblacklist', 'agree'),
    '~2.59 expected';

\echo ''
\echo 'F-S Parameters Summary:'
SELECT * FROM trapper.v_fs_parameters_summary;

\echo ''
\echo '=============================================='
\echo 'MIG_948 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created functions:'
\echo '  - fs_compute_field_weight(): Log-odds for single field'
\echo '  - fs_compare_records(): Compare all fields'
\echo '  - data_engine_score_candidates_fs(): Main scoring function'
\echo ''
\echo 'Key F-S principle: Missing data = neutral (weight 0)'
\echo ''
\echo 'Next: Run MIG_949 to update data_engine_resolve_identity()'
\echo ''
