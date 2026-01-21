\echo ''
\echo '=============================================='
\echo 'MIG_527: Integrate Org Mapping into Data Engine'
\echo '=============================================='
\echo ''
\echo 'Updates data_engine_resolve_identity to check for organization'
\echo 'representative mappings before rejecting organization names.'
\echo ''

-- ============================================================================
-- UPDATE data_engine_resolve_identity TO CHECK ORG MAPPINGS
-- ============================================================================

\echo 'Updating data_engine_resolve_identity...'

-- First drop the existing function
DROP FUNCTION IF EXISTS trapper.data_engine_resolve_identity(text,text,text,text,text,text,uuid,uuid);

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
    -- EARLY REJECTION 1: Internal accounts (existing check)
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

        RETURN QUERY SELECT NULL::UUID, v_decision_type, 0::NUMERIC, NULL::UUID, v_decision_id;
        RETURN;
    END IF;

    -- =========================================================================
    -- CHECK FOR ORGANIZATION REPRESENTATIVE MAPPING (NEW!)
    -- Before rejecting org names, check if there's a designated representative
    -- =========================================================================
    IF v_display_name IS NOT NULL AND v_display_name != '' THEN
        -- Check if this is an organization name
        IF trapper.is_organization_name(v_display_name) THEN
            -- Check for representative mapping
            v_org_representative_id := trapper.get_organization_representative(v_display_name);

            IF v_org_representative_id IS NOT NULL THEN
                -- Found a representative! Return them instead of rejecting
                v_decision_type := 'org_representative';
                v_decision_reason := 'Organization name "' || v_display_name ||
                    '" mapped to designated representative';

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

                RETURN QUERY SELECT v_org_representative_id, v_decision_type, 1.0::NUMERIC, NULL::UUID, v_decision_id;
                RETURN;
            END IF;
        END IF;
    END IF;

    -- =========================================================================
    -- EARLY REJECTION 2: Invalid person names (organization, garbage, etc.)
    -- =========================================================================
    IF v_display_name IS NOT NULL AND v_display_name != '' THEN
        -- Check for organization names (no representative mapping found)
        IF trapper.is_organization_name(v_display_name) THEN
            v_rejection_reason := 'organization name';
        -- Check for garbage/placeholder names
        ELSIF trapper.is_garbage_name(v_display_name) THEN
            v_rejection_reason := 'garbage/placeholder name';
        -- Check against data_fixing_patterns for additional patterns
        ELSIF EXISTS (
            SELECT 1 FROM trapper.data_fixing_patterns dfp
            WHERE dfp.is_organization = TRUE OR dfp.is_garbage = TRUE
              AND dfp.pattern_type = 'name'
              AND (
                  (dfp.pattern_value IS NOT NULL AND LOWER(v_display_name) = LOWER(dfp.pattern_value)) OR
                  (dfp.pattern_ilike IS NOT NULL AND v_display_name ILIKE dfp.pattern_ilike) OR
                  (dfp.pattern_regex IS NOT NULL AND v_display_name ~* dfp.pattern_regex)
              )
        ) THEN
            v_rejection_reason := 'matches bad pattern';
        END IF;

        IF v_rejection_reason IS NOT NULL THEN
            v_decision_type := 'rejected';
            v_decision_reason := 'Invalid person name (' || v_rejection_reason || '): ' || v_display_name;

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
    END IF;

    -- =========================================================================
    -- EARLY REJECTION 3: No usable identifiers (existing check)
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

        RETURN QUERY SELECT NULL::UUID, v_decision_type, 0::NUMERIC, NULL::UUID, v_decision_id;
        RETURN;
    END IF;

    -- =========================================================================
    -- EARLY REJECTION 4: Blacklisted email only
    -- =========================================================================
    IF v_email_norm IS NOT NULL AND v_phone_norm IS NULL THEN
        IF trapper.is_blacklisted_email(v_email_norm) THEN
            v_decision_type := 'rejected';
            v_decision_reason := 'Blacklisted email (placeholder/test): ' || v_email_norm;

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
    END IF;

    -- =========================================================================
    -- SCORING: Get candidates and score them
    -- =========================================================================

    -- Get candidates count
    SELECT COUNT(*) INTO v_candidates_count
    FROM trapper.data_engine_score_candidates(v_email_norm, v_phone_norm, v_display_name, v_address_norm);

    -- Get top candidate
    SELECT * INTO v_top_candidate
    FROM trapper.data_engine_score_candidates(v_email_norm, v_phone_norm, v_display_name, v_address_norm)
    ORDER BY total_score DESC
    LIMIT 1;

    -- Build score breakdown
    IF v_top_candidate.person_id IS NOT NULL THEN
        v_score_breakdown := jsonb_build_object(
            'email_score', v_top_candidate.email_score,
            'phone_score', v_top_candidate.phone_score,
            'name_score', v_top_candidate.name_score,
            'address_score', v_top_candidate.address_score,
            'total_score', v_top_candidate.total_score
        );
        v_rules_applied := to_jsonb(v_top_candidate.matched_rules);
    END IF;

    -- =========================================================================
    -- DECISION LOGIC
    -- =========================================================================

    IF v_top_candidate.person_id IS NOT NULL AND v_top_candidate.total_score >= 0.95 THEN
        -- High confidence: auto-match
        v_decision_type := 'auto_match';
        v_decision_reason := 'High confidence match (' || ROUND(v_top_candidate.total_score, 2)::TEXT || ') to ' || COALESCE(v_top_candidate.display_name, 'unknown');

        v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            top_candidate_person_id, top_candidate_score, decision_type,
            decision_reason, resulting_person_id, score_breakdown, rules_applied,
            processing_job_id, processing_duration_ms,
            used_enrichment, enrichment_source
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, v_candidates_count,
            v_top_candidate.person_id, v_top_candidate.total_score, v_decision_type,
            v_decision_reason, trapper.get_canonical_person_id(v_top_candidate.person_id),
            v_score_breakdown, v_rules_applied, p_job_id, v_duration_ms,
            COALESCE(v_top_candidate.used_enrichment, FALSE),
            v_top_candidate.enrichment_source
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT
            trapper.get_canonical_person_id(v_top_candidate.person_id),
            v_decision_type,
            v_top_candidate.total_score,
            v_top_candidate.household_id,
            v_decision_id;
        RETURN;

    ELSIF v_top_candidate.person_id IS NOT NULL AND v_top_candidate.total_score >= 0.50 THEN
        -- Medium confidence: check if household situation
        IF v_top_candidate.is_household_candidate AND v_top_candidate.name_score < 0.5 THEN
            v_decision_type := 'household_member';
            v_decision_reason := 'Household member detected (score ' || ROUND(v_top_candidate.total_score, 2)::TEXT || ', name similarity ' || ROUND(v_top_candidate.name_score, 2)::TEXT || ')';
            v_household_id := v_top_candidate.household_id;

            -- Create new person
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

            v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

            INSERT INTO trapper.data_engine_match_decisions (
                staged_record_id, source_system, incoming_email, incoming_phone,
                incoming_name, incoming_address, candidates_evaluated,
                top_candidate_person_id, top_candidate_score, decision_type,
                decision_reason, resulting_person_id, score_breakdown, rules_applied,
                household_id, processing_job_id, processing_duration_ms,
                used_enrichment, enrichment_source
            ) VALUES (
                p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
                v_display_name, v_address_norm, v_candidates_count,
                v_top_candidate.person_id, v_top_candidate.total_score, v_decision_type,
                v_decision_reason, v_new_person_id, v_score_breakdown, v_rules_applied,
                v_household_id, p_job_id, v_duration_ms,
                COALESCE(v_top_candidate.used_enrichment, FALSE),
                v_top_candidate.enrichment_source
            ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

            RETURN QUERY SELECT v_new_person_id, v_decision_type, v_top_candidate.total_score, v_household_id, v_decision_id;
            RETURN;
        ELSE
            -- Medium confidence but not household: review_pending
            v_decision_type := 'review_pending';
            v_decision_reason := 'Medium confidence (' || ROUND(v_top_candidate.total_score, 2)::TEXT || ') - manual review recommended';

            -- Still create person
            v_new_person_id := trapper.create_person_basic(
                v_display_name, v_email_norm, v_phone_norm, p_source_system
            );

            v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

            INSERT INTO trapper.data_engine_match_decisions (
                staged_record_id, source_system, incoming_email, incoming_phone,
                incoming_name, incoming_address, candidates_evaluated,
                top_candidate_person_id, top_candidate_score, decision_type,
                decision_reason, resulting_person_id, score_breakdown, rules_applied,
                processing_job_id, processing_duration_ms,
                used_enrichment, enrichment_source
            ) VALUES (
                p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
                v_display_name, v_address_norm, v_candidates_count,
                v_top_candidate.person_id, v_top_candidate.total_score, v_decision_type,
                v_decision_reason, v_new_person_id, v_score_breakdown, v_rules_applied,
                p_job_id, v_duration_ms,
                COALESCE(v_top_candidate.used_enrichment, FALSE),
                v_top_candidate.enrichment_source
            ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

            RETURN QUERY SELECT v_new_person_id, v_decision_type, v_top_candidate.total_score, NULL::UUID, v_decision_id;
            RETURN;
        END IF;
    ELSE
        -- Low or no score: create new entity
        v_decision_type := 'new_entity';
        IF v_top_candidate.person_id IS NOT NULL THEN
            v_decision_reason := 'Low confidence (' || ROUND(v_top_candidate.total_score, 2)::TEXT || ') - creating new person';
        ELSE
            v_decision_reason := 'No matching candidates found';
        END IF;

        -- Create new person
        v_new_person_id := trapper.create_person_basic(
            v_display_name, v_email_norm, v_phone_norm, p_source_system
        );

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

        RETURN QUERY SELECT v_new_person_id, v_decision_type, COALESCE(v_top_candidate.total_score, 0::NUMERIC), NULL::UUID, v_decision_id;
        RETURN;
    END IF;

EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'data_engine_resolve_identity error: %', SQLERRM;
    RETURN QUERY SELECT NULL::UUID, 'error'::TEXT, 0::NUMERIC, NULL::UUID, NULL::UUID;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_resolve_identity IS
'Identity resolution with organization representative mapping:
- Checks for organization representative mappings BEFORE rejecting
- If org has a designated representative, returns that person_id
- Otherwise, rejects organization names as before
- New decision_type: "org_representative" for mapped orgs';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_527 Complete!'
\echo '=============================================='
\echo ''
\echo 'Data Engine now checks for organization representative mappings.'
\echo ''
\echo 'Flow:'
\echo '  1. "Jehovahs Witnesses" comes in as owner'
\echo '  2. Data Engine detects it as organization name'
\echo '  3. Checks organization_person_mappings for representative'
\echo '  4. If found, returns representative person_id (decision_type=org_representative)'
\echo '  5. If not found, rejects as before'
\echo ''
\echo 'To set up a mapping:'
\echo '  INSERT INTO trapper.organization_person_mappings ('
\echo '    org_pattern, org_pattern_type, representative_person_id,'
\echo '    org_display_name, notes'
\echo '  ) VALUES ('
\echo '    ''%Jehovah%'', ''ilike'', ''<jennifer-pratt-person-id>'','
\echo '    ''Jehovah''''s Witnesses'', ''Jennifer Pratt is the designated trapper'''
\echo '  );'
\echo ''
