\echo ''
\echo '=============================================='
\echo 'MIG_949: Integrate Fellegi-Sunter into Data Engine'
\echo '=============================================='
\echo ''
\echo 'Replaces fixed-weight scoring with Fellegi-Sunter probabilistic matching.'
\echo ''
\echo 'Key Changes:'
\echo '  1. Use data_engine_score_candidates_fs() instead of legacy scoring'
\echo '  2. Use configurable thresholds from fellegi_sunter_thresholds'
\echo '  3. Store F-S details (score, probability, field breakdown)'
\echo '  4. Missing data treated as neutral (weight = 0)'
\echo ''
\echo 'Decision Logic:'
\echo '  score >= upper_threshold (15) → auto_match (~97% probability)'
\echo '  score >= lower_threshold (2)  → review_pending (~80% probability)'
\echo '  score < lower_threshold       → new_entity'
\echo ''

-- ============================================================================
-- PART 1: Update data_engine_resolve_identity to use F-S scoring
-- ============================================================================

\echo '1. Updating data_engine_resolve_identity with F-S scoring...'

CREATE OR REPLACE FUNCTION trapper.data_engine_resolve_identity(
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'unknown',
    p_staged_record_id UUID DEFAULT NULL,
    p_job_id UUID DEFAULT NULL
)
RETURNS TABLE(
    person_id UUID,
    decision_type TEXT,
    confidence_score NUMERIC,
    household_id UUID,
    decision_id UUID,
    canonical_place_id UUID
)
LANGUAGE plpgsql
AS $function$
DECLARE
    v_email_norm TEXT;
    v_phone_norm TEXT;
    v_display_name TEXT;
    v_address_norm TEXT;
    v_top_candidate RECORD;
    v_tier4_match RECORD;
    v_decision_type TEXT;
    v_decision_reason TEXT;
    v_new_person_id UUID;
    v_household_id UUID;
    v_decision_id UUID;
    v_candidates_count INT;
    v_start_time TIMESTAMPTZ;
    v_duration_ms INT;
    v_org_representative_id UUID;
    v_org_place_id UUID;
    v_direct_match_id UUID;
    -- F-S thresholds (loaded from table)
    v_upper_threshold NUMERIC;
    v_lower_threshold NUMERIC;
