-- MIG_2827__dynamic_identifier_demotion.sql
-- FFS-182: Dynamic Identifier Demotion
--
-- Reduce match weight for phone/email identifiers shared across many distinct
-- unmerged people (Senzing pattern). Shared office phones, org emails, etc.
-- should contribute less to match confidence.
--
-- Depends on: MIG_2803 (current data_engine_score_candidates)

--------------------------------------------------------------------------------
-- 1. identifier_usage_count: How many distinct unmerged people use this identifier?
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sot.identifier_usage_count(
    p_id_type TEXT,
    p_id_value_norm TEXT
)
RETURNS INTEGER AS $$
    SELECT COUNT(DISTINCT pi.person_id)::INTEGER
    FROM sot.person_identifiers pi
    JOIN sot.people sp ON sp.person_id = pi.person_id
    WHERE pi.id_type = p_id_type
      AND pi.id_value_norm = p_id_value_norm
      AND pi.confidence >= 0.5
      AND sp.merged_into_person_id IS NULL;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION sot.identifier_usage_count IS
'Counts distinct unmerged people sharing an identifier. Used by demotion logic
to reduce weight of hub identifiers (shared phones, org emails).';

--------------------------------------------------------------------------------
-- 2. identifier_demotion_factor: Weight multiplier based on usage count
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sot.identifier_demotion_factor(
    p_id_type TEXT,
    p_id_value_norm TEXT
)
RETURNS NUMERIC AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Null/empty identifiers get full weight (no demotion)
    IF p_id_value_norm IS NULL OR p_id_value_norm = '' THEN
        RETURN 1.0;
    END IF;

    v_count := sot.identifier_usage_count(p_id_type, p_id_value_norm);

    RETURN CASE
        WHEN v_count <= 2 THEN 1.0    -- Normal: full weight
        WHEN v_count <= 5 THEN 0.6    -- Moderate sharing: reduced
        WHEN v_count <= 9 THEN 0.2    -- High sharing: heavily reduced
        ELSE 0.05                      -- Hub identifier: near-zero
    END;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.identifier_demotion_factor IS
'Returns weight multiplier (0.05-1.0) for an identifier based on how many
distinct unmerged people share it. Hub identifiers (10+ people) get near-zero
weight. Follows Senzing pattern for shared identifier demotion.';

--------------------------------------------------------------------------------
-- 3. Updated data_engine_score_candidates with demotion factors
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sot.data_engine_score_candidates(
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
    score_breakdown JSONB
) AS $$
DECLARE
    v_email_demotion NUMERIC;
    v_phone_demotion NUMERIC;
