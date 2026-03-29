-- MIG_2990: Phase 0.5 Address Guard for Identity Resolution
--
-- FFS-860: Phone-only matches across different addresses can merge unrelated people.
-- Example: Gordon Maxwell (1251 Lohrman) matched to Susan Simons via shared phone
-- 7075436499 because phone lookup had no address check.
--
-- D1: Add address compatibility check to Phase 0.5 phone lookup
-- D2: Phone-only matches with address disagreement → new_entity (not review_pending)
-- D3: Configurable flag in ops.app_config
--
-- Created: 2026-03-26

\echo ''
\echo '=============================================='
\echo '  MIG_2990: Phase 0.5 Address Guard'
\echo '=============================================='
\echo ''

-- ============================================================================
-- D3. CONFIGURABLE FLAG (before function so it can be read)
-- ============================================================================

\echo 'D3. Adding config flag...'

INSERT INTO ops.app_config (key, value, description, category) VALUES
  ('identity.phone_only_requires_address_match', 'true',
   'Phone-only matches with address disagreement create new entities instead of review_pending',
   'identity')
ON CONFLICT (key) DO NOTHING;

\echo '  → Config flag added'

-- ============================================================================
-- D1 + D2. UPDATE data_engine_resolve_identity()
-- ============================================================================

\echo 'D1/D2. Updating data_engine_resolve_identity with address guard...'

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
    v_existing_person_id UUID;
    v_existing_display_name TEXT;
    v_name_similarity NUMERIC;
    -- Configurable thresholds (read once per call)
    v_auto_match_weight NUMERIC;
    v_review_weight NUMERIC;
    v_phase05_name_sim NUMERIC;
    v_phone_requires_addr BOOLEAN;
