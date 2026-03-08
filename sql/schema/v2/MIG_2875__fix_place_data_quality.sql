-- MIG_2875: Place Data Quality Audit Fixes
--
-- Fixes identified from audit of 11,452 active places:
--   Step 1: Fix display_name = 'clinichq' (66 places)
--   Step 2: Fix extract_unit_from_address() truncation bug (442 affected)
--   Step 3: Reclassify apartment_building → apartment_unit (176 places)
--   Step 4: Auto-merge Tier 4 exact duplicates (6 pairs)
--   Step 5: Backfill orphan apartment units (10 places + Step 3 results)
--   Step 6: Refresh dedup candidates after fixes
--
-- Created: 2026-03-08

\echo ''
\echo '=============================================='
\echo '  MIG_2875: Place Data Quality Audit Fixes'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- STEP 1: Fix display_name = 'clinichq' (66 places)
-- ============================================================================
-- Source system name was stored as display_name during ingestion.
-- Replace with formatted_address which is the correct human-readable name.

\echo '1. Fixing display_name = ''clinichq''...'

DO $$
DECLARE
  v_count INT;
BEGIN
  UPDATE sot.places
  SET display_name = formatted_address,
      updated_at = NOW()
  WHERE merged_into_place_id IS NULL
    AND display_name = 'clinichq'
    AND formatted_address IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '   Fixed % places with display_name = clinichq', v_count;
END $$;

-- ============================================================================
-- STEP 2: Fix extract_unit_from_address() regex truncation bug
-- ============================================================================
-- ROOT CAUSE: The trailing `,?\s*` is too greedy — "Apartment 2019, Santa Rosa"
-- matches "Apartment 2" as the unit because "019, Santa Rosa" gets consumed by
-- the trailing group (the comma is optional).
--
-- FIX: Replace trailing `,?\s*` with `[,]\s*` (require comma before city/state).
-- Also add `(?:\s+[a-z]+)?` to capture directional suffixes like "904 East".
--
-- VERIFIED against 8 test cases — all produce correct full unit numbers.

\echo '2. Fixing extract_unit_from_address() regex...'

CREATE OR REPLACE FUNCTION sot.extract_unit_from_address(addr TEXT)
RETURNS TABLE(base_address TEXT, unit TEXT) AS $$
DECLARE
  v_addr TEXT;
  v_unit TEXT;
  v_base TEXT;
  v_match TEXT[];
BEGIN
  IF addr IS NULL THEN
    RETURN QUERY SELECT NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  v_addr := addr;

  -- Extract unit patterns (case insensitive)
  -- Pattern: "123 Main St Apt 5" or "123 Main St, Apt 5" or "123 Main St #5"
  -- Require text keywords to be at word boundary (\m) AND followed by whitespace.
  -- This prevents matching "Steele", "Western", "Gravenstein", "Este Madera" etc.
  -- The # symbol can be immediately followed by the unit number (e.g., "#5").
  --
  -- FIX (MIG_2875): Changed trailing `,?\s*` to `[,]\s*` to require a comma
  -- before city/state/zip. Prevents "Apartment 2019" from being truncated to
  -- "Apartment 2" when followed by "019, Santa Rosa".
  -- Added `(?:\s+[a-z]+)?` to capture directional suffixes like "904 East".
  v_match := REGEXP_MATCH(v_addr,
    '(.*?),?\s*((?:(?:\mapt\.?|\mapartment|\munit|\msuite|\mste\.?|\mspace)\s+|#)\s*[a-z0-9-]+(?:\s+[a-z]+)?)\s*[,]\s*(.*)',
    'i'
  );

  IF v_match IS NOT NULL AND v_match[2] IS NOT NULL THEN
    -- Found a unit
    v_unit := TRIM(v_match[2]);
    -- Base is everything before the unit + everything after (city, state, zip)
    v_base := TRIM(v_match[1]);
    IF v_match[3] IS NOT NULL AND v_match[3] != '' THEN
      v_base := v_base || ', ' || TRIM(v_match[3]);
    END IF;
    -- Clean up trailing comma
    v_base := REGEXP_REPLACE(v_base, ',\s*$', '');

    RETURN QUERY SELECT v_base, v_unit;
    RETURN;
  END IF;

  -- No unit found
  RETURN QUERY SELECT v_addr, NULL::TEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

