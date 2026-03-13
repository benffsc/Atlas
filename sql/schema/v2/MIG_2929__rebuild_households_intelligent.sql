-- MIG_2929: Rebuild household grouping with intelligent detection
-- FFS-524: Replace MIG_2877's address-only grouping with family-signal detection
--
-- MIG_2877 grouped ALL people at the same address into one "household",
-- creating groups of 10 unrelated people. Real households require family signals:
--   1. Same address + shared last name → likely family
--   2. Clinic account name contains "&" (e.g., "Glenn & Cheri Clark") → couple
--   3. Same address + shared phone → family sharing phone
--
-- Also: Update Phase 0.5 of data_engine_resolve_identity to prevent auto-matching
-- when incoming name is very different from existing person (household member case).

BEGIN;

-- ============================================================================
-- 1. Clear garbage households from MIG_2877
-- ============================================================================

\echo '1. Clearing MIG_2877 garbage households...'

-- Clear FK references from clinic_accounts before deleting households
UPDATE ops.clinic_accounts SET household_id = NULL WHERE household_id IS NOT NULL;
DELETE FROM sot.household_members;
DELETE FROM sot.households;

\echo '   Cleared all existing households'

-- ============================================================================
-- 2. Create intelligent household detection function
-- ============================================================================

\echo '2. Creating sot.detect_and_populate_households()...'

CREATE OR REPLACE FUNCTION sot.detect_and_populate_households()
RETURNS TABLE(households_created INT, members_added INT) AS $$
DECLARE
    v_households INT := 0;
    v_members INT := 0;
    v_household_id UUID;
    r RECORD;
