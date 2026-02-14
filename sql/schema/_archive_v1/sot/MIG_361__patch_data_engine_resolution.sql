\echo '=== MIG_361: Patch Data Engine Resolution ==='
\echo 'Updates data_engine_resolve_identity to use fixed name normalization'
\echo ''

-- ============================================================================
-- This migration updates the Data Engine to use the fixed functions from MIG_360
--
-- Changes:
-- 1. Use normalize_display_name() instead of inline CONCAT_WS
-- 2. Add is_business flag to decision logging
-- 3. Add fallback identifier check before new_entity creation
-- ============================================================================

\echo 'Step 1: Updating data_engine_resolve_identity function...'

-- We need to read the existing function and patch it. Since we can't easily
-- patch inline, we'll recreate the entire function with fixes.

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
RETURNS TABLE (
    person_id UUID,
    decision_type TEXT,
    confidence_score NUMERIC,
    household_id UUID,
    decision_id UUID
) AS $$
DECLARE
    v_email_norm TEXT;
    v_phone_norm TEXT;
    v_display_name TEXT;
    v_address_norm TEXT;
    v_is_business BOOLEAN;
    v_top_candidate RECORD;
    v_decision_type TEXT;
    v_decision_reason TEXT;
    v_new_person_id UUID;
    v_household_id UUID;
    v_decision_id UUID;
    v_score_breakdown JSONB;
    v_rules_applied JSONB;
    v_candidates_count INT;
    v_start_time TIMESTAMPTZ;
    v_duration_ms INT;
    v_existing_by_email UUID;
    v_existing_by_phone UUID;
