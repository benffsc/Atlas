-- ============================================================================
-- MIG_896: Data Engine Address+Name Candidate Finding
-- ============================================================================
-- Adds fallback candidate finding for returning historical persons who:
--   1. Have no identifiers in the system (6.5% of people = 880 records)
--   2. Have soft-blacklisted org emails that can't be used for matching
--   3. Call back years later with NEW contact info + same address + same name
--
-- Without this: System creates duplicate because new identifiers don't match
-- With this: System finds existing record via address+name and flags for review
--
-- Key design:
--   - FALLBACK ONLY: Only triggers when no email/phone match found
--   - ALWAYS REVIEW: Score 0.30-0.50 ensures review_pending, never auto-match
--   - FUZZY MATCHING: Uses trigram similarity for address variations
-- ============================================================================

\echo '=== MIG_896: Data Engine Address+Name Candidate Finding ==='
\echo ''
\echo 'Adding fallback candidate finding for returning historical persons.'
\echo 'Targets: 880 people (6.5%) without identifiers + 11,314 appointments with empty emails.'
\echo ''

-- ============================================================================
-- Phase 1: Update data_engine_score_candidates() with address+name fallback
-- ============================================================================

\echo 'Phase 1: Updating data_engine_score_candidates() with address+name fallback...'

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
    enrichment_source TEXT,
    score_breakdown JSONB,
    rules_applied JSONB
) AS $$
DECLARE
    v_email_blacklisted BOOLEAN := FALSE;
