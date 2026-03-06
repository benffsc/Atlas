-- MIG_2828__fuzzy_phone_matching.sql
-- FFS-179: Fuzzy Phone Matching
--
-- Match phones where levenshtein distance = 1 on normalized 10-digit numbers,
-- gated by a compound condition requiring at least one corroborating signal
-- (email match, address similarity, or strong name match).
--
-- Example: Charletta Colon (7076568286) vs Charlotta Colon (7076568266)
-- Phones differ by 1 digit, names are phonetically similar → should surface.
--
-- Depends on: MIG_2827 (demotion-aware data_engine_score_candidates)
-- Reuses: sot.compare_names() from MIG_2545

--------------------------------------------------------------------------------
-- 1. fuzzy_phone_match: Find phones within levenshtein distance 1
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sot.fuzzy_phone_match(p_phone_norm TEXT)
RETURNS TABLE (
    person_id UUID,
    matched_phone TEXT,
    levenshtein_distance INTEGER
) AS $$
BEGIN
    -- Only match 10-digit normalized phones
    IF p_phone_norm IS NULL OR length(p_phone_norm) != 10 THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        pi.person_id,
        pi.id_value_norm AS matched_phone,
        levenshtein(p_phone_norm, pi.id_value_norm) AS levenshtein_distance
    FROM sot.person_identifiers pi
    JOIN sot.people sp ON sp.person_id = pi.person_id
    WHERE pi.id_type = 'phone'
      AND pi.confidence >= 0.5
      AND sp.merged_into_person_id IS NULL
      AND length(pi.id_value_norm) = 10
      -- Same area code (first 3 digits)
      AND left(pi.id_value_norm, 3) = left(p_phone_norm, 3)
      -- Levenshtein distance exactly 1
      AND levenshtein(p_phone_norm, pi.id_value_norm) = 1
      -- Exclude exact matches (already handled by phone_matches CTE)
      AND pi.id_value_norm != p_phone_norm;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.fuzzy_phone_match IS
'Finds people with phones within levenshtein distance 1 of the input phone.
Requires same area code (first 3 digits) and exactly 10-digit normalized phones.
Excludes exact matches (handled separately). Used by data_engine_score_candidates
for fuzzy phone matching with compound gate.';

