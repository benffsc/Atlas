\echo '=== MIG_578: Data Engine Returns Organization Place ==='
\echo ''
\echo 'Updates data_engine_resolve_identity() to return canonical_place_id'
\echo 'when an organization is detected. This allows request creation to'
\echo 'automatically link to the organization place.'
\echo ''

-- ============================================================================
-- Update data_engine_resolve_identity to return place_id
-- ============================================================================

\echo 'Dropping old function to change return type...'

DROP FUNCTION IF EXISTS trapper.data_engine_resolve_identity(text,text,text,text,text,text,uuid,uuid);

\echo 'Creating updated data_engine_resolve_identity() function...'

CREATE OR REPLACE FUNCTION trapper.data_engine_resolve_identity(
    p_email TEXT,
    p_phone TEXT,
    p_first_name TEXT,
    p_last_name TEXT,
    p_address TEXT,
    p_source_system TEXT,
    p_staged_record_id UUID DEFAULT NULL,
    p_job_id UUID DEFAULT NULL
)
RETURNS TABLE(
    person_id UUID,
    decision_type TEXT,
    confidence_score NUMERIC,
    household_id UUID,
    decision_id UUID,
    canonical_place_id UUID  -- NEW: Returns org place when detected
)
LANGUAGE plpgsql AS $$
DECLARE
    v_email_norm TEXT;
    v_phone_norm TEXT;
    v_display_name TEXT;
    v_address_norm TEXT;
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
    v_rejection_reason TEXT;
    v_org_representative_id UUID;
    v_org_place_id UUID;  -- NEW
    v_auto_match_threshold NUMERIC := 0.90;
