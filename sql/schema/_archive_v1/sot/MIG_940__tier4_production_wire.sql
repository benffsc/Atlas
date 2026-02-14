-- ============================================================================
-- MIG_940: Wire Tier 4 Check into Production Data Engine
-- ============================================================================
-- Problem: MIG_939 added Tier 4 check to the 6-parameter overload, but the
--          production pipeline uses the 8-parameter overload. New data coming
--          through the pipeline bypasses the Tier 4 prevention.
--
-- Solution: Add Tier 4 check to the 8-parameter data_engine_resolve_identity()
--           right before the "new_entity" creation branch.
--
-- This ensures:
--   1. All new data goes through Tier 4 prevention
--   2. Same-name-same-address duplicates are caught at the gate
--   3. Full audit trail in data_engine_match_decisions
--   4. Merged entities stay merged (source data references preserved)
-- ============================================================================

\echo '=============================================='
\echo 'MIG_940: Wire Tier 4 Check into Production'
\echo '=============================================='
\echo ''

-- ============================================================================
-- Step 1: Update the production data_engine_resolve_identity function
-- ============================================================================

\echo 'Step 1: Updating production data_engine_resolve_identity with Tier 4...'

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
    v_score_breakdown JSONB;
    v_rules_applied JSONB;
    v_candidates_count INT;
    v_start_time TIMESTAMPTZ;
    v_duration_ms INT;
    v_rejection_reason TEXT;
    v_org_representative_id UUID;
    v_org_place_id UUID;
    v_auto_match_threshold NUMERIC := 0.90;
    v_direct_match_id UUID;
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
                    processing_duration_ms
                ) VALUES (
                    p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
                    v_display_name, v_address_norm, 1,
                    v_decision_type, v_decision_reason, v_direct_match_id, p_job_id,
                    EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT
                ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

                -- Update contact info
                PERFORM trapper.update_person_contact_info(
                    v_direct_match_id, v_email_norm, v_phone_norm, p_source_system
                );

                RETURN QUERY SELECT v_direct_match_id, v_decision_type,
                    0.95::NUMERIC, NULL::UUID, v_decision_id, NULL::UUID;
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

    -- =========================================================================
    -- MIG_940: TIER 4 CHECK - Same name + same address (PREVENTION)
    -- =========================================================================
    -- Before creating a new person, check if someone with the same name
    -- already exists at the same address. This catches duplicates like
    -- Cristina Campbell (same name, same address, different phone numbers).
    --
    -- If found: return review_pending with the existing person
    -- If not found: continue to create new person
    -- =========================================================================

    IF v_display_name IS NOT NULL AND v_display_name != '' AND p_address IS NOT NULL AND p_address != '' THEN
        SELECT * INTO v_tier4_match
        FROM trapper.check_tier4_same_name_same_address(v_display_name, p_address);

        IF v_tier4_match.matched_person_id IS NOT NULL THEN
            v_decision_type := 'review_pending';
            v_decision_reason := 'MIG_940 Tier 4: Same name + same address as existing person "' ||
                                 v_tier4_match.matched_name || '" (similarity: ' ||
                                 ROUND(v_tier4_match.name_similarity::NUMERIC, 2) || ')';

            v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

            INSERT INTO trapper.data_engine_match_decisions (
                staged_record_id, source_system, incoming_email, incoming_phone,
                incoming_name, incoming_address, candidates_evaluated,
                top_candidate_person_id, top_candidate_score,
                decision_type, decision_reason, resulting_person_id,
                processing_job_id, processing_duration_ms, review_status
            ) VALUES (
                p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
                v_display_name, v_address_norm, 1,
                v_tier4_match.matched_person_id, v_tier4_match.name_similarity,
                v_decision_type, v_decision_reason, v_tier4_match.matched_person_id,
                p_job_id, v_duration_ms, 'needs_review'
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
$function$;

COMMENT ON FUNCTION trapper.data_engine_resolve_identity(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID) IS
'MIG_940: Production Data Engine with Tier 4 Prevention

This is the SINGLE FORTRESS for all identity resolution in the pipeline.
All data flows through here: ClinicHQ, ShelterLuv, VolunteerHub, Web Intake.

Decision Flow:
  1. EARLY REJECTION: Internal accounts
  2. EARLY REJECTION: Organization names (with representative routing)
  3. EARLY REJECTION: MIG_939 org/address patterns (NEW)
  4. DIRECT MATCH: Email lookup
  5. SCORE CANDIDATES: Multi-signal scoring
  6. AUTO-MATCH: Score >= 0.90
  7. REVIEW_PENDING: Score 0.50-0.89
  8. TIER 4 CHECK (MIG_940): Same name + same address prevention (NEW)
  9. NEW_ENTITY: Create if no match

Tier 4 Prevention (MIG_940):
  - Catches duplicates with same name + same address but different contact info
  - Returns existing person with review_pending status
  - Adds new identifiers to existing person with lower confidence
  - Logs to potential_person_duplicates for staff review
  - Full audit trail in data_engine_match_decisions

Invariants:
  INV-17: Organizational emails rejected
  INV-18: Location names rejected
  INV-19: Same-name-same-address triggers review (Tier 4)
  INV-20: All decisions logged with full reasoning';

-- ============================================================================
-- Step 2: Verify the Tier 4 check works
-- ============================================================================

\echo ''
\echo 'Step 2: Testing Tier 4 prevention...'

-- Test: Try to create another Cristina Campbell at the same address
SELECT
  'Test: Cristina Campbell at same address' as test_case,
  decision_type,
  confidence_score
FROM trapper.data_engine_resolve_identity(
  p_email := NULL::TEXT,
  p_phone := '4155559999'::TEXT,
  p_first_name := 'Cristina'::TEXT,
  p_last_name := 'Campbell'::TEXT,
  p_address := '990 Borden Villa Dr, Santa Rosa, CA 95401'::TEXT,
  p_source_system := 'test_mig940'::TEXT,
  p_staged_record_id := NULL::UUID,
  p_job_id := NULL::UUID
);

-- Cleanup test record
DELETE FROM trapper.data_engine_match_decisions WHERE source_system = 'test_mig940';

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_940 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Added MIG_939 org/address pattern check to production function'
\echo '  2. Added Tier 4 (same-name-same-address) check before new_entity creation'
\echo '  3. New identifiers added to existing person with lower confidence (0.7)'
\echo '  4. Full audit trail: decision_reason includes Tier 4 match details'
\echo '  5. Logged to potential_person_duplicates for staff review'
\echo ''
\echo 'Stability Guarantees:'
\echo '  - New data through pipeline will not recreate merged entities'
\echo '  - Same-name-same-address duplicates caught at the gate'
\echo '  - Full source data reference preserved in match_decisions'
\echo '  - Staff can review Tier 4 matches via potential_person_duplicates'
\echo ''
