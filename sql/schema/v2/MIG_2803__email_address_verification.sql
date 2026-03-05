-- MIG_2803__email_address_verification.sql
-- Fixes FFS-121: Email matching in data_engine lacks address verification
-- MIG_2548 added address verification for PHONE matches but not EMAIL matches.
-- Shared household emails (e.g., vlopez1313@gmail.com used by both Vicki Lopez
-- and Virginia Bautista) resolve to whichever person was created first.
--
-- Fix: When email matches and both parties have addresses, check address similarity.
-- If addresses differ significantly (similarity < 0.3), reduce email score from
-- 1.0 to 0.5, matching the soft-blacklist penalty pattern.

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
BEGIN
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
                ) THEN 0.5::NUMERIC  -- Soft blacklisted: half weight
                -- FFS-121: Address mismatch penalty for shared household emails
                -- If caller provided an address AND the candidate has a place
                -- AND the addresses are very different, reduce score
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
                ) THEN 0.5::NUMERIC  -- Address mismatch: half weight (same penalty as soft blacklist)
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
          AND pi.confidence >= 0.5  -- MIG_887: Exclude low-confidence identifiers
          AND EXISTS (
              SELECT 1 FROM sot.people sp
              WHERE sp.person_id = pi.person_id
              AND sp.merged_into_person_id IS NULL
          )
    ),

    -- Phone matches (with soft blacklist check) - unchanged from MIG_2007
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

    -- Calculate scores for each candidate
    -- Weights: Email 40%, Phone 25%, Name 25%, Address 10% (Fellegi-Sunter based)
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
                ELSE sot.name_similarity(p_display_name, sp.display_name) * 0.25
            END AS name_component,
            -- Address match: 10% weight
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
                (SELECT pm.rule FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id)
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
            'address', sc.address_component
        ) AS score_breakdown
    FROM scored_candidates sc
    WHERE (sc.email_component + sc.phone_component + sc.name_component + sc.address_component) > 0
    ORDER BY (sc.email_component + sc.phone_component + sc.name_component + sc.address_component) DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.data_engine_score_candidates IS
'V2: Scores all potential person matches using Fellegi-Sunter weighted multi-signal matching.
Ported from V1 MIG_315/MIG_888. Updated by MIG_2803 (FFS-121).
Weights: Email 40%, Phone 25%, Name 25%, Address 10%.
FFS-121: Email matches now check address similarity - if email matches but
addresses differ significantly (similarity < 0.3), email score is halved
(same penalty as soft blacklist). This prevents shared household emails
from always resolving to the first person created.';
