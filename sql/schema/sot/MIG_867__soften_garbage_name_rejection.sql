\echo '=== MIG_867: Soften Data Engine Garbage-Name Rejection ==='
\echo 'Fix: When name is garbage but phone/email exist, proceed with resolution'
\echo ''
\echo 'Problem: data_engine_resolve_identity hard-rejects records where'
\echo 'is_garbage_name() returns TRUE, even when a valid phone or email exists.'
\echo 'In ClinicHQ, some appointments have the address in the name fields'
\echo '(e.g., "5403 San Antonio Road Petaluma" as first AND last name).'
\echo 'These records have valid phone numbers and addresses but get rejected.'
\echo ''
\echo 'Fix: Only reject garbage names when there are NO other identifiers.'
\echo 'When phone or email exists, nullify the name and proceed to scoring.'
\echo '84 previously-rejected records will be recoverable after this fix.'
\echo ''

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
    decision_id UUID,
    canonical_place_id UUID
) AS $$
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
    v_org_place_id UUID;
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

        -- =================================================================
        -- MIG_867 FIX: Soften garbage name rejection
        -- BEFORE: Hard reject when name is garbage (even with phone/email)
        -- AFTER:  Only reject if ALSO no phone and no email.
        --         When phone/email exists, nullify the name and proceed.
        -- =================================================================
        IF trapper.is_garbage_name(v_display_name) THEN
            IF v_email_norm IS NULL AND v_phone_norm IS NULL THEN
                -- No other identifiers — still reject
                v_decision_type := 'rejected';
                v_decision_reason := 'Garbage/placeholder name with no other identifiers: ' || v_display_name;

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
            ELSE
                -- Has phone or email — try direct identifier lookup first.
                -- Phone/email-only scoring maxes at ~0.40 which is below match
                -- thresholds, so we need a direct lookup path for garbage names.
                DECLARE
                    v_direct_match_id UUID;
                    v_direct_match_count INT;
                BEGIN
                    -- Try email first (highest confidence)
                    IF v_email_norm IS NOT NULL THEN
                        SELECT pi.person_id, COUNT(*) OVER() INTO v_direct_match_id, v_direct_match_count
                        FROM trapper.person_identifiers pi
                        WHERE pi.id_type = 'email' AND pi.id_value_norm = v_email_norm
                        LIMIT 1;
                    END IF;

                    -- Fall back to phone if no email match
                    IF v_direct_match_id IS NULL AND v_phone_norm IS NOT NULL THEN
                        SELECT pi.person_id, COUNT(*) OVER() INTO v_direct_match_id, v_direct_match_count
                        FROM trapper.person_identifiers pi
                        WHERE pi.id_type = 'phone' AND pi.id_value_norm = v_phone_norm
                        LIMIT 1;
                    END IF;

                    IF v_direct_match_id IS NOT NULL AND v_direct_match_count = 1 THEN
                        -- Unique match via phone/email — auto-match despite garbage name
                        v_decision_type := 'auto_match';
                        v_decision_reason := 'Garbage name "' || v_display_name || '" bypassed — matched via '
                            || CASE WHEN v_email_norm IS NOT NULL THEN 'email' ELSE 'phone' END;

                        v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

                        INSERT INTO trapper.data_engine_match_decisions (
                            staged_record_id, source_system, incoming_email, incoming_phone,
                            incoming_name, incoming_address, candidates_evaluated,
                            decision_type, decision_reason, resulting_person_id,
                            processing_job_id, processing_duration_ms
                        ) VALUES (
                            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
                            v_display_name, v_address_norm, 1,
                            v_decision_type, v_decision_reason, v_direct_match_id,
                            p_job_id, v_duration_ms
                        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

                        PERFORM trapper.update_person_contact_info(
                            v_direct_match_id, v_email_norm, v_phone_norm, p_source_system
                        );

                        RETURN QUERY SELECT v_direct_match_id, v_decision_type,
                            0.95::NUMERIC, NULL::UUID, v_decision_id, NULL::UUID;
                        RETURN;
                    END IF;
                END;

                -- No direct match or ambiguous — nullify name and fall through to scoring
                v_display_name := NULL;
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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_resolve_identity IS
'MIG_867: Softened garbage-name rejection in identity resolution.

Change: When is_garbage_name() returns TRUE but phone or email exists,
the name is nullified and resolution proceeds using phone/email signals.
Only hard-rejects garbage names when there are NO other identifiers.

This fixes records where ClinicHQ has addresses in name fields
(e.g., "5403 San Antonio Road Petaluma" as owner first AND last name).
These records have valid phone numbers and should be matched.

84 previously-rejected records are now recoverable.';

\echo ''
\echo '=== MIG_867 Complete ==='
\echo ''
\echo 'Change: Garbage name check no longer hard-rejects when phone/email exists.'
\echo 'Instead, nullifies the name and proceeds with identity resolution.'
\echo ''
\echo 'To re-process previously rejected records:'
\echo '  UPDATE trapper.staged_records sr'
\echo '    SET is_processed = FALSE, processed_at = NULL'
\echo '    FROM trapper.data_engine_match_decisions md'
\echo '    WHERE md.staged_record_id = sr.id'
\echo '      AND md.decision_type = ''rejected'''
\echo '      AND md.decision_reason LIKE ''Garbage/placeholder%'''
\echo '      AND (md.incoming_phone IS NOT NULL AND md.incoming_phone != '''')'
\echo '      AND sr.source_table = ''owner_info'';'
\echo '  SELECT * FROM trapper.process_clinichq_owner_info(500);'
