\echo '=== MIG_315: Data Engine Core Functions ==='
\echo 'Creating core identity resolution functions for the Data Engine'
\echo ''

-- ============================================================================
-- DATA ENGINE CANDIDATE SCORING
-- Multi-signal weighted scoring for identity matching
-- Fixed: Use explicit aliases to avoid ambiguous column references
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.data_engine_score_candidates(
    p_email_norm TEXT,
    p_phone_norm TEXT,
    p_display_name TEXT,
    p_address_norm TEXT
)
RETURNS TABLE (
    person_id UUID,
    display_name TEXT,
    total_score NUMERIC,
    email_score NUMERIC,
    phone_score NUMERIC,
    name_score NUMERIC,
    address_score NUMERIC,
    household_id UUID,
    is_household_candidate BOOLEAN,
    matched_rules TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    WITH
    -- Email matches
    email_matches AS (
        SELECT DISTINCT
            pi.person_id AS matched_person_id,
            1.0::NUMERIC as score,
            'exact_email'::TEXT as rule
        FROM trapper.person_identifiers pi
        WHERE p_email_norm IS NOT NULL
          AND p_email_norm != ''
          AND pi.id_type = 'email'
          AND pi.id_value_norm = p_email_norm
          AND EXISTS (
              SELECT 1 FROM trapper.sot_people sp
              WHERE sp.person_id = pi.person_id
              AND sp.merged_into_person_id IS NULL
          )
    ),

    -- Phone matches (check blacklists)
    phone_matches AS (
        SELECT DISTINCT
            pi.person_id AS matched_person_id,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM trapper.identity_phone_blacklist bl
                    WHERE bl.phone_norm = p_phone_norm
                    AND bl.allow_with_name_match = FALSE
                ) THEN 0.0::NUMERIC
                WHEN EXISTS (
                    SELECT 1 FROM trapper.data_engine_soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_phone_norm
                    AND sbl.identifier_type = 'phone'
                ) THEN 0.5::NUMERIC
                ELSE 1.0::NUMERIC
            END as score,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM trapper.data_engine_soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_phone_norm
                    AND sbl.identifier_type = 'phone'
                ) THEN 'exact_phone_soft_blacklist'::TEXT
                ELSE 'exact_phone'::TEXT
            END as rule
        FROM trapper.person_identifiers pi
        WHERE p_phone_norm IS NOT NULL
          AND p_phone_norm != ''
          AND pi.id_type = 'phone'
          AND pi.id_value_norm = p_phone_norm
          AND NOT EXISTS (
              SELECT 1 FROM trapper.identity_phone_blacklist bl
              WHERE bl.phone_norm = p_phone_norm
              AND bl.allow_with_name_match = FALSE
              AND bl.allow_with_address_match = FALSE
          )
          AND EXISTS (
              SELECT 1 FROM trapper.sot_people sp
              WHERE sp.person_id = pi.person_id
              AND sp.merged_into_person_id IS NULL
          )
    ),

    -- Address matches
    address_matches AS (
        SELECT DISTINCT
            ppr.person_id AS matched_person_id,
            0.8::NUMERIC as score,
            'address_match'::TEXT as rule
        FROM trapper.person_place_relationships ppr
        JOIN trapper.places pl ON pl.place_id = ppr.place_id
        WHERE p_address_norm IS NOT NULL
          AND p_address_norm != ''
          AND (
              pl.normalized_address = p_address_norm
              OR pl.formatted_address ILIKE '%' || p_address_norm || '%'
          )
          AND pl.merged_into_place_id IS NULL
    ),

    -- Household candidates
    household_candidates AS (
        SELECT DISTINCT
            hm.person_id AS matched_person_id,
            h.household_id AS hh_id,
            TRUE as is_household
        FROM trapper.households h
        JOIN trapper.household_members hm ON hm.household_id = h.household_id AND hm.valid_to IS NULL
        JOIN trapper.places pl ON pl.place_id = h.primary_place_id
        WHERE p_address_norm IS NOT NULL
          AND p_address_norm != ''
          AND (
              pl.normalized_address = p_address_norm
              OR pl.formatted_address ILIKE '%' || p_address_norm || '%'
          )
    ),

    -- Collect all candidates
    all_candidates AS (
        SELECT DISTINCT matched_person_id FROM email_matches WHERE score > 0
        UNION
        SELECT DISTINCT matched_person_id FROM phone_matches WHERE score > 0
        UNION
        SELECT DISTINCT matched_person_id FROM address_matches
    ),

    -- Name similarity scores
    name_scores AS (
        SELECT
            ac.matched_person_id,
            trapper.name_similarity(sp.display_name, p_display_name) as score,
            'name_similarity'::TEXT as rule
        FROM all_candidates ac
        JOIN trapper.sot_people sp ON sp.person_id = ac.matched_person_id
        WHERE p_display_name IS NOT NULL
          AND p_display_name != ''
          AND sp.merged_into_person_id IS NULL
    )

    -- Combine scores
    SELECT
        ac.matched_person_id AS person_id,
        sp.display_name,
        GREATEST(0, LEAST(1,
            COALESCE(em.score, 0) * 0.40 +
            COALESCE(pm.score, 0) * 0.25 +
            COALESCE(ns.score, 0) * 0.25 +
            COALESCE(am.score, 0) * 0.10
        ))::NUMERIC as total_score,
        COALESCE(em.score, 0)::NUMERIC as email_score,
        COALESCE(pm.score, 0)::NUMERIC as phone_score,
        COALESCE(ns.score, 0)::NUMERIC as name_score,
        COALESCE(am.score, 0)::NUMERIC as address_score,
        hc.hh_id AS household_id,
        COALESCE(hc.is_household, FALSE) as is_household_candidate,
        ARRAY_REMOVE(ARRAY[em.rule, pm.rule, ns.rule, am.rule], NULL) as matched_rules
    FROM all_candidates ac
    JOIN trapper.sot_people sp ON sp.person_id = ac.matched_person_id
    LEFT JOIN email_matches em ON em.matched_person_id = ac.matched_person_id
    LEFT JOIN phone_matches pm ON pm.matched_person_id = ac.matched_person_id
    LEFT JOIN name_scores ns ON ns.matched_person_id = ac.matched_person_id
    LEFT JOIN address_matches am ON am.matched_person_id = ac.matched_person_id
    LEFT JOIN household_candidates hc ON hc.matched_person_id = ac.matched_person_id
    WHERE sp.merged_into_person_id IS NULL
    ORDER BY total_score DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.data_engine_score_candidates IS
