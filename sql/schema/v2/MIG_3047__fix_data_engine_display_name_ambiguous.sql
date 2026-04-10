-- MIG_3047: Fix ambiguous display_name reference in sot.data_engine_resolve_identity
--
-- BUG: When sot.find_or_create_person() is called for an EXISTING person whose
-- name is being enriched (source_system = 'atlas_ui'), the UPDATE statement
-- inside the auto_match branch fails with:
--
--   ERROR: column reference "display_name" is ambiguous
--   QUERY: UPDATE sot.people
--          SET ...
--              display_name = COALESCE(NULLIF(display_name, ''), v_display_name),
--                                              ^
--
-- ROOT CAUSE: The function's RETURNS TABLE clause declares `display_name` as an
-- OUT parameter, which puts it in scope as a PL/pgSQL variable. Inside the UPDATE,
-- the unqualified `display_name` reference inside NULLIF could resolve to either
-- the OUT parameter or the sot.people.display_name column, so PostgreSQL refuses
-- to guess.
--
-- FIX: Qualify the column reference as `sot.people.display_name` so the parser
-- unambiguously selects the column.
--
-- DISCOVERED: 2026-04-06 while linking Renee Calhoon (request fa04f387) to an
-- existing person via find_or_create_person from a SQL DO block. The first
-- call (creating the person) succeeded; the second call (which hit the
-- "person already exists, enrich names" path) blew up with the ambiguity error.
--
-- VERIFICATION:
--   1. After applying, call:
--      SELECT sot.find_or_create_person(NULL, '8172911809', 'Renee', 'Calhoon', NULL, 'atlas_ui');
--      twice in the same transaction. Both calls should succeed.
--   2. Confirm the function still enriches names on auto_match by checking that
--      a person with NULL first_name receives the new name on second call.

CREATE OR REPLACE FUNCTION sot.data_engine_resolve_identity(p_email text, p_phone text, p_first_name text, p_last_name text, p_address text, p_source_system text)
 RETURNS TABLE(decision_type text, resolved_person_id uuid, display_name text, confidence numeric, reason text, match_details jsonb, decision_id uuid)
 LANGUAGE plpgsql
AS $function$
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
            -- MIG_3047: Qualify display_name as sot.people.display_name to disambiguate
            -- from the OUT parameter of the same name in RETURNS TABLE.
            IF p_source_system = 'atlas_ui' THEN
                UPDATE sot.people
                SET first_name = COALESCE(sot.people.first_name, NULLIF(TRIM(p_first_name), '')),
                    last_name = COALESCE(sot.people.last_name, NULLIF(TRIM(p_last_name), '')),
                    display_name = COALESCE(NULLIF(sot.people.display_name, ''), v_display_name),
                    is_verified = TRUE
                WHERE sot.people.person_id = v_person_id
                  AND (sot.people.first_name IS NULL OR sot.people.last_name IS NULL);
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
$function$;