BEGIN
    v_start_time := clock_timestamp();

    -- =========================================================================
    -- LOAD F-S THRESHOLDS
    -- =========================================================================
    SELECT upper_threshold, lower_threshold
    INTO v_upper_threshold, v_lower_threshold
    FROM trapper.fellegi_sunter_thresholds
    WHERE source_system = 'all' AND is_active = TRUE
    LIMIT 1;

    -- Fallback to defaults if not configured
    v_upper_threshold := COALESCE(v_upper_threshold, 15.0);
    v_lower_threshold := COALESCE(v_lower_threshold, 2.0);

    -- Normalize inputs
    v_email_norm := trapper.norm_email(p_email);
    v_phone_norm := trapper.norm_phone_us(p_phone);
    v_display_name := TRIM(CONCAT_WS(' ',
        NULLIF(TRIM(COALESCE(p_first_name, '')), ''),
        NULLIF(TRIM(COALESCE(p_last_name, '')), '')
    ));
    v_address_norm := trapper.normalize_address(COALESCE(p_address, ''));

    -- =========================================================================
    -- EARLY REJECTION 1: Internal accounts
    -- =========================================================================
    IF trapper.is_internal_account(v_display_name) THEN
        v_decision_type := 'rejected';
        v_decision_reason := 'Internal account detected: ' || v_display_name;

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            decision_type, decision_reason, processing_job_id,
            processing_duration_ms
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, 0,
            v_decision_type, v_decision_reason, p_job_id,
            EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT NULL::UUID, v_decision_type, 0::NUMERIC, NULL::UUID, v_decision_id, NULL::UUID;
        RETURN;
    END IF;

    -- =========================================================================
    -- EARLY REJECTION 2: Organization names (check for representative first)
    -- =========================================================================
    IF v_display_name IS NOT NULL AND v_display_name != '' THEN
        IF trapper.is_organization_name(v_display_name) THEN
            -- Get BOTH representative AND place using the combined function
            SELECT
                gor.representative_person_id,
                gor.linked_place_id
            INTO v_org_representative_id, v_org_place_id
            FROM trapper.get_organization_routing(v_display_name) gor;

            IF v_org_representative_id IS NOT NULL THEN
                v_decision_type := 'org_representative';
                v_decision_reason := 'Organization "' || v_display_name || '" mapped to representative';
                IF v_org_place_id IS NOT NULL THEN
                    v_decision_reason := v_decision_reason || ' with linked place';
                END IF;

                INSERT INTO trapper.data_engine_match_decisions (
                    staged_record_id, source_system, incoming_email, incoming_phone,
                    incoming_name, incoming_address, candidates_evaluated,
                    decision_type, decision_reason, resulting_person_id, processing_job_id,
                    processing_duration_ms
                ) VALUES (
                    p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
                    v_display_name, v_address_norm, 0,
                    v_decision_type, v_decision_reason, v_org_representative_id, p_job_id,
                    EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT
                ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

                RETURN QUERY SELECT v_org_representative_id, v_decision_type, 1.0::NUMERIC, NULL::UUID, v_decision_id, v_org_place_id;
                RETURN;
            ELSE
                -- No representative - but still get place if available
                v_org_place_id := trapper.get_organization_place(v_display_name);

                v_decision_type := 'rejected';
                v_decision_reason := 'Organization name (no representative): ' || v_display_name;
                IF v_org_place_id IS NOT NULL THEN
                    v_decision_reason := v_decision_reason || ' (place available)';
                END IF;

                INSERT INTO trapper.data_engine_match_decisions (
                    staged_record_id, source_system, incoming_email, incoming_phone,
                    incoming_name, incoming_address, candidates_evaluated,
                    decision_type, decision_reason, processing_job_id,
                    processing_duration_ms
                ) VALUES (
                    p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
                    v_display_name, v_address_norm, 0,
                    v_decision_type, v_decision_reason, p_job_id,
                    EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT
                ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

                RETURN QUERY SELECT NULL::UUID, v_decision_type, 0::NUMERIC, NULL::UUID, v_decision_id, v_org_place_id;
                RETURN;
            END IF;
        END IF;

        -- =========================================================================
        -- EARLY REJECTION 2b: Address/org patterns via MIG_939 detector
        -- =========================================================================
        IF trapper.is_organization_or_address_name(v_display_name) THEN
            v_decision_type := 'rejected';
            v_decision_reason := 'MIG_939: Organization/address pattern detected: ' || v_display_name;

            INSERT INTO trapper.data_engine_match_decisions (
                staged_record_id, source_system, incoming_email, incoming_phone,
                incoming_name, incoming_address, candidates_evaluated,
                decision_type, decision_reason, processing_job_id,
                processing_duration_ms
            ) VALUES (
                p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
                v_display_name, v_address_norm, 0,
                v_decision_type, v_decision_reason, p_job_id,
                EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT
            ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

            RETURN QUERY SELECT NULL::UUID, v_decision_type, 0::NUMERIC, NULL::UUID, v_decision_id, NULL::UUID;
            RETURN;
        END IF;

        -- =========================================================================
        -- DIRECT EMAIL/PHONE LOOKUP (MIG_833 style)
        -- =========================================================================
        IF v_email_norm IS NOT NULL THEN
            SELECT pi.person_id INTO v_direct_match_id
            FROM trapper.person_identifiers pi
            JOIN trapper.sot_people p ON p.person_id = pi.person_id
            WHERE pi.id_type = 'email'
              AND pi.id_value_norm = v_email_norm
              AND p.merged_into_person_id IS NULL
            LIMIT 1;

            IF v_direct_match_id IS NOT NULL THEN
                v_decision_type := 'auto_match';
                v_decision_reason := 'Direct email match';

                INSERT INTO trapper.data_engine_match_decisions (
                    staged_record_id, source_system, incoming_email, incoming_phone,
                    incoming_name, incoming_address, candidates_evaluated,
                    decision_type, decision_reason, resulting_person_id, processing_job_id,
                    processing_duration_ms,
                    -- F-S scoring: Direct email match is essentially perfect
                    fs_composite_score, fs_match_probability,
                    fs_field_scores, comparison_vector
                ) VALUES (
                    p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
                    v_display_name, v_address_norm, 1,
                    v_decision_type, v_decision_reason, v_direct_match_id, p_job_id,
                    EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT,
                    -- Direct email match: highest agreement weight
                    (SELECT agreement_weight FROM trapper.fellegi_sunter_parameters WHERE field_name = 'email_exact'),
                    0.99999,
                    jsonb_build_object('email_exact', (SELECT agreement_weight FROM trapper.fellegi_sunter_parameters WHERE field_name = 'email_exact')),
                    jsonb_build_object('email_exact', 'agree')
                ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

                -- Update contact info
                PERFORM trapper.update_person_contact_info(
                    v_direct_match_id, v_email_norm, v_phone_norm, p_source_system
                );

                RETURN QUERY SELECT v_direct_match_id, v_decision_type,
                    0.99999::NUMERIC, NULL::UUID, v_decision_id, NULL::UUID;
                RETURN;
            END IF;
        END IF;
    END IF;

    -- =========================================================================
    -- EARLY REJECTION 3: No usable identifiers
    -- =========================================================================
    IF v_email_norm IS NULL AND v_phone_norm IS NULL THEN
        v_decision_type := 'rejected';
        v_decision_reason := 'No email or phone provided';

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            decision_type, decision_reason, processing_job_id,
            processing_duration_ms
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, 0,
            v_decision_type, v_decision_reason, p_job_id,
            EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT NULL::UUID, v_decision_type, 0::NUMERIC, NULL::UUID, v_decision_id, NULL::UUID;
        RETURN;
    END IF;

    -- =========================================================================
    -- FELLEGI-SUNTER SCORING (MIG_949)
    -- =========================================================================
    SELECT * INTO v_top_candidate
    FROM trapper.data_engine_score_candidates_fs(v_email_norm, v_phone_norm, v_display_name, v_address_norm)
    ORDER BY composite_score DESC
    LIMIT 1;

    SELECT COUNT(*) INTO v_candidates_count
    FROM trapper.data_engine_score_candidates_fs(v_email_norm, v_phone_norm, v_display_name, v_address_norm);

    -- =========================================================================
    -- DECISION LOGIC (using F-S log-odds thresholds)
    -- =========================================================================

    -- AUTO-MATCH: Score >= upper_threshold (default 15 log-odds = ~97% probability)
    IF v_top_candidate.candidate_person_id IS NOT NULL AND v_top_candidate.composite_score >= v_upper_threshold THEN
        v_decision_type := 'auto_match';
        v_decision_reason := 'F-S high confidence: ' || ROUND(v_top_candidate.match_probability * 100, 1)::TEXT || '% probability (score: ' || ROUND(v_top_candidate.composite_score, 2)::TEXT || ')';

        v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            top_candidate_person_id, top_candidate_score,
            decision_type, decision_reason, resulting_person_id,
            processing_job_id, processing_duration_ms,
            -- F-S fields
            fs_composite_score, fs_match_probability,
            fs_field_scores, comparison_vector
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, v_candidates_count,
            v_top_candidate.candidate_person_id, v_top_candidate.match_probability,
            v_decision_type, v_decision_reason, v_top_candidate.candidate_person_id,
            p_job_id, v_duration_ms,
            v_top_candidate.composite_score, v_top_candidate.match_probability,
            v_top_candidate.field_scores, v_top_candidate.comparison_vector
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        -- Update contact info if newer
        PERFORM trapper.update_person_contact_info(
            v_top_candidate.candidate_person_id, v_email_norm, v_phone_norm, p_source_system
        );

        RETURN QUERY SELECT v_top_candidate.candidate_person_id, v_decision_type,
            v_top_candidate.match_probability, v_top_candidate.household_id, v_decision_id, NULL::UUID;
        RETURN;
    END IF;

    -- REVIEW PENDING: Score >= lower_threshold (default 2 log-odds = ~80% probability)
    IF v_top_candidate.candidate_person_id IS NOT NULL AND v_top_candidate.composite_score >= v_lower_threshold THEN
        v_decision_type := 'review_pending';
        v_decision_reason := 'F-S medium confidence: ' || ROUND(v_top_candidate.match_probability * 100, 1)::TEXT || '% probability (score: ' || ROUND(v_top_candidate.composite_score, 2)::TEXT || ') - flagged for review';

        v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            top_candidate_person_id, top_candidate_score,
            decision_type, decision_reason, resulting_person_id,
            processing_job_id, processing_duration_ms, review_status,
            -- F-S fields
            fs_composite_score, fs_match_probability,
            fs_field_scores, comparison_vector
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, v_candidates_count,
            v_top_candidate.candidate_person_id, v_top_candidate.match_probability,
            v_decision_type, v_decision_reason, v_top_candidate.candidate_person_id,
            p_job_id, v_duration_ms, 'needs_review',
            v_top_candidate.composite_score, v_top_candidate.match_probability,
            v_top_candidate.field_scores, v_top_candidate.comparison_vector
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT v_top_candidate.candidate_person_id, v_decision_type,
            v_top_candidate.match_probability, v_top_candidate.household_id, v_decision_id, NULL::UUID;
        RETURN;
    END IF;

    -- =========================================================================
    -- MIG_940: TIER 4 CHECK - Same name + same address (PREVENTION)
    -- =========================================================================
    IF v_display_name IS NOT NULL AND v_display_name != '' AND p_address IS NOT NULL AND p_address != '' THEN
        SELECT * INTO v_tier4_match
        FROM trapper.check_tier4_same_name_same_address(v_display_name, p_address);

        IF v_tier4_match.matched_person_id IS NOT NULL THEN
            v_decision_type := 'review_pending';
            v_decision_reason := 'Tier 4: Same name + same address as "' ||
                                 v_tier4_match.matched_name || '" (name similarity: ' ||
                                 ROUND(v_tier4_match.name_similarity::NUMERIC, 2) || ')';

            v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

            INSERT INTO trapper.data_engine_match_decisions (
                staged_record_id, source_system, incoming_email, incoming_phone,
                incoming_name, incoming_address, candidates_evaluated,
                top_candidate_person_id, top_candidate_score,
                decision_type, decision_reason, resulting_person_id,
                processing_job_id, processing_duration_ms, review_status,
                -- F-S fields for Tier 4 (name + address agreement)
                fs_composite_score, fs_match_probability,
                fs_field_scores, comparison_vector
            ) VALUES (
                p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
                v_display_name, v_address_norm, 1,
                v_tier4_match.matched_person_id, v_tier4_match.name_similarity,
                v_decision_type, v_decision_reason, v_tier4_match.matched_person_id,
                p_job_id, v_duration_ms, 'needs_review',
                -- Tier 4 scoring: name_similar_high + address_exact (both agree)
                (SELECT SUM(agreement_weight) FROM trapper.fellegi_sunter_parameters WHERE field_name IN ('name_similar_high', 'address_exact')),
                (1.0 / (1.0 + POWER(2::NUMERIC, -(SELECT SUM(agreement_weight) FROM trapper.fellegi_sunter_parameters WHERE field_name IN ('name_similar_high', 'address_exact'))))),
                jsonb_build_object(
                    'name_similar_high', (SELECT agreement_weight FROM trapper.fellegi_sunter_parameters WHERE field_name = 'name_similar_high'),
                    'address_exact', (SELECT agreement_weight FROM trapper.fellegi_sunter_parameters WHERE field_name = 'address_exact')
                ),
                jsonb_build_object('name_similar_high', 'agree', 'address_exact', 'agree', 'email_exact', 'missing', 'phone_exact', 'missing')
            ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

            -- Add new identifiers to existing person with lower confidence
            IF v_email_norm IS NOT NULL THEN
                INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
                VALUES (v_tier4_match.matched_person_id, 'email', p_email, v_email_norm, 0.7, p_source_system)
                ON CONFLICT DO NOTHING;
            END IF;

            IF v_phone_norm IS NOT NULL THEN
                INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
                VALUES (v_tier4_match.matched_person_id, 'phone', p_phone, v_phone_norm, 0.7, p_source_system)
                ON CONFLICT DO NOTHING;
            END IF;

            -- Log to potential duplicates for staff review
            INSERT INTO trapper.potential_person_duplicates (
                person_id, potential_match_id, match_type,
                new_name, existing_name, name_similarity,
                new_source_system, status, created_at
            ) VALUES (
                v_tier4_match.matched_person_id, v_tier4_match.matched_person_id, 'tier4_same_name_same_address',
                v_display_name, v_tier4_match.matched_name, v_tier4_match.name_similarity,
                p_source_system, 'pending', NOW()
            ) ON CONFLICT DO NOTHING;

            RETURN QUERY SELECT v_tier4_match.matched_person_id, v_decision_type,
                v_tier4_match.name_similarity::NUMERIC, NULL::UUID, v_decision_id, NULL::UUID;
            RETURN;
        END IF;
    END IF;

    -- =========================================================================
    -- LOW/NO MATCH: Create new person
    -- =========================================================================
    v_decision_type := 'new_entity';
    v_decision_reason := CASE
        WHEN v_top_candidate.candidate_person_id IS NULL THEN 'No candidates found'
        ELSE 'F-S low confidence: ' || ROUND(COALESCE(v_top_candidate.match_probability * 100, 0), 1)::TEXT || '% probability (score: ' || ROUND(COALESCE(v_top_candidate.composite_score, 0), 2)::TEXT || ') - creating new person'
    END;

    -- Create new person with advisory lock protection
    v_new_person_id := trapper.create_person_basic(
        v_display_name, v_email_norm, v_phone_norm, p_source_system
    );

    v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

    INSERT INTO trapper.data_engine_match_decisions (
        staged_record_id, source_system, incoming_email, incoming_phone,
        incoming_name, incoming_address, candidates_evaluated,
        top_candidate_person_id, top_candidate_score,
        decision_type, decision_reason, resulting_person_id,
        processing_job_id, processing_duration_ms,
        -- F-S fields
        fs_composite_score, fs_match_probability,
        fs_field_scores, comparison_vector
    ) VALUES (
        p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
        v_display_name, v_address_norm, v_candidates_count,
        v_top_candidate.candidate_person_id, v_top_candidate.match_probability,
        v_decision_type, v_decision_reason, v_new_person_id,
        p_job_id, v_duration_ms,
        v_top_candidate.composite_score, v_top_candidate.match_probability,
        v_top_candidate.field_scores, v_top_candidate.comparison_vector
    ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

    RETURN QUERY SELECT v_new_person_id, v_decision_type,
        COALESCE(v_top_candidate.match_probability, 0)::NUMERIC, NULL::UUID, v_decision_id, NULL::UUID;
    RETURN;
END;
$function$;

COMMENT ON FUNCTION trapper.data_engine_resolve_identity(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID) IS
'MIG_949: Full Fellegi-Sunter Probabilistic Identity Matching

Uses data_engine_score_candidates_fs() for log-odds scoring with:
- M/U probabilities from fellegi_sunter_parameters table
- Configurable thresholds from fellegi_sunter_thresholds table
- Missing data treated as neutral (weight = 0)

Decision Logic:
  score >= upper_threshold (15) → auto_match (~97% probability)
  score >= lower_threshold (2)  → review_pending (~80% probability)
  score < lower_threshold       → new_entity

All decisions now include:
  - fs_composite_score: Sum of log-odds weights
  - fs_match_probability: Computed as 1/(1+2^(-score))
  - fs_field_scores: Breakdown by field
  - comparison_vector: agree/disagree/missing per field

Early rejections preserved:
  - Internal accounts
  - Organization names (with representative routing)
  - Org/address patterns
  - Direct email match (fast path)
  - No identifiers

Tier 4 check (same name + same address) still runs before new_entity creation.';

-- ============================================================================
-- PART 2: Verification tests
-- ============================================================================

\echo ''
\echo '2. Running verification tests...'

-- Test 1: High confidence match (same email)
\echo ''
\echo 'Test 1: High confidence match (same email as existing person)...'

SELECT
    'Existing person lookup' as test,
    p.display_name,
    p.primary_email
FROM trapper.sot_people p
WHERE p.primary_email IS NOT NULL
  AND p.merged_into_person_id IS NULL
  AND p.data_quality = 'normal'
LIMIT 1;

-- Use that email to test matching
WITH test_email AS (
    SELECT primary_email, display_name
    FROM trapper.sot_people
    WHERE primary_email IS NOT NULL
      AND merged_into_person_id IS NULL
      AND data_quality = 'normal'
    LIMIT 1
)
SELECT
    'High confidence test' as test_case,
    r.decision_type,
    ROUND(r.confidence_score * 100, 1) || '%' as probability,
    d.fs_composite_score,
    d.comparison_vector
FROM test_email te
CROSS JOIN LATERAL trapper.data_engine_resolve_identity(
    p_email := te.primary_email,
    p_phone := NULL,
    p_first_name := NULL,
    p_last_name := NULL,
    p_address := NULL,
    p_source_system := 'test_mig949'
) r
JOIN trapper.data_engine_match_decisions d ON d.decision_id = r.decision_id;

-- Test 2: No match (random email)
\echo ''
\echo 'Test 2: No match (new random email)...'

SELECT
    'No match test' as test_case,
    r.decision_type,
    ROUND(COALESCE(r.confidence_score, 0) * 100, 1) || '%' as probability
FROM trapper.data_engine_resolve_identity(
    p_email := 'completely_random_' || gen_random_uuid()::TEXT || '@test.com',
    p_phone := NULL,
    p_first_name := 'Test',
    p_last_name := 'Person',
    p_address := NULL,
    p_source_system := 'test_mig949'
) r;

-- Test 3: Check F-S details are stored
\echo ''
\echo 'Test 3: F-S details stored in decisions...'

SELECT
    decision_type,
    ROUND(fs_composite_score, 2) as score,
    ROUND(fs_match_probability * 100, 1) || '%' as probability,
    fs_field_scores,
    comparison_vector
FROM trapper.data_engine_match_decisions
WHERE source_system = 'test_mig949'
ORDER BY created_at DESC
LIMIT 3;

-- Cleanup test records
\echo ''
\echo 'Cleaning up test records...'

DELETE FROM trapper.data_engine_match_decisions WHERE source_system = 'test_mig949';
DELETE FROM trapper.sot_people WHERE data_source = 'test_mig949';

-- ============================================================================
-- PART 3: Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_949 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. data_engine_resolve_identity() now uses F-S scoring'
\echo '  2. Thresholds loaded from fellegi_sunter_thresholds table'
\echo '  3. F-S details stored in data_engine_match_decisions:'
\echo '     - fs_composite_score (log-odds sum)'
\echo '     - fs_match_probability (0-1)'
\echo '     - fs_field_scores (per-field breakdown)'
\echo '     - comparison_vector (agree/disagree/missing)'
\echo ''
\echo 'Default thresholds:'
\echo '  - Upper (auto_match): 15 log-odds (~97% probability)'
\echo '  - Lower (review_pending): 2 log-odds (~80% probability)'
\echo ''
\echo 'Next: Update API endpoints and UI to display probabilities'
\echo ''
