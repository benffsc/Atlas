-- MIG_2829__phonetic_dedup_candidates.sql
-- FFS-181: Phonetic Dedup Candidates
--
-- Adds tier 6 (phonetic name match + shared place) to the dedup candidate view.
-- Surfaces near-duplicates like "Charletta Colon" / "Charlotta Colon" that share
-- a place but have no exact identifier match.
--
-- CRITICAL INVARIANT: Tier 6 = human review ONLY. NEVER auto-merge.
-- Respects CLAUDE.md Rule #5: "Identity By Identifier Only"
--
-- Depends on: MIG_2545 (compare_names), MIG_2039 (v_person_dedup_candidates)

--------------------------------------------------------------------------------
-- 1. Index for phonetic blocking on last name
--------------------------------------------------------------------------------

-- Extract last name token for dmetaphone blocking
-- Using expression index on the last word in display_name
CREATE INDEX IF NOT EXISTS idx_people_last_name_dmetaphone
ON sot.people (dmetaphone(
    CASE
        WHEN display_name LIKE '% %'
        THEN SPLIT_PART(display_name, ' ', array_length(string_to_array(display_name, ' '), 1))
        ELSE display_name
    END
))
WHERE merged_into_person_id IS NULL
  AND display_name IS NOT NULL;

--------------------------------------------------------------------------------
-- 2. compare_names_score: Single numeric from compare_names() output
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sot.compare_names_score(
    p_name1 TEXT,
    p_name2 TEXT
)
RETURNS NUMERIC AS $$
DECLARE
    v_result RECORD;
    v_score NUMERIC;
BEGIN
    IF p_name1 IS NULL OR p_name2 IS NULL THEN
        RETURN 0.0;
    END IF;

    SELECT * INTO v_result FROM sot.compare_names(p_name1, p_name2);

    -- Weighted combination:
    -- 40% trigram similarity (fuzzy string match)
    -- 25% jaro_winkler similarity (prefix-weighted)
    -- 20% phonetic match (sounds-alike)
    -- 15% first+last name component matches
    v_score := (
        v_result.trigram_similarity * 0.40 +
        v_result.jaro_winkler_similarity * 0.25 +
        CASE WHEN v_result.phonetic_match THEN 0.20 ELSE 0.0 END +
        CASE
            WHEN v_result.first_name_match AND v_result.last_name_match THEN 0.15
            WHEN v_result.first_name_match OR v_result.last_name_match THEN 0.075
            ELSE 0.0
        END
    );

    RETURN ROUND(v_score, 4);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION sot.compare_names_score IS
'Returns a single 0-1 numeric score from compare_names() output.
Weighted: 40% trigram, 25% jaro-winkler, 20% phonetic, 15% component matches.
Used by phonetic dedup candidate view for ranking.';