BEGIN
    -- Check if incoming email is blacklisted (hard blacklist)
    IF p_email_norm IS NOT NULL AND p_email_norm != '' THEN
        v_email_blacklisted := trapper.is_blacklisted_email(p_email_norm);
    END IF;

    RETURN QUERY
    WITH
    -- Email matches (with blacklist check + confidence filter)
    -- MIG_888: Now checks data_engine_soft_blacklist for emails (same as phones)
    email_matches AS (
        SELECT DISTINCT
            pi.person_id AS matched_person_id,
            CASE
                WHEN v_email_blacklisted THEN 0.0::NUMERIC
                -- MIG_888: Soft blacklist reduces email score to 0.5
                WHEN EXISTS (
                    SELECT 1 FROM trapper.data_engine_soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_email_norm
                    AND sbl.identifier_type = 'email'
                ) THEN 0.5::NUMERIC
                ELSE 1.0::NUMERIC
            END as score,
            CASE
                WHEN v_email_blacklisted THEN 'email_blacklisted'::TEXT
                -- MIG_888: Track soft blacklist match rule
                WHEN EXISTS (
                    SELECT 1 FROM trapper.data_engine_soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_email_norm
                    AND sbl.identifier_type = 'email'
                ) THEN 'exact_email_soft_blacklist'::TEXT
                ELSE 'exact_email'::TEXT
            END as rule
        FROM trapper.person_identifiers pi
        WHERE p_email_norm IS NOT NULL
          AND p_email_norm != ''
          AND NOT v_email_blacklisted  -- Don't match on blacklisted emails
          AND pi.id_type = 'email'
          AND pi.id_value_norm = p_email_norm
          AND pi.confidence >= 0.5  -- MIG_887: Exclude low-confidence identifiers
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

    -- =========================================================================
    -- MIG_896: Address+Name Candidate Finding (FALLBACK for historical persons)
    -- =========================================================================
    -- This finds candidates when NO email/phone match exists.
    -- Targets: 880 people without identifiers + soft-blacklisted identifiers
    -- ALWAYS routes to review_pending (score 0.30-0.50), never auto-match
    -- =========================================================================
    address_name_candidates AS (
        SELECT DISTINCT
            p.person_id AS matched_person_id,
            -- Score based on name similarity (0.30-0.50 range)
            -- Higher similarity = higher score, but always below auto_match threshold
            (0.30 + (similarity(p.display_name, p_display_name) * 0.20))::NUMERIC as score,
            'address_name_similarity'::TEXT as rule
        FROM trapper.sot_people p
        JOIN trapper.person_place_relationships ppr ON ppr.person_id = p.person_id
        JOIN trapper.places pl ON pl.place_id = ppr.place_id AND pl.merged_into_place_id IS NULL
        WHERE p.merged_into_person_id IS NULL
          AND p_address_norm IS NOT NULL
          AND p_address_norm != ''
          AND p_display_name IS NOT NULL
          AND p_display_name != ''
          -- Address must match (exact normalized, fuzzy formatted, or trigram > 0.7)
          AND (
              pl.normalized_address = p_address_norm
              OR pl.formatted_address ILIKE '%' || REPLACE(p_address_norm, ',', '%') || '%'
              OR similarity(COALESCE(pl.normalized_address, pl.formatted_address), p_address_norm) > 0.7
          )
          -- Name must be similar (> 0.6 trigram similarity)
          AND similarity(p.display_name, p_display_name) > 0.6
          -- FALLBACK ONLY: Only when NO identifier match exists for this person
          -- This prevents double-matching when email/phone also matches
          AND NOT EXISTS (
              SELECT 1 FROM email_matches em WHERE em.matched_person_id = p.person_id
          )
          AND NOT EXISTS (
              SELECT 1 FROM phone_matches pm WHERE pm.matched_person_id = p.person_id
          )
          -- Limit to people without usable identifiers (the 6.5% target)
          -- OR people whose only identifier is soft-blacklisted
          AND (
              -- No identifiers at all
              NOT EXISTS (
                  SELECT 1 FROM trapper.person_identifiers pi
                  WHERE pi.person_id = p.person_id
                  AND pi.confidence >= 0.5
              )
              -- OR only has soft-blacklisted identifiers
              OR NOT EXISTS (
                  SELECT 1 FROM trapper.person_identifiers pi
                  WHERE pi.person_id = p.person_id
                  AND pi.confidence >= 0.5
                  AND NOT EXISTS (
                      SELECT 1 FROM trapper.data_engine_soft_blacklist sbl
                      WHERE sbl.identifier_norm = pi.id_value_norm
                  )
              )
          )
    ),

    -- All unique candidates from identifier matches + address/name fallback
    all_candidates AS (
        SELECT matched_person_id FROM email_matches
        UNION
        SELECT matched_person_id FROM phone_matches
        UNION
        SELECT matched_person_id FROM address_name_candidates  -- MIG_896: Add fallback
    ),

    -- Enriched address matching (cross-source)
    enriched_address_matches AS (
        SELECT DISTINCT
            ppr.person_id AS matched_person_id,
            p.formatted_address AS enriched_address,
            sp.data_source::TEXT AS address_source
        FROM trapper.person_place_relationships ppr
        JOIN trapper.places p ON p.place_id = ppr.place_id
        JOIN trapper.sot_people sp ON sp.person_id = ppr.person_id
        WHERE ppr.person_id IN (SELECT matched_person_id FROM all_candidates)
          AND p.formatted_address IS NOT NULL
          AND p.merged_into_place_id IS NULL
          AND sp.merged_into_person_id IS NULL
    ),

    -- Calculate scores for each candidate
    scored_candidates AS (
        SELECT
            sp.person_id,
            sp.display_name,
            -- MIG_896: Check if this is an address_name candidate (use its score directly)
            CASE
                WHEN EXISTS (SELECT 1 FROM address_name_candidates anc WHERE anc.matched_person_id = sp.person_id)
                     AND NOT EXISTS (SELECT 1 FROM email_matches em WHERE em.matched_person_id = sp.person_id)
                     AND NOT EXISTS (SELECT 1 FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id)
                THEN (SELECT anc.score FROM address_name_candidates anc WHERE anc.matched_person_id = sp.person_id LIMIT 1)
                ELSE
                    -- Standard scoring for identifier-based matches
                    COALESCE((SELECT em.score FROM email_matches em WHERE em.matched_person_id = sp.person_id), 0.0) * 0.40 +
                    COALESCE((SELECT pm.score FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id), 0.0) * 0.25 +
                    CASE
                        WHEN p_display_name IS NULL OR p_display_name = '' THEN 0.0
                        WHEN sp.display_name IS NULL OR sp.display_name = '' THEN 0.0
                        ELSE trapper.name_similarity(p_display_name, sp.display_name) * 0.25
                    END +
                    CASE
                        WHEN p_address_norm IS NOT NULL AND p_address_norm != '' AND EXISTS (
                            SELECT 1 FROM trapper.person_place_relationships ppr
                            JOIN trapper.places pl ON pl.place_id = ppr.place_id
                            WHERE ppr.person_id = sp.person_id
                            AND pl.normalized_address = p_address_norm
                            AND pl.merged_into_place_id IS NULL
                        ) THEN 0.10
                        WHEN p_address_norm IS NOT NULL AND p_address_norm != '' AND EXISTS (
                            SELECT 1 FROM enriched_address_matches eam
                            WHERE eam.matched_person_id = sp.person_id
                            AND UPPER(eam.enriched_address) = p_address_norm
                        ) THEN 0.08
                        ELSE 0.0
                    END
            END AS total_score_calc,
            -- Email score: 40% weight (for display)
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
                    JOIN trapper.places pl ON pl.place_id = ppr.place_id
                    WHERE ppr.person_id = sp.person_id
                    AND pl.normalized_address = p_address_norm
                    AND pl.merged_into_place_id IS NULL
                ) THEN 0.10
                -- Cross-source enriched address match
                WHEN p_address_norm IS NOT NULL AND p_address_norm != '' AND EXISTS (
                    SELECT 1 FROM enriched_address_matches eam
                    WHERE eam.matched_person_id = sp.person_id
                    AND UPPER(eam.enriched_address) = p_address_norm
                ) THEN 0.08
                ELSE 0.0
            END AS address_component,
            -- Household detection
            hm.household_id,
            CASE
                WHEN hm.household_id IS NOT NULL THEN TRUE
                ELSE FALSE
            END AS is_household_candidate,
            -- Track matched rules (MIG_896: include address_name_similarity)
            ARRAY_REMOVE(ARRAY[
                (SELECT em.rule FROM email_matches em WHERE em.matched_person_id = sp.person_id),
                (SELECT pm.rule FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id),
                (SELECT anc.rule FROM address_name_candidates anc WHERE anc.matched_person_id = sp.person_id),
                CASE WHEN EXISTS (
                    SELECT 1 FROM enriched_address_matches eam
                    WHERE eam.matched_person_id = sp.person_id
                ) THEN 'enriched_address' ELSE NULL END
            ], NULL) AS matched_rules,
            -- Check if enrichment was used
            EXISTS (
                SELECT 1 FROM enriched_address_matches eam
                WHERE eam.matched_person_id = sp.person_id
            ) AS used_enrichment,
            (SELECT eam.address_source FROM enriched_address_matches eam
             WHERE eam.matched_person_id = sp.person_id LIMIT 1) AS enrichment_source
        FROM all_candidates ac
        JOIN trapper.sot_people sp ON sp.person_id = ac.matched_person_id
        LEFT JOIN trapper.household_members hm ON hm.person_id = sp.person_id
        WHERE sp.merged_into_person_id IS NULL
    )

    SELECT
        sc.person_id,
        sc.display_name,
        sc.total_score_calc::NUMERIC AS total_score,
        sc.email_component AS email_score,
        sc.phone_component AS phone_score,
        sc.name_component AS name_score,
        sc.address_component AS address_score,
        sc.household_id,
        sc.is_household_candidate,
        sc.matched_rules,
        sc.used_enrichment,
        sc.enrichment_source,
        jsonb_build_object(
            'email', sc.email_component,
            'phone', sc.phone_component,
            'name', sc.name_component,
            'address', sc.address_component,
            'address_name_fallback', CASE WHEN 'address_name_similarity' = ANY(sc.matched_rules) THEN true ELSE false END
        ) AS score_breakdown,
        '[]'::JSONB AS rules_applied
    FROM scored_candidates sc
    WHERE sc.total_score_calc > 0
    ORDER BY sc.total_score_calc DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.data_engine_score_candidates(TEXT, TEXT, TEXT, TEXT) IS