'Scores all potential person matches for incoming identity data using weighted multi-signal matching.';

\echo 'Created data_engine_score_candidates function'

-- ============================================================================
-- DATA ENGINE IDENTITY RESOLUTION
-- Main entry point for resolving person identity
-- Fixed: Use string concatenation instead of format() to avoid % issues
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.data_engine_resolve_identity(
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'unknown',
    p_staged_record_id UUID DEFAULT NULL,
    p_job_id UUID DEFAULT NULL
)
RETURNS TABLE (
    person_id UUID,
    decision_type TEXT,
    confidence_score NUMERIC,
    household_id UUID,
    decision_id UUID
) AS $$
DECLARE
    v_email_norm TEXT;
    v_phone_norm TEXT;
    v_display_name TEXT;
    v_address_norm TEXT;
    v_top_candidate RECORD;
    v_decision_type TEXT;
    v_decision_reason TEXT;
    v_new_person_id UUID;
    v_household_id UUID;
    v_decision_id UUID;
    v_score_breakdown JSONB;
    v_rules_applied JSONB;
    v_candidates_count INT;
    v_start_time TIMESTAMPTZ;
    v_duration_ms INT;
BEGIN
    v_start_time := clock_timestamp();

    -- Normalize inputs
    v_email_norm := trapper.norm_email(p_email);
    v_phone_norm := trapper.norm_phone_us(p_phone);
    v_display_name := TRIM(CONCAT_WS(' ',
        NULLIF(TRIM(COALESCE(p_first_name, '')), ''),
        NULLIF(TRIM(COALESCE(p_last_name, '')), '')
    ));
    v_address_norm := trapper.normalize_address(COALESCE(p_address, ''));

    -- Early rejection: internal accounts
    IF trapper.is_internal_account(v_display_name) THEN
        v_decision_type := 'rejected';
        v_decision_reason := 'Internal account detected';

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            decision_type, decision_reason, processing_job_id,
            processing_duration_ms
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, 0,
            v_decision_type, v_decision_reason, p_job_id,
            EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT NULL::UUID, v_decision_type, 0::NUMERIC, NULL::UUID, v_decision_id;
        RETURN;
    END IF;

    -- Early rejection: no usable identifiers
    IF v_email_norm IS NULL AND v_phone_norm IS NULL THEN
        v_decision_type := 'rejected';
        v_decision_reason := 'No email or phone provided';

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            decision_type, decision_reason, processing_job_id,
            processing_duration_ms
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, 0,
            v_decision_type, v_decision_reason, p_job_id,
            EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT NULL::UUID, v_decision_type, 0::NUMERIC, NULL::UUID, v_decision_id;
        RETURN;
    END IF;

    -- Get candidates count
    SELECT COUNT(*) INTO v_candidates_count
    FROM trapper.data_engine_score_candidates(v_email_norm, v_phone_norm, v_display_name, v_address_norm);

    -- Get top candidate
    SELECT * INTO v_top_candidate
    FROM trapper.data_engine_score_candidates(v_email_norm, v_phone_norm, v_display_name, v_address_norm)
    ORDER BY total_score DESC
    LIMIT 1;

    -- Build score breakdown
    IF v_top_candidate.person_id IS NOT NULL THEN
        v_score_breakdown := jsonb_build_object(
            'email_score', v_top_candidate.email_score,
            'phone_score', v_top_candidate.phone_score,
            'name_score', v_top_candidate.name_score,
            'address_score', v_top_candidate.address_score,
            'total_score', v_top_candidate.total_score
        );
        v_rules_applied := to_jsonb(v_top_candidate.matched_rules);
    END IF;

    -- Decision logic based on score and context
    IF v_top_candidate.person_id IS NOT NULL AND v_top_candidate.total_score >= 0.95 THEN
        -- High confidence: auto-match
        v_decision_type := 'auto_match';
        v_decision_reason := 'High confidence match (' || ROUND(v_top_candidate.total_score, 2)::TEXT || ') to ' || COALESCE(v_top_candidate.display_name, 'unknown');

        v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            top_candidate_person_id, top_candidate_score, decision_type,
            decision_reason, resulting_person_id, score_breakdown, rules_applied,
            processing_job_id, processing_duration_ms
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, v_candidates_count,
            v_top_candidate.person_id, v_top_candidate.total_score, v_decision_type,
            v_decision_reason, trapper.get_canonical_person_id(v_top_candidate.person_id),
            v_score_breakdown, v_rules_applied, p_job_id, v_duration_ms
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT
            trapper.get_canonical_person_id(v_top_candidate.person_id),
            v_decision_type,
            v_top_candidate.total_score,
            v_top_candidate.household_id,
            v_decision_id;
        RETURN;

    ELSIF v_top_candidate.person_id IS NOT NULL AND v_top_candidate.total_score >= 0.50 THEN
        -- Medium confidence: check if household situation
        IF v_top_candidate.is_household_candidate AND v_top_candidate.name_score < 0.5 THEN
            v_decision_type := 'household_member';
            v_decision_reason := 'Household member detected (score ' || ROUND(v_top_candidate.total_score, 2)::TEXT || ', name similarity ' || ROUND(v_top_candidate.name_score, 2)::TEXT || ')';
            v_household_id := v_top_candidate.household_id;

            -- Create new person
            v_new_person_id := trapper.create_person_basic(
                v_display_name, v_email_norm, v_phone_norm, p_source_system
            );

            -- Add to household if exists
            IF v_household_id IS NOT NULL AND v_new_person_id IS NOT NULL THEN
                INSERT INTO trapper.household_members (household_id, person_id, inferred_from, source_system)
                VALUES (v_household_id, v_new_person_id, 'data_engine_matching', p_source_system)
                ON CONFLICT DO NOTHING;

                UPDATE trapper.households SET member_count = member_count + 1, updated_at = NOW()
                WHERE households.household_id = v_household_id;
            END IF;

        ELSE
            -- Uncertain: needs review
            v_decision_type := 'review_pending';
            v_decision_reason := 'Medium confidence match (' || ROUND(v_top_candidate.total_score, 2)::TEXT || ') - needs human review';

            -- Create new person (will be merged or kept separate after review)
            v_new_person_id := trapper.create_person_basic(
                v_display_name, v_email_norm, v_phone_norm, p_source_system
            );

            -- Flag as potential duplicate
            IF v_new_person_id IS NOT NULL THEN
                INSERT INTO trapper.potential_person_duplicates (
                    person_id, potential_match_id, match_type, name_similarity,
                    new_source_system, existing_source_system, status
                ) VALUES (
                    v_new_person_id, v_top_candidate.person_id, 'data_engine_review',
                    v_top_candidate.name_score, p_source_system,
                    (SELECT data_source::TEXT FROM trapper.sot_people WHERE sot_people.person_id = v_top_candidate.person_id),
                    'pending'
                ) ON CONFLICT DO NOTHING;
            END IF;
        END IF;

        v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            top_candidate_person_id, top_candidate_score, decision_type,
            decision_reason, resulting_person_id, household_id,
            score_breakdown, rules_applied, processing_job_id,
            review_status, processing_duration_ms
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, v_candidates_count,
            v_top_candidate.person_id, v_top_candidate.total_score, v_decision_type,
            v_decision_reason, v_new_person_id, v_household_id,
            v_score_breakdown, v_rules_applied, p_job_id,
            CASE WHEN v_decision_type = 'review_pending' THEN 'pending' ELSE 'not_required' END,
            v_duration_ms
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT v_new_person_id, v_decision_type, v_top_candidate.total_score, v_household_id, v_decision_id;
        RETURN;

    ELSE
        -- Low confidence or no candidates: create new person
        v_decision_type := 'new_entity';
        v_decision_reason := CASE
            WHEN v_top_candidate.person_id IS NULL THEN 'No matching candidates found'
            ELSE 'Low confidence match (' || ROUND(v_top_candidate.total_score, 2)::TEXT || ') - creating new person'
        END;

        v_new_person_id := trapper.create_person_basic(
            v_display_name, v_email_norm, v_phone_norm, p_source_system
        );

        v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            top_candidate_person_id, top_candidate_score, decision_type,
            decision_reason, resulting_person_id, score_breakdown, rules_applied,
            processing_job_id, processing_duration_ms
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, v_candidates_count,
            v_top_candidate.person_id, COALESCE(v_top_candidate.total_score, 0), v_decision_type,
            v_decision_reason, v_new_person_id, v_score_breakdown, v_rules_applied,
            p_job_id, v_duration_ms
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT v_new_person_id, v_decision_type, COALESCE(v_top_candidate.total_score, 0)::NUMERIC, NULL::UUID, v_decision_id;
        RETURN;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_resolve_identity IS
