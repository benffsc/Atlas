-- MIG_2835: Complete Cat Dedup System (FFS-186)
-- Date: 2026-03-05
--
-- Problem: ops.run_cat_dedup_scan() references 3 sub-views that were never created:
--   - ops.v_cat_dedup_duplicate_ids
--   - ops.v_cat_dedup_chip_typos
--   - ops.v_cat_dedup_same_owner
-- Also missing: cat_safe_to_merge() safety gate, phonetic name matching tier.
--
-- This migration:
-- 1. Creates the 3 missing sub-views
-- 2. Creates sot.cat_safe_to_merge() safety gate
-- 3. Adds phonetic cat name matching tier to v_cat_dedup_candidates
-- 4. Fixes ops.run_cat_dedup_scan() to work with real sub-views

\echo ''
\echo '=============================================='
\echo '  MIG_2835: Complete Cat Dedup System'
\echo '=============================================='
\echo ''

-- Ensure fuzzystrmatch extension (for levenshtein + dmetaphone)
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- ============================================================================
-- 1. SUB-VIEW: Exact Identifier Matches (confidence 0.95–1.0)
-- ============================================================================

\echo '1. Creating ops.v_cat_dedup_duplicate_ids...'

CREATE OR REPLACE VIEW ops.v_cat_dedup_duplicate_ids AS
SELECT
  c1.cat_id AS cat_id_1,
  c2.cat_id AS cat_id_2,
  c1.name AS name_1,
  c2.name AS name_2,
  c1.microchip AS chip_1,
  c2.microchip AS chip_2,
  c1.clinichq_animal_id AS chq_1,
  c2.clinichq_animal_id AS chq_2,
  c1.sex AS sex_1,
  c2.sex AS sex_2,
  CASE
    WHEN c1.microchip = c2.microchip AND c1.microchip IS NOT NULL AND c1.microchip != ''
    THEN 1.0
    ELSE 0.95
  END::NUMERIC AS confidence,
  CASE
    WHEN c1.microchip = c2.microchip AND c1.microchip IS NOT NULL AND c1.microchip != ''
    THEN 'duplicate_microchip'
    ELSE 'duplicate_clinichq_id'
  END AS match_reason
FROM sot.cats c1
JOIN sot.cats c2 ON c1.cat_id < c2.cat_id
WHERE c1.merged_into_cat_id IS NULL
  AND c2.merged_into_cat_id IS NULL
  AND (
    -- Exact microchip match (data integrity issue — should not happen)
    (c1.microchip = c2.microchip AND c1.microchip IS NOT NULL AND c1.microchip != '')
    -- OR exact clinichq_animal_id match
    OR (c1.clinichq_animal_id = c2.clinichq_animal_id
        AND c1.clinichq_animal_id IS NOT NULL AND c1.clinichq_animal_id != '')
  );

COMMENT ON VIEW ops.v_cat_dedup_duplicate_ids IS
'Cats sharing exact microchip or clinichq_animal_id — data integrity issues that should be 0.
Confidence: 1.0 for microchip, 0.95 for clinichq_animal_id.';

-- ============================================================================
-- 2. SUB-VIEW: Microchip Typos (confidence 0.65–0.80)
-- ============================================================================

\echo '2. Creating ops.v_cat_dedup_chip_typos...'

CREATE OR REPLACE VIEW ops.v_cat_dedup_chip_typos AS
SELECT
  c1.cat_id AS cat_id_1,
  c2.cat_id AS cat_id_2,
  c1.name AS name_1,
  c2.name AS name_2,
  c1.microchip AS chip_1,
  c2.microchip AS chip_2,
  c1.clinichq_animal_id AS chq_1,
  c2.clinichq_animal_id AS chq_2,
  c1.sex AS sex_1,
  c2.sex AS sex_2,
  levenshtein(c1.microchip, c2.microchip) AS edit_distance,
  CASE
    WHEN levenshtein(c1.microchip, c2.microchip) = 1 THEN 0.80
    WHEN levenshtein(c1.microchip, c2.microchip) = 2 THEN 0.65
  END::NUMERIC AS confidence,
  'microchip_typo' AS match_reason