--------------------------------------------------------------------------------
-- 2. Updated data_engine_score_candidates with fuzzy phone matching
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
    -- Pre-compute demotion factors (MIG_2827)
    v_email_demotion := sot.identifier_demotion_factor('email', p_email_norm);
    v_phone_demotion := sot.identifier_demotion_factor('phone', p_phone_norm);

    RETURN QUERY
    WITH
    -- Email matches (with soft blacklist check AND address verification - FFS-121)
    email_matches AS (
        SELECT DISTINCT
            pi.person_id AS matched_person_id,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM sot.soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_email_norm
                    AND sbl.identifier_type = 'email'
                ) THEN 0.5::NUMERIC
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

    -- Phone matches (exact, with soft blacklist check)
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

    -- Fuzzy phone matches (MIG_2828): levenshtein = 1 with compound gate
    fuzzy_phone_matches AS (
        SELECT
            fpm.person_id AS matched_person_id,
            fpm.matched_phone,
            -- Compound gate: fuzzy phone only scores if corroborated
            CASE
                -- Gate 1: Email match exists → strong corroboration
                WHEN p_email_norm IS NOT NULL AND p_email_norm != '' AND EXISTS (
                    SELECT 1 FROM sot.person_identifiers pi2
                    WHERE pi2.person_id = fpm.person_id
                    AND pi2.id_type = 'email'
                    AND pi2.id_value_norm = p_email_norm
                    AND pi2.confidence >= 0.5
                ) THEN 0.6::NUMERIC

                -- Gate 2: Address similarity > 0.5
                WHEN p_address_norm IS NOT NULL AND p_address_norm != '' AND EXISTS (
                    SELECT 1 FROM sot.person_place ppr
                    JOIN sot.places pl ON pl.place_id = ppr.place_id
                    WHERE ppr.person_id = fpm.person_id
                    AND pl.merged_into_place_id IS NULL
                    AND pl.formatted_address IS NOT NULL
                    AND similarity(LOWER(p_address_norm), LOWER(pl.formatted_address)) > 0.5
                ) THEN 0.6::NUMERIC

                -- Gate 3: Strong name match (jaro_winkler > 0.85 via compare_names)
                WHEN p_display_name IS NOT NULL AND p_display_name != '' AND EXISTS (
                    SELECT 1 FROM sot.people sp
                    WHERE sp.person_id = fpm.person_id
                    AND sp.display_name IS NOT NULL
                    AND (SELECT cn.jaro_winkler_similarity FROM sot.compare_names(p_display_name, sp.display_name) cn LIMIT 1) > 0.85
                ) THEN 0.5::NUMERIC

                -- No corroboration → REJECTED
                ELSE 0.0::NUMERIC
            END as score
        FROM sot.fuzzy_phone_match(p_phone_norm) fpm
        -- Exclude people already matched by exact phone
        WHERE NOT EXISTS (
            SELECT 1 FROM phone_matches pm WHERE pm.matched_person_id = fpm.person_id
        )
    ),

    -- All unique candidates from identifier matches
    all_candidates AS (
        SELECT matched_person_id FROM email_matches
        UNION
        SELECT matched_person_id FROM phone_matches
        UNION
        SELECT matched_person_id FROM fuzzy_phone_matches WHERE score > 0
    ),

    -- Calculate scores with demotion factors applied
    scored_candidates AS (
        SELECT
            sp.person_id,
            sp.display_name,
            -- Email score: 40% weight * demotion factor
            COALESCE((SELECT em.score FROM email_matches em WHERE em.matched_person_id = sp.person_id), 0.0)
                * 0.40 * v_email_demotion AS email_component,
            -- Phone score: 25% weight * demotion factor
            -- Use GREATEST of exact and fuzzy phone scores
            GREATEST(
                COALESCE((SELECT pm.score FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id), 0.0),
                COALESCE((SELECT fpm.score FROM fuzzy_phone_matches fpm WHERE fpm.matched_person_id = sp.person_id), 0.0)
            ) * 0.25 * v_phone_demotion AS phone_component,
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
            -- Track matched rules
            ARRAY_REMOVE(ARRAY[
                (SELECT em.rule FROM email_matches em WHERE em.matched_person_id = sp.person_id),
                (SELECT pm.rule FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id),
                CASE WHEN EXISTS (
                    SELECT 1 FROM fuzzy_phone_matches fpm
                    WHERE fpm.matched_person_id = sp.person_id AND fpm.score > 0
                ) THEN 'fuzzy_phone_lev1' ELSE NULL END,
                CASE WHEN v_email_demotion < 1.0 AND EXISTS (
                    SELECT 1 FROM email_matches em WHERE em.matched_person_id = sp.person_id
                ) THEN 'email_demoted' ELSE NULL END,
                CASE WHEN v_phone_demotion < 1.0 AND (
                    EXISTS (SELECT 1 FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id)
                    OR EXISTS (SELECT 1 FROM fuzzy_phone_matches fpm WHERE fpm.matched_person_id = sp.person_id AND fpm.score > 0)
                ) THEN 'phone_demoted' ELSE NULL END
            ], NULL) AS matched_rules,
            -- Fuzzy phone score for breakdown
            COALESCE((SELECT fpm.score FROM fuzzy_phone_matches fpm WHERE fpm.matched_person_id = sp.person_id), 0.0) AS fuzzy_phone_raw
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
            'phone_demotion_factor', v_phone_demotion,
            'fuzzy_phone_raw_score', sc.fuzzy_phone_raw
        ) AS score_breakdown
    FROM scored_candidates sc
    WHERE (sc.email_component + sc.phone_component + sc.name_component + sc.address_component) > 0
    ORDER BY (sc.email_component + sc.phone_component + sc.name_component + sc.address_component) DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.data_engine_score_candidates IS
'V4: Scores potential person matches using Fellegi-Sunter weighted multi-signal matching.
MIG_2828 (FFS-179): Added fuzzy phone matching — phones with levenshtein distance 1
(same area code) are matched when corroborated by email, address, or strong name match.
Fuzzy phone alone = score 0 (REJECTED). Uses GREATEST(exact, fuzzy) for phone component.
MIG_2827 (FFS-182): Dynamic identifier demotion for hub phones/emails.
Weights: Email 40%, Phone 25%, Name 25%, Address 10% (pre-demotion).';