\echo '   Fixed extract_unit_from_address() regex'

-- Verify with test cases
\echo '   Verifying regex fix...'
DO $$
DECLARE
  v_result RECORD;
  v_errors INT := 0;
BEGIN
  -- Test 1: "1000 Bellevue Ave Apartment 2019, Santa Rosa, CA"
  SELECT * INTO v_result FROM sot.extract_unit_from_address('1000 Bellevue Ave Apartment 2019, Santa Rosa, CA');
  IF v_result.unit != 'Apartment 2019' THEN
    RAISE WARNING 'FAIL Test 1: Expected "Apartment 2019", got "%"', v_result.unit;
    v_errors := v_errors + 1;
  END IF;

  -- Test 2: "500 Oak St #14, Petaluma, CA"
  SELECT * INTO v_result FROM sot.extract_unit_from_address('500 Oak St #14, Petaluma, CA');
  IF v_result.unit != '#14' THEN
    RAISE WARNING 'FAIL Test 2: Expected "#14", got "%"', v_result.unit;
    v_errors := v_errors + 1;
  END IF;

  -- Test 3: "200 Main St APT 201, Rohnert Park, CA"
  SELECT * INTO v_result FROM sot.extract_unit_from_address('200 Main St APT 201, Rohnert Park, CA');
  IF v_result.unit != 'APT 201' THEN
    RAISE WARNING 'FAIL Test 3: Expected "APT 201", got "%"', v_result.unit;
    v_errors := v_errors + 1;
  END IF;

  -- Test 4: "100 Elm Dr Unit 904 East, Santa Rosa, CA"
  SELECT * INTO v_result FROM sot.extract_unit_from_address('100 Elm Dr Unit 904 East, Santa Rosa, CA');
  IF v_result.unit != 'Unit 904 East' THEN
    RAISE WARNING 'FAIL Test 4: Expected "Unit 904 East", got "%"', v_result.unit;
    v_errors := v_errors + 1;
  END IF;

  -- Test 5: No unit — "123 Main St, Santa Rosa, CA"
  SELECT * INTO v_result FROM sot.extract_unit_from_address('123 Main St, Santa Rosa, CA');
  IF v_result.unit IS NOT NULL THEN
    RAISE WARNING 'FAIL Test 5: Expected NULL, got "%"', v_result.unit;
    v_errors := v_errors + 1;
  END IF;

  -- Test 6: "4321 Gravenstein Hwy S, Sebastopol, CA" (should NOT match "ste" in Gravenstein)
  SELECT * INTO v_result FROM sot.extract_unit_from_address('4321 Gravenstein Hwy S, Sebastopol, CA');
  IF v_result.unit IS NOT NULL THEN
    RAISE WARNING 'FAIL Test 6: Expected NULL for Gravenstein, got "%"', v_result.unit;
    v_errors := v_errors + 1;
  END IF;

  -- Test 7: "750 Steele Ln, Santa Rosa, CA" (should NOT match "ste" in Steele)
  SELECT * INTO v_result FROM sot.extract_unit_from_address('750 Steele Ln, Santa Rosa, CA');
  IF v_result.unit IS NOT NULL THEN
    RAISE WARNING 'FAIL Test 7: Expected NULL for Steele, got "%"', v_result.unit;
    v_errors := v_errors + 1;
  END IF;

  -- Test 8: "300 Western Ave Suite 100, Petaluma, CA"
  SELECT * INTO v_result FROM sot.extract_unit_from_address('300 Western Ave Suite 100, Petaluma, CA');
  IF v_result.unit != 'Suite 100' THEN
    RAISE WARNING 'FAIL Test 8: Expected "Suite 100", got "%"', v_result.unit;
    v_errors := v_errors + 1;
  END IF;

  IF v_errors > 0 THEN
    RAISE EXCEPTION '% regex test(s) FAILED — aborting migration', v_errors;
  END IF;

  RAISE NOTICE '   All 8 regex tests passed';
END $$;

-- Re-extract all unit_identifiers with the fixed regex
\echo '   Re-extracting unit_identifiers for all child places...'

DO $$
DECLARE
  v_count INT;