FROM sot.cats c1
JOIN sot.cats c2 ON c1.cat_id < c2.cat_id
WHERE c1.merged_into_cat_id IS NULL
  AND c2.merged_into_cat_id IS NULL
  -- Both have 15-digit microchips
  AND c1.microchip IS NOT NULL AND c1.microchip != '' AND length(c1.microchip) = 15
  AND c2.microchip IS NOT NULL AND c2.microchip != '' AND length(c2.microchip) = 15
  -- Not exact match (those are in v_cat_dedup_duplicate_ids)
  AND c1.microchip != c2.microchip
  -- Edit distance 1 or 2
  AND levenshtein(c1.microchip, c2.microchip) <= 2
  -- For distance 2, require same area prefix (first 3 digits) to reduce false positives
  AND (
    levenshtein(c1.microchip, c2.microchip) = 1
    OR LEFT(c1.microchip, 3) = LEFT(c2.microchip, 3)
  )
  -- Blocking: same sex OR same primary_color
  AND (
    (c1.sex IS NOT NULL AND c1.sex = c2.sex)
    OR (c1.primary_color IS NOT NULL AND c1.primary_color = c2.primary_color)
  );

COMMENT ON VIEW ops.v_cat_dedup_chip_typos IS
'Cats with microchips differing by 1-2 characters (typos).
Edit distance 1 = 0.80 confidence, distance 2 = 0.65.
Distance 2 requires same area prefix (first 3 digits) to reduce false positives.
Blocked by same sex or same primary color.';

-- ============================================================================
-- 3. SUB-VIEW: Same Name + Same Owner + One Chipped (Pixie pattern, 0.85)
-- ============================================================================

\echo '3. Creating ops.v_cat_dedup_same_owner...'

CREATE OR REPLACE VIEW ops.v_cat_dedup_same_owner AS
SELECT
  c1.cat_id AS cat_id_1,
  c2.cat_id AS cat_id_2,
  c1.name AS name_1,
  c2.name AS name_2,
  c1.microchip AS chip_1,
  c2.microchip AS chip_2,
  c1.clinichq_animal_id AS chq_1,
  c2.clinichq_animal_id AS chq_2,
  c1.sex AS sex_1,
  c2.sex AS sex_2,
  0.85::NUMERIC AS confidence,
  'same_name_same_owner' AS match_reason
FROM sot.cats c1
JOIN sot.cats c2 ON c1.cat_id < c2.cat_id
WHERE c1.merged_into_cat_id IS NULL
  AND c2.merged_into_cat_id IS NULL
  -- Same name (case-insensitive, trimmed)
  AND LOWER(TRIM(c1.name)) = LOWER(TRIM(c2.name))
  AND LOWER(TRIM(c1.name)) NOT IN ('unknown', '')
  AND c1.name IS NOT NULL AND c2.name IS NOT NULL
  -- Not in blocked common names list
  AND NOT EXISTS (
    SELECT 1 FROM ops.common_cat_names cn
    WHERE cn.name = LOWER(TRIM(c1.name)) AND cn.is_blocked
  )
  -- Shared person via appointments (same owner)
  AND EXISTS (
    SELECT 1 FROM ops.appointments a1
    JOIN ops.appointments a2 ON a1.person_id = a2.person_id
      AND a1.person_id IS NOT NULL
    WHERE a1.cat_id = c1.cat_id AND a2.cat_id = c2.cat_id
  )
  -- One has microchip, other doesn't (XOR)
  AND (
    (c1.microchip IS NULL OR c1.microchip = '')
    != (c2.microchip IS NULL OR c2.microchip = '')
  );

COMMENT ON VIEW ops.v_cat_dedup_same_owner IS
'Same name + same owner (via appointments) + one chipped, one not (Pixie pattern).
Classic scenario: cat visits clinic before and after microchipping.
Blocked common names excluded. Confidence: 0.85.';

