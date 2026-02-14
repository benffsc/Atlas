\echo ''
\echo '=============================================='
\echo 'MIG_943: Remove Tier 5 (Name-Only) from Identity Review'
\echo '=============================================='
\echo ''
\echo 'Problem: Tier 5 produces 635 candidates that are false positives.'
\echo ''
\echo 'Root cause:'
\echo '  - Tier 5 = same name, NO shared identifier, NO shared address'
\echo '  - Example: "John" at 123 Main vs "John" at 456 Oak = different people'
\echo '  - Name-only matching without ANY context is unreliable'
\echo ''
\echo 'Fix:'
\echo '  - Remove Tier 5 from the view entirely'
\echo '  - Keep Tier 4 (same name + same address) which IS reliable'
\echo ''

-- ============================================================================
-- PART 1: Update v_person_dedup_candidates to exclude Tier 5
-- ============================================================================

\echo '1. Updating v_person_dedup_candidates to exclude Tier 5...'

CREATE OR REPLACE VIEW trapper.v_person_dedup_candidates AS
WITH
-- ── Tier 1: Same email via person_identifiers ──
email_pairs AS (
  SELECT DISTINCT ON (pi1.person_id, pi2.person_id)
    CASE WHEN p1.created_at < p2.created_at
              OR (p1.created_at = p2.created_at AND pi1.person_id < pi2.person_id)
         THEN pi1.person_id ELSE pi2.person_id END AS canonical_person_id,
    CASE WHEN p1.created_at < p2.created_at
              OR (p1.created_at = p2.created_at AND pi1.person_id < pi2.person_id)
         THEN pi2.person_id ELSE pi1.person_id END AS duplicate_person_id,
    1 AS match_tier,
    pi1.id_value_norm AS shared_email,
    NULL::text AS shared_phone
  FROM trapper.person_identifiers pi1
  JOIN trapper.person_identifiers pi2
    ON pi1.id_type = 'email' AND pi2.id_type = 'email'
    AND pi1.id_value_norm = pi2.id_value_norm
    AND pi1.person_id < pi2.person_id
  JOIN trapper.sot_people p1 ON p1.person_id = pi1.person_id
    AND p1.merged_into_person_id IS NULL
  JOIN trapper.sot_people p2 ON p2.person_id = pi2.person_id
    AND p2.merged_into_person_id IS NULL
  ORDER BY pi1.person_id, pi2.person_id
),

-- ── Tier 2/3: Same phone via person_identifiers ──
-- Tier 2 = similar name (safe), Tier 3 = different name (household)
phone_pairs AS (
  SELECT DISTINCT ON (pi1.person_id, pi2.person_id)
    CASE WHEN p1.created_at < p2.created_at
              OR (p1.created_at = p2.created_at AND pi1.person_id < pi2.person_id)
         THEN pi1.person_id ELSE pi2.person_id END AS canonical_person_id,
    CASE WHEN p1.created_at < p2.created_at
              OR (p1.created_at = p2.created_at AND pi1.person_id < pi2.person_id)
         THEN pi2.person_id ELSE pi1.person_id END AS duplicate_person_id,
    CASE
      WHEN trapper.name_similarity(p1.display_name, p2.display_name) >= 0.5 THEN 2
      ELSE 3
    END AS match_tier,
    NULL::text AS shared_email,
    pi1.id_value_norm AS shared_phone
  FROM trapper.person_identifiers pi1
  JOIN trapper.person_identifiers pi2
    ON pi1.id_type = 'phone' AND pi2.id_type = 'phone'
    AND pi1.id_value_norm = pi2.id_value_norm
    AND pi1.person_id < pi2.person_id
  JOIN trapper.sot_people p1 ON p1.person_id = pi1.person_id
    AND p1.merged_into_person_id IS NULL
  JOIN trapper.sot_people p2 ON p2.person_id = pi2.person_id
    AND p2.merged_into_person_id IS NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM trapper.identity_phone_blacklist bl
    WHERE bl.phone_norm = pi1.id_value_norm
  )
  ORDER BY pi1.person_id, pi2.person_id
),

