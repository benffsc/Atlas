-- ============================================================================
-- MIG_919: Data Engine Consolidated Gate (DATA_GAP_013)
-- ============================================================================
-- Problem: Identity validation is scattered across multiple entry points:
--   - should_be_person() only called by ClinicHQ processing
--   - data_engine_resolve_identity() has its own partial checks
--   - JS ingest scripts can bypass all validation
--
-- Solution: Add should_be_person() as Phase 0 in data_engine_resolve_identity().
--           This makes Data Engine the SINGLE FORTRESS for all identity decisions.
--
-- After this migration, ALL paths to person creation go through:
--   any source → find_or_create_person() → data_engine_resolve_identity()
--                                              ↓
--                                    Phase 0: should_be_person() ← SINGLE GATE
--
-- Related: MIG_915 (should_be_person org email check), DATA_GAP_009, DATA_GAP_010
-- ============================================================================

\echo '=== MIG_919: Data Engine Consolidated Gate ==='
\echo ''
\echo 'Making data_engine_resolve_identity() the SINGLE FORTRESS for identity validation.'
\echo ''

-- ============================================================================
-- Phase 1: Update data_engine_resolve_identity() with Phase 0 gate
-- ============================================================================

\echo 'Phase 1: Updating data_engine_resolve_identity() with should_be_person() gate...'