BEGIN
    -- Read thresholds from config (with hardcoded fallbacks)
    v_auto_match_weight := ops.get_config_numeric('identity.auto_match_weight', 20);
    v_review_weight := ops.get_config_numeric('identity.review_weight', 5);
    v_phase05_name_sim := ops.get_config_numeric('identity.phase05_name_similarity', 0.75);
    v_phone_requires_addr := ops.get_config_value('identity.phone_only_requires_address_match', 'true') = 'true';

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

    -- No email AND no phone = reject
    IF (v_email_norm IS NULL OR v_email_norm = '') AND (v_phone_norm IS NULL OR v_phone_norm = '') THEN
        v_decision_type := 'rejected';
        v_reason := 'No valid email or phone provided';
        v_match_details := jsonb_build_object(
            'first_name', p_first_name,
            'last_name', p_last_name,
            'raw_email', p_email,
            'raw_phone', p_phone
        );

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
    -- MIG_2929/FFS-524: Name similarity check to prevent household merging
    -- MIG_2932/FFS-528: Threshold now configurable via identity.phase05_name_similarity
    -- MIG_2990/FFS-860: Address guard on phone-only lookup
    -- =========================================================================

    IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
        SELECT pi.person_id, p.display_name
        INTO v_existing_person_id, v_existing_display_name
        FROM sot.person_identifiers pi
        JOIN sot.people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = v_email_norm
          AND p.merged_into_person_id IS NULL
        LIMIT 1;
    END IF;

    -- D1: Phone lookup with address compatibility check (MIG_2990/FFS-860)
    -- Only match by phone if addresses are compatible (or unknown)
    IF v_existing_person_id IS NULL AND v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
        SELECT pi.person_id, p.display_name
        INTO v_existing_person_id, v_existing_display_name
        FROM sot.person_identifiers pi
        JOIN sot.people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'phone'
          AND pi.id_value_norm = v_phone_norm
          AND p.merged_into_person_id IS NULL
          -- Address guard: allow match if addresses are compatible or unknown
          AND (
            -- No address provided → can't check, allow match
            p_address IS NULL OR TRIM(p_address) = ''
            -- Person has no known address → can't check, allow match
            OR p.primary_address_id IS NULL
            -- Person's address matches → allow match
            OR EXISTS (
              SELECT 1 FROM sot.places pl
              WHERE pl.place_id = p.primary_address_id
                AND similarity(LOWER(pl.formatted_address), LOWER(p_address)) > 0.3
            )
            -- Person has primary_address_id but place has no formatted_address → can't check
            OR NOT EXISTS (
              SELECT 1 FROM sot.places pl
              WHERE pl.place_id = p.primary_address_id AND pl.formatted_address IS NOT NULL
            )
          )
        LIMIT 1;
    END IF;

    IF v_existing_person_id IS NOT NULL THEN
        v_name_similarity := 1.0;
        IF v_display_name IS NOT NULL AND v_display_name != ''
           AND v_existing_display_name IS NOT NULL AND v_existing_display_name != '' THEN
            SELECT cn.jaro_winkler_similarity INTO v_name_similarity
            FROM sot.compare_names(v_display_name, v_existing_display_name) cn;
        END IF;

        IF v_name_similarity >= v_phase05_name_sim THEN
            -- Names similar enough → auto-match
            v_decision_type := 'auto_match';
            v_reason := 'Matched by existing identifier';
            v_person_id := v_existing_person_id;

            v_match_details := jsonb_build_object(
                'matched_person_id', v_person_id,
                'matched_name', v_existing_display_name,
                'match_type', 'direct_identifier_lookup',
                'name_similarity', v_name_similarity,
                'threshold', v_phase05_name_sim
            );

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

            -- MIG_2914: Enrich NULL names on auto_match when source=atlas_ui
            IF p_source_system = 'atlas_ui' THEN
                UPDATE sot.people
                SET first_name = COALESCE(first_name, NULLIF(TRIM(p_first_name), '')),
                    last_name = COALESCE(last_name, NULLIF(TRIM(p_last_name), '')),
                    display_name = COALESCE(NULLIF(display_name, ''), v_display_name),
                    is_verified = TRUE
                WHERE sot.people.person_id = v_person_id
                  AND (first_name IS NULL OR last_name IS NULL);
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
                v_existing_display_name,
                1.0::NUMERIC,
                v_reason,
                v_match_details,
                v_decision_id;
            RETURN;
        ELSE
            -- Names too different → potential household member, fall through
            RAISE NOTICE 'Phase 0.5 name guard: "%" vs "%" (similarity %, threshold %) — falling through to scoring',
                v_display_name, v_existing_display_name, ROUND(v_name_similarity, 2), v_phase05_name_sim;
        END IF;
    END IF;

    -- =========================================================================
    -- PHASE 1+: V2 SCORING AND MATCHING (MIG_2830)
    -- MIG_2932/FFS-528: Thresholds now configurable
    -- =========================================================================

    SELECT * INTO v_candidate
    FROM sot.data_engine_score_candidates_v2(
        v_email_norm,
        v_phone_norm,
        v_display_name,
        v_address_norm
    )
    LIMIT 1;

    -- Decision logic using configurable thresholds
    IF v_candidate.person_id IS NOT NULL AND v_candidate.total_weight >= v_auto_match_weight THEN
        v_decision_type := 'auto_match';
        v_reason := 'High confidence match (weight ' || ROUND(v_candidate.total_weight, 1)::TEXT ||
                     ', score ' || ROUND(v_candidate.total_score, 2)::TEXT ||
                     ', threshold ' || v_auto_match_weight::TEXT || ')';
        v_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'total_weight', v_candidate.total_weight,
            'score_breakdown', v_candidate.score_breakdown,
            'scoring_version', 'v2',
            'auto_match_threshold', v_auto_match_weight
        );

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

    ELSIF v_candidate.person_id IS NOT NULL AND v_candidate.total_weight > v_review_weight THEN
        -- D2: Phone-only match with address disagreement → new_entity (MIG_2990/FFS-860)
        IF v_phone_requires_addr
           AND v_candidate.phone_score IS NOT NULL AND v_candidate.phone_score > 0
           AND (v_candidate.email_score IS NULL OR v_candidate.email_score <= 0)
           AND v_candidate.address_score IS NOT NULL AND v_candidate.address_score < 0 THEN
            -- Phone matched but addresses disagree and no email match
            -- This is likely a shared phone (household member, not same person)
            v_decision_type := 'new_entity';
            v_reason := 'Phone-only match with address disagreement (phone_score ' ||
                         ROUND(v_candidate.phone_score, 1)::TEXT ||
                         ', addr_score ' || ROUND(v_candidate.address_score, 1)::TEXT ||
                         ') — creating new entity per MIG_2990';

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
                'would_have_matched', v_candidate.person_id,
                'would_have_matched_name', v_candidate.display_name,
                'phone_score', v_candidate.phone_score,
                'email_score', v_candidate.email_score,
                'address_score', v_candidate.address_score,
                'total_weight', v_candidate.total_weight,
                'scoring_version', 'v2',
                'guard', 'phone_only_address_disagreement'
            );
        ELSE
            v_decision_type := 'review_pending';
            v_reason := 'Medium confidence match (weight ' || ROUND(v_candidate.total_weight, 1)::TEXT ||
                         ', score ' || ROUND(v_candidate.total_score, 2)::TEXT ||
                         ') - needs verification (threshold ' || v_auto_match_weight::TEXT || ')';
            v_person_id := v_candidate.person_id;
            v_match_details := jsonb_build_object(
                'matched_person_id', v_candidate.person_id,
                'matched_name', v_candidate.display_name,
                'score', v_candidate.total_score,
                'total_weight', v_candidate.total_weight,
                'score_breakdown', v_candidate.score_breakdown,
                'scoring_version', 'v2',
                'review_threshold', v_review_weight
            );
        END IF;

    ELSE
        v_decision_type := 'new_entity';
        v_reason := CASE
            WHEN v_candidate.person_id IS NULL THEN 'No matching candidates found'
            ELSE 'Best match weight too low (' || ROUND(COALESCE(v_candidate.total_weight, 0), 1)::TEXT || ')'
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
            'best_candidate_weight', COALESCE(v_candidate.total_weight, 0),
            'best_candidate_score', COALESCE(v_candidate.total_score, 0),
            'scoring_version', 'v2'
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
'V6: Unified identity resolution with address guard (MIG_2990/FFS-860).
All thresholds read from ops.app_config with hardcoded fallbacks:
- identity.auto_match_weight (default 20)
- identity.review_weight (default 5)
- identity.phase05_name_similarity (default 0.75)
- identity.phone_only_requires_address_match (default true)
Phase 0: should_be_person gate
Phase 0.5: Direct identifier lookup with name similarity + ADDRESS guard on phone lookup
Phase 1+: V2 comparison-level scoring with name rarity
D1: Phone lookup in Phase 0.5 now checks address compatibility (similarity > 0.3)
D2: Phone-only matches with address disagreement → new_entity instead of review_pending
Changes take effect on next resolution call — no redeploy needed.';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo 'Verification...'

DO $$
DECLARE
    v_config_val TEXT;
BEGIN
    SELECT value INTO v_config_val
    FROM ops.app_config
    WHERE key = 'identity.phone_only_requires_address_match';

    RAISE NOTICE 'Config identity.phone_only_requires_address_match = %', v_config_val;
    RAISE NOTICE 'Function updated with Phase 0.5 address guard + Phase 1+ phone-only rejection';
END $$;

\echo ''
\echo '=============================================='
\echo '  MIG_2990 COMPLETE'
\echo '=============================================='
\echo ''