BEGIN
  UPDATE sot.places p
  SET unit_identifier = sub.unit,
      updated_at = NOW()
  FROM (
    SELECT place_id, (sot.extract_unit_from_address(formatted_address)).unit
    FROM sot.places
    WHERE merged_into_place_id IS NULL
      AND parent_place_id IS NOT NULL
      AND formatted_address IS NOT NULL
  ) sub
  WHERE p.place_id = sub.place_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '   Re-extracted unit_identifiers for % places', v_count;
END $$;

-- ============================================================================
-- STEP 3: Reclassify mistyped apartment_building → apartment_unit (176 places)
-- ============================================================================
-- These have place_kind = 'apartment_building' but their address contains a unit
-- number (e.g., "1000 Bellevue Ave Apartment 2019"). They should be apartment_unit.

\echo '3. Reclassifying mistyped apartment_building → apartment_unit...'

DO $$
DECLARE
  v_count INT;
BEGIN
  UPDATE sot.places
  SET place_kind = 'apartment_unit',
      updated_at = NOW()
  WHERE merged_into_place_id IS NULL
    AND place_kind = 'apartment_building'
    AND formatted_address ~* '(?:apt|apartment|unit|suite|ste|space|#)\s*\.?\s*\d';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '   Reclassified % places from apartment_building to apartment_unit', v_count;
END $$;

-- ============================================================================
-- STEP 4: Auto-merge Tier 4 exact duplicates (6 pairs)
-- ============================================================================
-- These have identical normalized_address or same sot_address_id.
-- Safe to auto-merge — they are definite duplicates.

\echo '4. Auto-merging Tier 4 exact duplicates...'

DO $$
DECLARE
  r RECORD;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT canonical_place_id, duplicate_place_id
    FROM sot.place_dedup_candidates
    WHERE status = 'pending' AND match_tier = 4
  LOOP
    BEGIN
      PERFORM sot.merge_place_into(
        r.duplicate_place_id, r.canonical_place_id,
        'Auto-merge: Tier 4 exact normalized_address match', 'MIG_2875'
      );

      UPDATE sot.place_dedup_candidates
      SET status = 'merged', resolved_at = NOW(), resolved_by = 'MIG_2875'
      WHERE canonical_place_id = r.canonical_place_id
        AND duplicate_place_id = r.duplicate_place_id;

      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to merge % into %: %', r.duplicate_place_id, r.canonical_place_id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE '   Auto-merged % Tier 4 duplicate pairs', v_count;
END $$;

-- ============================================================================
-- STEP 5: Backfill apartment hierarchy (orphans + newly reclassified)
-- ============================================================================
-- Runs backfill_apartment_hierarchy() to link orphan apartment_unit places
-- to their parent buildings. Handles both the 10 original orphans and the
-- ~176 newly reclassified units from Step 3.

\echo '5. Running backfill_apartment_hierarchy()...'

SELECT * FROM sot.backfill_apartment_hierarchy(FALSE);

COMMIT;

-- ============================================================================
-- STEP 5b: Reclassify remaining orphan apartment_units without unit patterns
-- ============================================================================
-- Some places are classified as apartment_unit but have no extractable unit
-- pattern (no keyword prefix, or bare letter suffix like "a", "b").
-- Reclassify to single_family since they're standalone records.

\echo '5b. Reclassifying orphan apartment_units without unit patterns...'

DO $$
DECLARE
  v_count INT;
BEGIN
  WITH orphans AS (
    SELECT p.place_id,
           (sot.extract_unit_from_address(p.formatted_address)).unit AS extracted_unit
    FROM sot.places p
    WHERE p.place_kind = 'apartment_unit'
      AND p.parent_place_id IS NULL
      AND p.merged_into_place_id IS NULL
  )
  UPDATE sot.places p
  SET place_kind = 'single_family',
      unit_identifier = NULL,
      updated_at = NOW()
  FROM orphans o
  WHERE p.place_id = o.place_id
    AND o.extracted_unit IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '   Reclassified % orphan apartment_units to single_family', v_count;
END $$;

-- ============================================================================
-- STEP 6: Refresh dedup candidates after all fixes (Tiers 1, 2, 4)
-- ============================================================================
-- Re-runs the dedup candidate generation. Many Tier 1 building/unit pairs
-- should now be resolved (they became parent-child in Step 5).
-- NOTE: Runs OUTSIDE transaction — Steps 1-5 are already committed.
-- Tier 3 (full N² similarity scan) is skipped as it exceeds Supabase's
-- statement timeout. Run Tier 3 via direct DB connection if needed.

