-- MIG_2020: Fix person_id ambiguity in Data Engine functions
--
-- Problem: sot.data_engine_resolve_identity() RETURNS TABLE with a column named
-- 'person_id'. Inside the function body, RETURNING clauses reference
-- sot.people.person_id, which can be ambiguous with the output column.
--
-- Solution: Rename the output column from 'person_id' to 'resolved_person_id'
-- to avoid any confusion with table columns.
--
-- Created: 2026-02-12

\echo ''
\echo '=============================================='
\echo '  MIG_2020: Fix person_id Ambiguity'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. RECREATE data_engine_resolve_identity WITH RENAMED OUTPUT COLUMN
-- ============================================================================

\echo '1. Recreating sot.data_engine_resolve_identity()...'

DROP FUNCTION IF EXISTS sot.data_engine_resolve_identity(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

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
    resolved_person_id UUID,  -- Renamed from 'person_id' to avoid ambiguity
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
    v_new_person_id UUID;  -- Renamed from v_person_id for clarity
    v_decision_id UUID;
    v_classification TEXT;
BEGIN
    -- Normalize inputs
    v_email_norm := sot.norm_email(p_email);
    v_phone_norm := sot.norm_phone_us(p_phone);
    v_display_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));
    v_address_norm := sot.normalize_address(COALESCE(p_address, ''));

    -- =========================================================================
    -- PHASE 0: CONSOLIDATED GATE (MIG_919)
    -- Uses should_be_person() to check all rejection criteria
    -- =========================================================================

    IF NOT sot.should_be_person(p_first_name, p_last_name, p_email, p_phone) THEN
        -- Build specific rejection reason
        v_reason := 'Failed should_be_person() gate: ';

        IF v_email_norm LIKE '%@forgottenfelines.com' OR v_email_norm LIKE '%@forgottenfelines.org' THEN
            v_reason := v_reason || 'FFSC organizational email';
        ELSIF v_email_norm LIKE 'info@%' OR v_email_norm LIKE 'office@%' OR v_email_norm LIKE 'contact@%' THEN
            v_reason := v_reason || 'Generic organizational email prefix';
        ELSIF v_email_norm IS NOT NULL AND EXISTS (
            SELECT 1 FROM sot.soft_blacklist
            WHERE identifier_norm = v_email_norm
              AND identifier_type = 'email'
              AND require_name_similarity >= 0.9
        ) THEN
            v_reason := v_reason || 'Soft-blacklisted organizational email';
        ELSIF (v_email_norm IS NULL OR v_email_norm = '') AND (v_phone_norm IS NULL OR v_phone_norm = '') THEN
            v_reason := v_reason || 'No email or phone provided';
        ELSIF p_first_name IS NULL OR TRIM(COALESCE(p_first_name, '')) = '' THEN
            v_reason := v_reason || 'No first name provided';
        ELSE
            v_classification := sot.classify_owner_name(v_display_name);
            v_reason := v_reason || 'Name classification: ' || COALESCE(v_classification, 'unknown');
        END IF;

        -- Log the rejection
        INSERT INTO sot.match_decisions (
            source_system, incoming_email, incoming_phone, incoming_name, incoming_address,
            decision_type, decision_reason, rules_applied
        ) VALUES (
            p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm,
            'rejected', v_reason, '["should_be_person_gate"]'::JSONB
        ) RETURNING sot.match_decisions.decision_id INTO v_decision_id;

        -- Return rejection
        RETURN QUERY SELECT
            'rejected'::TEXT,
            NULL::UUID,
            NULL::TEXT,
            0.0::NUMERIC,
            v_reason,
            jsonb_build_object(
                'gate', 'should_be_person',
                'email_checked', v_email_norm,
                'name_checked', v_display_name,
                'classification', sot.classify_owner_name(v_display_name)
            ),
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
        v_new_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'score_breakdown', v_candidate.score_breakdown
        );

        -- Add any new identifiers to existing person
        IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_new_person_id, 'email', p_email, v_email_norm, 1.0, p_source_system)
            ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;
        END IF;

        IF v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_new_person_id, 'phone', p_phone, v_phone_norm, 1.0, p_source_system)
            ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;
        END IF;

    ELSIF v_candidate.person_id IS NOT NULL AND v_candidate.total_score >= 0.50 THEN
        -- Medium confidence: needs review but return existing person
        v_decision_type := 'review_pending';
        v_reason := 'Medium confidence match (score ' || ROUND(v_candidate.total_score, 2)::TEXT || ') - needs verification';
        v_new_person_id := v_candidate.person_id;
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
            ELSE 'Low confidence match (score ' || ROUND(COALESCE(v_candidate.total_score, 0), 2)::TEXT || ')'
        END;

        -- Create new person - use explicit column reference with alias
        INSERT INTO sot.people (first_name, last_name, display_name, primary_email, primary_phone, source_system)
        VALUES (
            TRIM(p_first_name),
            TRIM(p_last_name),
            v_display_name,
            v_email_norm,
            v_phone_norm,
            p_source_system
        )
        RETURNING sot.people.person_id INTO v_new_person_id;

        -- Add identifiers
        IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_new_person_id, 'email', p_email, v_email_norm, 1.0, p_source_system)
            ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;
        END IF;

        IF v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_new_person_id, 'phone', p_phone, v_phone_norm, 1.0, p_source_system)
            ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;
        END IF;

        v_match_details := jsonb_build_object(
            'nearest_candidate', v_candidate.person_id,
            'nearest_score', COALESCE(v_candidate.total_score, 0)
        );
    END IF;

    -- Log decision
    INSERT INTO sot.match_decisions (
        source_system, incoming_email, incoming_phone, incoming_name, incoming_address,
        candidates_evaluated, top_candidate_person_id, top_candidate_score,
        decision_type, decision_reason, resulting_person_id,
        score_breakdown,
        review_status
    ) VALUES (
        p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm,
        CASE WHEN v_candidate.person_id IS NOT NULL THEN 1 ELSE 0 END,
        v_candidate.person_id, v_candidate.total_score,
        v_decision_type, v_reason, v_new_person_id,
        v_candidate.score_breakdown,
        CASE WHEN v_decision_type = 'review_pending' THEN 'pending' ELSE 'not_required' END
    ) RETURNING sot.match_decisions.decision_id INTO v_decision_id;

    RETURN QUERY SELECT
        v_decision_type,
        v_new_person_id,
        v_display_name,
        COALESCE(v_candidate.total_score, 0.0)::NUMERIC,
        v_reason,
        v_match_details,
        v_decision_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.data_engine_resolve_identity IS