BEGIN
    -- =========================================================================
    -- Signal 1: Same address + shared last name (strongest household signal)
    -- People at the same place with the same last name are likely family.
    -- =========================================================================

    FOR r IN
        SELECT
            pl.sot_address_id AS address_id,
            p.last_name,
            pl.formatted_address,
            ARRAY_AGG(p.person_id ORDER BY p.created_at ASC) AS person_ids,
            ARRAY_AGG(p.display_name ORDER BY p.created_at ASC) AS names,
            COUNT(*) AS cnt
        FROM sot.person_place pp
        JOIN sot.people p ON p.person_id = pp.person_id
            AND p.merged_into_person_id IS NULL
            AND p.is_organization = FALSE
            AND p.last_name IS NOT NULL
            AND LENGTH(p.last_name) > 1
        JOIN sot.places pl ON pl.place_id = pp.place_id
            AND pl.merged_into_place_id IS NULL
            AND pl.sot_address_id IS NOT NULL
        WHERE pp.relationship_type IN ('resident', 'owner', 'contact_address')
        GROUP BY pl.sot_address_id, p.last_name, pl.formatted_address
        HAVING COUNT(*) >= 2  -- At least 2 people with same last name at same place
    LOOP
        -- Check if any of these persons are already in a household at this address
        SELECT h.household_id INTO v_household_id
        FROM sot.household_members hm
        JOIN sot.households h ON h.household_id = hm.household_id
        WHERE hm.person_id = ANY(r.person_ids)
          AND h.primary_address_id = r.address_id
        LIMIT 1;

        IF v_household_id IS NULL THEN
            -- Create new household
            INSERT INTO sot.households (
                household_id, primary_address_id, household_name,
                primary_address, detection_reason, detected_at
            ) VALUES (
                gen_random_uuid(), r.address_id,
                r.last_name || ' household',
                r.formatted_address,
                'shared_last_name_at_address',
                NOW()
            )
            RETURNING sot.households.household_id INTO v_household_id;
            v_households := v_households + 1;
        END IF;

        -- Add members
        FOR i IN 1..array_length(r.person_ids, 1) LOOP
            INSERT INTO sot.household_members (
                member_id, household_id, person_id, relationship, is_primary, joined_at
            ) VALUES (
                gen_random_uuid(), v_household_id, r.person_ids[i],
                CASE WHEN i = 1 THEN 'primary' ELSE 'member' END,
                i = 1,
                NOW()
            )
            ON CONFLICT DO NOTHING;
            v_members := v_members + 1;
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Signal 1 (shared last name): % households, % members', v_households, v_members;

    -- =========================================================================
    -- Signal 2: Ampersand names in clinic accounts (e.g., "Glenn & Cheri Clark")
    -- These indicate couples sharing one ClinicHQ booking account.
    -- =========================================================================

    DECLARE
        v_sig2_households INT := 0;
        v_sig2_members INT := 0;
    BEGIN
        FOR r IN
            SELECT
                ca.account_id,
                ca.display_name,
                ca.resolved_person_id,
                pl.sot_address_id AS address_id,
                pl.formatted_address
            FROM ops.clinic_accounts ca
            JOIN sot.places pl ON pl.place_id = ca.resolved_place_id
                AND pl.merged_into_place_id IS NULL
                AND pl.sot_address_id IS NOT NULL
            WHERE ca.display_name LIKE '%&%'
              AND ca.resolved_person_id IS NOT NULL
              AND ca.resolved_place_id IS NOT NULL
              AND ca.account_type NOT IN ('organization', 'site_name', 'address')
        LOOP
            -- Check if this person already in a household at this address
            IF NOT EXISTS (
                SELECT 1 FROM sot.household_members hm
                JOIN sot.households h ON h.household_id = hm.household_id
                WHERE hm.person_id = r.resolved_person_id
                  AND h.primary_address_id = r.address_id
            ) THEN
                -- Create household from ampersand name
                INSERT INTO sot.households (
                    household_id, primary_address_id, household_name,
                    primary_address, primary_account_id, detection_reason, detected_at
                ) VALUES (
                    gen_random_uuid(), r.address_id,
                    r.display_name,
                    r.formatted_address,
                    r.account_id,
                    'ampersand_clinic_account',
                    NOW()
                )
                RETURNING sot.households.household_id INTO v_household_id;

                INSERT INTO sot.household_members (
                    member_id, household_id, person_id, relationship, is_primary, joined_at
                ) VALUES (
                    gen_random_uuid(), v_household_id, r.resolved_person_id,
                    'primary', TRUE, NOW()
                )
                ON CONFLICT DO NOTHING;

                v_sig2_households := v_sig2_households + 1;
                v_sig2_members := v_sig2_members + 1;
            END IF;
        END LOOP;

        v_households := v_households + v_sig2_households;
        v_members := v_members + v_sig2_members;
        RAISE NOTICE 'Signal 2 (ampersand names): % households, % members', v_sig2_households, v_sig2_members;
    END;

    households_created := v_households;
    members_added := v_members;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.detect_and_populate_households IS
'FFS-524: Detects and creates households using family signals:
Signal 1: Same address + shared last name (2+ people)
Signal 2: Clinic account with ampersand name ("Glenn & Cheri Clark")
Does NOT group unrelated people at the same address.
Run periodically or after entity linking to keep households current.';

-- ============================================================================
-- 3. Run household detection
-- ============================================================================

\echo '3. Running household detection...'

SELECT * FROM sot.detect_and_populate_households();

-- Show results
\echo 'Household summary:'
SELECT
    detection_reason,
    COUNT(*) AS household_count,
    SUM(member_count) AS total_members
FROM (
    SELECT h.detection_reason, COUNT(hm.person_id) AS member_count
    FROM sot.households h
    LEFT JOIN sot.household_members hm ON hm.household_id = h.household_id
    GROUP BY h.household_id, h.detection_reason
) sub
GROUP BY detection_reason;

\echo 'Sample households:'
SELECT
    h.household_name,
    h.primary_address,
    h.detection_reason,
    ARRAY_AGG(p.display_name ORDER BY hm.is_primary DESC, p.display_name) AS members
FROM sot.households h
JOIN sot.household_members hm ON hm.household_id = h.household_id
JOIN sot.people p ON p.person_id = hm.person_id
GROUP BY h.household_id, h.household_name, h.primary_address, h.detection_reason
HAVING COUNT(*) >= 2
ORDER BY COUNT(*) DESC
LIMIT 15;

-- ============================================================================
-- 4. Add household-awareness to Phase 0.5 of data_engine_resolve_identity
-- ============================================================================

