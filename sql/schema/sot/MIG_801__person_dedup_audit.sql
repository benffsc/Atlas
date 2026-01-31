\echo ''
\echo '=============================================='
\echo 'MIG_801: Comprehensive Person Duplicate Audit'
\echo '=============================================='
\echo ''
\echo 'Creates tiered duplicate detection views + safety guard function.'
\echo 'Tiers: 1=email, 2=phone+name, 3=phone only, 4=name+place, 5=name only'

-- ============================================================================
-- PART 1: Supporting indexes
-- ============================================================================

\echo '1. Creating supporting indexes...'

-- Index for efficient name-based self-join (tiers 4-5)
CREATE INDEX IF NOT EXISTS idx_sot_people_display_name_lower
  ON trapper.sot_people (LOWER(TRIM(display_name)))
  WHERE merged_into_person_id IS NULL
    AND display_name IS NOT NULL
    AND TRIM(display_name) != '';

-- Ensure person_identifiers has efficient lookup indexes
CREATE INDEX IF NOT EXISTS idx_person_identifiers_email_norm
  ON trapper.person_identifiers (id_value_norm)
  WHERE id_type = 'email';

CREATE INDEX IF NOT EXISTS idx_person_identifiers_phone_norm
  ON trapper.person_identifiers (id_value_norm)
  WHERE id_type = 'phone';

-- ============================================================================
-- PART 2: v_person_dedup_candidates — comprehensive pair detection
-- ============================================================================

\echo '2. Creating v_person_dedup_candidates view...'

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

-- ── Tier 4/5: Identical normalized display_name ──
-- Tier 4 = shared place, Tier 5 = name only
-- Guardrails: min 4 chars, exclude garbage patterns, max 10 people per name
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
    CASE
      WHEN EXISTS (
        SELECT 1 FROM trapper.person_place_relationships r1
        JOIN trapper.person_place_relationships r2 ON r1.place_id = r2.place_id
        WHERE r1.person_id = p1.person_id AND r2.person_id = p2.person_id
      ) THEN 4
      ELSE 5
    END AS match_tier,
    NULL::text AS shared_email,
    NULL::text AS shared_phone
  FROM trapper.sot_people p1
  JOIN trapper.sot_people p2
    ON LOWER(TRIM(p1.display_name)) = LOWER(TRIM(p2.display_name))
    AND p1.person_id < p2.person_id
    AND p1.merged_into_person_id IS NULL
    AND p2.merged_into_person_id IS NULL
  WHERE LOWER(TRIM(p1.display_name)) IN (SELECT norm_name FROM name_groups)
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
'Comprehensive person duplicate detection across 5 confidence tiers:
  Tier 1: Same email (highest confidence)
  Tier 2: Same phone + similar name (>= 0.5 similarity)
  Tier 3: Same phone + different name (household candidates)
  Tier 4: Identical display_name + shared place
  Tier 5: Identical display_name only (lowest confidence)
Each pair appears once at its best (lowest) tier.
Canonical = older record by created_at.';

-- ============================================================================
-- PART 3: v_person_dedup_summary — dashboard counts
-- ============================================================================

\echo '3. Creating v_person_dedup_summary view...'

CREATE OR REPLACE VIEW trapper.v_person_dedup_summary AS
SELECT
  match_tier,
  CASE match_tier
    WHEN 1 THEN 'Same Email'
    WHEN 2 THEN 'Same Phone + Similar Name'
    WHEN 3 THEN 'Same Phone + Different Name'
    WHEN 4 THEN 'Same Name + Shared Place'
    WHEN 5 THEN 'Same Name Only'
  END AS tier_label,
  COUNT(*) AS pair_count
FROM trapper.v_person_dedup_candidates
GROUP BY match_tier
ORDER BY match_tier;

COMMENT ON VIEW trapper.v_person_dedup_summary IS
'Aggregate counts of person duplicate candidates by confidence tier.
Used for the admin dashboard header.';

-- ============================================================================
-- PART 4: person_safe_to_merge() — safety guard function
-- ============================================================================

\echo '4. Creating person_safe_to_merge function...'

CREATE OR REPLACE FUNCTION trapper.person_safe_to_merge(
  p_person_a UUID,
  p_person_b UUID
) RETURNS TEXT AS $$
DECLARE
  v_a RECORD;
  v_b RECORD;
  v_a_is_staff BOOLEAN;
  v_b_is_staff BOOLEAN;