CREATE OR REPLACE FUNCTION trapper.data_engine_resolve_identity(
    p_email TEXT,
    p_phone TEXT,
    p_first_name TEXT,
    p_last_name TEXT,
    p_address TEXT,
    p_source_system TEXT
)
RETURNS TABLE(
    decision_type TEXT,
    person_id UUID,
    display_name TEXT,
    confidence NUMERIC,
    reason TEXT,
    match_details JSONB,
    created_place_id UUID
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
    v_place_id UUID;
    v_has_address_name_match BOOLEAN := FALSE;
    v_classification TEXT;
BEGIN
    -- Normalize inputs
    v_email_norm := LOWER(TRIM(COALESCE(p_email, '')));
    v_phone_norm := trapper.norm_phone_us(COALESCE(p_phone, ''));
    v_display_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));
    v_address_norm := UPPER(TRIM(COALESCE(p_address, '')));

    -- =========================================================================
    -- PHASE 0: CONSOLIDATED GATE (MIG_919)
    -- =========================================================================
    -- This is now the SINGLE place where we decide if this should be a person.
    -- All sources go through here: ClinicHQ, web_intake, ShelterLuv, JS scripts.
    --
    -- Uses should_be_person() which checks:
    --   1. Org email domains (@forgottenfelines.com, @forgottenfelines.org)
    --   2. Generic org prefixes (info@, office@, contact@, admin@, help@, support@)
    --   3. Soft-blacklisted emails with high threshold (require_name_similarity >= 0.9)
    --   4. Must have email OR phone
    --   5. Must have first name
    --   6. classify_owner_name() must return 'likely_person'
    -- =========================================================================

    IF NOT trapper.should_be_person(p_first_name, p_last_name, p_email, p_phone) THEN
        -- Build specific rejection reason for logging
        v_reason := 'Failed should_be_person() gate: ';

        -- Check which specific rule triggered rejection
        IF v_email_norm LIKE '%@forgottenfelines.com' OR v_email_norm LIKE '%@forgottenfelines.org' THEN
            v_reason := v_reason || 'FFSC organizational email';
        ELSIF v_email_norm LIKE 'info@%' OR v_email_norm LIKE 'office@%' OR v_email_norm LIKE 'contact@%'
              OR v_email_norm LIKE 'admin@%' OR v_email_norm LIKE 'help@%' OR v_email_norm LIKE 'support@%' THEN
            v_reason := v_reason || 'Generic organizational email prefix';
        ELSIF v_email_norm != '' AND EXISTS (
            SELECT 1 FROM trapper.data_engine_soft_blacklist
            WHERE identifier_norm = v_email_norm
              AND identifier_type = 'email'
              AND require_name_similarity >= 0.9
        ) THEN
            v_reason := v_reason || 'Soft-blacklisted organizational email';
        ELSIF (v_email_norm = '' OR v_email_norm IS NULL) AND (v_phone_norm = '' OR v_phone_norm IS NULL) THEN
            v_reason := v_reason || 'No email or phone provided';
        ELSIF p_first_name IS NULL OR TRIM(COALESCE(p_first_name, '')) = '' THEN
            v_reason := v_reason || 'No first name provided';
        ELSE
            -- Must be name classification rejection
            v_classification := trapper.classify_owner_name(v_display_name);
            CASE v_classification
                WHEN 'organization' THEN
                    v_reason := v_reason || 'Organization name detected: ' || v_display_name;
                WHEN 'address' THEN
                    v_reason := v_reason || 'Address pattern detected: ' || v_display_name;
                WHEN 'apartment_complex' THEN
                    v_reason := v_reason || 'Apartment complex name detected: ' || v_display_name;
                WHEN 'garbage' THEN
                    v_reason := v_reason || 'Garbage/test name detected: ' || v_display_name;
                ELSE
                    v_reason := v_reason || 'Classification: ' || COALESCE(v_classification, 'unknown');
            END CASE;
        END IF;

        -- Log the rejection to match decisions
        INSERT INTO trapper.data_engine_match_decisions (
            source_system, input_email, input_phone, input_name, input_address,
            decision_type, matched_person_id, confidence_score, match_rules, reason
        ) VALUES (
            p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm,
            'rejected', NULL, 0.0, ARRAY['should_be_person_gate'], v_reason
        );

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
                'classification', trapper.classify_owner_name(v_display_name)
            ),
            NULL::UUID;
        RETURN;
    END IF;

    -- =========================================================================
    -- PHASE 1: LEGACY INTERNAL/TEST ACCOUNT CHECK
    -- =========================================================================
    -- Note: This is now largely redundant with Phase 0, but kept for defense-in-depth.
    -- should_be_person() already catches @forgottenfelines.com and @test.% patterns.
    -- =========================================================================

    -- Kept for backwards compatibility but most should be caught by Phase 0
    IF v_email_norm LIKE '%@test.%' OR v_email_norm LIKE 'test@%' THEN
        RETURN QUERY SELECT
            'rejected'::TEXT,
            NULL::UUID,
            NULL::TEXT,
            0.0::NUMERIC,
            'Test account'::TEXT,
            '{}'::JSONB,
            NULL::UUID;
        RETURN;
    END IF;

    -- =========================================================================
    -- PHASE 2+: EXISTING LOGIC (unchanged from MIG_896)
    -- =========================================================================

    -- Find or create place if address provided
    IF v_address_norm != '' THEN
        SELECT trapper.find_or_create_place_deduped(p_address, NULL, NULL, NULL, p_source_system)
        INTO v_place_id;
    END IF;

    -- Get best candidate from scoring function
    SELECT * INTO v_candidate
    FROM trapper.data_engine_score_candidates(
        NULLIF(v_email_norm, ''),
        NULLIF(v_phone_norm, ''),
        NULLIF(v_display_name, ''),
        NULLIF(v_address_norm, '')
    )
    LIMIT 1;

    -- MIG_896: Check if this is an address_name_similarity match
    IF v_candidate.person_id IS NOT NULL THEN
        v_has_address_name_match := 'address_name_similarity' = ANY(v_candidate.matched_rules);
    END IF;

    -- Decision logic
    IF v_candidate.person_id IS NULL THEN
        -- No match found - create new person
        v_decision_type := 'new_entity';
        v_reason := 'No matching person found';
        v_match_details := '{}'::JSONB;

        -- Create new person
        SELECT trapper.find_or_create_person(
            NULLIF(v_email_norm, ''),
            NULLIF(v_phone_norm, ''),
            p_first_name,
            p_last_name,
            p_address,
            p_source_system
        ) INTO v_person_id;

    ELSIF v_has_address_name_match THEN
        -- MIG_896: Address+name match found - ALWAYS route to review
        v_decision_type := 'review_pending';
        v_reason := 'Matched by address and name similarity - please verify identity (returning historical person)';
        v_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'score_breakdown', v_candidate.score_breakdown,
            'matched_rules', v_candidate.matched_rules,
            'address_name_fallback', true
        );

        -- Log to match decisions
        INSERT INTO trapper.data_engine_match_decisions (
            source_system, input_email, input_phone, input_name, input_address,
            decision_type, matched_person_id, confidence_score, match_rules, reason
        ) VALUES (
            p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm,
            'review_pending', v_candidate.person_id, v_candidate.total_score,
            v_candidate.matched_rules, v_reason
        );

    ELSIF v_candidate.total_score >= 0.95 THEN
        -- High confidence - auto match
        v_decision_type := 'auto_match';
        v_reason := 'High confidence match';
        v_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'score_breakdown', v_candidate.score_breakdown,
            'matched_rules', v_candidate.matched_rules
        );

        -- Add new identifiers to existing person
        IF v_email_norm != '' AND NOT EXISTS (
            SELECT 1 FROM trapper.person_identifiers pi
            WHERE pi.person_id = v_candidate.person_id
            AND pi.id_type = 'email' AND pi.id_value_norm = v_email_norm
        ) THEN
            INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_candidate.person_id, 'email', p_email, v_email_norm, 0.9, p_source_system)
            ON CONFLICT DO NOTHING;
        END IF;

        IF v_phone_norm != '' AND NOT EXISTS (
            SELECT 1 FROM trapper.person_identifiers pi
            WHERE pi.person_id = v_candidate.person_id
            AND pi.id_type = 'phone' AND pi.id_value_norm = v_phone_norm
        ) THEN
            INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_candidate.person_id, 'phone', p_phone, v_phone_norm, 0.9, p_source_system)
            ON CONFLICT DO NOTHING;
        END IF;

        -- Link to place if not already linked
        IF v_place_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM trapper.person_place_relationships ppr
            WHERE ppr.person_id = v_candidate.person_id AND ppr.place_id = v_place_id
        ) THEN
            INSERT INTO trapper.person_place_relationships (person_id, place_id, role, confidence, source_system, source_table)
            VALUES (v_candidate.person_id, v_place_id, 'resident', 0.8, p_source_system, 'data_engine')
            ON CONFLICT DO NOTHING;
        END IF;

    ELSIF v_candidate.total_score >= 0.50 THEN
        -- Medium confidence - needs review
        v_decision_type := 'review_pending';
        v_reason := 'Medium confidence match - needs verification';
        v_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'score_breakdown', v_candidate.score_breakdown,
            'matched_rules', v_candidate.matched_rules
        );

        -- Log to match decisions
        INSERT INTO trapper.data_engine_match_decisions (
            source_system, input_email, input_phone, input_name, input_address,
            decision_type, matched_person_id, confidence_score, match_rules, reason
        ) VALUES (
            p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm,
            'review_pending', v_candidate.person_id, v_candidate.total_score,
            v_candidate.matched_rules, v_reason
        );

    ELSIF v_candidate.is_household_candidate THEN
        -- Household member detection
        v_decision_type := 'household_member';
        v_reason := 'Possible household member at same address';

        -- Create new person and add to household
        SELECT trapper.find_or_create_person(
            NULLIF(v_email_norm, ''),
            NULLIF(v_phone_norm, ''),
            p_first_name,
            p_last_name,
            p_address,
            p_source_system
        ) INTO v_person_id;

        -- Add to household if one exists
        IF v_candidate.household_id IS NOT NULL THEN
            INSERT INTO trapper.household_members (household_id, person_id, role)
            VALUES (v_candidate.household_id, v_person_id, 'member')
            ON CONFLICT DO NOTHING;
        END IF;

        v_match_details := jsonb_build_object(
            'related_person_id', v_candidate.person_id,
            'household_id', v_candidate.household_id,
            'score', v_candidate.total_score
        );

    ELSE
        -- Low confidence - create new
        v_decision_type := 'new_entity';
        v_reason := 'Low confidence match - creating new person';
        v_match_details := jsonb_build_object(
            'nearest_match', v_candidate.person_id,
            'score', v_candidate.total_score
        );

        SELECT trapper.find_or_create_person(
            NULLIF(v_email_norm, ''),
            NULLIF(v_phone_norm, ''),
            p_first_name,
            p_last_name,
            p_address,
            p_source_system
        ) INTO v_person_id;
    END IF;

    RETURN QUERY SELECT
        v_decision_type,
        v_person_id,
        v_display_name,
        COALESCE(v_candidate.total_score, 0.0)::NUMERIC,
        v_reason,
        v_match_details,
        v_place_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_resolve_identity(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
'MIG_919: CONSOLIDATED IDENTITY GATE (DATA_GAP_013)

This function is now the SINGLE FORTRESS for all identity resolution.
Every path to person creation goes through here:
  - ClinicHQ via process_clinichq_owner_info() → find_or_create_person()
  - Web Intake via create_person_from_intake() → find_or_create_person()
  - ShelterLuv via process_shelterluv_person() → find_or_create_person()
  - JS ingest scripts → find_or_create_person()
  - API routes → find_or_create_person()

All of these ultimately call data_engine_resolve_identity().

Phase 0 (NEW): should_be_person() gate catches ALL rejectable inputs:
  - Org emails (@forgottenfelines.com, info@, office@, etc.)
  - Soft-blacklisted org emails
  - Location names (addresses, apartments, organizations)
  - No contact info (no email AND no phone)
  - No first name

Phase 1+: Unchanged from MIG_896 (scoring, matching, address+name fallback)

Invariants Enforced:
  INV-17: Organizational emails rejected at Phase 0
  INV-18: Location names rejected at Phase 0';

-- ============================================================================
-- Phase 2: Verify the gate
-- ============================================================================

\echo ''
\echo 'Phase 2: Verifying the consolidated gate...'

-- Test org email rejection
SELECT 'Testing org email rejection:' as info;
SELECT
    decision_type,
    reason
FROM trapper.data_engine_resolve_identity(
    'info@forgottenfelines.com', NULL, 'Test', 'Person', NULL, 'test'
);

-- Test location name rejection
SELECT 'Testing location name rejection:' as info;
SELECT
    decision_type,
    reason
FROM trapper.data_engine_resolve_identity(
    'test@example.com', '7075551234', 'Golden Gate', 'Transit', NULL, 'test'
);

-- Test valid person (should pass gate)
SELECT 'Testing valid person (should pass gate):' as info;
SELECT
    decision_type,
    reason
FROM trapper.data_engine_resolve_identity(
    'john.doe@gmail.com', '7075551234', 'John', 'Doe', '123 Main St, Santa Rosa, CA', 'test'
);

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_919 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Added Phase 0: should_be_person() gate at START of data_engine_resolve_identity()'
\echo '  2. All rejections now logged to data_engine_match_decisions with specific reasons'
\echo '  3. Preserved all existing scoring and matching logic from MIG_896'
\echo ''
\echo 'Architecture After:'
\echo '  ALL SOURCES → find_or_create_person() → data_engine_resolve_identity()'
\echo '                                              ↓'
\echo '                                    Phase 0: should_be_person() ← SINGLE GATE'
\echo '                                              ↓'
\echo '                                    Phase 1+: Scoring and matching'
\echo ''
\echo 'Invariants Enforced:'
\echo '  INV-17: Organizational emails rejected at Phase 0'
\echo '  INV-18: Location names rejected at Phase 0'
\echo ''
\echo 'DATA_GAP_013: Identity Resolution Consolidation - CORE GATE INSTALLED'
\echo ''
