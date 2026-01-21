\echo ''
\echo '=============================================='
\echo 'MIG_522: Data Engine Validation Hardening'
\echo '=============================================='
\echo ''
\echo 'Strengthens identity resolution by:'
\echo '  1. Adding full is_valid_person_name() check to early rejection'
\echo '  2. Adding email blacklist check to scoring'
\echo '  3. Ensuring organization names are rejected'
\echo ''

-- ============================================================================
-- PART 1: Update data_engine_resolve_identity() to check is_valid_person_name()
-- ============================================================================

\echo 'Updating data_engine_resolve_identity() with full name validation...'

CREATE OR REPLACE FUNCTION trapper.data_engine_resolve_identity(
    p_email TEXT,
    p_phone TEXT,
    p_first_name TEXT,
    p_last_name TEXT,
    p_address TEXT,
    p_source_system TEXT,
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
    v_rejection_reason TEXT;
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

    -- =========================================================================
    -- EARLY REJECTION 1: Internal accounts (existing check)
    -- =========================================================================
    IF trapper.is_internal_account(v_display_name) THEN
        v_decision_type := 'rejected';
        v_decision_reason := 'Internal account detected: ' || v_display_name;

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

    -- =========================================================================
    -- EARLY REJECTION 2: Invalid person names (NEW - organization, garbage, etc.)
    -- =========================================================================
    IF v_display_name IS NOT NULL AND v_display_name != '' THEN
        -- Check for organization names
        IF trapper.is_organization_name(v_display_name) THEN
            v_rejection_reason := 'organization name';
        -- Check for garbage/placeholder names
        ELSIF trapper.is_garbage_name(v_display_name) THEN
            v_rejection_reason := 'garbage/placeholder name';
        -- Check against data_fixing_patterns for additional patterns
        ELSIF EXISTS (
            SELECT 1 FROM trapper.data_fixing_patterns dfp
            WHERE dfp.is_organization = TRUE OR dfp.is_garbage = TRUE
              AND dfp.pattern_type = 'name'
              AND (
                  (dfp.pattern_value IS NOT NULL AND LOWER(v_display_name) = LOWER(dfp.pattern_value)) OR
                  (dfp.pattern_ilike IS NOT NULL AND v_display_name ILIKE dfp.pattern_ilike) OR
                  (dfp.pattern_regex IS NOT NULL AND v_display_name ~* dfp.pattern_regex)
              )
        ) THEN
            v_rejection_reason := 'matches bad pattern';
        END IF;

        IF v_rejection_reason IS NOT NULL THEN
            v_decision_type := 'rejected';
            v_decision_reason := 'Invalid person name (' || v_rejection_reason || '): ' || v_display_name;

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
    END IF;

    -- =========================================================================
    -- EARLY REJECTION 3: No usable identifiers (existing check)
    -- =========================================================================
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

    -- =========================================================================
    -- EARLY REJECTION 4: Blacklisted email only (NEW - if only email provided)
    -- =========================================================================
    IF v_email_norm IS NOT NULL AND v_phone_norm IS NULL THEN
        IF trapper.is_blacklisted_email(v_email_norm) THEN
            v_decision_type := 'rejected';
            v_decision_reason := 'Blacklisted email (placeholder/test): ' || v_email_norm;

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
    END IF;

    -- =========================================================================
    -- SCORING: Get candidates and score them
    -- =========================================================================

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

    -- =========================================================================
    -- DECISION LOGIC
    -- =========================================================================

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
            processing_job_id, processing_duration_ms,
            used_enrichment, enrichment_source
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, v_candidates_count,
            v_top_candidate.person_id, v_top_candidate.total_score, v_decision_type,
            v_decision_reason, trapper.get_canonical_person_id(v_top_candidate.person_id),
            v_score_breakdown, v_rules_applied, p_job_id, v_duration_ms,
            COALESCE(v_top_candidate.used_enrichment, FALSE),
            v_top_candidate.enrichment_source
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

            v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

            INSERT INTO trapper.data_engine_match_decisions (
                staged_record_id, source_system, incoming_email, incoming_phone,
                incoming_name, incoming_address, candidates_evaluated,
                top_candidate_person_id, top_candidate_score, decision_type,
                decision_reason, resulting_person_id, score_breakdown, rules_applied,
                household_id, processing_job_id, processing_duration_ms,
                used_enrichment, enrichment_source
            ) VALUES (
                p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
                v_display_name, v_address_norm, v_candidates_count,
                v_top_candidate.person_id, v_top_candidate.total_score, v_decision_type,
                v_decision_reason, v_new_person_id, v_score_breakdown, v_rules_applied,
                v_household_id, p_job_id, v_duration_ms,
                COALESCE(v_top_candidate.used_enrichment, FALSE),
                v_top_candidate.enrichment_source
            ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

            RETURN QUERY SELECT v_new_person_id, v_decision_type, v_top_candidate.total_score, v_household_id, v_decision_id;
            RETURN;
        ELSE
            -- Medium confidence but not household: review_pending
            v_decision_type := 'review_pending';
            v_decision_reason := 'Medium confidence (' || ROUND(v_top_candidate.total_score, 2)::TEXT || ') - manual review recommended';

            -- Still create person
            v_new_person_id := trapper.create_person_basic(
                v_display_name, v_email_norm, v_phone_norm, p_source_system
            );

            v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

            INSERT INTO trapper.data_engine_match_decisions (
                staged_record_id, source_system, incoming_email, incoming_phone,
                incoming_name, incoming_address, candidates_evaluated,
                top_candidate_person_id, top_candidate_score, decision_type,
                decision_reason, resulting_person_id, score_breakdown, rules_applied,
                processing_job_id, processing_duration_ms,
                used_enrichment, enrichment_source
            ) VALUES (
                p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
                v_display_name, v_address_norm, v_candidates_count,
                v_top_candidate.person_id, v_top_candidate.total_score, v_decision_type,
                v_decision_reason, v_new_person_id, v_score_breakdown, v_rules_applied,
                p_job_id, v_duration_ms,
                COALESCE(v_top_candidate.used_enrichment, FALSE),
                v_top_candidate.enrichment_source
            ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

            RETURN QUERY SELECT v_new_person_id, v_decision_type, v_top_candidate.total_score, NULL::UUID, v_decision_id;
            RETURN;
        END IF;
    ELSE
        -- Low or no score: create new entity
        v_decision_type := 'new_entity';
        IF v_top_candidate.person_id IS NOT NULL THEN
            v_decision_reason := 'Low confidence (' || ROUND(v_top_candidate.total_score, 2)::TEXT || ') - creating new person';
        ELSE
            v_decision_reason := 'No matching candidates found';
        END IF;

        -- Create new person
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
            v_top_candidate.person_id, v_top_candidate.total_score, v_decision_type,
            v_decision_reason, v_new_person_id, v_score_breakdown, v_rules_applied,
            p_job_id, v_duration_ms
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT v_new_person_id, v_decision_type, COALESCE(v_top_candidate.total_score, 0::NUMERIC), NULL::UUID, v_decision_id;
        RETURN;
    END IF;

EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'data_engine_resolve_identity error: %', SQLERRM;
    RETURN QUERY SELECT NULL::UUID, 'error'::TEXT, 0::NUMERIC, NULL::UUID, NULL::UUID;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_resolve_identity IS
'Identity resolution with full validation:
- Rejects internal accounts
- Rejects organization names (via is_organization_name)
- Rejects garbage/placeholder names (via is_garbage_name)
- Rejects records with no email/phone
- Rejects blacklisted-email-only records
- Scores candidates and makes matching decisions';

\echo 'data_engine_resolve_identity() updated with full name validation.'

-- ============================================================================
-- PART 2: Update scoring function to check email blacklist
-- ============================================================================

\echo 'Updating data_engine_score_candidates() with email blacklist check...'

-- Note: The scoring function is already complex and was updated in MIG_509.
-- We add a wrapper check here that zeroes email score for blacklisted emails.
-- This is applied in the main email_matches CTE.

-- First, check if MIG_509 columns exist (used_enrichment, enrichment_source)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'data_engine_match_decisions'
        AND column_name = 'used_enrichment'
    ) THEN
        ALTER TABLE trapper.data_engine_match_decisions
        ADD COLUMN used_enrichment BOOLEAN DEFAULT FALSE,
        ADD COLUMN enrichment_source TEXT;
    END IF;
END $$;

-- Update the scoring function to check email blacklist
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
    matched_rules TEXT[],
    used_enrichment BOOLEAN,
    enrichment_source TEXT
) AS $$
DECLARE
    v_email_blacklisted BOOLEAN := FALSE;
BEGIN
    -- Check if incoming email is blacklisted
    IF p_email_norm IS NOT NULL AND p_email_norm != '' THEN
        v_email_blacklisted := trapper.is_blacklisted_email(p_email_norm);
    END IF;

    RETURN QUERY
    WITH
    -- Email matches (with blacklist check)
    email_matches AS (
        SELECT DISTINCT
            pi.person_id AS matched_person_id,
            -- If email is blacklisted, score is 0 (won't match based on placeholder emails)
            CASE
                WHEN v_email_blacklisted THEN 0.0::NUMERIC
                ELSE 1.0::NUMERIC
            END as score,
            CASE
                WHEN v_email_blacklisted THEN 'email_blacklisted'::TEXT
                ELSE 'exact_email'::TEXT
            END as rule
        FROM trapper.person_identifiers pi
        WHERE p_email_norm IS NOT NULL
          AND p_email_norm != ''
          AND NOT v_email_blacklisted  -- Don't match on blacklisted emails
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
          )
          AND EXISTS (
              SELECT 1 FROM trapper.sot_people sp
              WHERE sp.person_id = pi.person_id
              AND sp.merged_into_person_id IS NULL
          )
    ),

    -- All unique candidates from identifier matches
    all_candidates AS (
        SELECT matched_person_id FROM email_matches
        UNION
        SELECT matched_person_id FROM phone_matches
    ),

    -- Enriched address matching (cross-source)
    enriched_address_matches AS (
        SELECT DISTINCT
            ppr.person_id AS matched_person_id,
            p.formatted_address AS enriched_address,
            p.source_system AS address_source
        FROM trapper.person_place_relationships ppr
        JOIN trapper.places p ON p.place_id = ppr.place_id
        WHERE ppr.person_id IN (SELECT matched_person_id FROM all_candidates)
          AND p.formatted_address IS NOT NULL
          AND p.merged_into_place_id IS NULL
    ),

    -- Calculate scores for each candidate
    scored_candidates AS (
        SELECT
            sp.person_id,
            sp.display_name,
            -- Email score: 40% weight
            COALESCE((SELECT em.score FROM email_matches em WHERE em.matched_person_id = sp.person_id), 0.0) * 0.40 AS email_component,
            -- Phone score: 25% weight
            COALESCE((SELECT pm.score FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id), 0.0) * 0.25 AS phone_component,
            -- Name similarity: 25% weight
            CASE
                WHEN p_display_name IS NULL OR p_display_name = '' THEN 0.0
                WHEN sp.display_name IS NULL OR sp.display_name = '' THEN 0.0
                ELSE trapper.name_similarity(p_display_name, sp.display_name) * 0.25
            END AS name_component,
            -- Address match: 10% weight (with enrichment from cross-source)
            CASE
                -- Direct address match
                WHEN p_address_norm IS NOT NULL AND p_address_norm != '' AND EXISTS (
                    SELECT 1 FROM trapper.person_place_relationships ppr
                    JOIN trapper.places p ON p.place_id = ppr.place_id
                    WHERE ppr.person_id = sp.person_id
                    AND p.merged_into_place_id IS NULL
                    AND (
                        trapper.normalize_address(p.formatted_address) = p_address_norm OR
                        p.formatted_address ILIKE '%' || p_address_norm || '%'
                    )
                ) THEN 0.08
                -- Enriched address match (cross-source)
                WHEN p_address_norm IS NULL OR p_address_norm = '' THEN
                    CASE
                        WHEN EXISTS (SELECT 1 FROM enriched_address_matches eam WHERE eam.matched_person_id = sp.person_id)
                        THEN 0.06  -- Slight boost for having address in another source
                        ELSE 0.0
                    END
                ELSE 0.0
            END AS address_component,
            -- Collect matched rules
            ARRAY_REMOVE(ARRAY[
                (SELECT em.rule FROM email_matches em WHERE em.matched_person_id = sp.person_id),
                (SELECT pm.rule FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id)
            ], NULL) AS matched_rules,
            -- Household info
            hm.household_id,
            hm.household_id IS NOT NULL AS is_household_candidate,
            -- Enrichment tracking
            EXISTS (SELECT 1 FROM enriched_address_matches eam WHERE eam.matched_person_id = sp.person_id) AS used_enrichment,
            (SELECT eam.address_source FROM enriched_address_matches eam WHERE eam.matched_person_id = sp.person_id LIMIT 1) AS enrichment_source
        FROM trapper.sot_people sp
        LEFT JOIN trapper.household_members hm ON hm.person_id = sp.person_id
        WHERE sp.person_id IN (SELECT matched_person_id FROM all_candidates)
          AND sp.merged_into_person_id IS NULL
          AND sp.is_canonical = TRUE  -- Only match to canonical people
    )

    SELECT
        sc.person_id,
        sc.display_name,
        (sc.email_component + sc.phone_component + sc.name_component + sc.address_component)::NUMERIC AS total_score,
        sc.email_component::NUMERIC AS email_score,
        sc.phone_component::NUMERIC AS phone_score,
        sc.name_component::NUMERIC AS name_score,
        sc.address_component::NUMERIC AS address_score,
        sc.household_id,
        sc.is_household_candidate,
        sc.matched_rules,
        sc.used_enrichment,
        sc.enrichment_source
    FROM scored_candidates sc
    ORDER BY (sc.email_component + sc.phone_component + sc.name_component + sc.address_component) DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.data_engine_score_candidates IS
'Scores candidate people for identity matching with:
- Email blacklist check (placeholder emails score 0)
- Phone blacklist check (blocked phones excluded, soft-blacklist reduced)
- Name similarity scoring
- Address matching with cross-source enrichment
- Only returns canonical (non-merged, valid) people as candidates';

\echo 'data_engine_score_candidates() updated with email blacklist check.'

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_522 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. data_engine_resolve_identity() now:'
\echo '     - Rejects organization names (via is_organization_name)'
\echo '     - Rejects garbage/placeholder names (via is_garbage_name)'
\echo '     - Rejects records with data_fixing_patterns matches'
\echo '     - Rejects blacklisted-email-only records'
\echo ''
\echo '  2. data_engine_score_candidates() now:'
\echo '     - Checks email blacklist before scoring'
\echo '     - Blacklisted emails get score of 0'
\echo '     - Only matches to is_canonical = TRUE people'
\echo ''
\echo 'Next steps:'
\echo '  1. Run MIG_523 to add more bad patterns'
\echo '  2. Run MIG_524 to clean up historical bad data'
\echo ''
