-- MIG_2341__cat_dedup_enhancements.sql
-- Cat Entity Resolution & Deduplication System
--
-- Based on industry best practices research:
-- - Deterministic + Probabilistic Hybrid (Healthcare MPI, Salesforce)
-- - Confidence Scoring (HL7 FHIR standard)
-- - Blocking Strategies (Splink, dedupe.io)
-- - Human-in-the-Loop (MDM systems)
--
-- Key Design Decisions:
-- 1. Never match by name alone (11,749 "Unknown" cats would collide)
-- 2. Microchip is gold standard (95.6% coverage)
-- 3. Prefer false negatives over false positives (conservative)
-- 4. Medium-confidence matches go to review queue

-- ==============================================================================
-- 1. ENABLE FUZZYSTRMATCH EXTENSION (for Levenshtein distance)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- ==============================================================================
-- 2. ADD CONFIDENCE COLUMN TO CAT_IDENTIFIERS
-- ==============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sot' AND table_name = 'cat_identifiers' AND column_name = 'confidence'
  ) THEN
    ALTER TABLE sot.cat_identifiers
    ADD COLUMN confidence NUMERIC(3,2) DEFAULT 1.0;
  END IF;
END $$;

COMMENT ON COLUMN sot.cat_identifiers.confidence IS
'Confidence in identifier accuracy.
1.0 = gold standard (microchip - verified unique)
0.95 = clinichq_animal_id (unique within ClinicHQ, but can change)
0.5 = inferred from name pattern or low-confidence match';

-- Set confidence based on identifier type
UPDATE sot.cat_identifiers
SET confidence = CASE
  WHEN id_type = 'microchip' THEN 1.0
  WHEN id_type = 'clinichq_animal_id' THEN 0.95
  WHEN id_type = 'shelterluv_animal_id' THEN 0.95
  ELSE 0.8
END
WHERE confidence = 1.0 OR confidence IS NULL;

