-- MIG_2932: Make identity resolution thresholds configurable via ops.app_config
-- FFS-528: Move hardcoded thresholds to app_config with SQL helper
--
-- Thresholds were hardcoded in data_engine_resolve_identity() (MIG_2831/2929)
-- and identifier_demotion_factor() (MIG_2827). Now read from ops.app_config
-- with fallback to current hardcoded values for zero-downtime.

BEGIN;

\echo 'MIG_2932: Configurable identity thresholds'

-- ============================================================================
-- 1. SQL config reader helper (mirrors TS getServerConfig pattern)
-- ============================================================================

\echo '1. Creating ops.get_config() helper...'

CREATE OR REPLACE FUNCTION ops.get_config(p_key TEXT, p_default JSONB)
RETURNS JSONB
LANGUAGE sql STABLE
AS $$
    SELECT COALESCE(
        (SELECT value FROM ops.app_config WHERE key = p_key),
        p_default
    );
$$;

CREATE OR REPLACE FUNCTION ops.get_config_numeric(p_key TEXT, p_default NUMERIC)
RETURNS NUMERIC
LANGUAGE sql STABLE
AS $$
    SELECT COALESCE(
        (SELECT value::text::numeric FROM ops.app_config WHERE key = p_key),
        p_default
    );
$$;

COMMENT ON FUNCTION ops.get_config(TEXT, JSONB) IS
'Read a config value from ops.app_config with JSONB fallback default.
Usage: ops.get_config(''identity.auto_match_weight'', ''20''::jsonb)';

COMMENT ON FUNCTION ops.get_config_numeric(TEXT, NUMERIC) IS
'Read a numeric config value from ops.app_config with fallback.
Usage: ops.get_config_numeric(''identity.auto_match_weight'', 20)';

-- ============================================================================
-- 2. Seed identity config keys
-- ============================================================================

\echo '2. Seeding identity config keys...'

INSERT INTO ops.app_config (key, value, description, category) VALUES
    ('identity.auto_match_weight', '20', 'Minimum Fellegi-Sunter weight for auto-matching (higher = stricter). Weight 20 ≈ score 0.98.', 'identity'),
    ('identity.review_weight', '5', 'Minimum weight to queue for human review (below this = new entity). Weight 5 ≈ score 0.73.', 'identity'),
    ('identity.phase05_name_similarity', '0.75', 'Jaro-Winkler threshold for Phase 0.5 name guard. Below this, identifier match falls through to full scoring instead of auto-matching. Prevents household member merging.', 'identity'),
    ('identity.phone_hub_threshold', '3', 'Number of people sharing a phone before demotion kicks in (Senzing pattern). 3+ = moderate sharing.', 'identity'),
    ('identity.email_hub_threshold', '3', 'Number of people sharing an email before demotion kicks in. 3+ = moderate sharing.', 'identity')
ON CONFLICT (key) DO NOTHING;

\echo '   Seeded 5 identity config keys'

-- ============================================================================
-- 3. Update data_engine_resolve_identity() to read from config
-- ============================================================================

\echo '3. Updating data_engine_resolve_identity() with configurable thresholds...'

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
BEGIN
    -- Read thresholds from config (with hardcoded fallbacks)
    v_auto_match_weight := ops.get_config_numeric('identity.auto_match_weight', 20);
    v_review_weight := ops.get_config_numeric('identity.review_weight', 5);
    v_phase05_name_sim := ops.get_config_numeric('identity.phase05_name_similarity', 0.75);

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

    IF v_existing_person_id IS NULL AND v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
        SELECT pi.person_id, p.display_name
        INTO v_existing_person_id, v_existing_display_name
        FROM sot.person_identifiers pi
        JOIN sot.people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'phone'
          AND pi.id_value_norm = v_phone_norm
          AND p.merged_into_person_id IS NULL
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
'V5: Unified identity resolution with configurable thresholds (MIG_2932/FFS-528).
All thresholds read from ops.app_config with hardcoded fallbacks:
- identity.auto_match_weight (default 20)
- identity.review_weight (default 5)
- identity.phase05_name_similarity (default 0.75)
Phase 0: should_be_person gate
Phase 0.5: Direct identifier lookup with name similarity guard
Phase 1+: V2 comparison-level scoring with name rarity
Changes take effect on next resolution call — no redeploy needed.';

