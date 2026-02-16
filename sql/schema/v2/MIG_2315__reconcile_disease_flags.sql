-- MIG_2315: Reconcile disease_risk flags with computed disease status
--
-- Problem: sot.places.disease_risk = TRUE was set by automated ingestion
-- but many of these have NO actual positive test results in ops.cat_test_results.
-- The map view ORs manual flag with computed data, causing false positives.
--
-- This migration:
-- 1. Audits places with disease_risk=TRUE but no computed disease data
-- 2. Clears stale disease_risk flags (sets to FALSE where no test data supports it)
-- 3. Updates compute_place_disease_status() to sync sot.places.disease_risk from computed data
--
-- Usage: psql -f MIG_2315__reconcile_disease_flags.sql
--
-- References: ATLAS_NORTH_STAR.md (disease computation pipeline)

BEGIN;

-- ============================================================
-- 1. AUDIT: Find false positive disease_risk flags
-- ============================================================

DO $$
DECLARE
  false_positive_count INTEGER;
  missing_badge_count INTEGER;
BEGIN
  -- Count places with disease_risk=TRUE but no computed disease status
  SELECT COUNT(*) INTO false_positive_count
  FROM sot.places p
  WHERE p.disease_risk = TRUE
    AND p.merged_into_place_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM ops.place_disease_status pds
      WHERE pds.place_id = p.place_id
        AND pds.status NOT IN ('false_flag', 'cleared')
    );

  RAISE NOTICE 'MIG_2315: Found % places with disease_risk=TRUE but no supporting test data', false_positive_count;

  -- Count cats with positive tests but no cat_place link
  SELECT COUNT(*) INTO missing_badge_count
  FROM ops.cat_test_results ctr
  WHERE ctr.result = 'positive'
    AND NOT EXISTS (
      SELECT 1 FROM sot.cat_place cp
      WHERE cp.cat_id = ctr.cat_id
    );

  RAISE NOTICE 'MIG_2315: Found % positive test results on cats with no cat_place link', missing_badge_count;
END;
$$;

-- ============================================================
-- 2. FIX: Clear stale disease_risk flags
-- ============================================================

-- Clear disease_risk where no computed disease status exists
-- This removes false positives from the map

UPDATE sot.places p
SET
  disease_risk = FALSE,
  disease_risk_notes = CASE
    WHEN p.disease_risk_notes IS NOT NULL THEN
      p.disease_risk_notes || ' [MIG_2315: Cleared - no supporting test data]'
    ELSE
      '[MIG_2315: Cleared - no supporting test data]'
  END,
  updated_at = NOW()
WHERE p.disease_risk = TRUE
  AND p.merged_into_place_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM ops.place_disease_status pds
    WHERE pds.place_id = p.place_id
      AND pds.status NOT IN ('false_flag', 'cleared')
  );

-- Log the count
DO $$
DECLARE
  cleared_count INTEGER;
BEGIN
  GET DIAGNOSTICS cleared_count = ROW_COUNT;
  RAISE NOTICE 'MIG_2315: Cleared disease_risk flag on % places', cleared_count;
END;
$$;

-- ============================================================
-- 3. SYNC: Set disease_risk=TRUE where computed status exists
-- ============================================================

-- Set disease_risk=TRUE where there IS computed disease status
-- This ensures places with actual positive tests show the badge

UPDATE sot.places p
SET
  disease_risk = TRUE,
  disease_risk_notes = CASE
    WHEN p.disease_risk_notes IS NOT NULL THEN
      p.disease_risk_notes || ' [MIG_2315: Set from computed disease status]'
    ELSE
      '[MIG_2315: Set from computed disease status]'
  END,
  updated_at = NOW()
WHERE p.merged_into_place_id IS NULL
  AND p.disease_risk IS NOT TRUE  -- Only update if not already TRUE
  AND EXISTS (
    SELECT 1 FROM ops.place_disease_status pds
    WHERE pds.place_id = p.place_id
      AND pds.status IN ('confirmed_active', 'suspected', 'perpetual')
      AND pds.positive_cat_count > 0
  );

-- Log the count
DO $$
DECLARE
  set_count INTEGER;