'Main Data Engine entry point for identity resolution. Returns matched or newly created person with full audit trail.';

\echo 'Created data_engine_resolve_identity function'

-- ============================================================================
-- HELPER: CREATE PERSON BASIC
-- Creates a person with minimal validation (used internally by Data Engine)
-- Fixed: Use data_source enum instead of source_system column
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.create_person_basic(
    p_display_name TEXT,
    p_email_norm TEXT,
    p_phone_norm TEXT,
    p_source_system TEXT
)
RETURNS UUID AS $$
DECLARE
    v_person_id UUID;
    v_data_source trapper.data_source;
BEGIN
    -- Validate name
    IF NOT trapper.is_valid_person_name(p_display_name) THEN
        RETURN NULL;
    END IF;

    -- Map source_system to data_source enum
    v_data_source := CASE p_source_system
        WHEN 'clinichq' THEN 'clinichq'::trapper.data_source
        WHEN 'airtable' THEN 'airtable'::trapper.data_source
        WHEN 'web_intake' THEN 'web_app'::trapper.data_source
        WHEN 'atlas_ui' THEN 'web_app'::trapper.data_source
        ELSE 'web_app'::trapper.data_source
    END;

    -- Create person
    INSERT INTO trapper.sot_people (
        display_name, data_source, is_canonical, primary_email, primary_phone
    ) VALUES (
        p_display_name, v_data_source, TRUE, p_email_norm, p_phone_norm
    ) RETURNING person_id INTO v_person_id;

    -- Add email identifier
    IF p_email_norm IS NOT NULL AND p_email_norm != '' THEN
        INSERT INTO trapper.person_identifiers (
            person_id, id_type, id_value_norm, id_value_raw, source_system, confidence
        ) VALUES (
            v_person_id, 'email', p_email_norm, p_email_norm, p_source_system, 1.0
        ) ON CONFLICT (id_type, id_value_norm) DO NOTHING;
    END IF;

    -- Add phone identifier (if not blacklisted)
    IF p_phone_norm IS NOT NULL AND p_phone_norm != '' THEN
        IF NOT EXISTS (
            SELECT 1 FROM trapper.identity_phone_blacklist
            WHERE phone_norm = p_phone_norm
        ) THEN
            INSERT INTO trapper.person_identifiers (
                person_id, id_type, id_value_norm, id_value_raw, source_system, confidence
            ) VALUES (
                v_person_id, 'phone', p_phone_norm, p_phone_norm, p_source_system, 1.0
            ) ON CONFLICT (id_type, id_value_norm) DO NOTHING;
        END IF;
    END IF;

    RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.create_person_basic IS
