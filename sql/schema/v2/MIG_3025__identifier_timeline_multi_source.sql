-- MIG_3025: Identifier Timeline + Multi-Source Tracking
--
-- Problem: person_identifiers has a single source_system TEXT and created_at timestamp.
-- When ClinicHQ re-reports Susan's phone in a new batch, ON CONFLICT DO NOTHING means
-- the identifier stays frozen. We can't distinguish a phone confirmed by VolunteerHub +
-- ClinicHQ + ShelterLuv from one seen once in 2024.
--
-- Solution:
--   1. Add last_confirmed_at, source_systems[], confirmation_count columns
--   2. Create sot.confirm_identifier() centralized write function
--   3. Backfill existing rows
--   4. Replace all INSERT ... ON CONFLICT DO NOTHING patterns in data_engine_resolve_identity()
--
-- FFS-103x: Identifier Confidence & Proxy Detection (Issue 1)
-- Created: 2026-03-31

\echo ''
\echo '=============================================='
\echo '  MIG_3025: Identifier Timeline + Multi-Source'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. SCHEMA CHANGES
-- ============================================================================

\echo '1. Adding columns to sot.person_identifiers...'

ALTER TABLE sot.person_identifiers
  ADD COLUMN IF NOT EXISTS last_confirmed_at TIMESTAMPTZ;

ALTER TABLE sot.person_identifiers
  ADD COLUMN IF NOT EXISTS source_systems TEXT[];

ALTER TABLE sot.person_identifiers
  ADD COLUMN IF NOT EXISTS confirmation_count INT DEFAULT 1;

COMMENT ON COLUMN sot.person_identifiers.last_confirmed_at IS
'When this identifier was last seen/confirmed in any source system.
Used for freshness ranking — most recently confirmed identifier wins ties.
MIG_3025.';

COMMENT ON COLUMN sot.person_identifiers.source_systems IS
'Array of distinct source systems that have confirmed this identifier.
E.g. {clinichq, volunteerhub} means confirmed by both systems.
Multi-source confirmation is the strongest signal for identifier validity.
MIG_3025.';

COMMENT ON COLUMN sot.person_identifiers.confirmation_count IS
'How many times this identifier has been re-confirmed across batches.
Incremented by sot.confirm_identifier() on each re-confirmation.
MIG_3025.';

\echo '   Columns added'

-- ============================================================================
-- 2. CREATE sot.confirm_identifier()
-- ============================================================================

\echo ''
\echo '2. Creating sot.confirm_identifier()...'