-- ============================================================================
-- 4. SAFETY GATE: sot.cat_safe_to_merge()
-- ============================================================================

\echo '4. Creating sot.cat_safe_to_merge()...'

CREATE OR REPLACE FUNCTION sot.cat_safe_to_merge(
  p_loser_id UUID,
  p_winner_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_loser RECORD;
  v_winner RECORD;
BEGIN
  -- Get both cats
  SELECT cat_id, name, microchip, sex, data_quality
  INTO v_loser
  FROM sot.cats
  WHERE cat_id = p_loser_id AND merged_into_cat_id IS NULL;

  SELECT cat_id, name, microchip, sex, data_quality
  INTO v_winner
  FROM sot.cats
  WHERE cat_id = p_winner_id AND merged_into_cat_id IS NULL;

  IF v_loser IS NULL THEN
    RETURN 'loser_not_found';
  END IF;

  IF v_winner IS NULL THEN
    RETURN 'winner_not_found';
  END IF;

  -- Block if loser has staff-verified data (sot.cats uses data_quality, not is_verified)
  IF v_loser.data_quality = 'verified' THEN
    RETURN 'loser_verified';
  END IF;

  -- Block if both have different non-null microchips
  IF v_loser.microchip IS NOT NULL AND v_loser.microchip != ''
     AND v_winner.microchip IS NOT NULL AND v_winner.microchip != ''
     AND v_loser.microchip != v_winner.microchip THEN
    RETURN 'conflicting_microchips';
  END IF;

  -- Block if different known sex (male vs female, not unknown)
  IF v_loser.sex IS NOT NULL AND v_winner.sex IS NOT NULL
     AND v_loser.sex != v_winner.sex
     AND v_loser.sex NOT IN ('unknown', 'Unknown', '')
     AND v_winner.sex NOT IN ('unknown', 'Unknown', '') THEN
    RETURN 'conflicting_sex';
  END IF;

  RETURN 'safe';
END;
$$;

COMMENT ON FUNCTION sot.cat_safe_to_merge IS
'Safety gate for cat merges. Returns:
- safe: OK to merge
- loser_not_found: Loser cat missing or already merged
- winner_not_found: Winner cat missing or already merged
- loser_verified: Loser has data_quality=verified (INV-2: Manual > AI)
- conflicting_microchips: Both have different non-null microchips
- conflicting_sex: Known different sex (male vs female)';

-- ============================================================================
-- 5. TABLE-BASED APPROACH: Pre-computed candidates (like place dedup)
-- ============================================================================
-- The view-based approach times out on Supabase with 35K+ chipped cats.
-- Solution: table populated by run_cat_dedup_scan(), view wraps the table.

\echo '5. Creating ops.cat_dedup_candidates table...'

CREATE TABLE IF NOT EXISTS ops.cat_dedup_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cat_id_1 UUID NOT NULL REFERENCES sot.cats(cat_id),
  cat_id_2 UUID NOT NULL REFERENCES sot.cats(cat_id),
  name_1 TEXT,
  name_2 TEXT,
  chip_1 TEXT,
  chip_2 TEXT,
  chq_1 TEXT,
  chq_2 TEXT,
  sex_1 TEXT,
  sex_2 TEXT,
  color_1 TEXT,
  color_2 TEXT,
  owner_1 TEXT,
  owner_2 TEXT,
  confidence NUMERIC NOT NULL,
  match_reason TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(cat_id_1, cat_id_2)
);

CREATE INDEX IF NOT EXISTS idx_cat_dedup_action ON ops.cat_dedup_candidates(recommended_action);
CREATE INDEX IF NOT EXISTS idx_cat_dedup_confidence ON ops.cat_dedup_candidates(confidence DESC);

