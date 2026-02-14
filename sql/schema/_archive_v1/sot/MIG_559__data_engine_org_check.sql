-- ============================================================================
-- MIG_559: Data Engine Organization Check Integration
-- ============================================================================
-- Modifies data_engine_resolve_identity to check known_organizations FIRST,
-- before expensive candidate scoring. This prevents:
-- 1. Creating duplicate person records for known orgs
-- 2. Wasted computation scoring candidates that should route to canonical org
-- ============================================================================

\echo '=== MIG_559: Data Engine Organization Check Integration ==='

-- ============================================================================
-- Recreate data_engine_resolve_identity with org check
-- ============================================================================

\echo 'Updating data_engine_resolve_identity with organization check...'

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
    -- NEW: Organization matching
    v_org_match RECORD;
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

    -- Early rejection: internal accounts
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

    -- Early rejection: no usable identifiers
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

    -- ==========================================================================
    -- NEW: Check for known organization BEFORE candidate scoring
    -- ==========================================================================
    SELECT * INTO v_org_match
    FROM trapper.match_known_organization_v2(v_display_name, v_email_norm, v_phone_norm)
    LIMIT 1;

    IF v_org_match IS NOT NULL AND v_org_match.confidence >= 0.75 THEN
        -- Found a known organization match
        v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

        -- Log to organization_match_log
        PERFORM trapper.log_organization_match(
            v_org_match.org_id,
            COALESCE(v_display_name, v_email_norm, v_phone_norm),
            v_org_match.match_type,
            v_org_match.matched_pattern,
            v_org_match.confidence,
            p_source_system,
            p_staged_record_id::TEXT,
            CASE
                WHEN v_org_match.canonical_person_id IS NOT NULL THEN 'linked'
                ELSE 'flagged'
            END,
            v_org_match.canonical_person_id
        );

        -- If org has a canonical person, link to it
        IF v_org_match.canonical_person_id IS NOT NULL THEN
            v_decision_type := 'organization_linked';
            v_decision_reason := 'Matched known organization: ' || v_org_match.canonical_name ||
                                 ' (' || v_org_match.match_type || ' match, confidence: ' ||
                                 ROUND(v_org_match.confidence, 2)::TEXT || ')';

            INSERT INTO trapper.data_engine_match_decisions (
                staged_record_id, source_system, incoming_email, incoming_phone,
                incoming_name, incoming_address, candidates_evaluated,
                top_candidate_person_id, top_candidate_score, decision_type,
                decision_reason, resulting_person_id, processing_job_id,
                processing_duration_ms
            ) VALUES (
                p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
                v_display_name, v_address_norm, 0,
                v_org_match.canonical_person_id, v_org_match.confidence, v_decision_type,
                v_decision_reason, v_org_match.canonical_person_id, p_job_id,
                v_duration_ms
            ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

            RETURN QUERY SELECT
                v_org_match.canonical_person_id,
                v_decision_type,
                v_org_match.confidence,
                NULL::UUID,  -- No household for orgs
                v_decision_id;
            RETURN;
        ELSE
            -- Org matched but no canonical person yet - flag for review
            v_decision_type := 'organization_flagged';
            v_decision_reason := 'Matched known organization without canonical person: ' ||
                                 v_org_match.canonical_name;

            INSERT INTO trapper.data_engine_match_decisions (
                staged_record_id, source_system, incoming_email, incoming_phone,
                incoming_name, incoming_address, candidates_evaluated,
                decision_type, decision_reason, processing_job_id,
                processing_duration_ms
            ) VALUES (
                p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
                v_display_name, v_address_norm, 0,
                v_decision_type, v_decision_reason, p_job_id,
                v_duration_ms
            ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

            RETURN QUERY SELECT NULL::UUID, v_decision_type, v_org_match.confidence, NULL::UUID, v_decision_id;
            RETURN;
        END IF;
    END IF;
    -- ==========================================================================
    -- END: Organization check
    -- ==========================================================================

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

    -- Decision logic based on score and context
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

    ELSIF v_top_candidate.person_id IS NOT NULL AND v_top_candidate.total_score >= 0.50 THEN
        -- Medium confidence: check if household situation
        IF v_top_candidate.address_score >= 0.8 AND v_top_candidate.name_score < 0.5 THEN
            -- Same address, different name = likely household member
            v_decision_type := 'household_member';
            v_decision_reason := 'Different name at same address - likely household member';

            -- Create new person
            v_new_person_id := trapper.create_person_basic(
                v_email_norm, v_phone_norm, p_first_name, p_last_name, p_source_system
            );

            -- Add to household
            IF v_top_candidate.household_id IS NOT NULL THEN
                v_household_id := v_top_candidate.household_id;
            ELSE
                -- Create household with both people
                SELECT * INTO v_household_id
                FROM trapper.data_engine_create_household(
                    v_top_candidate.address_place_id,
                    ARRAY[v_top_candidate.person_id, v_new_person_id]
                );
            END IF;

            v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

            INSERT INTO trapper.data_engine_match_decisions (
                staged_record_id, source_system, incoming_email, incoming_phone,
                incoming_name, incoming_address, candidates_evaluated,
                top_candidate_person_id, top_candidate_score, decision_type,
                decision_reason, resulting_person_id, resulting_household_id,
                score_breakdown, rules_applied, processing_job_id, processing_duration_ms
            ) VALUES (
                p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
                v_display_name, v_address_norm, v_candidates_count,
                v_top_candidate.person_id, v_top_candidate.total_score, v_decision_type,
                v_decision_reason, v_new_person_id, v_household_id,
                v_score_breakdown, v_rules_applied, p_job_id, v_duration_ms
            ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

            RETURN QUERY SELECT v_new_person_id, v_decision_type, v_top_candidate.total_score, v_household_id, v_decision_id;
            RETURN;
        ELSE
            -- Medium confidence, not household - flag for review
            v_decision_type := 'review_pending';
            v_decision_reason := 'Medium confidence (' || ROUND(v_top_candidate.total_score, 2)::TEXT || ') - needs human review';

            -- Create new person (tentatively)
            v_new_person_id := trapper.create_person_basic(
                v_email_norm, v_phone_norm, p_first_name, p_last_name, p_source_system
            );

            v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

            INSERT INTO trapper.data_engine_match_decisions (
                staged_record_id, source_system, incoming_email, incoming_phone,
                incoming_name, incoming_address, candidates_evaluated,
                top_candidate_person_id, top_candidate_score, decision_type,
                decision_reason, resulting_person_id, score_breakdown, rules_applied,
                review_status, processing_job_id, processing_duration_ms
            ) VALUES (
                p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
                v_display_name, v_address_norm, v_candidates_count,
                v_top_candidate.person_id, v_top_candidate.total_score, v_decision_type,
                v_decision_reason, v_new_person_id, v_score_breakdown, v_rules_applied,
                'pending', p_job_id, v_duration_ms
            ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

            RETURN QUERY SELECT v_new_person_id, v_decision_type, v_top_candidate.total_score, NULL::UUID, v_decision_id;
            RETURN;
        END IF;

    ELSE
        -- Low confidence or no candidates: create new person
        v_decision_type := 'new_entity';
        v_decision_reason := CASE
            WHEN v_top_candidate.person_id IS NULL THEN 'No matching candidates found'
            ELSE 'Low confidence (' || ROUND(v_top_candidate.total_score, 2)::TEXT || ') - creating new person'
        END;

        -- Create new person
        v_new_person_id := trapper.create_person_basic(
            v_email_norm, v_phone_norm, p_first_name, p_last_name, p_source_system
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
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_resolve_identity IS
'Main identity resolution entry point with organization awareness.
Checks known_organizations FIRST to prevent duplicates for orgs like "Sonoma County Animal Services".
Decision types: auto_match, review_pending, new_entity, household_member, rejected, organization_linked, organization_flagged.';

-- ============================================================================
-- Update decision_type constraint to include new types
-- ============================================================================

\echo 'Updating decision_type enum...'

-- Add new decision types if not already present
DO $$
BEGIN
  -- Check if constraint exists and update it
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'trapper'
      AND table_name = 'data_engine_match_decisions'
      AND constraint_name LIKE '%decision_type%'
  ) THEN
    -- Drop old constraint if it exists
    ALTER TABLE trapper.data_engine_match_decisions
    DROP CONSTRAINT IF EXISTS data_engine_match_decisions_decision_type_check;
  END IF;

  -- Add updated constraint with new decision types
  ALTER TABLE trapper.data_engine_match_decisions
  ADD CONSTRAINT data_engine_match_decisions_decision_type_check
  CHECK (decision_type IN (
    'auto_match',
    'review_pending',
    'new_entity',
    'household_member',
    'rejected',
    'organization_linked',
    'organization_flagged'
  ));
EXCEPTION
  WHEN duplicate_object THEN
    -- Constraint already exists with correct values
    NULL;
END;
$$;

-- ============================================================================
-- View: Data Engine health with org stats
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_data_engine_health AS
SELECT
    -- Overall stats
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS decisions_24h,
    COUNT(*) FILTER (WHERE decision_type = 'auto_match' AND created_at > NOW() - INTERVAL '24 hours') AS auto_matches_24h,
    COUNT(*) FILTER (WHERE decision_type = 'new_entity' AND created_at > NOW() - INTERVAL '24 hours') AS new_entities_24h,
    COUNT(*) FILTER (WHERE decision_type = 'review_pending' AND review_status = 'pending') AS pending_reviews,
    COUNT(*) FILTER (WHERE decision_type = 'household_member' AND created_at > NOW() - INTERVAL '24 hours') AS household_24h,
    -- NEW: Organization stats
    COUNT(*) FILTER (WHERE decision_type = 'organization_linked' AND created_at > NOW() - INTERVAL '24 hours') AS org_linked_24h,
    COUNT(*) FILTER (WHERE decision_type = 'organization_flagged' AND created_at > NOW() - INTERVAL '24 hours') AS org_flagged_24h,
    -- Processing performance
    ROUND(AVG(processing_duration_ms) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours'), 1) AS avg_duration_ms_24h,
    MAX(processing_duration_ms) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS max_duration_ms_24h
FROM trapper.data_engine_match_decisions;

COMMENT ON VIEW trapper.v_data_engine_health IS
'Data Engine health metrics including organization matching stats.';

\echo ''
\echo '=== MIG_559 Complete ==='
\echo 'Modified: data_engine_resolve_identity() to check organizations first'
\echo 'Added: organization_linked and organization_flagged decision types'
\echo 'Updated: v_data_engine_health view with org stats'