-- ============================================================================
-- 4. Update identifier_demotion_factor() to read hub threshold from config
-- ============================================================================

\echo '4. Updating identifier_demotion_factor() with configurable hub threshold...'

CREATE OR REPLACE FUNCTION sot.identifier_demotion_factor(
    p_id_type TEXT,
    p_id_value_norm TEXT
)
RETURNS NUMERIC AS $$
DECLARE
    v_usage_count INT;
    v_hub_threshold INT;
BEGIN
    IF p_id_value_norm IS NULL OR p_id_value_norm = '' THEN
        RETURN 1.0;
    END IF;

    -- Read hub threshold from config
    v_hub_threshold := ops.get_config_numeric(
        CASE p_id_type
            WHEN 'email' THEN 'identity.email_hub_threshold'
            WHEN 'phone' THEN 'identity.phone_hub_threshold'
            ELSE 'identity.phone_hub_threshold'
        END,
        3
    )::int;

    -- Count how many unmerged people share this identifier
    SELECT COUNT(DISTINCT pi.person_id) INTO v_usage_count
    FROM sot.person_identifiers pi
    JOIN sot.people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
    WHERE pi.id_type = p_id_type
      AND pi.id_value_norm = p_id_value_norm;

    -- Demotion tiers (Senzing pattern)
    IF v_usage_count < v_hub_threshold THEN
        RETURN 1.0;  -- Normal
    ELSIF v_usage_count < v_hub_threshold * 2 THEN
        RETURN 0.6;  -- Moderate sharing
    ELSIF v_usage_count < v_hub_threshold * 3 THEN
        RETURN 0.2;  -- High sharing
    ELSE
        RETURN 0.05; -- Hub identifier (near-zero)
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.identifier_demotion_factor(TEXT, TEXT) IS
'MIG_2932: Senzing-style dynamic demotion for shared identifiers.
Hub threshold configurable via identity.phone_hub_threshold / identity.email_hub_threshold.
Multiplier applied to email/phone weights when shared by multiple people.';

-- ============================================================================
-- 5. Verification
-- ============================================================================

\echo ''
\echo 'Verification:'

SELECT key, value, description
FROM ops.app_config
WHERE category = 'identity'
ORDER BY key;

-- Test that config reader works
\echo ''
\echo 'Config reader test:'
SELECT
    ops.get_config_numeric('identity.auto_match_weight', 20) AS auto_match_weight,
    ops.get_config_numeric('identity.review_weight', 5) AS review_weight,
    ops.get_config_numeric('identity.phase05_name_similarity', 0.75) AS phase05_sim,
    ops.get_config_numeric('identity.phone_hub_threshold', 3) AS phone_hub,
    ops.get_config_numeric('identity.email_hub_threshold', 3) AS email_hub,
    ops.get_config_numeric('nonexistent.key', 42) AS fallback_test;

-- Smoke test: resolve identity still works
\echo ''
\echo 'Smoke test (should return rejected — test data):'
SELECT decision_type, reason
FROM sot.data_engine_resolve_identity('test@example.com', NULL, 'Test', 'User', NULL, 'atlas_ui');

-- Clean up smoke test
DELETE FROM sot.match_decisions WHERE source_system = 'atlas_ui' AND decision_reason = 'Failed should_be_person gate'
  AND created_at > NOW() - INTERVAL '1 minute';

\echo ''
\echo 'MIG_2932: Identity thresholds now configurable via ops.app_config'

COMMIT;