-- ==============================================================================
-- 3. CREATE COMMON CAT NAMES TABLE (FALSE POSITIVE PREVENTION)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS ops.common_cat_names (
  name TEXT PRIMARY KEY,
  occurrence_count INT NOT NULL DEFAULT 0,
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ops.common_cat_names IS
'Registry of common cat names used to prevent false positive matches.
Names with is_blocked=TRUE will never be matched by name alone.
Threshold: >50 occurrences = blocked.';

-- Populate with current data
INSERT INTO ops.common_cat_names (name, occurrence_count, is_blocked)
SELECT
  LOWER(TRIM(name)),
  COUNT(*),
  (COUNT(*) > 50)  -- Block names appearing >50 times
FROM sot.cats
WHERE merged_into_cat_id IS NULL
  AND name IS NOT NULL
  AND name != ''
  AND name NOT IN ('Unknown', 'unknown')  -- Always blocked separately
GROUP BY LOWER(TRIM(name))
HAVING COUNT(*) > 5  -- Only track names appearing >5 times
ON CONFLICT (name) DO UPDATE SET
  occurrence_count = EXCLUDED.occurrence_count,
  is_blocked = EXCLUDED.is_blocked,
  updated_at = NOW();

-- ==============================================================================
-- 4. ENHANCED DUPLICATE DETECTION VIEW WITH CONFIDENCE SCORING
-- ==============================================================================

CREATE OR REPLACE VIEW ops.v_cat_dedup_candidates AS
WITH scored_pairs AS (
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
    c1.primary_color AS color_1,
    c2.primary_color AS color_2,
    -- Get owner names for display
    (SELECT p.display_name FROM sot.people p
     JOIN ops.appointments a ON a.person_id = p.person_id
     WHERE a.cat_id = c1.cat_id AND p.merged_into_person_id IS NULL
     ORDER BY a.appointment_date DESC LIMIT 1) AS owner_1,
    (SELECT p.display_name FROM sot.people p
     JOIN ops.appointments a ON a.person_id = p.person_id
     WHERE a.cat_id = c2.cat_id AND p.merged_into_person_id IS NULL
     ORDER BY a.appointment_date DESC LIMIT 1) AS owner_2,
    -- Calculate confidence score
    CASE
      -- Same microchip (data integrity issue - should not happen)
      WHEN c1.microchip = c2.microchip AND c1.microchip IS NOT NULL AND c1.microchip != '' THEN 1.0
      -- Same clinichq_animal_id (data integrity issue)
      WHEN c1.clinichq_animal_id = c2.clinichq_animal_id
           AND c1.clinichq_animal_id IS NOT NULL AND c1.clinichq_animal_id != '' THEN 0.95
      -- Microchip edit distance 1 (typo)
      WHEN c1.microchip IS NOT NULL AND c2.microchip IS NOT NULL
           AND length(c1.microchip) = 15 AND length(c2.microchip) = 15
           AND levenshtein(c1.microchip, c2.microchip) = 1 THEN 0.80
      -- Microchip edit distance 2 (possible typo)
      WHEN c1.microchip IS NOT NULL AND c2.microchip IS NOT NULL
           AND length(c1.microchip) = 15 AND length(c2.microchip) = 15
           AND levenshtein(c1.microchip, c2.microchip) = 2 THEN 0.65
      -- Same name + same owner + one has chip, one doesn't (Pixie pattern)
      WHEN LOWER(TRIM(c1.name)) = LOWER(TRIM(c2.name))
           AND LOWER(TRIM(c1.name)) NOT IN ('unknown', '')
           AND EXISTS (
             SELECT 1 FROM ops.appointments a1
             JOIN ops.appointments a2 ON a1.person_id = a2.person_id
               AND a1.person_id IS NOT NULL
             WHERE a1.cat_id = c1.cat_id AND a2.cat_id = c2.cat_id
           )
           AND (
             (c1.microchip IS NULL OR c1.microchip = '')
             != (c2.microchip IS NULL OR c2.microchip = '')
           )
      THEN 0.85
      ELSE 0.0
    END AS confidence,
    -- Reason for flagging
    CASE
      WHEN c1.microchip = c2.microchip AND c1.microchip IS NOT NULL THEN 'duplicate_microchip'
      WHEN c1.clinichq_animal_id = c2.clinichq_animal_id AND c1.clinichq_animal_id IS NOT NULL THEN 'duplicate_clinichq_id'
      WHEN c1.microchip IS NOT NULL AND c2.microchip IS NOT NULL
           AND levenshtein(c1.microchip, c2.microchip) <= 2 THEN 'microchip_typo'
      ELSE 'same_name_same_owner'
    END AS match_reason
  FROM sot.cats c1
  JOIN sot.cats c2 ON c1.cat_id < c2.cat_id  -- Avoid duplicate pairs
  WHERE c1.merged_into_cat_id IS NULL
    AND c2.merged_into_cat_id IS NULL
    -- Blocking: only compare cats with same sex OR same primary_color
    -- This reduces comparison space by ~90%
    AND (
      (c1.sex IS NOT NULL AND c1.sex = c2.sex)
      OR (c1.primary_color IS NOT NULL AND c1.primary_color = c2.primary_color)
    )
    -- Exclude blocked common names from name-based matching
    AND NOT EXISTS (
      SELECT 1 FROM ops.common_cat_names cn
      WHERE cn.name = LOWER(TRIM(c1.name)) AND cn.is_blocked
    )
)
SELECT
  cat_id_1,
  cat_id_2,
  name_1,
  name_2,
  chip_1,
  chip_2,
  chq_1,
  chq_2,
  sex_1,
  sex_2,
  color_1,
  color_2,
  owner_1,
  owner_2,
  confidence,
  match_reason,
  -- Action recommendation
  CASE
    WHEN confidence >= 0.95 THEN 'auto_merge'
    WHEN confidence >= 0.85 THEN 'review_high'
    WHEN confidence >= 0.65 THEN 'review_medium'
    ELSE 'flag_only'
  END AS recommended_action
FROM scored_pairs
WHERE confidence >= 0.5
ORDER BY confidence DESC, match_reason;

COMMENT ON VIEW ops.v_cat_dedup_candidates IS
'Potential duplicate cats scored by confidence.

Confidence Levels:
- 1.0: Exact microchip match (data integrity issue)
- 0.95: Same clinichq_animal_id (data integrity issue)
- 0.85: Same name + same owner + one chipped (Pixie pattern)
- 0.80: Microchip edit distance = 1 (typo)
- 0.65: Microchip edit distance = 2 (possible typo)

Actions:
- auto_merge (>=0.95): Can merge automatically
- review_high (0.85-0.94): Staff should review, likely merge
- review_medium (0.65-0.84): Staff must review carefully
- flag_only (<0.65): Probably not duplicates, just flag';

-- ==============================================================================
-- 5. MERGE FUNCTION WITH AUDIT TRAIL
-- ==============================================================================

CREATE OR REPLACE FUNCTION sot.merge_cats(
  p_loser_id UUID,
  p_winner_id UUID,
  p_reason TEXT DEFAULT 'duplicate',
  p_changed_by TEXT DEFAULT 'system'
)
RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  v_loser_name TEXT;
  v_winner_name TEXT;
BEGIN
  -- Get names for logging
  SELECT name INTO v_loser_name FROM sot.cats WHERE cat_id = p_loser_id;
  SELECT name INTO v_winner_name FROM sot.cats WHERE cat_id = p_winner_id;

  -- Validate both cats exist and aren't already merged
  IF NOT EXISTS (SELECT 1 FROM sot.cats WHERE cat_id = p_loser_id AND merged_into_cat_id IS NULL) THEN
    RAISE EXCEPTION 'Loser cat % not found or already merged', p_loser_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sot.cats WHERE cat_id = p_winner_id AND merged_into_cat_id IS NULL) THEN
    RAISE EXCEPTION 'Winner cat % not found or already merged', p_winner_id;
  END IF;

  -- Reassign appointments
  UPDATE ops.appointments SET cat_id = p_winner_id WHERE cat_id = p_loser_id;

  -- Move identifiers (preserve all, winner takes priority on conflicts)
  INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, confidence, source_system, created_at)
  SELECT p_winner_id, id_type, id_value, confidence, source_system, created_at
  FROM sot.cat_identifiers WHERE cat_id = p_loser_id
  ON CONFLICT (id_type, id_value) DO NOTHING;

  -- Move cat-place relationships
  INSERT INTO sot.cat_place (cat_id, place_id, relationship_type, confidence, source_system, created_at)
  SELECT p_winner_id, place_id, relationship_type, confidence, source_system, created_at
  FROM sot.cat_place WHERE cat_id = p_loser_id
  ON CONFLICT DO NOTHING;

  -- Move person-cat relationships
  INSERT INTO sot.person_cat (person_id, cat_id, relationship_type, confidence, source_system, created_at)
  SELECT person_id, p_winner_id, relationship_type, confidence, source_system, created_at
  FROM sot.person_cat WHERE cat_id = p_loser_id
  ON CONFLICT DO NOTHING;

  -- Mark loser as merged
  UPDATE sot.cats
  SET merged_into_cat_id = p_winner_id, updated_at = NOW()
  WHERE cat_id = p_loser_id;

  -- Log the merge to entity_edits
  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, changed_by, created_at)
  VALUES (
    'cat',
    p_loser_id,
    'merge',
    jsonb_build_object(
      'loser_id', p_loser_id,
      'loser_name', v_loser_name,
      'merged_into', p_winner_id,
      'winner_name', v_winner_name,
      'reason', p_reason
    ),
    NULL,
    p_changed_by,
    NOW()
  );

  RAISE NOTICE 'Merged cat "%" (%) into "%" (%)', v_loser_name, p_loser_id, v_winner_name, p_winner_id;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION sot.merge_cats IS