BEGIN
    v_start_time := clock_timestamp();

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

                -- Return person, decision, AND place
                RETURN QUERY SELECT v_org_representative_id, v_decision_type, 1.0::NUMERIC, NULL::UUID, v_decision_id, v_org_place_id;
                RETURN;
            ELSE
                -- No representative - but still get place if available
                v_org_place_id := trapper.get_organization_place(v_display_name);

                v_decision_type := 'rejected';
                v_decision_reason := 'Organization name (no representative): ' || v_display_name;
                IF v_org_place_id IS NOT NULL THEN
                    v_decision_reason := v_decision_reason || ' - place available but no contact';
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

                -- Return the place even though rejected (caller can use it)
                RETURN QUERY SELECT NULL::UUID, v_decision_type, 0::NUMERIC, NULL::UUID, v_decision_id, v_org_place_id;
                RETURN;
            END IF;
        END IF;

        -- Check for garbage names
        IF trapper.is_garbage_name(v_display_name) THEN
            v_decision_type := 'rejected';
            v_decision_reason := 'Garbage/placeholder name: ' || v_display_name;

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
    -- SCORE CANDIDATES
    -- =========================================================================
    SELECT * INTO v_top_candidate
    FROM trapper.data_engine_score_candidates(v_email_norm, v_phone_norm, v_display_name, v_address_norm)
    ORDER BY total_score DESC
    LIMIT 1;

    SELECT COUNT(*) INTO v_candidates_count
    FROM trapper.data_engine_score_candidates(v_email_norm, v_phone_norm, v_display_name, v_address_norm);

    -- =========================================================================
    -- DECISION LOGIC
    -- =========================================================================

    -- AUTO-MATCH: Score >= 0.90
    IF v_top_candidate.person_id IS NOT NULL AND v_top_candidate.total_score >= v_auto_match_threshold THEN
        v_decision_type := 'auto_match';
        v_decision_reason := 'High confidence match (' || ROUND(v_top_candidate.total_score, 2)::TEXT || ') to ' || COALESCE(v_top_candidate.display_name, 'unknown');

        v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            top_candidate_person_id, top_candidate_score,
            decision_type, decision_reason, resulting_person_id,
            score_breakdown, rules_applied, processing_job_id,
            processing_duration_ms
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, v_candidates_count,
            v_top_candidate.person_id, v_top_candidate.total_score,
            v_decision_type, v_decision_reason, v_top_candidate.person_id,
            v_top_candidate.score_breakdown, v_top_candidate.rules_applied, p_job_id,
            v_duration_ms
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        -- Update contact info if newer
        PERFORM trapper.update_person_contact_info(
            v_top_candidate.person_id, v_email_norm, v_phone_norm, p_source_system
        );

        RETURN QUERY SELECT v_top_candidate.person_id, v_decision_type,
            v_top_candidate.total_score, NULL::UUID, v_decision_id, NULL::UUID;
        RETURN;
    END IF;

    -- MEDIUM CONFIDENCE (0.50 - 0.89): Link to existing, flag for review
    IF v_top_candidate.person_id IS NOT NULL AND v_top_candidate.total_score >= 0.50 THEN
        v_decision_type := 'review_pending';
        v_decision_reason := 'Medium confidence (' || ROUND(v_top_candidate.total_score, 2)::TEXT || ') - linked to best match, flagged for review';

        v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            top_candidate_person_id, top_candidate_score,
            decision_type, decision_reason,
            resulting_person_id,
            score_breakdown, rules_applied, processing_job_id,
            processing_duration_ms, review_status
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, v_candidates_count,
            v_top_candidate.person_id, v_top_candidate.total_score,
            v_decision_type, v_decision_reason,
            v_top_candidate.person_id,
            v_top_candidate.score_breakdown, v_top_candidate.rules_applied, p_job_id,
            v_duration_ms, 'needs_review'
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT v_top_candidate.person_id, v_decision_type,
            v_top_candidate.total_score, NULL::UUID, v_decision_id, NULL::UUID;
        RETURN;
    END IF;

    -- LOW/NO MATCH: Create new person
    v_decision_type := 'new_entity';
    v_decision_reason := CASE
        WHEN v_top_candidate.person_id IS NULL THEN 'No candidates found'
        ELSE 'Low confidence (' || ROUND(v_top_candidate.total_score, 2)::TEXT || ') - creating new person'
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
        score_breakdown, rules_applied, processing_job_id,
        processing_duration_ms
    ) VALUES (
        p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
        v_display_name, v_address_norm, v_candidates_count,
        v_top_candidate.person_id, v_top_candidate.total_score,
        v_decision_type, v_decision_reason, v_new_person_id,
        v_top_candidate.score_breakdown, v_top_candidate.rules_applied, p_job_id,
        v_duration_ms
    ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

    RETURN QUERY SELECT v_new_person_id, v_decision_type,
        COALESCE(v_top_candidate.total_score, 0)::NUMERIC, NULL::UUID, v_decision_id, NULL::UUID;
    RETURN;
END;
$$;

COMMENT ON FUNCTION trapper.data_engine_resolve_identity IS
'Main Data Engine function for identity resolution.

Now returns canonical_place_id when an organization is detected, allowing
request creation to automatically link to the organization''s physical location.

Returns:
  - person_id: Matched or created person UUID
  - decision_type: auto_match, review_pending, new_entity, org_representative, rejected
  - confidence_score: Match confidence (0-1)
  - household_id: Household UUID if applicable
  - decision_id: Reference to the decision audit record
  - canonical_place_id: Organization place UUID when org detected (NEW)

Example:
  SELECT * FROM trapper.data_engine_resolve_identity(
    NULL, NULL, ''Coast Guard'', ''Station'', NULL, ''clinichq''
  );
  -- Returns: person_id=Natasha Reed, canonical_place_id=16920 Sir Francis Drake...';

-- ============================================================================
-- Verification
-- ============================================================================

\echo ''
\echo '=== Verification ==='

-- Test org routing returns place
SELECT
    'Coast Guard routing' as test,
    person_id IS NOT NULL as has_person,
    canonical_place_id IS NOT NULL as has_place,
    decision_type
FROM trapper.data_engine_resolve_identity(
    NULL, NULL, 'Coast Guard', 'Station', NULL, 'test'
);

-- Test Park N Ride (no representative yet)
SELECT
    'Park N Ride routing' as test,
    person_id IS NULL as no_person,
    canonical_place_id IS NOT NULL as has_place,
    decision_type
FROM trapper.data_engine_resolve_identity(
    NULL, NULL, 'Park', 'N Ride', NULL, 'test'
);

\echo ''
\echo '=== MIG_578 Complete ==='
\echo ''
\echo 'data_engine_resolve_identity() now returns canonical_place_id'
\echo 'for organization detections, enabling automatic place linking.'
\echo ''