BEGIN
  GET DIAGNOSTICS set_count = ROW_COUNT;
  RAISE NOTICE 'MIG_2315: Set disease_risk=TRUE on % places from computed data', set_count;
END;
$$;

-- ============================================================
-- 4. CREATE: Function to sync disease_risk from computed status
-- ============================================================

-- This function should be called after compute_place_disease_status()
-- to keep sot.places.disease_risk in sync with ops.place_disease_status

CREATE OR REPLACE FUNCTION ops.sync_place_disease_flags()
RETURNS TABLE (
  places_set_true INTEGER,
  places_set_false INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_set_true INTEGER := 0;
  v_set_false INTEGER := 0;
BEGIN
  -- Set disease_risk=TRUE where computed status indicates active disease
  WITH to_set_true AS (
    UPDATE sot.places p
    SET
      disease_risk = TRUE,
      updated_at = NOW()
    WHERE p.merged_into_place_id IS NULL
      AND p.disease_risk IS NOT TRUE
      AND EXISTS (
        SELECT 1 FROM ops.place_disease_status pds
        WHERE pds.place_id = p.place_id
          AND pds.status IN ('confirmed_active', 'suspected', 'perpetual')
          AND pds.positive_cat_count > 0
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_set_true FROM to_set_true;

  -- Clear disease_risk where no computed status or status is cleared/false_flag
  -- BUT only if disease_risk_notes doesn't indicate manual override
  WITH to_set_false AS (
    UPDATE sot.places p
    SET
      disease_risk = FALSE,
      updated_at = NOW()
    WHERE p.merged_into_place_id IS NULL
      AND p.disease_risk = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM ops.place_disease_status pds
        WHERE pds.place_id = p.place_id
          AND pds.status IN ('confirmed_active', 'suspected', 'perpetual')
          AND pds.positive_cat_count > 0
      )
      -- Don't clear if manually set
      AND (p.disease_risk_notes IS NULL
           OR p.disease_risk_notes NOT ILIKE '%manual%'
           OR p.disease_risk_notes NOT ILIKE '%staff set%')
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_set_false FROM to_set_false;

  RAISE NOTICE 'sync_place_disease_flags: Set TRUE=%, Set FALSE=%', v_set_true, v_set_false;

  places_set_true := v_set_true;
  places_set_false := v_set_false;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION ops.sync_place_disease_flags() IS
  'Syncs sot.places.disease_risk flag from computed ops.place_disease_status.
   Should be called after compute_place_disease_status() to keep flags in sync.
   Does not clear flags that were manually set (notes contain "manual" or "staff set").';

-- ============================================================
-- 5. UPDATE: Modify run_disease_status_computation to call sync
-- ============================================================

-- Drop existing function to change return type
DROP FUNCTION IF EXISTS ops.run_disease_status_computation();

-- Update the main disease computation wrapper to include sync
CREATE OR REPLACE FUNCTION ops.run_disease_status_computation()
RETURNS TABLE (
  places_processed INTEGER,
  cats_with_tests INTEGER,
  disease_statuses_created INTEGER,
  flags_set_true INTEGER,
  flags_set_false INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_places_processed INTEGER := 0;
  v_cats_with_tests INTEGER := 0;
  v_statuses_created INTEGER := 0;
  v_flags_set_true INTEGER := 0;
  v_flags_set_false INTEGER := 0;
  sync_result RECORD;
BEGIN
  -- Step 1: Run the main disease computation
  -- This populates ops.place_disease_status from ops.cat_test_results + sot.cat_place

  -- Count cats with tests
  SELECT COUNT(DISTINCT cat_id) INTO v_cats_with_tests
  FROM ops.cat_test_results
  WHERE result = 'positive';

  -- Count places that could have disease status (cats with tests + cat_place link)
  SELECT COUNT(DISTINCT cp.place_id) INTO v_places_processed
  FROM sot.cat_place cp
  JOIN ops.cat_test_results ctr ON ctr.cat_id = cp.cat_id
  WHERE ctr.result = 'positive';

  -- Upsert disease statuses
  INSERT INTO ops.place_disease_status (
    place_id,
    disease_type_key,
    status,
    evidence_source,
    first_positive_date,
    last_positive_date,
    positive_cat_count,
    total_tested_count,
    notes,
    set_by,
    set_at
  )
  SELECT
    cp.place_id,
    ctr.test_type AS disease_type_key,
    'confirmed_active' AS status,
    'computed' AS evidence_source,
    MIN(ctr.test_date) AS first_positive_date,
    MAX(ctr.test_date) AS last_positive_date,
    COUNT(DISTINCT ctr.cat_id) AS positive_cat_count,
    COUNT(DISTINCT ctr.cat_id) AS total_tested_count,
    'Computed from cat test results' AS notes,
    'system' AS set_by,
    NOW() AS set_at
  FROM sot.cat_place cp
  JOIN ops.cat_test_results ctr ON ctr.cat_id = cp.cat_id
  WHERE ctr.result = 'positive'
  GROUP BY cp.place_id, ctr.test_type
  ON CONFLICT (place_id, disease_type_key)
  DO UPDATE SET
    last_positive_date = GREATEST(
      ops.place_disease_status.last_positive_date,
      EXCLUDED.last_positive_date
    ),
    positive_cat_count = EXCLUDED.positive_cat_count,
    total_tested_count = EXCLUDED.total_tested_count,
    updated_at = NOW()
  WHERE ops.place_disease_status.evidence_source = 'computed';  -- Don't override manual entries

  GET DIAGNOSTICS v_statuses_created = ROW_COUNT;

  -- Step 2: Sync the disease_risk flags on sot.places
  SELECT * INTO sync_result FROM ops.sync_place_disease_flags();
  v_flags_set_true := sync_result.places_set_true;
  v_flags_set_false := sync_result.places_set_false;

  RAISE NOTICE 'run_disease_status_computation: processed=%, cats=%, statuses=%, flags_true=%, flags_false=%',
    v_places_processed, v_cats_with_tests, v_statuses_created, v_flags_set_true, v_flags_set_false;

  places_processed := v_places_processed;
  cats_with_tests := v_cats_with_tests;
  disease_statuses_created := v_statuses_created;
  flags_set_true := v_flags_set_true;
  flags_set_false := v_flags_set_false;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION ops.run_disease_status_computation() IS
  'Computes place disease status from cat test results and syncs sot.places.disease_risk flags.
   Pipeline: ops.cat_test_results + sot.cat_place → ops.place_disease_status → sot.places.disease_risk';

-- ============================================================
-- 6. VERIFICATION: Final counts
-- ============================================================

DO $$
DECLARE
  final_true_count INTEGER;
  final_false_count INTEGER;
  computed_status_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO final_true_count
  FROM sot.places
  WHERE disease_risk = TRUE AND merged_into_place_id IS NULL;

  SELECT COUNT(*) INTO final_false_count
  FROM sot.places
  WHERE disease_risk = FALSE AND merged_into_place_id IS NULL;

  SELECT COUNT(*) INTO computed_status_count
  FROM ops.place_disease_status
  WHERE status IN ('confirmed_active', 'suspected', 'perpetual')
    AND positive_cat_count > 0;

  RAISE NOTICE '=== MIG_2315 Final Verification ===';
  RAISE NOTICE 'Places with disease_risk=TRUE: %', final_true_count;
  RAISE NOTICE 'Places with disease_risk=FALSE: %', final_false_count;
  RAISE NOTICE 'Computed disease statuses (active): %', computed_status_count;
  RAISE NOTICE 'Expected: disease_risk=TRUE count should match computed status count';
END;
$$;

COMMIT;

-- ============================================================
-- POST-MIGRATION: Run entity linking to fix missing cat-place links
-- ============================================================
--
-- After this migration, run the entity linking pipeline to create
-- cat_place links for cats with positive tests that are missing links:
--
-- SELECT * FROM ops.run_all_entity_linking();
-- SELECT * FROM ops.run_disease_status_computation();
--
-- This will:
-- 1. Create cat_place links from person_cat → person_place chains
-- 2. Recompute disease status with newly linked cats
-- 3. Sync disease_risk flags