\echo ''
\echo '4. Adding name-check guard to Phase 0.5 auto-matching...'

-- The fix: when Phase 0.5 finds a person by email/phone, check if the incoming
-- name is very different. If so, skip Phase 0.5 and fall through to full scoring.
-- This prevents auto-merging family members who share an identifier.

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
    -- MIG_2929/FFS-524: Added name similarity check to prevent household
    -- member auto-merging when same identifier but very different name.
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
        -- MIG_2929/FFS-524: Check name similarity before auto-matching
        -- If incoming name is provided and is very different from existing person,
        -- skip Phase 0.5 and fall through to full scoring.
        -- This catches family members sharing email/phone.
        v_name_similarity := 1.0;  -- Default: assume same person if no name to compare
        IF v_display_name IS NOT NULL AND v_display_name != ''
           AND v_existing_display_name IS NOT NULL AND v_existing_display_name != '' THEN
            SELECT cn.jaro_winkler_similarity INTO v_name_similarity
            FROM sot.compare_names(v_display_name, v_existing_display_name) cn;
        END IF;

        IF v_name_similarity >= 0.75 THEN
            -- Names are similar enough → auto-match (original behavior)
            v_decision_type := 'auto_match';
            v_reason := 'Matched by existing identifier';
            v_person_id := v_existing_person_id;

            v_match_details := jsonb_build_object(
                'matched_person_id', v_person_id,
                'matched_name', v_existing_display_name,
                'match_type', 'direct_identifier_lookup',
                'name_similarity', v_name_similarity
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
            -- MIG_2929: Names are too different → potential household member
            -- Fall through to full scoring instead of auto-matching
            RAISE NOTICE 'Phase 0.5 name guard: "%" vs "%" (similarity %) — falling through to scoring',
                v_display_name, v_existing_display_name, ROUND(v_name_similarity, 2);
        END IF;
    END IF;

    -- =========================================================================
    -- PHASE 1+: V2 SCORING AND MATCHING (MIG_2830)
    -- Uses comparison-level weights instead of flat percentages
    -- =========================================================================

    SELECT * INTO v_candidate
    FROM sot.data_engine_score_candidates_v2(
        v_email_norm,
        v_phone_norm,
        v_display_name,
        v_address_norm
    )
    LIMIT 1;

    -- Decision logic based on total_weight (not total_score)
    IF v_candidate.person_id IS NOT NULL AND v_candidate.total_weight >= 20 THEN
        v_decision_type := 'auto_match';
        v_reason := 'High confidence match (weight ' || ROUND(v_candidate.total_weight, 1)::TEXT ||
                     ', score ' || ROUND(v_candidate.total_score, 2)::TEXT || ')';
        v_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'total_weight', v_candidate.total_weight,
            'score_breakdown', v_candidate.score_breakdown,
            'scoring_version', 'v2'
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

    ELSIF v_candidate.person_id IS NOT NULL AND v_candidate.total_weight > 5 THEN
        v_decision_type := 'review_pending';
        v_reason := 'Medium confidence match (weight ' || ROUND(v_candidate.total_weight, 1)::TEXT ||
                     ', score ' || ROUND(v_candidate.total_score, 2)::TEXT || ') - needs verification';
        v_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'total_weight', v_candidate.total_weight,
            'score_breakdown', v_candidate.score_breakdown,
            'scoring_version', 'v2'
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
'V4: Unified identity resolution with household-aware Phase 0.5 (MIG_2929).
Phase 0: should_be_person gate
Phase 0.5: Direct identifier lookup WITH name similarity check (>= 0.75)
  - If name similarity < 0.75, falls through to full scoring to prevent
    auto-merging household members sharing an email/phone
Phase 1+: V2 comparison-level scoring with name rarity (MIG_2928)
Auto-match threshold: total_weight >= 20
Review threshold: total_weight > 5
Creates new person below threshold.';

\echo '   Updated data_engine_resolve_identity() with Phase 0.5 name guard'

\echo ''
\echo 'MIG_2929: Households rebuilt with intelligent detection, Phase 0.5 name guard added'

COMMIT;