'MIG_896: Added address+name fallback candidate finding for returning historical persons.
Targets: 880 people (6.5%) without identifiers + 11,314 appointments with empty emails.
When NO email/phone match exists, finds candidates via address+name similarity.
Score range 0.30-0.50 ensures review_pending, NEVER auto-match on address+name alone.
MIG_888: Email soft blacklist check. MIG_887: pi.confidence >= 0.5 filter.
Weights: email 40%, phone 25%, name 25%, address 10%.';

-- ============================================================================
-- Phase 2: Update data_engine_resolve_identity() to handle address_name matches
-- ============================================================================

\echo ''
\echo 'Phase 2: Ensuring data_engine_resolve_identity() routes address_name matches to review...'

-- The existing resolve_identity function already routes scores 0.50-0.94 to review_pending
-- and scores < 0.50 to new_entity. Since address_name_candidates score 0.30-0.50,
-- they will be routed to new_entity by default.
--
-- We need to update the logic to FORCE review_pending when address_name_similarity is found,
-- regardless of score, since this is a returning historical person scenario.

-- First, check if the function exists and what its current logic is
-- Then update it to handle address_name_similarity matches specially

CREATE OR REPLACE FUNCTION trapper.data_engine_resolve_identity(
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
    created_place_id UUID
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
    v_place_id UUID;
    v_has_address_name_match BOOLEAN := FALSE;
BEGIN
    -- Normalize inputs
    v_email_norm := LOWER(TRIM(COALESCE(p_email, '')));
    v_phone_norm := trapper.norm_phone_us(COALESCE(p_phone, ''));
    v_display_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));
    v_address_norm := UPPER(TRIM(COALESCE(p_address, '')));

    -- Validate: need at least email, phone, or address+name
    IF (v_email_norm = '' OR v_email_norm IS NULL)
       AND (v_phone_norm = '' OR v_phone_norm IS NULL)
       AND (v_address_norm = '' OR v_display_name = '') THEN
        RETURN QUERY SELECT
            'rejected'::TEXT,
            NULL::UUID,
            NULL::TEXT,
            0.0::NUMERIC,
            'No identifiers provided (need email, phone, or address+name)'::TEXT,
            '{}'::JSONB,
            NULL::UUID;
        RETURN;
    END IF;

    -- Check for internal/test accounts
    IF v_email_norm LIKE '%@forgottenfelines.com'
       OR v_email_norm LIKE '%@test.%'
       OR v_email_norm LIKE 'test@%' THEN
        RETURN QUERY SELECT
            'rejected'::TEXT,
            NULL::UUID,
            NULL::TEXT,
            0.0::NUMERIC,
            'Internal or test account'::TEXT,
            '{}'::JSONB,
            NULL::UUID;
        RETURN;
    END IF;

    -- Find or create place if address provided
    IF v_address_norm != '' THEN
        SELECT trapper.find_or_create_place_deduped(p_address, NULL, NULL, NULL, p_source_system)
        INTO v_place_id;
    END IF;

    -- Get best candidate from scoring function
    SELECT * INTO v_candidate
    FROM trapper.data_engine_score_candidates(
        NULLIF(v_email_norm, ''),
        NULLIF(v_phone_norm, ''),
        NULLIF(v_display_name, ''),
        NULLIF(v_address_norm, '')
    )
    LIMIT 1;

    -- MIG_896: Check if this is an address_name_similarity match
    IF v_candidate.person_id IS NOT NULL THEN
        v_has_address_name_match := 'address_name_similarity' = ANY(v_candidate.matched_rules);
    END IF;

    -- Decision logic
    IF v_candidate.person_id IS NULL THEN
        -- No match found - create new person
        v_decision_type := 'new_entity';
        v_reason := 'No matching person found';
        v_match_details := '{}'::JSONB;

        -- Create new person
        SELECT trapper.find_or_create_person(
            NULLIF(v_email_norm, ''),
            NULLIF(v_phone_norm, ''),
            p_first_name,
            p_last_name,
            p_address,
            p_source_system
        ) INTO v_person_id;

    ELSIF v_has_address_name_match THEN
        -- MIG_896: Address+name match found - ALWAYS route to review
        -- This is a returning historical person scenario
        v_decision_type := 'review_pending';
        v_reason := 'Matched by address and name similarity - please verify identity (returning historical person)';
        v_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'score_breakdown', v_candidate.score_breakdown,
            'matched_rules', v_candidate.matched_rules,
            'address_name_fallback', true
        );

        -- Log to match decisions
        INSERT INTO trapper.data_engine_match_decisions (
            source_system, input_email, input_phone, input_name, input_address,
            decision_type, matched_person_id, confidence_score, match_rules, reason
        ) VALUES (
            p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm,
            'review_pending', v_candidate.person_id, v_candidate.total_score,
            v_candidate.matched_rules, v_reason
        );

    ELSIF v_candidate.total_score >= 0.95 THEN
        -- High confidence - auto match
        v_decision_type := 'auto_match';
        v_reason := 'High confidence match';
        v_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'score_breakdown', v_candidate.score_breakdown,
            'matched_rules', v_candidate.matched_rules
        );

        -- Add new identifiers to existing person
        IF v_email_norm != '' AND NOT EXISTS (
            SELECT 1 FROM trapper.person_identifiers pi
            WHERE pi.person_id = v_candidate.person_id
            AND pi.id_type = 'email' AND pi.id_value_norm = v_email_norm
        ) THEN
            INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_candidate.person_id, 'email', p_email, v_email_norm, 0.9, p_source_system)
            ON CONFLICT DO NOTHING;
        END IF;

        IF v_phone_norm != '' AND NOT EXISTS (
            SELECT 1 FROM trapper.person_identifiers pi
            WHERE pi.person_id = v_candidate.person_id
            AND pi.id_type = 'phone' AND pi.id_value_norm = v_phone_norm
        ) THEN
            INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_candidate.person_id, 'phone', p_phone, v_phone_norm, 0.9, p_source_system)
            ON CONFLICT DO NOTHING;
        END IF;

        -- Link to place if not already linked
        IF v_place_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM trapper.person_place_relationships ppr
            WHERE ppr.person_id = v_candidate.person_id AND ppr.place_id = v_place_id
        ) THEN
            INSERT INTO trapper.person_place_relationships (person_id, place_id, role, confidence, source_system, source_table)
            VALUES (v_candidate.person_id, v_place_id, 'resident', 0.8, p_source_system, 'data_engine')
            ON CONFLICT DO NOTHING;
        END IF;

    ELSIF v_candidate.total_score >= 0.50 THEN
        -- Medium confidence - needs review
        v_decision_type := 'review_pending';
        v_reason := 'Medium confidence match - needs verification';
        v_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'score_breakdown', v_candidate.score_breakdown,
            'matched_rules', v_candidate.matched_rules
        );

        -- Log to match decisions
        INSERT INTO trapper.data_engine_match_decisions (
            source_system, input_email, input_phone, input_name, input_address,
            decision_type, matched_person_id, confidence_score, match_rules, reason
        ) VALUES (
            p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm,
            'review_pending', v_candidate.person_id, v_candidate.total_score,
            v_candidate.matched_rules, v_reason
        );

    ELSIF v_candidate.is_household_candidate THEN
        -- Household member detection
        v_decision_type := 'household_member';
        v_reason := 'Possible household member at same address';

        -- Create new person and add to household
        SELECT trapper.find_or_create_person(
            NULLIF(v_email_norm, ''),
            NULLIF(v_phone_norm, ''),
            p_first_name,
            p_last_name,
            p_address,
            p_source_system
        ) INTO v_person_id;

        -- Add to household if one exists
        IF v_candidate.household_id IS NOT NULL THEN
            INSERT INTO trapper.household_members (household_id, person_id, role)
            VALUES (v_candidate.household_id, v_person_id, 'member')
            ON CONFLICT DO NOTHING;
        END IF;

        v_match_details := jsonb_build_object(
            'related_person_id', v_candidate.person_id,
            'household_id', v_candidate.household_id,
            'score', v_candidate.total_score
        );

    ELSE
        -- Low confidence - create new
        v_decision_type := 'new_entity';
        v_reason := 'Low confidence match - creating new person';
        v_match_details := jsonb_build_object(
            'nearest_match', v_candidate.person_id,
            'score', v_candidate.total_score
        );

        SELECT trapper.find_or_create_person(
            NULLIF(v_email_norm, ''),
            NULLIF(v_phone_norm, ''),
            p_first_name,
            p_last_name,
            p_address,
            p_source_system
        ) INTO v_person_id;
    END IF;

    RETURN QUERY SELECT
        v_decision_type,
        v_person_id,
        v_display_name,
        COALESCE(v_candidate.total_score, 0.0)::NUMERIC,
        v_reason,
        v_match_details,
        v_place_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_resolve_identity(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
'MIG_896: Added special handling for address_name_similarity matches.
When address+name fallback finds a candidate (returning historical person),
ALWAYS route to review_pending regardless of score.
This prevents creating duplicates when historical persons call back with new contact info.';

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_896 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  1. data_engine_score_candidates(): Added address_name_candidates CTE'
\echo '     - Finds candidates by address+name when no email/phone match'
\echo '     - Score 0.30-0.50 (always below auto_match threshold)'
\echo '     - Only triggers for people without usable identifiers'
\echo ''
\echo '  2. data_engine_resolve_identity(): Special handling for address_name matches'
\echo '     - ALWAYS routes to review_pending (never auto-match)'
\echo '     - Logs with reason "returning historical person"'
\echo ''
\echo 'Targets:'
\echo '  - 880 people (6.5%) without identifiers in person_identifiers'
\echo '  - 11,314 appointments (23.7%) with empty email strings'
\echo '  - People with only soft-blacklisted org emails'
\echo ''
\echo 'Test with:'
\echo '  SELECT * FROM trapper.data_engine_resolve_identity('
\echo '      ''new.email@example.com'', ''7075551234'', ''Jeanie'', ''Garcia'','
\echo '      ''14485 Valley Ford Rd, Valley Ford, CA 94972'', ''web_intake'''
\echo '  );'
\echo ''
