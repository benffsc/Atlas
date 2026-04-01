-- MIG_3028: Trapper-Aware Identity Resolution
--
-- Problem 1 (Proxy Guard): When Susan Simons' phone is flagged as proxy (MIG_3027),
--   Phase 0.5 still matches Gordon Maxwell to Susan via phone lookup. The proxy flag
--   exists but isn't used during resolution.
--
-- Problem 2 (Phase 0.7): When Gordon Maxwell's booking arrives with Susan's phone,
--   Phase 0.5 name guard fires (good) but Phase 1+ scoring still scores Susan as a
--   candidate with phone_exact weight. Gordon may land in review_pending limbo instead
--   of getting his own record.
--
-- Solution:
--   1. Proxy guard in Phase 0.5: If phone identifier is_proxy, skip auto-match
--   2. Phase 0.7: If identifier match has different name AND matched person is a known
--      trapper, create new entity immediately (skip scoring entirely). Do NOT assign
--      trapper's phone to new person.
--   3. ops.v_skeleton_persons_needing_enrichment: monitoring view for people created
--      from trapper proxy bookings who still have no identifiers
--
-- FFS-103x: Identifier Confidence & Proxy Detection (Issues 3+4)
-- Dependencies: MIG_3025 (confirm_identifier), MIG_3026 (compute_identifier_confidence), MIG_3027 (is_proxy)
-- Created: 2026-03-31

\echo ''
\echo '=============================================='
\echo '  MIG_3028: Trapper-Aware Identity Resolution'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. V8 data_engine_resolve_identity() — Proxy Guard + Phase 0.7
-- ============================================================================