'Creates a new person with email/phone identifiers. Used internally by Data Engine.';

\echo 'Created create_person_basic helper function'

-- ============================================================================
-- HOUSEHOLD MANAGEMENT FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.data_engine_create_household(
    p_place_id UUID,
    p_person_ids UUID[],
    p_source TEXT DEFAULT 'data_engine'
)
RETURNS UUID AS $$
DECLARE
    v_household_id UUID;
    v_person_id UUID;
BEGIN
    -- Check if household already exists for this place
    SELECT household_id INTO v_household_id
    FROM trapper.households
    WHERE primary_place_id = p_place_id;

    -- Create if not exists
    IF v_household_id IS NULL THEN
        INSERT INTO trapper.households (primary_place_id, member_count, source_system)
        VALUES (p_place_id, array_length(p_person_ids, 1), p_source)
        RETURNING household_id INTO v_household_id;
    END IF;

    -- Add all members
    FOREACH v_person_id IN ARRAY p_person_ids
    LOOP
        INSERT INTO trapper.household_members (household_id, person_id, inferred_from, source_system)
        VALUES (v_household_id, v_person_id, p_source, p_source)
        ON CONFLICT DO NOTHING;
    END LOOP;

    -- Update member count
    UPDATE trapper.households
    SET member_count = (SELECT COUNT(*) FROM trapper.household_members WHERE household_members.household_id = v_household_id AND valid_to IS NULL),
        updated_at = NOW()
    WHERE households.household_id = v_household_id;

    RETURN v_household_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_create_household IS