'Merge a duplicate cat record into the canonical record.
- Reassigns all appointments to winner
- Moves all identifiers, relationships to winner
- Marks loser as merged_into_cat_id = winner
- Logs merge to entity_edits for audit trail

Usage: SELECT sot.merge_cats(loser_uuid, winner_uuid, ''duplicate'', ''staff_name'');';

-- ==============================================================================
-- 6. WEEKLY DEDUP SCAN FUNCTION
-- ==============================================================================

CREATE OR REPLACE FUNCTION ops.run_cat_dedup_scan()
RETURNS TABLE(
  same_owner_count INT,
  chip_typo_count INT,
  duplicate_id_count INT
)
LANGUAGE plpgsql AS $$
DECLARE
  v_same_owner INT;
  v_chip_typo INT;
  v_dup_id INT;
BEGIN
  -- Refresh common names table
  DELETE FROM ops.common_cat_names;
  INSERT INTO ops.common_cat_names (name, occurrence_count, is_blocked)
  SELECT
    LOWER(TRIM(name)),
    COUNT(*),
    (COUNT(*) > 50)
  FROM sot.cats
  WHERE merged_into_cat_id IS NULL
    AND name IS NOT NULL AND name != ''
    AND name NOT IN ('Unknown', 'unknown')
  GROUP BY LOWER(TRIM(name))
  HAVING COUNT(*) > 5;

  -- Count candidates from each targeted view
  SELECT COUNT(*) INTO v_same_owner FROM ops.v_cat_dedup_same_owner;
  SELECT COUNT(*) INTO v_chip_typo FROM ops.v_cat_dedup_chip_typos;
  SELECT COUNT(*) INTO v_dup_id FROM ops.v_cat_dedup_duplicate_ids;

  RAISE NOTICE 'Dedup scan complete: % same_owner, % chip_typos, % duplicate_ids',
    v_same_owner, v_chip_typo, v_dup_id;

  RETURN QUERY SELECT v_same_owner, v_chip_typo, v_dup_id;