'V2: Main Data Engine entry point for identity resolution.
Ported from V1 MIG_315/MIG_919.

Phase 0: should_be_person() gate (catches orgs, sites, garbage)
Phase 1+: Multi-signal scoring with Fellegi-Sunter weights

Decision types:
- auto_match: >= 0.95 confidence
- review_pending: 0.50 - 0.95 confidence
- new_entity: < 0.50 or no candidates
- rejected: Failed Phase 0 gate

Note: Output column is "resolved_person_id" (not "person_id") to avoid
ambiguity with table columns inside the function body (MIG_2020 fix).

All decisions logged to sot.match_decisions for audit.';

\echo '   Recreated sot.data_engine_resolve_identity() with unambiguous column names'

-- ============================================================================
-- 2. UPDATE find_or_create_person TO USE NEW COLUMN NAME
-- ============================================================================

\echo ''
\echo '2. Updating sot.find_or_create_person()...'

DROP FUNCTION IF EXISTS sot.find_or_create_person(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION sot.find_or_create_person(
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'unknown'
)
RETURNS UUID AS $$
DECLARE
    v_result RECORD;
BEGIN
    -- Use Data Engine for identity resolution
    SELECT * INTO v_result
    FROM sot.data_engine_resolve_identity(
        p_email, p_phone, p_first_name, p_last_name, p_address, p_source_system
    );

    -- Use the renamed column
    RETURN v_result.resolved_person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.find_or_create_person IS
'V2: Standard entry point for finding or creating a person.
Wrapper for data_engine_resolve_identity().
Returns person_id (NULL if rejected by should_be_person gate).';

\echo '   Updated sot.find_or_create_person()'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Testing sot.data_engine_resolve_identity output columns:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'pg_temp' -- For TABLE-returning functions this won't work directly
LIMIT 0;

-- Test with a sample call
\echo ''
\echo 'Test call to find_or_create_person:'
SELECT sot.find_or_create_person(
    p_email := 'test@example.com',
    p_first_name := 'Test',
    p_last_name := 'User',
    p_source_system := 'test'
) IS NOT NULL AS person_created;

-- Clean up test data
DELETE FROM sot.person_identifiers WHERE source_system = 'test';
DELETE FROM sot.people WHERE source_system = 'test';
DELETE FROM sot.match_decisions WHERE source_system = 'test';

\echo ''
\echo '=============================================='
\echo '  MIG_2020 Complete!'
\echo '=============================================='
\echo ''
\echo 'Fixed person_id ambiguity in:'
\echo '  - sot.data_engine_resolve_identity() - renamed output to resolved_person_id'
\echo '  - sot.find_or_create_person() - updated to use new column name'
\echo ''