--------------------------------------------------------------------------------
-- 3. Updated v_person_dedup_candidates with tier 6 (phonetic + shared place)
--------------------------------------------------------------------------------
CREATE OR REPLACE VIEW sot.v_person_dedup_candidates AS
WITH
-- Existing: exact identifier sharing (tiers 1-3)
shared_identifiers AS (
    SELECT
        pi1.id_value_norm AS identifier,
        pi1.id_type,
        pi1.person_id AS person1_id,
        pi2.person_id AS person2_id,
        LEAST(pi1.person_id, pi2.person_id) AS canonical_person_id,
        GREATEST(pi1.person_id, pi2.person_id) AS duplicate_person_id
    FROM sot.person_identifiers pi1
    JOIN sot.person_identifiers pi2
        ON pi1.id_value_norm = pi2.id_value_norm
        AND pi1.id_type = pi2.id_type
        AND pi1.person_id < pi2.person_id
        AND pi1.confidence >= 0.5
        AND pi2.confidence >= 0.5
    WHERE NOT EXISTS (
        SELECT 1 FROM sot.soft_blacklist sb
        WHERE sb.identifier_norm = pi1.id_value_norm
          AND sb.identifier_type = pi1.id_type
    )
),
candidate_pairs AS (
    SELECT DISTINCT
        si.canonical_person_id,
        si.duplicate_person_id,
        MAX(CASE WHEN si.id_type = 'email' THEN si.identifier END) AS shared_email,
        MAX(CASE WHEN si.id_type = 'phone' THEN si.identifier END) AS shared_phone
    FROM shared_identifiers si
    GROUP BY si.canonical_person_id, si.duplicate_person_id
),
-- Tiers 1-3: exact identifier matches
identifier_candidates AS (
    SELECT
        cp.canonical_person_id,
        cp.duplicate_person_id,
        CASE
            WHEN cp.shared_email IS NOT NULL AND cp.shared_phone IS NOT NULL THEN 1
            WHEN cp.shared_email IS NOT NULL THEN 2
            WHEN cp.shared_phone IS NOT NULL THEN 3
            ELSE 5
        END AS match_tier,
        cp.shared_email,
        cp.shared_phone,
        COALESCE(p1.display_name, p1.first_name || ' ' || p1.last_name) AS canonical_name,
        COALESCE(p2.display_name, p2.first_name || ' ' || p2.last_name) AS duplicate_name,
        CASE
            WHEN LOWER(COALESCE(p1.display_name, p1.first_name || ' ' || p1.last_name)) =
                 LOWER(COALESCE(p2.display_name, p2.first_name || ' ' || p2.last_name))
            THEN 1.0
            ELSE 0.5
        END::numeric AS name_similarity,
        p1.created_at AS canonical_created_at,
        p2.created_at AS duplicate_created_at
    FROM candidate_pairs cp
    JOIN sot.people p1 ON p1.person_id = cp.canonical_person_id AND p1.merged_into_person_id IS NULL
    JOIN sot.people p2 ON p2.person_id = cp.duplicate_person_id AND p2.merged_into_person_id IS NULL
),
-- Tier 6: Phonetic name match + shared place (NEW in MIG_2829)
-- Blocking: dmetaphone on last name token
-- Filtering: first name dmetaphone OR similarity > 0.5
-- Requires: shared place via person_place join
phonetic_pairs AS (
    SELECT
        LEAST(p1.person_id, p2.person_id) AS canonical_person_id,
        GREATEST(p1.person_id, p2.person_id) AS duplicate_person_id,
        6 AS match_tier,
        NULL::TEXT AS shared_email,
        NULL::TEXT AS shared_phone,
        COALESCE(p1.display_name, p1.first_name || ' ' || p1.last_name) AS canonical_name,
        COALESCE(p2.display_name, p2.first_name || ' ' || p2.last_name) AS duplicate_name,
        sot.compare_names_score(
            COALESCE(p1.display_name, p1.first_name || ' ' || p1.last_name),
            COALESCE(p2.display_name, p2.first_name || ' ' || p2.last_name)
        ) AS name_similarity,
        CASE WHEN p1.created_at <= p2.created_at THEN p1.created_at ELSE p2.created_at END AS canonical_created_at,
        CASE WHEN p1.created_at <= p2.created_at THEN p2.created_at ELSE p1.created_at END AS duplicate_created_at
    FROM sot.people p1
    JOIN sot.people p2
        ON p1.person_id < p2.person_id
        AND p1.merged_into_person_id IS NULL
        AND p2.merged_into_person_id IS NULL
        AND p1.display_name IS NOT NULL
        AND p2.display_name IS NOT NULL
    WHERE
        -- Blocking: same last name dmetaphone
        dmetaphone(
            CASE
                WHEN p1.display_name LIKE '% %'
                THEN SPLIT_PART(p1.display_name, ' ', array_length(string_to_array(p1.display_name, ' '), 1))
                ELSE p1.display_name
            END
        ) = dmetaphone(
            CASE
                WHEN p2.display_name LIKE '% %'
                THEN SPLIT_PART(p2.display_name, ' ', array_length(string_to_array(p2.display_name, ' '), 1))
                ELSE p2.display_name
            END
        )
        -- First name gate: dmetaphone match OR trigram similarity > 0.5
        AND (
            dmetaphone(SPLIT_PART(LOWER(p1.display_name), ' ', 1)) =
            dmetaphone(SPLIT_PART(LOWER(p2.display_name), ' ', 1))
            OR
            similarity(SPLIT_PART(LOWER(p1.display_name), ' ', 1),
                       SPLIT_PART(LOWER(p2.display_name), ' ', 1)) > 0.5
        )
        -- Exclude exact name matches (already in tiers 1-5)
        AND LOWER(COALESCE(p1.display_name, '')) != LOWER(COALESCE(p2.display_name, ''))
        -- Require shared place
        AND EXISTS (
            SELECT 1
            FROM sot.person_place pp1
            JOIN sot.person_place pp2 ON pp1.place_id = pp2.place_id
            WHERE pp1.person_id = p1.person_id
              AND pp2.person_id = p2.person_id
        )
        -- Exclude pairs already in tiers 1-3 (shared identifier)
        AND NOT EXISTS (
            SELECT 1 FROM candidate_pairs cp
            WHERE cp.canonical_person_id = LEAST(p1.person_id, p2.person_id)
              AND cp.duplicate_person_id = GREATEST(p1.person_id, p2.person_id)
        )
),
-- Combine all tiers
all_tiers AS (
    SELECT * FROM identifier_candidates
    UNION ALL
    SELECT * FROM phonetic_pairs
)
SELECT at.*
FROM all_tiers at
-- Exclude already-processed pairs from match_decisions
WHERE NOT EXISTS (
    SELECT 1 FROM sot.match_decisions md
    WHERE md.resulting_person_id = at.canonical_person_id
      AND md.top_candidate_person_id = at.duplicate_person_id
      AND md.review_status = 'approved'
);

COMMENT ON VIEW sot.v_person_dedup_candidates IS
'Person dedup candidates across 6 tiers. MIG_2829 adds tier 6 (phonetic + shared place).
Tier 1: Email + Phone match (highest confidence)
Tier 2: Email match
Tier 3: Phone match
Tier 5: Other identifier match
Tier 6: Phonetic name match + shared place (review ONLY, NEVER auto-merge)
Each pair appears once at its best (lowest) tier.';

--------------------------------------------------------------------------------
-- 4. Update summary view to include tier 6
--------------------------------------------------------------------------------
CREATE OR REPLACE VIEW sot.v_person_dedup_summary AS
SELECT
    match_tier,
    CASE match_tier
        WHEN 1 THEN 'Email + Phone'
        WHEN 2 THEN 'Email Match'
        WHEN 3 THEN 'Phone Match'
        WHEN 4 THEN 'Name + Place'
        WHEN 5 THEN 'Name Only'
        WHEN 6 THEN 'Phonetic + Address'
    END AS tier_label,
    COUNT(*) AS pair_count
FROM sot.v_person_dedup_candidates
GROUP BY match_tier
ORDER BY match_tier;

COMMENT ON VIEW sot.v_person_dedup_summary IS
'Aggregate counts of person dedup candidates by tier. MIG_2829 adds tier 6.';
