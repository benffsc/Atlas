\echo '=== MIG_509: Data Engine Cross-Source Enrichment ==='
\echo 'Fixes duplicate creation when incoming records lack address but'
\echo 'person exists from another source with known address.'
\echo ''

-- ============================================================================
-- PROBLEM:
-- When ShelterLuv provides email+phone+name but NO address:
--   Score = 0.40 (email) + 0.25 (phone) + 0.25 (name) + 0.00 (no address) = 0.90
--   0.90 < 0.95 threshold → review_pending → creates duplicate
--
-- SOLUTION:
-- 1. Add exact identifier check BEFORE score-based decisions
-- 2. Add enriched_address_matches CTE to use candidate's existing addresses
-- ============================================================================

-- ============================================================================
-- PART 1: Schema additions for enrichment tracking
-- ============================================================================

ALTER TABLE trapper.data_engine_match_decisions
ADD COLUMN IF NOT EXISTS used_enrichment BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS enrichment_source TEXT;

COMMENT ON COLUMN trapper.data_engine_match_decisions.used_enrichment IS
'True if cross-source enrichment was used in scoring';

COMMENT ON COLUMN trapper.data_engine_match_decisions.enrichment_source IS
'Source system that provided enrichment data (e.g., address from airtable)';

\echo 'Added enrichment tracking columns'