\echo '6. Refreshing place dedup candidates (Tiers 1, 2, 4)...'

DELETE FROM sot.place_dedup_candidates WHERE status = 'pending';

-- Tier 1: Within 50m + address similarity >= 0.6
INSERT INTO sot.place_dedup_candidates (
  canonical_place_id, duplicate_place_id, match_tier,
  address_similarity, distance_meters,
  canonical_address, canonical_name, canonical_kind,
  duplicate_address, duplicate_name, duplicate_kind
)
SELECT
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.place_id ELSE b.place_id END,
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.place_id ELSE a.place_id END,
  1,
  ROUND(similarity(a.normalized_address, b.normalized_address)::numeric, 3),
  ROUND(ST_Distance(a.location::geography, b.location::geography)::numeric, 1),
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.formatted_address ELSE b.formatted_address END,
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.display_name ELSE b.display_name END,
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.place_kind::text ELSE b.place_kind::text END,
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.formatted_address ELSE a.formatted_address END,
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.display_name ELSE a.display_name END,
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.place_kind::text ELSE a.place_kind::text END
FROM sot.places a
JOIN sot.places b ON a.place_id < b.place_id AND ST_DWithin(a.location::geography, b.location::geography, 50) AND similarity(a.normalized_address, b.normalized_address) >= 0.6
WHERE a.merged_into_place_id IS NULL AND b.merged_into_place_id IS NULL
  AND a.location IS NOT NULL AND b.location IS NOT NULL
  AND a.normalized_address IS NOT NULL AND b.normalized_address IS NOT NULL
  AND a.parent_place_id IS DISTINCT FROM b.place_id
  AND b.parent_place_id IS DISTINCT FROM a.place_id
  AND NOT EXISTS (SELECT 1 FROM sot.place_dedup_candidates existing WHERE existing.status != 'pending' AND ((existing.canonical_place_id = a.place_id AND existing.duplicate_place_id = b.place_id) OR (existing.canonical_place_id = b.place_id AND existing.duplicate_place_id = a.place_id)))
ON CONFLICT (canonical_place_id, duplicate_place_id) DO NOTHING;

-- Tier 2: Within 50m + address similarity < 0.6
INSERT INTO sot.place_dedup_candidates (
  canonical_place_id, duplicate_place_id, match_tier,
  address_similarity, distance_meters,
  canonical_address, canonical_name, canonical_kind,
  duplicate_address, duplicate_name, duplicate_kind
)
SELECT
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.place_id ELSE b.place_id END,
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.place_id ELSE a.place_id END,
  2,
  ROUND(similarity(a.normalized_address, b.normalized_address)::numeric, 3),
  ROUND(ST_Distance(a.location::geography, b.location::geography)::numeric, 1),
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.formatted_address ELSE b.formatted_address END,
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.display_name ELSE b.display_name END,
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.place_kind::text ELSE b.place_kind::text END,
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.formatted_address ELSE a.formatted_address END,
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.display_name ELSE a.display_name END,
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.place_kind::text ELSE a.place_kind::text END
FROM sot.places a
JOIN sot.places b ON a.place_id < b.place_id AND ST_DWithin(a.location::geography, b.location::geography, 50) AND similarity(a.normalized_address, b.normalized_address) < 0.6
WHERE a.merged_into_place_id IS NULL AND b.merged_into_place_id IS NULL
  AND a.location IS NOT NULL AND b.location IS NOT NULL
  AND a.normalized_address IS NOT NULL AND b.normalized_address IS NOT NULL
  AND a.parent_place_id IS DISTINCT FROM b.place_id
  AND b.parent_place_id IS DISTINCT FROM a.place_id
  AND NOT EXISTS (SELECT 1 FROM sot.place_dedup_candidates existing WHERE existing.status != 'pending' AND ((existing.canonical_place_id = a.place_id AND existing.duplicate_place_id = b.place_id) OR (existing.canonical_place_id = b.place_id AND existing.duplicate_place_id = a.place_id)))
ON CONFLICT (canonical_place_id, duplicate_place_id) DO NOTHING;