'Creates or updates a household at a place with the given member person IDs.';

CREATE OR REPLACE FUNCTION trapper.data_engine_detect_shared_identifiers()
RETURNS TABLE (
    identifier_type TEXT,
    identifier_value TEXT,
    person_count BIGINT,
    person_ids UUID[],
    sample_names TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        pi.id_type::TEXT as identifier_type,
        pi.id_value_norm as identifier_value,
        COUNT(DISTINCT pi.person_id) as person_count,
        ARRAY_AGG(DISTINCT pi.person_id) as person_ids,
        ARRAY_AGG(DISTINCT p.display_name) as sample_names
    FROM trapper.person_identifiers pi
    JOIN trapper.sot_people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
    WHERE pi.id_type IN ('phone', 'email')
    GROUP BY pi.id_type, pi.id_value_norm
    HAVING COUNT(DISTINCT pi.person_id) > 1
    ORDER BY COUNT(DISTINCT pi.person_id) DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.data_engine_detect_shared_identifiers IS
'Detects identifiers (phone/email) that are shared by multiple people. Used for household detection and soft blacklist population.';

\echo 'Created household management functions'

-- ============================================================================
-- REVIEW QUEUE RESOLUTION
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.data_engine_resolve_review(
    p_decision_id UUID,
    p_action TEXT,  -- 'merge', 'keep_separate', 'add_to_household', 'reject'
    p_resolved_by TEXT DEFAULT 'staff',
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_decision RECORD;
    v_result JSONB;
BEGIN
    -- Get the decision
    SELECT * INTO v_decision
    FROM trapper.data_engine_match_decisions
    WHERE decision_id = p_decision_id;

    IF v_decision IS NULL THEN
        RAISE EXCEPTION 'Decision not found: %', p_decision_id;
    END IF;

    IF v_decision.review_status NOT IN ('pending', 'deferred') THEN
        RAISE EXCEPTION 'Decision already resolved: %', v_decision.review_status;
    END IF;

    -- Handle actions
    IF p_action = 'merge' THEN
        -- Merge the new person into the candidate
        IF v_decision.resulting_person_id IS NOT NULL AND v_decision.top_candidate_person_id IS NOT NULL THEN
            PERFORM trapper.merge_people(
                v_decision.resulting_person_id,
                v_decision.top_candidate_person_id,
                'data_engine_review_merge',
                p_resolved_by
            );
        END IF;

        UPDATE trapper.data_engine_match_decisions
        SET review_status = 'merged',
            reviewed_by = p_resolved_by,
            reviewed_at = NOW(),
            review_notes = p_notes,
            review_action = p_action
        WHERE decision_id = p_decision_id;

    ELSIF p_action = 'keep_separate' THEN
        -- Confirm they are different people
        UPDATE trapper.data_engine_match_decisions
        SET review_status = 'approved',
            reviewed_by = p_resolved_by,
            reviewed_at = NOW(),
            review_notes = p_notes,
            review_action = p_action
        WHERE decision_id = p_decision_id;

        -- Clear from potential duplicates
        DELETE FROM trapper.potential_person_duplicates
        WHERE person_id = v_decision.resulting_person_id
          AND potential_match_id = v_decision.top_candidate_person_id;

    ELSIF p_action = 'add_to_household' THEN
        -- Create household with both people
        PERFORM trapper.data_engine_create_household(
            (SELECT place_id FROM trapper.person_place_relationships
             WHERE person_id = v_decision.top_candidate_person_id LIMIT 1),
            ARRAY[v_decision.resulting_person_id, v_decision.top_candidate_person_id],
            'review_resolution'
        );

        UPDATE trapper.data_engine_match_decisions
        SET review_status = 'approved',
            reviewed_by = p_resolved_by,
            reviewed_at = NOW(),
            review_notes = p_notes,
            review_action = p_action
        WHERE decision_id = p_decision_id;

    ELSIF p_action = 'reject' THEN
        -- Mark the new person as invalid
        UPDATE trapper.sot_people
        SET is_canonical = FALSE
        WHERE person_id = v_decision.resulting_person_id;

        UPDATE trapper.data_engine_match_decisions
        SET review_status = 'rejected',
            reviewed_by = p_resolved_by,
            reviewed_at = NOW(),
            review_notes = p_notes,
            review_action = p_action
        WHERE decision_id = p_decision_id;

    ELSE
        RAISE EXCEPTION 'Unknown action: %', p_action;
    END IF;

    v_result := jsonb_build_object(
        'success', TRUE,
        'decision_id', p_decision_id,
        'action', p_action,
        'resolved_by', p_resolved_by
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_resolve_review IS
'Resolves a pending identity review with the specified action (merge, keep_separate, add_to_household, reject).';

\echo 'Created review resolution function'

-- ============================================================================
-- UPDATE EXISTING find_or_create_person TO USE DATA ENGINE
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.find_or_create_person(
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'web_intake'
)
RETURNS UUID AS $$
DECLARE
    v_result RECORD;
BEGIN
    -- Use Data Engine for identity resolution
    SELECT * INTO v_result
    FROM trapper.data_engine_resolve_identity(
        p_email, p_phone, p_first_name, p_last_name, p_address, p_source_system
    );

    RETURN v_result.person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_or_create_person IS
'Finds or creates a person using the Data Engine identity resolution system. Wrapper for data_engine_resolve_identity.';

\echo 'Updated find_or_create_person to use Data Engine'

\echo ''
\echo '=== MIG_315 Complete ==='
\echo 'Created functions:'
\echo '  - data_engine_score_candidates (multi-signal weighted scoring)'
\echo '  - data_engine_resolve_identity (main entry point)'
\echo '  - create_person_basic (helper for person creation)'
\echo '  - data_engine_create_household (household management)'
\echo '  - data_engine_detect_shared_identifiers (find shared phones/emails)'
\echo '  - data_engine_resolve_review (review queue resolution)'
\echo ''
\echo 'Updated: find_or_create_person now uses Data Engine'
\echo ''