\echo '1. Updating data_engine_resolve_identity() to V8...'

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
    v_is_proxy_phone BOOLEAN := FALSE;  -- MIG_3028: proxy flag from phone lookup
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
    -- MIG_2932/FFS-528: Threshold now configurable
    -- MIG_2990/FFS-860: Address guard on phone-only lookup
    -- MIG_3025: confirm_identifier() calls
    -- MIG_3028: Proxy guard on phone lookup + Phase 0.7 trapper shortcut
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
    -- MIG_3028: Also captures is_proxy flag for proxy guard
    IF v_existing_person_id IS NULL AND v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
        SELECT pi.person_id, p.display_name, COALESCE(pi.is_proxy, FALSE)
        INTO v_existing_person_id, v_existing_display_name, v_is_proxy_phone
        FROM sot.person_identifiers pi
        JOIN sot.people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'phone'
          AND pi.id_value_norm = v_phone_norm
          AND p.merged_into_person_id IS NULL
          -- Address guard: allow match if addresses are compatible or unknown
          AND (
            p_address IS NULL OR TRIM(p_address) = ''
            OR p.primary_address_id IS NULL
            OR EXISTS (
              SELECT 1 FROM sot.places pl
              WHERE pl.place_id = p.primary_address_id
                AND similarity(LOWER(pl.formatted_address), LOWER(p_address)) > 0.3
            )
            OR NOT EXISTS (
              SELECT 1 FROM sot.places pl
              WHERE pl.place_id = p.primary_address_id AND pl.formatted_address IS NOT NULL
            )
          )
        LIMIT 1;

        -- MIG_3028: Proxy guard — don't auto-match on proxy phone, fall through to scoring
        IF v_is_proxy_phone AND v_existing_person_id IS NOT NULL THEN
            RAISE NOTICE 'Phase 0.5 proxy guard: phone % is proxy (owner: %) -- falling through to scoring',
                v_phone_norm, v_existing_display_name;
            v_existing_person_id := NULL;
            v_existing_display_name := NULL;
        END IF;
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
            -- =========================================================================
            -- PHASE 0.7: TRAPPER PROXY SHORTCUT (MIG_3028)
            -- If names don't match AND matched person is a known trapper/staff:
            -- - Create new entity immediately (skip Phase 1+ scoring entirely)
            -- - Do NOT assign the trapper's phone to the new person
            -- - Only assign email if one was provided in this booking
            -- This prevents Gordon Maxwell from landing in review_pending limbo
            -- =========================================================================
            IF sot.is_excluded_from_cat_place_linking(v_existing_person_id) THEN
                v_decision_type := 'new_entity';
                v_reason := 'Trapper proxy booking: "' || v_display_name ||
                            '" booked via trapper "' || v_existing_display_name ||
                            '" (name_sim=' || ROUND(v_name_similarity, 2)::TEXT || ')';

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

                -- Only assign EMAIL if provided (NOT the trapper's phone)
                -- The phone belongs to the trapper, not the client
                PERFORM sot.confirm_identifier(v_person_id, 'email', p_email, v_email_norm, p_source_system, 1.0);

                v_match_details := jsonb_build_object(
                    'created_person_id', v_person_id,
                    'created_name', v_display_name,
                    'trapper_person_id', v_existing_person_id,
                    'trapper_name', v_existing_display_name,
                    'name_similarity', v_name_similarity,
                    'guard', 'trapper_proxy_phase07',
                    'phone_withheld', TRUE,
                    'email_assigned', (v_email_norm IS NOT NULL AND v_email_norm != '')
                );

                INSERT INTO sot.match_decisions (
                    decision_type, resulting_person_id, top_candidate_score, decision_reason, score_breakdown, source_system
                ) VALUES (
                    v_decision_type, v_person_id, 0.0, v_reason, v_match_details, p_source_system
                )
                RETURNING sot.match_decisions.decision_id INTO v_decision_id;

                RETURN QUERY SELECT
                    v_decision_type,
                    v_person_id,
                    v_display_name,
                    0.0::NUMERIC,
                    v_reason,
                    v_match_details,
                    v_decision_id;
                RETURN;
            END IF;

            -- Not a trapper -> fall through to Phase 1+ scoring as before
            RAISE NOTICE 'Phase 0.5 name guard: "%" vs "%" (similarity %, threshold %) -- falling through to scoring',
                v_display_name, v_existing_display_name, ROUND(v_name_similarity, 2), v_phase05_name_sim;
        END IF;
    END IF;

    -- =========================================================================
    -- PHASE 1+: V2 SCORING AND MATCHING (MIG_2830)
    -- MIG_2932/FFS-528: Thresholds now configurable
    -- MIG_3025: confirm_identifier() calls
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

        PERFORM sot.confirm_identifier(v_person_id, 'email', p_email, v_email_norm, p_source_system, 1.0);
        PERFORM sot.confirm_identifier(v_person_id, 'phone', p_phone, v_phone_norm, p_source_system, 1.0);

    ELSIF v_candidate.person_id IS NOT NULL AND v_candidate.total_weight > v_review_weight THEN
        -- D2: Phone-only match with address disagreement -> new_entity (MIG_2990/FFS-860)
        IF v_phone_requires_addr
           AND v_candidate.phone_score IS NOT NULL AND v_candidate.phone_score > 0
           AND (v_candidate.email_score IS NULL OR v_candidate.email_score <= 0)
           AND v_candidate.address_score IS NOT NULL AND v_candidate.address_score < 0 THEN
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
'V8: Identity resolution with proxy guard + trapper-aware Phase 0.7 (MIG_3028).
Phase 0: should_be_person gate
Phase 0.5: Direct identifier lookup with name similarity + address guard + PROXY GUARD
  - MIG_3028: If phone is_proxy=TRUE, skip auto-match and fall through to scoring
Phase 0.7 (NEW): Trapper proxy shortcut
  - If name guard fires AND matched person is a known trapper (is_excluded_from_cat_place_linking)
  - Create new entity immediately, skip scoring entirely
  - Do NOT assign trapper phone to new person (only email if provided)
  - Logs "trapper_proxy_phase07" guard in match_decisions
Phase 1+: V2 comparison-level scoring with name rarity
All thresholds configurable via ops.app_config identity.* keys.';

-- ============================================================================
-- 2. SKELETON PERSONS MONITORING VIEW
-- ============================================================================

\echo ''
\echo '2. Creating ops.v_skeleton_persons_needing_enrichment...'

CREATE OR REPLACE VIEW ops.v_skeleton_persons_needing_enrichment AS
SELECT
    p.person_id,
    p.display_name,
    p.first_name,
    p.last_name,
    p.source_system,
    p.created_at,
    md.decision_reason,
    md.score_breakdown->>'trapper_name' AS created_via_trapper,
    md.score_breakdown->>'trapper_person_id' AS trapper_person_id,
    (SELECT COUNT(*) FROM sot.person_identifiers pi
     WHERE pi.person_id = p.person_id AND pi.confidence >= 0.5) AS high_conf_identifier_count,
    (SELECT COUNT(*) FROM ops.appointments a
     WHERE a.person_id = p.person_id) AS appointment_count,
    (SELECT MAX(a.appointment_date) FROM ops.appointments a
     WHERE a.person_id = p.person_id) AS last_appointment_date
FROM sot.people p
JOIN sot.match_decisions md ON md.resulting_person_id = p.person_id
WHERE p.merged_into_person_id IS NULL
  AND md.decision_reason LIKE 'Trapper proxy booking:%'
  -- Only show those with no high-confidence identifiers (true "skeletons")
  AND NOT EXISTS (
    SELECT 1 FROM sot.person_identifiers pi
    WHERE pi.person_id = p.person_id AND pi.confidence >= 0.5
  )
ORDER BY p.created_at DESC;

COMMENT ON VIEW ops.v_skeleton_persons_needing_enrichment IS
'People created from trapper proxy bookings (Phase 0.7) who still have no high-confidence identifiers.
These are "skeleton" records — we know the name but have no contact info.
When the person eventually calls in or submits an intake form, their identifiers get attached.
Staff can also manually add contact info via /api/people/[id]/identifiers.
MIG_3028.';

\echo '   ops.v_skeleton_persons_needing_enrichment created'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Function version check:'
SELECT obj_description(oid, 'pg_proc') AS comment
FROM pg_proc
WHERE proname = 'data_engine_resolve_identity'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'sot');

\echo ''
\echo 'View exists:'
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'ops' AND table_name = 'v_skeleton_persons_needing_enrichment';

\echo ''
\echo 'Skeleton persons (should be 0 initially — Phase 0.7 only applies to future resolutions):'
SELECT COUNT(*) AS skeleton_count FROM ops.v_skeleton_persons_needing_enrichment;

\echo ''
\echo '=============================================='
\echo '  MIG_3028 Complete!'
\echo '=============================================='
\echo ''
\echo 'UPDATED:'
\echo '  - sot.data_engine_resolve_identity() V8:'
\echo '    - Phase 0.5: Proxy guard — skips auto-match when phone is_proxy=TRUE'
\echo '    - Phase 0.7: Trapper proxy shortcut — creates new entity immediately'
\echo '      when name does not match AND matched person is a known trapper'
\echo '    - Phone is NOT assigned to new person in Phase 0.7 (only email if provided)'
\echo ''
\echo 'CREATED:'
\echo '  - ops.v_skeleton_persons_needing_enrichment monitoring view'
\echo ''
\echo 'BEHAVIOR CHANGE:'
\echo '  - Gordon Maxwell booked with Susan Simons phone:'
\echo '    BEFORE: Falls through to Phase 1+ scoring, may land in review_pending'
\echo '    AFTER:  Phase 0.7 recognizes Susan as trapper, creates Gordon as new person,'
\echo '           does not give him Susan phone, puts him in enrichment queue'
\echo ''
