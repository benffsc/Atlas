-- MIG_2914: Atlas UI Enrichment — Name enrichment + verified flag for atlas_ui source
--
-- When data_engine_resolve_identity() auto-matches or review-matches to an existing person,
-- it adds identifiers but never updates the person's name — even if the existing record has
-- NULL first_name and staff just provided a real one via Atlas UI.
--
-- This migration replaces data_engine_resolve_identity() with two additions:
-- A) Auto-match name enrichment: When source = 'atlas_ui' and existing person has NULL name,
--    update with the incoming name and log to entity_edits
-- B) Set is_verified + verified_at + verified_by for atlas_ui sources
--
-- Depends: MIG_2007 (original function), MIG_2311 (is_verified columns on sot.people)

BEGIN;

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
    person_id UUID,
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
    v_existing_first_name TEXT;
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
        ) RETURNING match_decisions.decision_id INTO v_decision_id;

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
            ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;
        END IF;

        IF v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_person_id, 'phone', p_phone, v_phone_norm, 1.0, p_source_system)
            ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;
        END IF;

        -- =====================================================================
        -- MIG_2914A: Name enrichment for atlas_ui auto-matches
        -- When staff creates a person via Atlas UI and it matches an existing
        -- record with NULL name, enrich the name.
        -- =====================================================================
        IF p_source_system = 'atlas_ui'
           AND TRIM(COALESCE(p_first_name, '')) != '' THEN
            SELECT p.first_name INTO v_existing_first_name
            FROM sot.people p
            WHERE p.person_id = v_person_id;

            IF v_existing_first_name IS NULL OR TRIM(v_existing_first_name) = '' THEN
                UPDATE sot.people
                SET first_name = TRIM(p_first_name),
                    last_name = TRIM(p_last_name),
                    display_name = v_display_name,
                    updated_at = NOW()
                WHERE sot.people.person_id = v_person_id;

                -- Log enrichment to entity_edits
                INSERT INTO sot.entity_edits (
                    entity_type, entity_id, edit_type, field_name,
                    old_value, new_value, reason, edited_by, edit_source
                ) VALUES (
                    'person', v_person_id, 'enrichment', 'first_name',
                    to_jsonb(v_existing_first_name),
                    to_jsonb(TRIM(p_first_name)),
                    'Atlas UI enriched NULL name on auto-match',
                    'atlas_ui', 'data_engine_resolve_identity'
                );
            END IF;
        END IF;

        -- MIG_2914B: Set verified flag for atlas_ui
        IF p_source_system = 'atlas_ui' THEN
            UPDATE sot.people
            SET is_verified = TRUE,
                verified_at = COALESCE(verified_at, NOW()),
                verified_by = COALESCE(verified_by, 'atlas_ui'),
                updated_at = NOW()
            WHERE sot.people.person_id = v_person_id
              AND is_verified IS NOT TRUE;
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

        -- =====================================================================
        -- MIG_2914A: Name enrichment for atlas_ui review-pending matches
        -- Staff data is authoritative regardless of match confidence.
        -- =====================================================================
        IF p_source_system = 'atlas_ui'
           AND TRIM(COALESCE(p_first_name, '')) != '' THEN
            SELECT p.first_name INTO v_existing_first_name
            FROM sot.people p
            WHERE p.person_id = v_person_id;

            IF v_existing_first_name IS NULL OR TRIM(v_existing_first_name) = '' THEN
                UPDATE sot.people
                SET first_name = TRIM(p_first_name),
                    last_name = TRIM(p_last_name),
                    display_name = v_display_name,
                    updated_at = NOW()
                WHERE sot.people.person_id = v_person_id;

                INSERT INTO sot.entity_edits (
                    entity_type, entity_id, edit_type, field_name,
                    old_value, new_value, reason, edited_by, edit_source
                ) VALUES (
                    'person', v_person_id, 'enrichment', 'first_name',
                    to_jsonb(v_existing_first_name),
                    to_jsonb(TRIM(p_first_name)),
                    'Atlas UI enriched NULL name on review-pending match',
                    'atlas_ui', 'data_engine_resolve_identity'
                );
            END IF;
        END IF;

        -- MIG_2914B: Set verified flag for atlas_ui
        IF p_source_system = 'atlas_ui' THEN
            UPDATE sot.people
            SET is_verified = TRUE,
                verified_at = COALESCE(verified_at, NOW()),
                verified_by = COALESCE(verified_by, 'atlas_ui'),
                updated_at = NOW()
            WHERE sot.people.person_id = v_person_id
              AND is_verified IS NOT TRUE;
        END IF;

    ELSE
        -- Low confidence or no match: create new person
        v_decision_type := 'new_entity';
        v_reason := CASE
            WHEN v_candidate.person_id IS NULL THEN 'No matching candidates found'
            ELSE 'Low confidence match (score ' || ROUND(COALESCE(v_candidate.total_score, 0), 2)::TEXT || ')'
        END;

        -- Create new person (MIG_2914B: include verified flag for atlas_ui)
        INSERT INTO sot.people (
            first_name, last_name, display_name, primary_email, primary_phone,
            source_system, is_verified, verified_at, verified_by
        )
        VALUES (
            TRIM(p_first_name),
            TRIM(p_last_name),
            v_display_name,
            v_email_norm,
            v_phone_norm,
            p_source_system,
            CASE WHEN p_source_system = 'atlas_ui' THEN TRUE ELSE FALSE END,
            CASE WHEN p_source_system = 'atlas_ui' THEN NOW() ELSE NULL END,
            CASE WHEN p_source_system = 'atlas_ui' THEN 'atlas_ui' ELSE NULL END
        )
        RETURNING sot.people.person_id INTO v_person_id;

        -- Add identifiers
        IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_person_id, 'email', p_email, v_email_norm, 1.0, p_source_system)
            ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;
        END IF;

        IF v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_person_id, 'phone', p_phone, v_phone_norm, 1.0, p_source_system)
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
        v_decision_type, v_reason, v_person_id,
        v_candidate.score_breakdown,
        CASE WHEN v_decision_type = 'review_pending' THEN 'pending' ELSE 'not_required' END
    ) RETURNING match_decisions.decision_id INTO v_decision_id;

    RETURN QUERY SELECT
        v_decision_type,
        v_person_id,
        v_display_name,
        COALESCE(v_candidate.total_score, 0.0)::NUMERIC,
        v_reason,
        v_match_details,
        v_decision_id;
END;
$$ LANGUAGE plpgsql;

COMMIT;