BEGIN
    v_start_time := clock_timestamp();

    -- =========================================================================
    -- STEP 1: Normalize inputs using fixed functions
    -- =========================================================================
    v_email_norm := trapper.norm_email(p_email);
    v_phone_norm := trapper.norm_phone_us(p_phone);

    -- FIX: Use normalize_display_name to handle first=last deduplication
    v_display_name := trapper.normalize_display_name(p_first_name, p_last_name);

    -- FIX: Detect business names
    v_is_business := trapper.is_business_name(v_display_name);

    v_address_norm := trapper.normalize_address(COALESCE(p_address, ''));

    -- =========================================================================
    -- STEP 2: Early rejection checks
    -- =========================================================================

    -- Reject internal accounts
    IF trapper.is_internal_account(v_display_name) THEN
        v_decision_type := 'rejected';
        v_decision_reason := 'Internal account detected';

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

        RETURN QUERY SELECT NULL::UUID, v_decision_type, 0::NUMERIC, NULL::UUID, v_decision_id;
        RETURN;
    END IF;

    -- Reject if no usable identifiers
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

        RETURN QUERY SELECT NULL::UUID, v_decision_type, 0::NUMERIC, NULL::UUID, v_decision_id;
        RETURN;
    END IF;

    -- =========================================================================
    -- STEP 3: FIX - Direct identifier check BEFORE candidate scoring
    -- This catches cases where the identifier exists but scoring failed
    -- =========================================================================

    IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
        SELECT pi.person_id INTO v_existing_by_email
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = v_email_norm
          AND p.merged_into_person_id IS NULL
        LIMIT 1;
    END IF;

    IF v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
        IF NOT EXISTS (
            SELECT 1 FROM trapper.identity_phone_blacklist WHERE phone_norm = v_phone_norm
        ) THEN
            SELECT pi.person_id INTO v_existing_by_phone
            FROM trapper.person_identifiers pi
            JOIN trapper.sot_people p ON p.person_id = pi.person_id
            WHERE pi.id_type = 'phone'
              AND pi.id_value_norm = v_phone_norm
              AND p.merged_into_person_id IS NULL
            LIMIT 1;
        END IF;
    END IF;

    -- =========================================================================
    -- STEP 4: Score candidates using weighted algorithm
    -- =========================================================================

    SELECT COUNT(*) INTO v_candidates_count
    FROM trapper.data_engine_score_candidates(v_email_norm, v_phone_norm, v_display_name, v_address_norm);

    SELECT * INTO v_top_candidate
    FROM trapper.data_engine_score_candidates(v_email_norm, v_phone_norm, v_display_name, v_address_norm)
    ORDER BY total_score DESC
    LIMIT 1;

    -- Build score breakdown for audit
    IF v_top_candidate.person_id IS NOT NULL THEN
        v_score_breakdown := jsonb_build_object(
            'email_score', v_top_candidate.email_score,
            'phone_score', v_top_candidate.phone_score,
            'name_score', v_top_candidate.name_score,
            'address_score', v_top_candidate.address_score,
            'total_score', v_top_candidate.total_score,
            'is_business', v_is_business
        );
        v_rules_applied := to_jsonb(v_top_candidate.matched_rules);
    ELSE
        v_score_breakdown := jsonb_build_object('is_business', v_is_business);
    END IF;

    -- =========================================================================
    -- STEP 5: Decision logic
    -- =========================================================================

    -- High confidence match (score >= 0.95)
    IF v_top_candidate.person_id IS NOT NULL AND v_top_candidate.total_score >= 0.95 THEN
        v_decision_type := 'auto_match';
        v_decision_reason := 'High confidence match (' || ROUND(v_top_candidate.total_score, 2)::TEXT || ') to ' || COALESCE(v_top_candidate.display_name, 'unknown');

        v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            top_candidate_person_id, top_candidate_score, decision_type,
            decision_reason, resulting_person_id, score_breakdown, rules_applied,
            processing_job_id, processing_duration_ms
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, v_candidates_count,
            v_top_candidate.person_id, v_top_candidate.total_score, v_decision_type,
            v_decision_reason, trapper.get_canonical_person_id(v_top_candidate.person_id),
            v_score_breakdown, v_rules_applied, p_job_id, v_duration_ms
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT
            trapper.get_canonical_person_id(v_top_candidate.person_id),
            v_decision_type,
            v_top_candidate.total_score,
            v_top_candidate.household_id,
            v_decision_id;
        RETURN;
    END IF;

    -- Medium confidence (0.50 - 0.95): Check for household or create review
    IF v_top_candidate.person_id IS NOT NULL AND v_top_candidate.total_score >= 0.50 THEN
        -- Household member case
        IF v_top_candidate.is_household_candidate AND v_top_candidate.name_score < 0.5 THEN
            v_decision_type := 'household_member';
            v_decision_reason := 'Household member detected (score ' || ROUND(v_top_candidate.total_score, 2)::TEXT || ', name similarity ' || ROUND(v_top_candidate.name_score, 2)::TEXT || ')';
            v_household_id := v_top_candidate.household_id;

            -- Create new person using FIXED function
            v_new_person_id := trapper.create_person_basic(
                v_display_name, v_email_norm, v_phone_norm, p_source_system
            );

            -- Add to household if exists
            IF v_household_id IS NOT NULL AND v_new_person_id IS NOT NULL THEN
                INSERT INTO trapper.household_members (household_id, person_id, inferred_from, source_system)
                VALUES (v_household_id, v_new_person_id, 'data_engine_matching', p_source_system)
                ON CONFLICT DO NOTHING;

                UPDATE trapper.households SET member_count = member_count + 1, updated_at = NOW()
                WHERE households.household_id = v_household_id;
            END IF;
        ELSE
            -- Review pending case
            v_decision_type := 'review_pending';
            v_decision_reason := 'Medium confidence (' || ROUND(v_top_candidate.total_score, 2)::TEXT || ') - needs review';

            v_new_person_id := trapper.create_person_basic(
                v_display_name, v_email_norm, v_phone_norm, p_source_system
            );
        END IF;

        v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            top_candidate_person_id, top_candidate_score, decision_type,
            decision_reason, resulting_person_id, score_breakdown, rules_applied,
            processing_job_id, processing_duration_ms
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, v_candidates_count,
            v_top_candidate.person_id, v_top_candidate.total_score, v_decision_type,
            v_decision_reason, v_new_person_id, v_score_breakdown, v_rules_applied,
            p_job_id, v_duration_ms
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT
            v_new_person_id,
            v_decision_type,
            v_top_candidate.total_score,
            v_household_id,
            v_decision_id;
        RETURN;
    END IF;

    -- =========================================================================
    -- STEP 6: Low/No match - but FIRST check direct identifier ownership
    -- This is the CRITICAL FIX for the ON CONFLICT bug
    -- =========================================================================

    -- If identifier exists for someone, match to them instead of creating duplicate
    IF v_existing_by_email IS NOT NULL THEN
        v_decision_type := 'auto_match';
        v_decision_reason := 'Matched by existing email identifier (fallback check)';

        v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            top_candidate_person_id, top_candidate_score, decision_type,
            decision_reason, resulting_person_id, score_breakdown,
            processing_job_id, processing_duration_ms
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, v_candidates_count,
            v_existing_by_email, 1.0, v_decision_type,
            v_decision_reason, trapper.get_canonical_person_id(v_existing_by_email),
            v_score_breakdown, p_job_id, v_duration_ms
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT
            trapper.get_canonical_person_id(v_existing_by_email),
            v_decision_type,
            1.0::NUMERIC,
            NULL::UUID,
            v_decision_id;
        RETURN;
    END IF;

    IF v_existing_by_phone IS NOT NULL THEN
        v_decision_type := 'auto_match';
        v_decision_reason := 'Matched by existing phone identifier (fallback check)';

        v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            top_candidate_person_id, top_candidate_score, decision_type,
            decision_reason, resulting_person_id, score_breakdown,
            processing_job_id, processing_duration_ms
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, v_candidates_count,
            v_existing_by_phone, 0.9, v_decision_type,
            v_decision_reason, trapper.get_canonical_person_id(v_existing_by_phone),
            v_score_breakdown, p_job_id, v_duration_ms
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT
            trapper.get_canonical_person_id(v_existing_by_phone),
            v_decision_type,
            0.9::NUMERIC,
            NULL::UUID,
            v_decision_id;
        RETURN;
    END IF;

    -- =========================================================================
    -- STEP 7: Truly new entity - create person
    -- =========================================================================

    v_decision_type := 'new_entity';
    v_decision_reason := 'No matching candidates found';

    -- Create new person using FIXED function
    v_new_person_id := trapper.create_person_basic(
        v_display_name, v_email_norm, v_phone_norm, p_source_system
    );

    v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

    INSERT INTO trapper.data_engine_match_decisions (
        staged_record_id, source_system, incoming_email, incoming_phone,
        incoming_name, incoming_address, candidates_evaluated,
        decision_type, decision_reason, resulting_person_id, score_breakdown,
        processing_job_id, processing_duration_ms
    ) VALUES (
        p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
        v_display_name, v_address_norm, v_candidates_count,
        v_decision_type, v_decision_reason, v_new_person_id, v_score_breakdown,
        p_job_id, v_duration_ms
    ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

    RETURN QUERY SELECT
        v_new_person_id,
        v_decision_type,
        0::NUMERIC,
        NULL::UUID,
        v_decision_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_resolve_identity IS
'Main Data Engine entry point for identity resolution. PATCHED to:
1. Use normalize_display_name() for handling first=last
2. Add is_business detection
3. Include fallback identifier check before new_entity creation
4. Use fixed create_person_basic that prevents identifier-less duplicates';

\echo 'Updated data_engine_resolve_identity function'

\echo ''
\echo '=== MIG_361 Complete ==='
\echo 'Patched Data Engine to use:'
\echo '  1. normalize_display_name() for name construction'
\echo '  2. is_business_name() flag in score_breakdown'
\echo '  3. Direct identifier check before new_entity (fallback safety)'
\echo '  4. Fixed create_person_basic for person creation'
\echo ''