BEGIN
    -- Pre-compute demotion factors
    v_email_demotion := sot.identifier_demotion_factor('email', p_email_norm);
    v_phone_demotion := sot.identifier_demotion_factor('phone', p_phone_norm);

    RETURN QUERY
    WITH
    -- Email matches (with soft blacklist check AND address verification - FFS-121)
    email_matches AS (
        SELECT DISTINCT
            pi.person_id AS matched_person_id,
            CASE
                -- Check soft blacklist (MIG_888)
                WHEN EXISTS (
                    SELECT 1 FROM sot.soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_email_norm
                    AND sbl.identifier_type = 'email'
                ) THEN 0.5::NUMERIC
                -- FFS-121: Address mismatch penalty for shared household emails
                WHEN p_address_norm IS NOT NULL AND p_address_norm != '' AND EXISTS (
                    SELECT 1 FROM sot.person_place ppr
                    JOIN sot.places pl ON pl.place_id = ppr.place_id
                    WHERE ppr.person_id = pi.person_id
                    AND pl.merged_into_place_id IS NULL
                    AND pl.formatted_address IS NOT NULL
                ) AND NOT EXISTS (
                    SELECT 1 FROM sot.person_place ppr
                    JOIN sot.places pl ON pl.place_id = ppr.place_id
                    WHERE ppr.person_id = pi.person_id
                    AND pl.merged_into_place_id IS NULL
                    AND pl.formatted_address IS NOT NULL
                    AND similarity(LOWER(p_address_norm), LOWER(pl.formatted_address)) > 0.3
                ) THEN 0.5::NUMERIC
                ELSE 1.0::NUMERIC
            END as score,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM sot.soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_email_norm
                    AND sbl.identifier_type = 'email'
                ) THEN 'exact_email_soft_blacklist'::TEXT
                WHEN p_address_norm IS NOT NULL AND p_address_norm != '' AND EXISTS (
                    SELECT 1 FROM sot.person_place ppr
                    JOIN sot.places pl ON pl.place_id = ppr.place_id
                    WHERE ppr.person_id = pi.person_id
                    AND pl.merged_into_place_id IS NULL
                    AND pl.formatted_address IS NOT NULL
                ) AND NOT EXISTS (
                    SELECT 1 FROM sot.person_place ppr
                    JOIN sot.places pl ON pl.place_id = ppr.place_id
                    WHERE ppr.person_id = pi.person_id
                    AND pl.merged_into_place_id IS NULL
                    AND pl.formatted_address IS NOT NULL
                    AND similarity(LOWER(p_address_norm), LOWER(pl.formatted_address)) > 0.3
                ) THEN 'exact_email_address_mismatch'::TEXT
                ELSE 'exact_email'::TEXT
            END as rule
        FROM sot.person_identifiers pi
        WHERE p_email_norm IS NOT NULL
          AND p_email_norm != ''
          AND pi.id_type = 'email'
          AND pi.id_value_norm = p_email_norm
          AND pi.confidence >= 0.5
          AND EXISTS (
              SELECT 1 FROM sot.people sp
              WHERE sp.person_id = pi.person_id
              AND sp.merged_into_person_id IS NULL
          )
    ),

    -- Phone matches (with soft blacklist check)
    phone_matches AS (
        SELECT DISTINCT
            pi.person_id AS matched_person_id,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM sot.soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_phone_norm
                    AND sbl.identifier_type = 'phone'
                ) THEN 0.5::NUMERIC
                ELSE 1.0::NUMERIC
            END as score,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM sot.soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_phone_norm
                    AND sbl.identifier_type = 'phone'
                ) THEN 'exact_phone_soft_blacklist'::TEXT
                ELSE 'exact_phone'::TEXT
            END as rule
        FROM sot.person_identifiers pi
        WHERE p_phone_norm IS NOT NULL
          AND p_phone_norm != ''
          AND pi.id_type = 'phone'
          AND pi.id_value_norm = p_phone_norm
          AND pi.confidence >= 0.5
          AND EXISTS (
              SELECT 1 FROM sot.people sp
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

    -- Calculate scores with demotion factors applied
    -- Weights: Email 40%, Phone 25%, Name 25%, Address 10% (Fellegi-Sunter based)
    scored_candidates AS (
        SELECT
            sp.person_id,
            sp.display_name,
            -- Email score: 40% weight * demotion factor
            COALESCE((SELECT em.score FROM email_matches em WHERE em.matched_person_id = sp.person_id), 0.0)
                * 0.40 * v_email_demotion AS email_component,
            -- Phone score: 25% weight * demotion factor
            COALESCE((SELECT pm.score FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id), 0.0)
                * 0.25 * v_phone_demotion AS phone_component,
            -- Name similarity: 25% weight (unchanged)
            CASE
                WHEN p_display_name IS NULL OR p_display_name = '' THEN 0.0
                WHEN sp.display_name IS NULL OR sp.display_name = '' THEN 0.0
                ELSE sot.name_similarity(p_display_name, sp.display_name) * 0.25
            END AS name_component,
            -- Address match: 10% weight (unchanged)
            CASE
                WHEN p_address_norm IS NOT NULL AND p_address_norm != '' AND EXISTS (
                    SELECT 1 FROM sot.person_place ppr
                    JOIN sot.places pl ON pl.place_id = ppr.place_id
                    WHERE ppr.person_id = sp.person_id
                    AND LOWER(pl.formatted_address) LIKE '%' || p_address_norm || '%'
                    AND pl.merged_into_place_id IS NULL
                ) THEN 0.10
                ELSE 0.0
            END AS address_component,
            -- Track matched rules including demotion flags
            ARRAY_REMOVE(ARRAY[
                (SELECT em.rule FROM email_matches em WHERE em.matched_person_id = sp.person_id),
                (SELECT pm.rule FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id),
                CASE WHEN v_email_demotion < 1.0 AND EXISTS (
                    SELECT 1 FROM email_matches em WHERE em.matched_person_id = sp.person_id
                ) THEN 'email_demoted' ELSE NULL END,
                CASE WHEN v_phone_demotion < 1.0 AND EXISTS (
                    SELECT 1 FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id
                ) THEN 'phone_demoted' ELSE NULL END
            ], NULL) AS matched_rules
        FROM all_candidates ac
        JOIN sot.people sp ON sp.person_id = ac.matched_person_id
        WHERE sp.merged_into_person_id IS NULL
    )

    SELECT
        sc.person_id,
        sc.display_name,
        (sc.email_component + sc.phone_component + sc.name_component + sc.address_component)::NUMERIC AS total_score,
        sc.email_component AS email_score,
        sc.phone_component AS phone_score,
        sc.name_component AS name_score,
        sc.address_component AS address_score,
        NULL::UUID AS household_id,
        FALSE AS is_household_candidate,
        sc.matched_rules,
        jsonb_build_object(
            'email', sc.email_component,
            'phone', sc.phone_component,
            'name', sc.name_component,
            'address', sc.address_component,
            'email_demotion_factor', v_email_demotion,
            'phone_demotion_factor', v_phone_demotion
        ) AS score_breakdown
    FROM scored_candidates sc
    WHERE (sc.email_component + sc.phone_component + sc.name_component + sc.address_component) > 0
    ORDER BY (sc.email_component + sc.phone_component + sc.name_component + sc.address_component) DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.data_engine_score_candidates IS
'V3: Scores potential person matches using Fellegi-Sunter weighted multi-signal matching.
MIG_2827 (FFS-182): Added dynamic identifier demotion — identifiers shared by many
unmerged people get reduced weight (Senzing pattern). Hub phones/emails (10+ people)
get near-zero weight (0.05x). Score breakdown now includes demotion factors.
Weights: Email 40%, Phone 25%, Name 25%, Address 10% (pre-demotion).';