-- Tier 4: Exact normalized_address match OR same sot_address_id
INSERT INTO sot.place_dedup_candidates (
  canonical_place_id, duplicate_place_id, match_tier,
  address_similarity, distance_meters,
  canonical_address, canonical_name, canonical_kind,
  duplicate_address, duplicate_name, duplicate_kind
)
SELECT
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.place_id ELSE b.place_id END,
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.place_id ELSE a.place_id END,
  4,
  ROUND(similarity(COALESCE(a.normalized_address, ''), COALESCE(b.normalized_address, ''))::numeric, 3),
  CASE WHEN a.location IS NOT NULL AND b.location IS NOT NULL THEN ROUND(ST_Distance(a.location::geography, b.location::geography)::numeric, 1) ELSE NULL END,
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.formatted_address ELSE b.formatted_address END,
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.display_name ELSE b.display_name END,
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.place_kind::text ELSE b.place_kind::text END,
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.formatted_address ELSE a.formatted_address END,
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.display_name ELSE a.display_name END,
  CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.place_kind::text ELSE a.place_kind::text END
FROM sot.places a
JOIN sot.places b ON a.place_id < b.place_id AND (a.normalized_address = b.normalized_address OR (a.sot_address_id = b.sot_address_id AND a.sot_address_id IS NOT NULL))
WHERE a.merged_into_place_id IS NULL AND b.merged_into_place_id IS NULL
  AND a.parent_place_id IS DISTINCT FROM b.place_id
  AND b.parent_place_id IS DISTINCT FROM a.place_id
  AND NOT EXISTS (SELECT 1 FROM sot.place_dedup_candidates existing WHERE existing.status != 'pending' AND ((existing.canonical_place_id = a.place_id AND existing.duplicate_place_id = b.place_id) OR (existing.canonical_place_id = b.place_id AND existing.duplicate_place_id = a.place_id)))
ON CONFLICT (canonical_place_id, duplicate_place_id) DO NOTHING;

-- Auto-merge any new Tier 4 exact duplicates
DO $$
DECLARE
  r RECORD;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT canonical_place_id, duplicate_place_id
    FROM sot.place_dedup_candidates
    WHERE status = 'pending' AND match_tier = 4
  LOOP
    BEGIN
      PERFORM sot.merge_place_into(
        r.duplicate_place_id, r.canonical_place_id,
        'Auto-merge: Tier 4 exact normalized_address match', 'MIG_2875'
      );
      UPDATE sot.place_dedup_candidates
      SET status = 'merged', resolved_at = NOW(), resolved_by = 'MIG_2875'
      WHERE canonical_place_id = r.canonical_place_id
        AND duplicate_place_id = r.duplicate_place_id;
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to merge % into %: %', r.duplicate_place_id, r.canonical_place_id, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE '   Auto-merged % new Tier 4 duplicate pairs', v_count;
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  Verification'
\echo '=============================================='

-- display_name = 'clinichq' should be 0
\echo 'Remaining clinichq display names (expect 0):'
SELECT COUNT(*) AS clinichq_display_names
FROM sot.places
WHERE merged_into_place_id IS NULL AND display_name = 'clinichq';

-- Orphan apartment units should be 0
\echo 'Orphan apartment units (expect 0):'
SELECT COUNT(*) AS orphan_apt_units
FROM sot.places
WHERE place_kind = 'apartment_unit'
  AND parent_place_id IS NULL
  AND merged_into_place_id IS NULL;

-- Pending dedup candidates (should be lower)
\echo 'Remaining pending dedup candidates by tier:'
SELECT match_tier, COUNT(*) AS pending_count
FROM sot.place_dedup_candidates
WHERE status = 'pending'
GROUP BY match_tier
ORDER BY match_tier;

-- Sample of re-extracted unit_identifiers
\echo 'Sample unit_identifiers (spot check):'
SELECT formatted_address, unit_identifier, place_kind
FROM sot.places
WHERE parent_place_id IS NOT NULL
  AND merged_into_place_id IS NULL
  AND unit_identifier IS NOT NULL
ORDER BY random()
LIMIT 10;

\echo ''
\echo '=============================================='
\echo '  MIG_2875 Complete'
\echo '=============================================='
\echo ''