-- Drop old view, replace with thin wrapper over table
DROP VIEW IF EXISTS ops.v_cat_dedup_candidates;
CREATE OR REPLACE VIEW ops.v_cat_dedup_candidates AS
SELECT cat_id_1, cat_id_2, name_1, name_2, chip_1, chip_2,
  chq_1, chq_2, sex_1, sex_2, color_1, color_2,
  owner_1, owner_2, confidence, match_reason, recommended_action
FROM ops.cat_dedup_candidates;

COMMENT ON VIEW ops.v_cat_dedup_candidates IS
'Thin wrapper over ops.cat_dedup_candidates table.
Run ops.run_cat_dedup_scan() to refresh data.';

-- ============================================================================
-- 6. TABLE-POPULATING SCAN FUNCTION
-- ============================================================================
-- Uses variant-generation for chip typos (O(n*135) index lookups, not O(n^2) levenshtein)
-- Chip typos require corroboration (same owner OR same name) to filter sequential-chip noise

\echo '6. Creating ops.run_cat_dedup_scan() (table-based)...'

DROP FUNCTION IF EXISTS ops.run_cat_dedup_scan();

CREATE OR REPLACE FUNCTION ops.run_cat_dedup_scan()
RETURNS TABLE(
  same_owner_count INT,
  chip_typo_count INT,
  duplicate_id_count INT,
  phonetic_count INT
)
LANGUAGE plpgsql AS $$
DECLARE
  v_same_owner INT := 0;
  v_chip_typo INT := 0;
  v_dup_id INT := 0;
  v_phonetic INT := 0;
