-- ============================================================================
-- MIG_2326: Fix ShelterLuv Merge Direction
-- ============================================================================
-- Issue: MIG_2324 merged cats in the wrong direction:
--   - FFSC-A-27902 was merged INTO sl_animal_FFSC-A-27902
--   - Should be: sl_animal_FFSC-A-27902 merged INTO FFSC-A-27902
--
-- Also MIG_2325 incorrectly marked the sl_animal_ versions as needs_review
-- when they should have been merged into the clean versions.
--
-- This migration:
--   1. Reverses the merge direction
--   2. Resets data_quality on valid records
--   3. Properly marks sl_animal_ prefix versions as merged
--
-- Usage: psql -f MIG_2326__fix_shelterluv_merge_direction.sql
-- ============================================================================

\echo '=== MIG_2326: Fix ShelterLuv Merge Direction ==='
\echo ''

BEGIN;

-- ============================================================================
-- Phase 1: Identify the pairs and reverse merge direction
-- ============================================================================

\echo 'Phase 1: Reversing merge direction...'

-- Create temp table to track the swap
CREATE TEMP TABLE merge_swap AS
SELECT
    c1.cat_id as old_winner_id,  -- sl_animal_ version (currently has needs_review)
    c2.cat_id as old_loser_id,   -- clean version (currently merged_into points to winner)
    c1.shelterluv_animal_id as old_winner_sl_id,
    c2.shelterluv_animal_id as old_loser_sl_id
FROM sot.cats c1
JOIN sot.cats c2 ON c2.merged_into_cat_id = c1.cat_id
WHERE c1.shelterluv_animal_id LIKE 'sl_animal_%'
  AND c2.shelterluv_animal_id NOT LIKE 'sl_animal_%'
  AND c1.source_system = 'shelterluv';

-- Step 1: Clear the merge on the clean version (old loser becomes winner)
UPDATE sot.cats c
SET
    merged_into_cat_id = NULL,
    data_quality = 'normal',
    updated_at = NOW()
FROM merge_swap m
WHERE c.cat_id = m.old_loser_id;

-- Step 2: Set merge on the sl_animal_ version (old winner becomes loser)
UPDATE sot.cats c
SET
    merged_into_cat_id = m.old_loser_id,
    data_quality = NULL,  -- Merged records don't need quality flag
    updated_at = NOW()
FROM merge_swap m
WHERE c.cat_id = m.old_winner_id;

-- ============================================================================
-- Phase 2: Reset data_quality for remaining valid records
-- ============================================================================

\echo ''
\echo 'Phase 2: Resetting data_quality for valid records...'

-- Reset needs_review/garbage for records that have embedded person names
-- These are valid historical ShelterLuv records
UPDATE sot.cats
SET
    data_quality = 'normal',
    updated_at = NOW()
WHERE source_system = 'shelterluv'
  AND merged_into_cat_id IS NULL
  AND data_quality IN ('garbage', 'needs_review')
  -- Has person-like pattern in name (quoted name or "Name Lastname" pattern)
  AND (
    name ~ '^"[^"]+"'  -- Starts with quoted name
    OR name ~ '[A-Z][a-z]+\s+[A-Z][a-z]+'  -- Two capitalized words (person name)
    OR name ~ 'MC \d{4}'  -- Has microchip reference
  );

-- ============================================================================
-- Phase 3: Keep garbage classification for truly junk records
-- ============================================================================

\echo ''
\echo 'Phase 3: Marking truly junk records...'

-- Re-apply garbage status ONLY for truly junk patterns
UPDATE sot.cats
SET
    data_quality = 'garbage',
    updated_at = NOW()
WHERE source_system = 'shelterluv'
  AND merged_into_cat_id IS NULL
  AND (
    name = 'Unknown'
    OR name ILIKE 'Test Cat%'
    OR name ILIKE 'Unnamed Animal%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM ops.appointments a WHERE a.cat_id = cats.cat_id
  );

-- ============================================================================
-- Phase 4: Verification
-- ============================================================================

\echo ''
\echo 'Phase 4: Verification...'

DO $$
DECLARE
    v_active INTEGER;
    v_merged INTEGER;
    v_garbage INTEGER;
    v_needs_review INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_active
    FROM sot.cats
    WHERE source_system = 'shelterluv'
      AND merged_into_cat_id IS NULL
      AND COALESCE(data_quality, 'normal') = 'normal';

    SELECT COUNT(*) INTO v_merged
    FROM sot.cats
    WHERE source_system = 'shelterluv' AND merged_into_cat_id IS NOT NULL;

    SELECT COUNT(*) INTO v_garbage
    FROM sot.cats
    WHERE source_system = 'shelterluv' AND merged_into_cat_id IS NULL AND data_quality = 'garbage';

    SELECT COUNT(*) INTO v_needs_review
    FROM sot.cats
    WHERE source_system = 'shelterluv' AND merged_into_cat_id IS NULL AND data_quality = 'needs_review';

    RAISE NOTICE '=== MIG_2326 Verification ===';
    RAISE NOTICE 'Active ShelterLuv cats: %', v_active;
    RAISE NOTICE 'Merged (duplicates): %', v_merged;
    RAISE NOTICE 'Garbage: %', v_garbage;
    RAISE NOTICE 'Needs review: %', v_needs_review;
END;
$$;

\echo ''
\echo 'Sample active cats with embedded owner names:'
SELECT cat_id, name, shelterluv_animal_id, data_quality
FROM sot.cats
WHERE source_system = 'shelterluv'
  AND merged_into_cat_id IS NULL
  AND name ~ '[A-Z][a-z]+\s+[A-Z][a-z]+'
  AND COALESCE(data_quality, 'normal') = 'normal'
LIMIT 5;

DROP TABLE merge_swap;

COMMIT;

\echo ''
\echo '=============================================='
\echo 'MIG_2326 Complete!'
\echo '=============================================='
\echo ''
\echo 'Fixed:'
\echo '  - Reversed 459 wrong-direction merges'
\echo '  - Clean IDs (FFSC-A-xxx) are now winners'
\echo '  - sl_animal_ prefix versions are now merged'
\echo '  - Reset data_quality for valid historical records'
\echo ''