END;
$$;

COMMENT ON FUNCTION ops.run_cat_dedup_scan IS
'Weekly batch job to scan for duplicate cats.
1. Refreshes common_cat_names table
2. Returns counts from three targeted dedup views:
   - same_owner: Same name + same owner + one chipped (Pixie pattern)
   - chip_typos: Microchip edit distance 1-2 with same owner/name
   - duplicate_ids: Same microchip or clinichq_animal_id (data integrity issues)

Schedule with: SELECT * FROM ops.run_cat_dedup_scan();';

-- ==============================================================================
-- 7. HELPER VIEW: CATS WITH MULTIPLE IDENTIFIERS (DATA QUALITY)
-- ==============================================================================

CREATE OR REPLACE VIEW ops.v_cats_with_multiple_chips AS
SELECT
  c.cat_id,
  c.name,
  c.microchip AS stored_microchip,
  array_agg(DISTINCT ci.id_value) AS all_microchips,
  COUNT(DISTINCT ci.id_value) AS chip_count
FROM sot.cats c
JOIN sot.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
WHERE c.merged_into_cat_id IS NULL
GROUP BY c.cat_id, c.name, c.microchip
HAVING COUNT(DISTINCT ci.id_value) > 1;

COMMENT ON VIEW ops.v_cats_with_multiple_chips IS
'Cats with multiple different microchips recorded.
This indicates data quality issues that need manual review.';

-- ==============================================================================
-- 8. INITIAL SCAN (run manually to avoid migration timeout)
-- ==============================================================================
-- Run after migration: SELECT * FROM ops.run_cat_dedup_scan();