-- ══════════════════════════════════════════════════════════════════════════
-- Tier 4 ONLY: Identical name + shared place
--
-- CHANGE FROM MIG_801: Tier 5 (name-only) is REMOVED
--
-- Rationale:
--   - Tier 5 = same name, no shared email/phone/address
--   - This catches "John" vs "John" at different locations = false positive
--   - Without ANY shared context, name matching is unreliable
--   - Tier 4 (same name + same place) remains because it HAS context
-- ══════════════════════════════════════════════════════════════════════════
name_groups AS (
  SELECT LOWER(TRIM(display_name)) AS norm_name
  FROM trapper.sot_people
  WHERE merged_into_person_id IS NULL
    AND display_name IS NOT NULL
    AND TRIM(display_name) != ''
    AND LENGTH(TRIM(display_name)) >= 4
    AND display_name !~ '(?i)^(unknown|n/?a|no name|test|deleted|none|na|tbd)$'
    AND display_name !~ '(?i)^feral\s*wild'
    AND display_name !~ '[0-9]{9,}'
    AND display_name !~ '(?i)med\s*hold'
  GROUP BY LOWER(TRIM(display_name))
  HAVING COUNT(*) BETWEEN 2 AND 10
),
name_pairs AS (
  SELECT
    CASE WHEN p1.created_at < p2.created_at
              OR (p1.created_at = p2.created_at AND p1.person_id < p2.person_id)
         THEN p1.person_id ELSE p2.person_id END AS canonical_person_id,
    CASE WHEN p1.created_at < p2.created_at
              OR (p1.created_at = p2.created_at AND p1.person_id < p2.person_id)
         THEN p2.person_id ELSE p1.person_id END AS duplicate_person_id,
    4 AS match_tier,  -- Always Tier 4 (we filter for shared place below)
    NULL::text AS shared_email,
    NULL::text AS shared_phone
  FROM trapper.sot_people p1
  JOIN trapper.sot_people p2
    ON LOWER(TRIM(p1.display_name)) = LOWER(TRIM(p2.display_name))
    AND p1.person_id < p2.person_id
    AND p1.merged_into_person_id IS NULL
    AND p2.merged_into_person_id IS NULL
  WHERE LOWER(TRIM(p1.display_name)) IN (SELECT norm_name FROM name_groups)
    -- ADDED: Only include if they share a place (Tier 4)
    -- This removes Tier 5 (name-only with no shared place)
    AND EXISTS (
      SELECT 1 FROM trapper.person_place_relationships r1
      JOIN trapper.person_place_relationships r2 ON r1.place_id = r2.place_id
      WHERE r1.person_id = p1.person_id AND r2.person_id = p2.person_id
    )
),

-- ── Combine all tiers, keep best (lowest) tier per pair ──
all_pairs AS (
  SELECT * FROM email_pairs
  UNION ALL
  SELECT * FROM phone_pairs
  UNION ALL
  SELECT * FROM name_pairs
),
ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY LEAST(canonical_person_id, duplicate_person_id),
                   GREATEST(canonical_person_id, duplicate_person_id)
      ORDER BY match_tier ASC
    ) AS rn
  FROM all_pairs
)

-- ── Final output with person details ──
SELECT
  r.canonical_person_id,
  r.duplicate_person_id,
  r.match_tier,
  r.shared_email,
  r.shared_phone,
  pc.display_name AS canonical_name,
  pd.display_name AS duplicate_name,
  trapper.name_similarity(pc.display_name, pd.display_name) AS name_similarity,
  pc.created_at AS canonical_created_at,
  pd.created_at AS duplicate_created_at
FROM ranked r
JOIN trapper.sot_people pc ON pc.person_id = r.canonical_person_id
JOIN trapper.sot_people pd ON pd.person_id = r.duplicate_person_id
WHERE r.rn = 1;

COMMENT ON VIEW trapper.v_person_dedup_candidates IS
'Comprehensive person duplicate detection across 4 confidence tiers:
  Tier 1: Same email (highest confidence)
  Tier 2: Same phone + similar name (>= 0.5 similarity)
  Tier 3: Same phone + different name (household candidates)
  Tier 4: Identical display_name + shared place (same address)

NOTE: Tier 5 (name-only, no shared context) was REMOVED by MIG_943
because it produced too many false positives. Name matching without
any identifier or address context is unreliable.

Each pair appears once at its best (lowest) tier.
Canonical = older record by created_at.';

-- ============================================================================
-- PART 2: Update summary view
-- ============================================================================

\echo ''
\echo '2. Updating v_person_dedup_summary...'

CREATE OR REPLACE VIEW trapper.v_person_dedup_summary AS
SELECT
  match_tier,
  CASE match_tier
    WHEN 1 THEN 'Same Email'
    WHEN 2 THEN 'Same Phone + Similar Name'
    WHEN 3 THEN 'Same Phone + Different Name'
    WHEN 4 THEN 'Same Name + Shared Place'
    -- Tier 5 removed
  END AS tier_label,
  COUNT(*) AS pair_count
FROM trapper.v_person_dedup_candidates
GROUP BY match_tier
ORDER BY match_tier;

COMMENT ON VIEW trapper.v_person_dedup_summary IS
'Aggregate counts of person duplicate candidates by confidence tier.
Used for the admin dashboard header. Tier 5 (name-only) removed by MIG_943.';

-- ============================================================================
-- PART 3: Verification
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Person dedup summary by tier (Tier 5 should be gone):'
SELECT * FROM trapper.v_person_dedup_summary;

\echo ''
\echo 'Sample Tier 4 candidates (same name + same place):'
SELECT
  match_tier,
  canonical_name,
  duplicate_name,
  ROUND(name_similarity::numeric, 2) AS name_sim
FROM trapper.v_person_dedup_candidates
WHERE match_tier = 4
LIMIT 5;

\echo ''
\echo '=============================================='
\echo 'MIG_943 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  - Tier 5 (name-only matches) REMOVED from view'
\echo '  - Only Tier 4 (same name + same place) remains for name-based matching'
\echo ''
\echo 'Expected reduction: 635 Tier 5 candidates -> 0'
\echo ''