-- ============================================================================
-- PART 2: Updated scoring function with cross-source enrichment
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
    matched_rules TEXT[],
    used_enrichment BOOLEAN,
    enrichment_source TEXT
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

    -- Direct address matches (when incoming address provided)
    direct_address_matches AS (
        SELECT DISTINCT
            ppr.person_id AS matched_person_id,
            1.0::NUMERIC as score,
            'direct_address_match'::TEXT as rule,
            FALSE as is_enriched,
            NULL::TEXT as enriched_from
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

    -- Collect all identifier-based candidates first
    all_identifier_candidates AS (
        SELECT DISTINCT matched_person_id FROM email_matches WHERE score > 0
        UNION
        SELECT DISTINCT matched_person_id FROM phone_matches WHERE score > 0
    ),

    -- NEW: Enriched address matches - Use candidate's existing addresses when incoming has none
    -- This allows cross-source matching: ShelterLuv email matches Airtable person who has address
    enriched_address_matches AS (
        SELECT DISTINCT
            aic.matched_person_id,
            0.8::NUMERIC as score,  -- Same as direct match (we're confident in the person's known address)
            'enriched_address_match'::TEXT as rule,
            TRUE as is_enriched,
            sp.data_source::TEXT as enriched_from
        FROM all_identifier_candidates aic
        JOIN trapper.sot_people sp ON sp.person_id = aic.matched_person_id
        JOIN trapper.person_place_relationships ppr
            ON ppr.person_id = aic.matched_person_id
        JOIN trapper.places pl
            ON pl.place_id = ppr.place_id
        WHERE p_address_norm IS NULL  -- Only when incoming has NO address
          AND pl.merged_into_place_id IS NULL
          AND ppr.confidence >= 0.7   -- Only high-confidence place links
          AND pl.normalized_address IS NOT NULL  -- Place actually has an address
    ),

    -- Combined address matches (direct or enriched)
    address_matches AS (
        SELECT matched_person_id, score, rule, is_enriched, enriched_from
        FROM direct_address_matches
        UNION ALL
        SELECT matched_person_id, score, rule, is_enriched, enriched_from
        FROM enriched_address_matches
        WHERE NOT EXISTS (
            SELECT 1 FROM direct_address_matches dam
            WHERE dam.matched_person_id = enriched_address_matches.matched_person_id
        )
    ),

    -- All candidates (now including enriched)
    all_candidates AS (
        SELECT DISTINCT matched_person_id FROM email_matches WHERE score > 0
        UNION
        SELECT DISTINCT matched_person_id FROM phone_matches WHERE score > 0
        UNION
        SELECT DISTINCT matched_person_id FROM address_matches
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
        ARRAY_REMOVE(ARRAY[em.rule, pm.rule, ns.rule, am.rule], NULL) as matched_rules,
        COALESCE(am.is_enriched, FALSE) as used_enrichment,
        am.enriched_from as enrichment_source
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
'Scores all potential person matches with cross-source enrichment. When incoming record lacks address but candidate has known addresses from other sources, those addresses contribute to scoring.';

\echo 'Updated data_engine_score_candidates with cross-source enrichment'

-- ============================================================================
-- PART 3: Updated resolve function with exact identifier check FIRST
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
    v_existing_by_email UUID;
    v_existing_by_phone UUID;
    v_used_enrichment BOOLEAN;
    v_enrichment_source TEXT;
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

    -- Find existing person by exact email (for fallback check)
    IF v_email_norm IS NOT NULL THEN
        SELECT pi.person_id INTO v_existing_by_email
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = v_email_norm
          AND sp.merged_into_person_id IS NULL
        LIMIT 1;
    END IF;

    -- Find existing person by exact phone
    IF v_phone_norm IS NOT NULL THEN
        SELECT pi.person_id INTO v_existing_by_phone
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
        WHERE pi.id_type = 'phone'
          AND pi.id_value_norm = v_phone_norm
          AND sp.merged_into_person_id IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM trapper.identity_phone_blacklist bl
              WHERE bl.phone_norm = v_phone_norm
          )
        LIMIT 1;
    END IF;

    -- Get candidates count
    SELECT COUNT(*) INTO v_candidates_count
    FROM trapper.data_engine_score_candidates(v_email_norm, v_phone_norm, v_display_name, v_address_norm);

    -- Get top candidate
    SELECT * INTO v_top_candidate
    FROM trapper.data_engine_score_candidates(v_email_norm, v_phone_norm, v_display_name, v_address_norm)
    ORDER BY total_score DESC
    LIMIT 1;

    -- Track enrichment usage
    v_used_enrichment := COALESCE(v_top_candidate.used_enrichment, FALSE);
    v_enrichment_source := v_top_candidate.enrichment_source;

    -- Build score breakdown
    IF v_top_candidate.person_id IS NOT NULL THEN
        v_score_breakdown := jsonb_build_object(
            'email_score', v_top_candidate.email_score,
            'phone_score', v_top_candidate.phone_score,
            'name_score', v_top_candidate.name_score,
            'address_score', v_top_candidate.address_score,
            'total_score', v_top_candidate.total_score,
            'used_enrichment', v_used_enrichment,
            'enrichment_source', v_enrichment_source
        );
        v_rules_applied := to_jsonb(v_top_candidate.matched_rules);
    END IF;

    -- =========================================================================
    -- NEW: Check if top_candidate matches exact identifier FIRST
    -- This prevents 0.90 scores from creating duplicates when email matches exactly
    -- =========================================================================
    IF v_top_candidate.person_id IS NOT NULL
       AND (v_existing_by_email = v_top_candidate.person_id
            OR v_existing_by_phone = v_top_candidate.person_id)
       AND v_top_candidate.total_score >= 0.50 THEN

        v_decision_type := 'auto_match';
        v_decision_reason := 'Exact identifier match to top candidate (score '
            || ROUND(v_top_candidate.total_score, 2)::TEXT || ', '
            || CASE
                WHEN v_existing_by_email = v_top_candidate.person_id THEN 'email'
                ELSE 'phone'
               END || ' verified)';

        v_duration_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT;

        INSERT INTO trapper.data_engine_match_decisions (
            staged_record_id, source_system, incoming_email, incoming_phone,
            incoming_name, incoming_address, candidates_evaluated,
            top_candidate_person_id, top_candidate_score, decision_type,
            decision_reason, resulting_person_id, score_breakdown, rules_applied,
            processing_job_id, processing_duration_ms, used_enrichment, enrichment_source
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, v_candidates_count,
            v_top_candidate.person_id, v_top_candidate.total_score, v_decision_type,
            v_decision_reason, trapper.get_canonical_person_id(v_top_candidate.person_id),
            v_score_breakdown, v_rules_applied, p_job_id, v_duration_ms,
            v_used_enrichment, v_enrichment_source
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT
            trapper.get_canonical_person_id(v_top_candidate.person_id),
            v_decision_type,
            v_top_candidate.total_score,
            v_top_candidate.household_id,
            v_decision_id;
        RETURN;
    END IF;

    -- =========================================================================
    -- Standard score-based decision logic
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
            processing_job_id, processing_duration_ms, used_enrichment, enrichment_source
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, v_candidates_count,
            v_top_candidate.person_id, v_top_candidate.total_score, v_decision_type,
            v_decision_reason, trapper.get_canonical_person_id(v_top_candidate.person_id),
            v_score_breakdown, v_rules_applied, p_job_id, v_duration_ms,
            v_used_enrichment, v_enrichment_source
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
            review_status, processing_duration_ms, used_enrichment, enrichment_source
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, v_candidates_count,
            v_top_candidate.person_id, v_top_candidate.total_score, v_decision_type,
            v_decision_reason, v_new_person_id, v_household_id,
            v_score_breakdown, v_rules_applied, p_job_id,
            CASE WHEN v_decision_type = 'review_pending' THEN 'pending' ELSE 'not_required' END,
            v_duration_ms, v_used_enrichment, v_enrichment_source
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
            processing_job_id, processing_duration_ms, used_enrichment, enrichment_source
        ) VALUES (
            p_staged_record_id, p_source_system, v_email_norm, v_phone_norm,
            v_display_name, v_address_norm, v_candidates_count,
            v_top_candidate.person_id, COALESCE(v_top_candidate.total_score, 0), v_decision_type,
            v_decision_reason, v_new_person_id, v_score_breakdown, v_rules_applied,
            p_job_id, v_duration_ms, v_used_enrichment, v_enrichment_source
        ) RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

        RETURN QUERY SELECT v_new_person_id, v_decision_type, COALESCE(v_top_candidate.total_score, 0)::NUMERIC, NULL::UUID, v_decision_id;
        RETURN;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_resolve_identity IS
'Main Data Engine entry point for identity resolution with cross-source enrichment. Exact identifier matches are checked BEFORE score thresholds to prevent duplicates when email/phone match exactly but address is missing.';

\echo 'Updated data_engine_resolve_identity with exact identifier check'

-- ============================================================================
-- PART 4: Diagnostic view for enrichment stats
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_data_engine_enrichment_stats AS
SELECT
    source_system,
    COUNT(*) as total_decisions,
    COUNT(*) FILTER (WHERE used_enrichment = TRUE) as enriched_matches,
    COUNT(*) FILTER (WHERE decision_type = 'auto_match') as auto_matches,
    COUNT(*) FILTER (WHERE decision_type = 'auto_match' AND used_enrichment = TRUE) as auto_enriched,
    COUNT(*) FILTER (WHERE decision_type = 'review_pending') as review_pending,
    COUNT(*) FILTER (WHERE decision_type = 'new_entity') as new_entities,
    ROUND(100.0 * COUNT(*) FILTER (WHERE used_enrichment = TRUE) / NULLIF(COUNT(*), 0), 1) as enrichment_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE decision_type = 'auto_match') / NULLIF(COUNT(*), 0), 1) as auto_match_pct
