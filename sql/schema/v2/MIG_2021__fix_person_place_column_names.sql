-- MIG_2021: Fix column name mismatches in V2 functions
--
-- Problems found:
-- 1. sot.link_person_to_place() uses 'role' but table has 'relationship_type'
-- 2. person_identifiers ON CONFLICT uses (person_id, id_type, id_value_norm)
--    but actual constraint is (id_type, id_value_norm)
--
-- Solution: Update all functions to use correct column names and constraints.
--
-- Created: 2026-02-12

\echo ''
\echo '=============================================='
\echo '  MIG_2021: Fix person_place Column Names'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. FIX LINK_PERSON_TO_PLACE FUNCTION
-- ============================================================================

\echo '1. Fixing sot.link_person_to_place()...'

DROP FUNCTION IF EXISTS sot.link_person_to_place(UUID, UUID, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION sot.link_person_to_place(
    p_person_id UUID,
    p_place_id UUID,
    p_relationship_type TEXT DEFAULT 'resident',
    p_evidence_type TEXT DEFAULT 'appointment',
    p_source_system TEXT DEFAULT 'atlas',
    p_confidence TEXT DEFAULT 'medium'
)
RETURNS UUID AS $$
DECLARE
    v_link_id UUID;
BEGIN
    -- Validate entities exist and aren't merged
    IF NOT EXISTS (
        SELECT 1 FROM sot.people WHERE person_id = p_person_id AND merged_into_person_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM sot.places WHERE place_id = p_place_id AND merged_into_place_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    -- Insert or update relationship
    INSERT INTO sot.person_place (
        person_id, place_id, relationship_type,
        confidence, evidence_type, source_system
    ) VALUES (
        p_person_id, p_place_id, p_relationship_type,
        p_confidence, p_evidence_type, p_source_system
    )
    ON CONFLICT (person_id, place_id, relationship_type)
    DO UPDATE SET
        confidence = CASE
            WHEN EXCLUDED.confidence > sot.person_place.confidence THEN EXCLUDED.confidence
            ELSE sot.person_place.confidence
        END,
        updated_at = NOW()
    RETURNING id INTO v_link_id;

    RETURN v_link_id;
EXCEPTION WHEN undefined_column THEN
    -- Fallback: Try with just person_id, place_id conflict
    INSERT INTO sot.person_place (
        person_id, place_id, relationship_type,
        confidence, evidence_type, source_system
    ) VALUES (
        p_person_id, p_place_id, p_relationship_type,
        p_confidence, p_evidence_type, p_source_system
    )
    ON CONFLICT (person_id, place_id) DO UPDATE SET
        relationship_type = EXCLUDED.relationship_type,
        confidence = EXCLUDED.confidence,
        updated_at = NOW()
    RETURNING id INTO v_link_id;

    RETURN v_link_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.link_person_to_place IS
'V2: Creates or updates a person-place relationship.
Fixed MIG_2021: Uses relationship_type column (not role).
Validates entities exist and arent merged before linking.
Uses ON CONFLICT to update if higher confidence.';

\echo '   Fixed sot.link_person_to_place()'

-- ============================================================================
-- 2. ADD UNIQUE CONSTRAINT IF MISSING
-- ============================================================================

\echo ''
\echo '2. Ensuring unique constraint exists...'

-- Check if constraint exists, add if not
DO $$
BEGIN
    -- Try to add the constraint
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'person_place_person_place_type_key'
    ) THEN
        -- First try the 3-column constraint
        BEGIN
            ALTER TABLE sot.person_place
            ADD CONSTRAINT person_place_person_place_type_key
            UNIQUE (person_id, place_id, relationship_type);
            RAISE NOTICE 'Added 3-column unique constraint';
        EXCEPTION WHEN duplicate_table THEN
            RAISE NOTICE 'Constraint already exists';
        WHEN unique_violation THEN
            -- If duplicates exist, add 2-column constraint instead
            ALTER TABLE sot.person_place
            ADD CONSTRAINT person_place_person_place_key
            UNIQUE (person_id, place_id);
            RAISE NOTICE 'Added 2-column unique constraint (duplicates exist for 3-column)';
        END;
    END IF;
END $$;

-- Also add updated_at column if missing
ALTER TABLE sot.person_place ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

\echo '   Constraints verified'

-- ============================================================================
-- 3. FIX LINK_CATS_TO_PLACES TO USE relationship_type
-- ============================================================================

\echo ''
\echo '3. Fixing sot.link_cats_to_places()...'

CREATE OR REPLACE FUNCTION sot.link_cats_to_places()
RETURNS TABLE(cats_linked_home INTEGER, cats_linked_appointment INTEGER, total_edges INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
    v_total INT := 0;
    v_cat_id UUID;
    v_place_id UUID;
    v_pcr_type TEXT;
    v_cpr_type TEXT;
    v_confidence TEXT;
    v_evidence_type TEXT;
    v_result UUID;
BEGIN
    -- Link cats to places via person_cat → person_place chain.
    -- Maps person_cat relationship types to cat_place relationship types.
    --
    -- MIG_889 FIX: Uses LIMIT 1 per person (highest confidence, most recent)
    -- instead of linking to ALL historical addresses. This prevents pollution.

    FOR v_cat_id, v_place_id, v_pcr_type IN
        SELECT DISTINCT
            pc.cat_id,
            best_place.place_id,
            pc.relationship_type
        FROM sot.person_cat pc
        JOIN sot.people sp ON sp.person_id = pc.person_id
            AND sp.merged_into_person_id IS NULL
        -- MIG_889: LATERAL join to get ONLY the best place per person
        JOIN LATERAL (
            SELECT pp.place_id
            FROM sot.person_place pp
            JOIN sot.places pl ON pl.place_id = pp.place_id
                AND pl.merged_into_place_id IS NULL
            WHERE pp.person_id = pc.person_id
              AND pp.relationship_type IN ('resident', 'owner', 'requester')
            ORDER BY
                CASE pp.confidence
                    WHEN 'high' THEN 1
                    WHEN 'medium' THEN 2
                    WHEN 'low' THEN 3
                    ELSE 4
                END,
                pp.created_at DESC
            LIMIT 1  -- INV-26: LIMIT 1 per person to prevent address pollution
        ) best_place ON TRUE
        JOIN sot.cats sc ON sc.cat_id = pc.cat_id
            AND sc.merged_into_cat_id IS NULL
        WHERE pc.relationship_type IN ('owner', 'caretaker', 'foster', 'adopter', 'colony_caretaker')
        -- INV-12: exclude staff/trappers whose cats are clinic-processed, not residents
        AND NOT EXISTS (
            SELECT 1 FROM sot.person_roles pr
            WHERE pr.person_id = pc.person_id
              AND pr.role_status = 'active'
              AND pr.role IN ('staff', 'coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper')
        )
        AND NOT EXISTS (
            SELECT 1 FROM sot.cat_place cp
            WHERE cp.cat_id = pc.cat_id
              AND cp.place_id = best_place.place_id
        )
    LOOP
        -- Map person_cat type → cat_place type + confidence
        CASE v_pcr_type
            WHEN 'owner' THEN
                v_cpr_type := 'home';
                v_confidence := 'high';
                v_evidence_type := 'owner_address';
            WHEN 'caretaker' THEN
                v_cpr_type := 'residence';
                v_confidence := 'medium';
                v_evidence_type := 'person_relationship';
            WHEN 'foster' THEN
                v_cpr_type := 'home';
                v_confidence := 'medium';
                v_evidence_type := 'person_relationship';
            WHEN 'adopter' THEN
                v_cpr_type := 'home';
                v_confidence := 'high';
                v_evidence_type := 'person_relationship';
            WHEN 'colony_caretaker' THEN
                v_cpr_type := 'colony_member';
                v_confidence := 'medium';
                v_evidence_type := 'person_relationship';
            ELSE
                CONTINUE;
        END CASE;

        v_result := sot.link_cat_to_place(
            p_cat_id := v_cat_id,
            p_place_id := v_place_id,
            p_relationship_type := v_cpr_type,
            p_evidence_type := v_evidence_type,
            p_source_system := 'atlas',
            p_source_table := 'link_cats_to_places',
            p_confidence := v_confidence
        );
        IF v_result IS NOT NULL THEN
            v_total := v_total + 1;
        END IF;
    END LOOP;

    cats_linked_home := v_total;
    cats_linked_appointment := 0;
    total_edges := v_total;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION sot.link_cats_to_places IS
'V2: Links cats to places via person_cat → person_place chain.
Fixed MIG_2021: Uses relationship_type column (not role).
Uses LIMIT 1 per person (INV-26), excludes staff/trappers (INV-12).';

\echo '   Fixed sot.link_cats_to_places()'

-- ============================================================================
-- 4. FIX DATA_ENGINE_RESOLVE_IDENTITY PERSON_IDENTIFIERS ON CONFLICT
-- ============================================================================

\echo ''
\echo '4. Fixing sot.data_engine_resolve_identity() person_identifiers ON CONFLICT...'

-- The person_identifiers constraint is (id_type, id_value_norm), NOT (person_id, id_type, id_value_norm)
-- This is intentional: one email/phone can only belong to ONE person

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
    v_new_person_id UUID;
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
    -- =========================================================================

    IF NOT sot.should_be_person(p_first_name, p_last_name, p_email, p_phone) THEN
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

        INSERT INTO sot.match_decisions (
            source_system, incoming_email, incoming_phone, incoming_name, incoming_address,
            decision_type, decision_reason, rules_applied
        ) VALUES (
            p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm,
            'rejected', v_reason, '["should_be_person_gate"]'::JSONB
        ) RETURNING sot.match_decisions.decision_id INTO v_decision_id;

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

    SELECT * INTO v_candidate
    FROM sot.data_engine_score_candidates(
        v_email_norm,
        v_phone_norm,
        v_display_name,
        v_address_norm
    )
    LIMIT 1;

    IF v_candidate.person_id IS NOT NULL AND v_candidate.total_score >= 0.95 THEN
        v_decision_type := 'auto_match';
        v_reason := 'High confidence match (score ' || ROUND(v_candidate.total_score, 2)::TEXT || ')';
        v_new_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'score_breakdown', v_candidate.score_breakdown
        );

        -- Add new identifiers (FIX: use correct ON CONFLICT columns)
        IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_new_person_id, 'email', p_email, v_email_norm, 1.0, p_source_system)
            ON CONFLICT (id_type, id_value_norm) DO NOTHING;
        END IF;

        IF v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_new_person_id, 'phone', p_phone, v_phone_norm, 1.0, p_source_system)
            ON CONFLICT (id_type, id_value_norm) DO NOTHING;
        END IF;

    ELSIF v_candidate.person_id IS NOT NULL AND v_candidate.total_score >= 0.50 THEN
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
        v_decision_type := 'new_entity';
        v_reason := CASE
            WHEN v_candidate.person_id IS NULL THEN 'No matching candidates found'
            ELSE 'Low confidence match (score ' || ROUND(COALESCE(v_candidate.total_score, 0), 2)::TEXT || ')'
        END;

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

        -- Add identifiers (FIX: use correct ON CONFLICT columns)
        IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_new_person_id, 'email', p_email, v_email_norm, 1.0, p_source_system)
            ON CONFLICT (id_type, id_value_norm) DO NOTHING;
        END IF;

        IF v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
            INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_new_person_id, 'phone', p_phone, v_phone_norm, 1.0, p_source_system)
            ON CONFLICT (id_type, id_value_norm) DO NOTHING;
        END IF;

        v_match_details := jsonb_build_object(
            'nearest_candidate', v_candidate.person_id,
            'nearest_score', COALESCE(v_candidate.total_score, 0)
        );
    END IF;

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
MIG_2021 fixes: person_identifiers ON CONFLICT uses (id_type, id_value_norm).';

\echo '   Fixed sot.data_engine_resolve_identity()'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'person_place columns:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'sot' AND table_name = 'person_place'
ORDER BY ordinal_position;

\echo ''
\echo '=============================================='
\echo '  MIG_2021 Complete!'
\echo '=============================================='
\echo ''