CREATE OR REPLACE FUNCTION sot.confirm_identifier(
    p_person_id UUID,
    p_id_type TEXT,
    p_id_value_raw TEXT,
    p_id_value_norm TEXT,
    p_source_system TEXT,
    p_confidence NUMERIC DEFAULT 1.0
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
    v_existing_person_id UUID;
BEGIN
    -- Skip NULL/empty identifiers
    IF p_id_value_norm IS NULL OR p_id_value_norm = '' THEN
        RETURN NULL;
    END IF;

    -- Check if identifier already exists
    SELECT id, person_id
    INTO v_id, v_existing_person_id
    FROM sot.person_identifiers
    WHERE id_type = p_id_type AND id_value_norm = p_id_value_norm;

    IF v_id IS NOT NULL THEN
        IF v_existing_person_id = p_person_id THEN
            -- Same person: bump confirmation metadata
            UPDATE sot.person_identifiers
            SET last_confirmed_at = NOW(),
                confirmation_count = COALESCE(confirmation_count, 1) + 1,
                source_systems = (
                    SELECT array_agg(DISTINCT s ORDER BY s)
                    FROM unnest(COALESCE(source_systems, ARRAY[source_system]) || ARRAY[p_source_system]) AS s
                    WHERE s IS NOT NULL
                ),
                confidence = GREATEST(COALESCE(confidence, 0), p_confidence),
                id_value_raw = COALESCE(NULLIF(p_id_value_raw, ''), id_value_raw)
            WHERE id = v_id;
            RETURN v_id;
        ELSE
            -- Different person owns this identifier: don't transfer
            -- (same as previous ON CONFLICT DO NOTHING behavior)
            RETURN NULL;
        END IF;
    END IF;

    -- New identifier: insert
    INSERT INTO sot.person_identifiers (
        person_id, id_type, id_value_raw, id_value_norm,
        confidence, source_system, source_systems,
        last_confirmed_at, confirmation_count
    ) VALUES (
        p_person_id, p_id_type, p_id_value_raw, p_id_value_norm,
        p_confidence, p_source_system, ARRAY[p_source_system],
        NOW(), 1
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.confirm_identifier IS
'Centralized write function for person_identifiers. Replaces all INSERT ... ON CONFLICT patterns.
- New identifier: INSERT with source_systems, last_confirmed_at, confirmation_count
- Same person re-confirmation: bumps last_confirmed_at, appends source, increments count, GREATEST confidence
- Different person owns identifier: returns NULL (no transfer)
MIG_3025.';

\echo '   sot.confirm_identifier() created'

-- ============================================================================
-- 3. BACKFILL existing rows
-- ============================================================================

\echo ''
\echo '3. Backfilling existing identifiers...'

UPDATE sot.person_identifiers
SET last_confirmed_at = COALESCE(last_confirmed_at, created_at),
    source_systems = COALESCE(source_systems, ARRAY[COALESCE(source_system, 'unknown')]),
    confirmation_count = COALESCE(confirmation_count, 1)
WHERE last_confirmed_at IS NULL
   OR source_systems IS NULL
   OR confirmation_count IS NULL;

\echo '   Backfill complete'

-- ============================================================================
-- 4. INDEX for freshness ranking
-- ============================================================================

\echo ''
\echo '4. Creating freshness index...'

CREATE INDEX IF NOT EXISTS idx_person_identifiers_freshness
  ON sot.person_identifiers (person_id, id_type, confidence DESC, last_confirmed_at DESC NULLS LAST);

\echo '   Index created'

-- ============================================================================
-- 5. V7 data_engine_resolve_identity() — confirm_identifier() calls
-- ============================================================================

\echo ''
\echo '5. Updating data_engine_resolve_identity() to V7 (confirm_identifier)...'

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
    -- MIG_3025: INSERT patterns replaced with sot.confirm_identifier()
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
            -- No address provided -> can't check, allow match
            p_address IS NULL OR TRIM(p_address) = ''
            -- Person has no known address -> can't check, allow match
            OR p.primary_address_id IS NULL
            -- Person's address matches -> allow match
            OR EXISTS (
              SELECT 1 FROM sot.places pl
              WHERE pl.place_id = p.primary_address_id
                AND similarity(LOWER(pl.formatted_address), LOWER(p_address)) > 0.3
            )
            -- Person has primary_address_id but place has no formatted_address -> can't check
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
            -- Names similar enough -> auto-match
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

            -- MIG_3025: Use confirm_identifier() instead of raw INSERT
            PERFORM sot.confirm_identifier(v_person_id, 'email', p_email, v_email_norm, p_source_system, 1.0);
            PERFORM sot.confirm_identifier(v_person_id, 'phone', p_phone, v_phone_norm, p_source_system, 1.0);

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
            -- Names too different -> potential household member, fall through
            RAISE NOTICE 'Phase 0.5 name guard: "%" vs "%" (similarity %, threshold %) -- falling through to scoring',
                v_display_name, v_existing_display_name, ROUND(v_name_similarity, 2), v_phase05_name_sim;
        END IF;
    END IF;

    -- =========================================================================
    -- PHASE 1+: V2 SCORING AND MATCHING (MIG_2830)
    -- MIG_2932/FFS-528: Thresholds now configurable
    -- MIG_3025: INSERT patterns replaced with sot.confirm_identifier()
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

        -- MIG_3025: Use confirm_identifier()
        PERFORM sot.confirm_identifier(v_person_id, 'email', p_email, v_email_norm, p_source_system, 1.0);
        PERFORM sot.confirm_identifier(v_person_id, 'phone', p_phone, v_phone_norm, p_source_system, 1.0);

    ELSIF v_candidate.person_id IS NOT NULL AND v_candidate.total_weight > v_review_weight THEN
        -- D2: Phone-only match with address disagreement -> new_entity (MIG_2990/FFS-860)
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
                         ') -- creating new entity per MIG_2990';

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

            -- MIG_3025: Use confirm_identifier()
            PERFORM sot.confirm_identifier(v_person_id, 'email', p_email, v_email_norm, p_source_system, 1.0);
            PERFORM sot.confirm_identifier(v_person_id, 'phone', p_phone, v_phone_norm, p_source_system, 1.0);

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

        -- MIG_3025: Use confirm_identifier()
        PERFORM sot.confirm_identifier(v_person_id, 'email', p_email, v_email_norm, p_source_system, 1.0);
        PERFORM sot.confirm_identifier(v_person_id, 'phone', p_phone, v_phone_norm, p_source_system, 1.0);

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
'V7: Identity resolution with confirm_identifier() (MIG_3025).
All 8 INSERT INTO person_identifiers patterns replaced with sot.confirm_identifier().
This enables multi-source tracking, last_confirmed_at bumping, and confirmation counting.
All thresholds read from ops.app_config with hardcoded fallbacks:
- identity.auto_match_weight (default 20)
- identity.review_weight (default 5)
- identity.phase05_name_similarity (default 0.75)
- identity.phone_only_requires_address_match (default true)
Phase 0: should_be_person gate
Phase 0.5: Direct identifier lookup with name similarity + ADDRESS guard on phone lookup
Phase 1+: V2 comparison-level scoring with name rarity
Changes take effect on next resolution call -- no redeploy needed.';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'New columns on sot.person_identifiers:'
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'sot' AND table_name = 'person_identifiers'
  AND column_name IN ('last_confirmed_at', 'source_systems', 'confirmation_count')
ORDER BY column_name;

\echo ''
\echo 'Backfill check (should be 0):'
SELECT COUNT(*) AS null_last_confirmed_at
FROM sot.person_identifiers
WHERE last_confirmed_at IS NULL;

\echo ''
\echo 'Source systems distribution:'
SELECT array_length(source_systems, 1) AS source_count, COUNT(*) AS identifiers
FROM sot.person_identifiers
GROUP BY array_length(source_systems, 1)
ORDER BY source_count;

\echo ''
\echo 'Functions created/updated:'
SELECT proname, pronamespace::regnamespace AS schema
FROM pg_proc
WHERE proname IN ('confirm_identifier', 'data_engine_resolve_identity')
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'sot')
ORDER BY proname;

\echo ''
\echo '=============================================='
\echo '  MIG_3025 Complete!'
\echo '=============================================='
\echo ''
\echo 'CREATED:'
\echo '  - sot.person_identifiers.last_confirmed_at column (backfilled from created_at)'
\echo '  - sot.person_identifiers.source_systems column (backfilled from source_system)'
\echo '  - sot.person_identifiers.confirmation_count column (backfilled to 1)'
\echo '  - sot.confirm_identifier() centralized write function'
\echo '  - idx_person_identifiers_freshness index'
\echo ''
\echo 'UPDATED:'
\echo '  - sot.data_engine_resolve_identity() V7 -- all 8 INSERT patterns use confirm_identifier()'
\echo ''