BEGIN
  -- Step 0: Refresh common names
  DELETE FROM ops.common_cat_names;
  INSERT INTO ops.common_cat_names (name, occurrence_count, is_blocked)
  SELECT LOWER(TRIM(name)), COUNT(*), (COUNT(*) > 50)
  FROM sot.cats
  WHERE merged_into_cat_id IS NULL AND name IS NOT NULL AND name != ''
    AND name NOT IN ('Unknown', 'unknown')
  GROUP BY LOWER(TRIM(name))
  HAVING COUNT(*) > 5;

  -- Step 1: Clear
  TRUNCATE ops.cat_dedup_candidates;

  -- Step 2: Exact ID matches (fast — indexed lookups)
  INSERT INTO ops.cat_dedup_candidates
    (cat_id_1, cat_id_2, name_1, name_2, chip_1, chip_2, chq_1, chq_2,
     sex_1, sex_2, color_1, color_2, confidence, match_reason, recommended_action)
  SELECT v.cat_id_1, v.cat_id_2, v.name_1, v.name_2, v.chip_1, v.chip_2,
    v.chq_1, v.chq_2, v.sex_1, v.sex_2,
    c1.primary_color, c2.primary_color,
    v.confidence, v.match_reason,
    CASE WHEN v.confidence >= 0.95 THEN 'auto_merge' ELSE 'review_high' END
  FROM ops.v_cat_dedup_duplicate_ids v
  JOIN sot.cats c1 ON c1.cat_id = v.cat_id_1
  JOIN sot.cats c2 ON c2.cat_id = v.cat_id_2
  ON CONFLICT (cat_id_1, cat_id_2) DO NOTHING;
  GET DIAGNOSTICS v_dup_id = ROW_COUNT;

  -- Step 3: Chip typos via variant generation (O(n*135) index lookups)
  -- Requires corroboration: same owner OR same name
  INSERT INTO ops.cat_dedup_candidates
    (cat_id_1, cat_id_2, name_1, name_2, chip_1, chip_2, chq_1, chq_2,
     sex_1, sex_2, color_1, color_2, confidence, match_reason, recommended_action)
  SELECT DISTINCT ON (LEAST(c1.cat_id, c2.cat_id), GREATEST(c1.cat_id, c2.cat_id))
    LEAST(c1.cat_id, c2.cat_id), GREATEST(c1.cat_id, c2.cat_id),
    c1.name, c2.name, c1.microchip, c2.microchip,
    c1.clinichq_animal_id, c2.clinichq_animal_id,
    c1.sex, c2.sex, c1.primary_color, c2.primary_color,
    0.80, 'microchip_typo', 'review_medium'
  FROM sot.cats c1
  CROSS JOIN generate_series(1, 15) AS pos(p)
  CROSS JOIN generate_series(0, 9) AS digit(d)
  JOIN sot.cats c2
    ON c2.microchip = LEFT(c1.microchip, pos.p - 1) || chr(digit.d + 48) || SUBSTRING(c1.microchip FROM pos.p + 1)
    AND c2.cat_id != c1.cat_id AND c2.merged_into_cat_id IS NULL
  WHERE c1.merged_into_cat_id IS NULL
    AND c1.microchip IS NOT NULL AND length(c1.microchip) = 15
    AND chr(digit.d + 48) != SUBSTRING(c1.microchip FROM pos.p FOR 1)
    AND ((c1.sex IS NOT NULL AND c1.sex = c2.sex)
      OR (c1.primary_color IS NOT NULL AND c1.primary_color = c2.primary_color))
    AND (
      (LOWER(TRIM(c1.name)) = LOWER(TRIM(c2.name))
       AND c1.name IS NOT NULL AND c2.name IS NOT NULL
       AND LOWER(TRIM(c1.name)) NOT IN ('unknown', ''))
      OR EXISTS (
        SELECT 1 FROM ops.appointments a1
        JOIN ops.appointments a2 ON a1.person_id = a2.person_id AND a1.person_id IS NOT NULL
        WHERE a1.cat_id = c1.cat_id AND a2.cat_id = c2.cat_id
      )
    )
  ON CONFLICT (cat_id_1, cat_id_2) DO NOTHING;
  GET DIAGNOSTICS v_chip_typo = ROW_COUNT;

  -- Step 4: Same name + same owner (fast — name equality + appointment join)
  INSERT INTO ops.cat_dedup_candidates
    (cat_id_1, cat_id_2, name_1, name_2, chip_1, chip_2, chq_1, chq_2,
     sex_1, sex_2, color_1, color_2, confidence, match_reason, recommended_action)
  SELECT v.cat_id_1, v.cat_id_2, v.name_1, v.name_2, v.chip_1, v.chip_2,
    v.chq_1, v.chq_2, v.sex_1, v.sex_2,
    c1.primary_color, c2.primary_color,
    v.confidence, v.match_reason, 'review_high'
  FROM ops.v_cat_dedup_same_owner v
  JOIN sot.cats c1 ON c1.cat_id = v.cat_id_1
  JOIN sot.cats c2 ON c2.cat_id = v.cat_id_2
  ON CONFLICT (cat_id_1, cat_id_2) DO NOTHING;
  GET DIAGNOSTICS v_same_owner = ROW_COUNT;

  -- Step 5: Phonetic name match
  INSERT INTO ops.cat_dedup_candidates
    (cat_id_1, cat_id_2, name_1, name_2, chip_1, chip_2, chq_1, chq_2,
     sex_1, sex_2, color_1, color_2, confidence, match_reason, recommended_action)
  SELECT c1.cat_id, c2.cat_id, c1.name, c2.name,
    c1.microchip, c2.microchip, c1.clinichq_animal_id, c2.clinichq_animal_id,
    c1.sex, c2.sex, c1.primary_color, c2.primary_color,
    0.55, 'phonetic_name_match', 'review_low'
  FROM sot.cats c1
  JOIN sot.cats c2 ON c1.cat_id < c2.cat_id
    AND dmetaphone(TRIM(c1.name)) = dmetaphone(TRIM(c2.name))
  WHERE c1.merged_into_cat_id IS NULL AND c2.merged_into_cat_id IS NULL
    AND c1.name IS NOT NULL AND c2.name IS NOT NULL
    AND c1.name != '' AND c2.name != ''
    AND LOWER(TRIM(c1.name)) NOT IN ('unknown', '')
    AND LOWER(TRIM(c2.name)) NOT IN ('unknown', '')
    AND dmetaphone(TRIM(c1.name)) IS NOT NULL AND dmetaphone(TRIM(c1.name)) != ''
    AND LOWER(TRIM(c1.name)) != LOWER(TRIM(c2.name))
    AND EXISTS (
      SELECT 1 FROM ops.appointments a1
      JOIN ops.appointments a2 ON a1.person_id = a2.person_id AND a1.person_id IS NOT NULL
      WHERE a1.cat_id = c1.cat_id AND a2.cat_id = c2.cat_id
    )
    AND ((c1.sex IS NOT NULL AND c1.sex = c2.sex)
      OR (c1.primary_color IS NOT NULL AND c1.primary_color = c2.primary_color))
    AND EXISTS (
      SELECT 1 FROM sot.cat_place cp1
      JOIN sot.cat_place cp2 ON cp1.place_id = cp2.place_id
      WHERE cp1.cat_id = c1.cat_id AND cp2.cat_id = c2.cat_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM ops.common_cat_names cn
      WHERE cn.name = LOWER(TRIM(c1.name)) AND cn.is_blocked
    )
  ON CONFLICT (cat_id_1, cat_id_2) DO NOTHING;
  GET DIAGNOSTICS v_phonetic = ROW_COUNT;

  -- Step 6: Enrich with owner names
  UPDATE ops.cat_dedup_candidates cdc SET
    owner_1 = (SELECT p.display_name FROM sot.people p
               JOIN ops.appointments a ON a.person_id = p.person_id
               WHERE a.cat_id = cdc.cat_id_1 AND p.merged_into_person_id IS NULL
               ORDER BY a.appointment_date DESC LIMIT 1),
    owner_2 = (SELECT p.display_name FROM sot.people p
               JOIN ops.appointments a ON a.person_id = p.person_id
               WHERE a.cat_id = cdc.cat_id_2 AND p.merged_into_person_id IS NULL
               ORDER BY a.appointment_date DESC LIMIT 1)
  WHERE owner_1 IS NULL;

  RAISE NOTICE 'Cat dedup scan: % dup_ids, % chip_typos, % same_owner, % phonetic',
    v_dup_id, v_chip_typo, v_same_owner, v_phonetic;

  RETURN QUERY SELECT v_same_owner, v_chip_typo, v_dup_id, v_phonetic;