FROM trapper.data_engine_match_decisions
WHERE processed_at > NOW() - INTERVAL '7 days'
GROUP BY source_system
ORDER BY total_decisions DESC;

COMMENT ON VIEW trapper.v_data_engine_enrichment_stats IS
'Shows cross-source enrichment statistics by source system for the last 7 days.';

\echo 'Created v_data_engine_enrichment_stats view'

-- ============================================================================
-- PART 5: Update create_person_basic to handle shelterluv source
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
        WHEN 'shelterluv' THEN 'shelterluv'::trapper.data_source
        WHEN 'volunteerhub' THEN 'volunteerhub'::trapper.data_source
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
'Creates a new person with email/phone identifiers. Supports shelterluv and volunteerhub sources.';

\echo 'Updated create_person_basic with shelterluv/volunteerhub support'

\echo ''
\echo '=== MIG_509 Complete ==='
\echo ''
\echo 'Changes made:'
\echo '  1. Added used_enrichment, enrichment_source columns to match_decisions'
\echo '  2. Updated data_engine_score_candidates with cross-source address enrichment'
\echo '  3. Updated data_engine_resolve_identity with exact identifier check FIRST'
\echo '  4. Created v_data_engine_enrichment_stats view'
\echo '  5. Updated create_person_basic with shelterluv/volunteerhub support'
\echo ''
\echo 'Key behavior change:'
\echo '  - Records with exact email/phone match now auto_match even with score < 0.95'
\echo '  - Missing addresses are enriched from candidate existing addresses'
\echo ''
