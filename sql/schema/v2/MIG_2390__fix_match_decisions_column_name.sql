-- MIG_2390: Fix match_decisions column name in data_engine_resolve_identity
--
-- Problem: MIG_2334 introduced a bug where the function uses 'reason' column
-- but the table has 'decision_reason' column. This breaks all identity resolution.
--
-- Fix: Update the function to use the correct column name.
--
-- Created: 2026-02-19

\echo ''
\echo '=============================================='
\echo '  MIG_2390: Fix match_decisions column name'
\echo '=============================================='
\echo ''

-- Fix data_engine_resolve_identity to use decision_reason instead of reason
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
    v_classification TEXT;
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

        -- FIXED: Use decision_reason instead of reason
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

    -- No email AND no phone = reject (can't create or match without identifiers)
    IF (v_email_norm IS NULL OR v_email_norm = '') AND (v_phone_norm IS NULL OR v_phone_norm = '') THEN
        v_decision_type := 'rejected';
        v_reason := 'No valid email or phone provided';
        v_match_details := jsonb_build_object(
            'first_name', p_first_name,
            'last_name', p_last_name,
            'raw_email', p_email,
            'raw_phone', p_phone
        );

        -- FIXED: Use decision_reason instead of reason
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
    -- Before scoring, check if identifier already exists
    -- =========================================================================

    -- Try email first
    IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
        SELECT pi.person_id INTO v_existing_person_id
        FROM sot.person_identifiers pi
        JOIN sot.people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = v_email_norm
          AND p.merged_into_person_id IS NULL
        LIMIT 1;
    END IF;

    -- Try phone if email didn't match
    IF v_existing_person_id IS NULL AND v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
        SELECT pi.person_id INTO v_existing_person_id
        FROM sot.person_identifiers pi
        JOIN sot.people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'phone'
          AND pi.id_value_norm = v_phone_norm
          AND p.merged_into_person_id IS NULL
        LIMIT 1;
    END IF;

    -- If we found an existing person by identifier, use them directly
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

        -- Try to add any new identifiers
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
    -- PHASE 1+: SCORING AND MATCHING
    -- =========================================================================

    -- Get best candidate from scoring function
    SELECT * INTO v_candidate
    FROM sot.data_engine_score_candidates(
        v_email_norm,
        v_phone_norm,
        v_display_name,
        v_address_norm
    )
    LIMIT 1;

    -- Decision logic based on score
    IF v_candidate.person_id IS NOT NULL AND v_candidate.total_score >= 0.95 THEN
        -- High confidence: auto-match
        v_decision_type := 'auto_match';
        v_reason := 'High confidence match (score ' || ROUND(v_candidate.total_score, 2)::TEXT || ')';
        v_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'score_breakdown', v_candidate.score_breakdown
        );

        -- Add any new identifiers to existing person
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

    ELSIF v_candidate.person_id IS NOT NULL AND v_candidate.total_score >= 0.50 THEN
        -- Medium confidence: needs review but return existing person
        v_decision_type := 'review_pending';
        v_reason := 'Medium confidence match (score ' || ROUND(v_candidate.total_score, 2)::TEXT || ') - needs verification';
        v_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'score_breakdown', v_candidate.score_breakdown
        );

    ELSE
        -- Low confidence or no match: create new person
        v_decision_type := 'new_entity';
        v_reason := CASE
            WHEN v_candidate.person_id IS NULL THEN 'No matching candidates found'
            ELSE 'Best match score too low (' || ROUND(COALESCE(v_candidate.total_score, 0), 2)::TEXT || ')'
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

        -- Add identifiers
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
            'best_candidate_score', COALESCE(v_candidate.total_score, 0)
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

    -- Return result
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
'V2: Unified identity resolution (MIG_2390 - fixed column names).
Phase 0: should_be_person gate
Phase 0.5: Direct identifier lookup
Phase 1+: Fellegi-Sunter scoring
Auto-match threshold: 0.95
Review threshold: 0.50
Creates new person below threshold.';

\echo ''
\echo 'Testing data_engine_resolve_identity...'

SELECT
    decision_type,
    resolved_person_id IS NOT NULL as has_person,
    reason
FROM sot.data_engine_resolve_identity(
    'test@example.com',
    '7075551234',
    'Test',
    'User',
    '123 Main St',
    'test'
) LIMIT 1;

\echo ''
\echo 'MIG_2390 complete - Fixed decision_reason column name'
\echo ''