END;
$$;

COMMENT ON FUNCTION ops.run_cat_dedup_scan IS
'Populates ops.cat_dedup_candidates table with potential duplicates.
Uses variant-generation for chip typos (O(n*135) index lookups, not O(n^2) levenshtein).
Chip typos require corroboration (same owner OR same name) to filter sequential-chip noise.
Call via: SELECT * FROM ops.run_cat_dedup_scan();';

-- ============================================================================
-- 7. VERIFICATION
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Running initial scan (populates ops.cat_dedup_candidates table)...'
SELECT * FROM ops.run_cat_dedup_scan();

\echo ''
\echo 'Candidates by action:'
SELECT recommended_action, COUNT(*) AS pair_count
FROM ops.cat_dedup_candidates
GROUP BY recommended_action
ORDER BY CASE recommended_action
  WHEN 'auto_merge' THEN 1 WHEN 'review_high' THEN 2
  WHEN 'review_medium' THEN 3 WHEN 'review_low' THEN 4 ELSE 5
END;

\echo ''
\echo '=============================================='
\echo '  MIG_2835 Complete'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - ops.v_cat_dedup_duplicate_ids (exact microchip/clinichq_id matches)'
\echo '  - ops.v_cat_dedup_chip_typos (microchip edit distance 1-2)'
\echo '  - ops.v_cat_dedup_same_owner (same name + same owner + one chipped)'
\echo '  - sot.cat_safe_to_merge() (safety gate)'
\echo '  - ops.cat_dedup_candidates TABLE (pre-computed results)'
\echo '  - ops.v_cat_dedup_candidates VIEW (thin wrapper over table)'
\echo '  - ops.run_cat_dedup_scan() (table-based with variant-generation)'
\echo ''