BEGIN
  -- Check both exist and aren't merged
  SELECT person_id, display_name, merged_into_person_id
  INTO v_a FROM trapper.sot_people WHERE person_id = p_person_a;
  IF NOT FOUND THEN RETURN 'person_a_not_found'; END IF;
  IF v_a.merged_into_person_id IS NOT NULL THEN RETURN 'person_a_already_merged'; END IF;

  SELECT person_id, display_name, merged_into_person_id
  INTO v_b FROM trapper.sot_people WHERE person_id = p_person_b;
  IF NOT FOUND THEN RETURN 'person_b_not_found'; END IF;
  IF v_b.merged_into_person_id IS NOT NULL THEN RETURN 'person_b_already_merged'; END IF;

  -- Check if both are staff/trappers (higher risk — always require review)
  v_a_is_staff := EXISTS (
    SELECT 1 FROM trapper.person_roles
    WHERE person_id = p_person_a
      AND role IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper')
  );
  v_b_is_staff := EXISTS (
    SELECT 1 FROM trapper.person_roles
    WHERE person_id = p_person_b
      AND role IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper')
  );

  IF v_a_is_staff AND v_b_is_staff THEN
    RETURN 'both_are_staff';
  END IF;

  -- Check if they share an email (tier 1 — safe to merge)
  IF EXISTS (
    SELECT 1
    FROM trapper.person_identifiers pi1
    JOIN trapper.person_identifiers pi2
      ON pi1.id_value_norm = pi2.id_value_norm
      AND pi1.id_type = 'email' AND pi2.id_type = 'email'
    WHERE pi1.person_id = p_person_a AND pi2.person_id = p_person_b
  ) THEN
    RETURN 'safe';
  END IF;

  -- Check if they share a phone + similar name (tier 2 — safe to merge)
  IF EXISTS (
    SELECT 1
    FROM trapper.person_identifiers pi1
    JOIN trapper.person_identifiers pi2
      ON pi1.id_value_norm = pi2.id_value_norm
      AND pi1.id_type = 'phone' AND pi2.id_type = 'phone'
    WHERE pi1.person_id = p_person_a AND pi2.person_id = p_person_b
  ) AND trapper.name_similarity(v_a.display_name, v_b.display_name) >= 0.5 THEN
    RETURN 'safe';
  END IF;

  -- Everything else needs manual review
  RETURN 'review';
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.person_safe_to_merge IS
'Safety guard for person merges. Returns:
  - ''safe'' for tier 1 (email match) or tier 2 (phone + similar name)
  - ''review'' for tier 3-5 (needs human judgment)
  - ''both_are_staff'' if both have staff/trapper roles
  - ''person_X_not_found'' / ''person_X_already_merged'' for invalid inputs';

-- ============================================================================
-- PART 5: Add views to Tippy catalog
-- ============================================================================

\echo '5. Adding views to Tippy catalog...'

INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
VALUES
  ('v_person_dedup_candidates', 'quality',
   'Comprehensive person duplicate candidates across 5 confidence tiers (email, phone+name, phone only, name+place, name only). Shows canonical vs duplicate with match details.',
   ARRAY['canonical_person_id', 'duplicate_person_id', 'match_tier', 'name_similarity'],
   ARRAY['match_tier'],
   ARRAY['How many duplicate people are there?', 'Which people share emails?', 'Are there people with the same name?']),
  ('v_person_dedup_summary', 'quality',
   'Aggregate counts of person duplicate candidates by confidence tier. Quick overview for the admin dashboard.',
   ARRAY['match_tier', 'tier_label', 'pair_count'],
   ARRAY['match_tier'],
   ARRAY['How many person duplicates by tier?', 'What is the person duplicate breakdown?'])
ON CONFLICT (view_name) DO UPDATE SET
  description = EXCLUDED.description,
  key_columns = EXCLUDED.key_columns,
  filter_columns = EXCLUDED.filter_columns,
  example_questions = EXCLUDED.example_questions,
  updated_at = NOW();

-- ============================================================================
-- PART 6: Verification
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Person dedup summary by tier:'
SELECT * FROM trapper.v_person_dedup_summary;

\echo ''
\echo 'Sample candidates (first 5):'
SELECT
  match_tier,
  canonical_name,
  duplicate_name,
  ROUND(name_similarity::numeric, 2) AS name_sim,
  shared_email,
  shared_phone
FROM trapper.v_person_dedup_candidates
ORDER BY match_tier, name_similarity DESC
LIMIT 5;

\echo ''
\echo 'Safety function test (should return safe/review/not_found):'
SELECT trapper.person_safe_to_merge(
  (SELECT person_id FROM trapper.sot_people WHERE merged_into_person_id IS NULL LIMIT 1),
  (SELECT person_id FROM trapper.sot_people WHERE merged_into_person_id IS NULL OFFSET 1 LIMIT 1)
) AS safety_check;

\echo ''
\echo '=============================================='
\echo 'MIG_801 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - v_person_dedup_candidates: 5-tier duplicate detection'
\echo '  - v_person_dedup_summary: Tier counts for dashboard'
\echo '  - person_safe_to_merge(): Safety guard function'
\echo '  - Indexes for efficient name/identifier matching'
\echo ''
\echo 'Next: Run MIG_802 for safe batch auto-merges'
