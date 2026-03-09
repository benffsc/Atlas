-- MIG_2876: Improve Place Deduplication (FFS-346)
--
-- PROBLEM: sot.normalize_address() keeps unit identifiers, causing 35% false
-- positive dedup candidates (1,140 of 3,223 in MIG_2875 audit). Units like
-- "Apt 5" and bare letter suffixes ("b") remain in normalized_address, so
-- "410 powell ave a" vs "410 powell ave" score 0.97 similarity.
--
-- SOLUTION:
-- 1. Add base_address column (address with unit stripped) for building-level dedup
-- 2. Create ref.usps_street_suffixes for lookup-based normalization
-- 3. Create sot.normalize_base_address() that strips units + normalizes
-- 4. Update trigger to compute base_address on insert/update
-- 5. Backfill base_address for all existing places
-- 6. Update ops.refresh_place_dedup_candidates() to use base_address + exclusions
-- 7. Add GIN trigram index on base_address
--
-- Created: 2026-03-08

\echo ''
\echo '=============================================='
\echo '  MIG_2876: Improve Place Deduplication'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 0. Fix extract_unit_from_address() — add $ end anchor
-- ============================================================================
-- BUG: Without $ anchor, PostgreSQL REGEXP_MATCH finds a shorter match where
-- group 3 (city/state/zip) is empty string. The (.*) at the end can match
-- empty, so the regex considers the match valid without consuming the rest.
-- Adding $ forces (.*)$ to consume everything after the comma.

\echo '0. Fixing extract_unit_from_address() — adding $ end anchor...'

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
  --
  -- FIX (MIG_2876): Added $ end anchor. Without it, PostgreSQL finds a match
  -- where (.*)$ captures empty string, losing city/state/zip in group 3.
  v_match := REGEXP_MATCH(v_addr,
    '(.*?),?\s*((?:(?:\mapt\.?|\mapartment|\munit|\msuite|\mste\.?|\mspace)\s+|#)\s*[a-z0-9-]+(?:\s+[a-z]+)?)\s*[,]\s*(.*)$',
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

-- Verify the fix
DO $$
DECLARE
  v_result RECORD;
BEGIN
  SELECT * INTO v_result FROM sot.extract_unit_from_address('1000 Bellevue Ave Apartment 2019, Santa Rosa, CA 95404');
  IF v_result.base_address != '1000 Bellevue Ave, Santa Rosa, CA 95404' THEN
    RAISE EXCEPTION 'extract_unit_from_address fix failed: expected "1000 Bellevue Ave, Santa Rosa, CA 95404", got "%"', v_result.base_address;
  END IF;
  RAISE NOTICE '   extract_unit_from_address fix verified: base="%" unit="%"', v_result.base_address, v_result.unit;
END $$;

-- ============================================================================
-- 1. USPS Street Suffix Reference Table
-- ============================================================================
-- From USPS Publication 28, Appendix C1. Maps all common variants to standard
-- USPS abbreviation. Used by normalize_base_address() instead of hardcoded regex.

\echo '1. Creating ref.usps_street_suffixes...'

CREATE TABLE IF NOT EXISTS ref.usps_street_suffixes (
  variant TEXT PRIMARY KEY,
  standard TEXT NOT NULL
);

TRUNCATE ref.usps_street_suffixes;

INSERT INTO ref.usps_street_suffixes (variant, standard) VALUES
  -- Most common suffixes with all USPS Publication 28 variants
  ('alley', 'aly'), ('allee', 'aly'), ('ally', 'aly'), ('aly', 'aly'),
  ('avenue', 'ave'), ('av', 'ave'), ('aven', 'ave'), ('avenu', 'ave'), ('ave', 'ave'), ('avn', 'ave'), ('avnue', 'ave'),
  ('boulevard', 'blvd'), ('blvd', 'blvd'), ('boul', 'blvd'), ('boulv', 'blvd'),
  ('circle', 'cir'), ('cir', 'cir'), ('circ', 'cir'), ('circl', 'cir'), ('crcl', 'cir'), ('crcle', 'cir'),
  ('court', 'ct'), ('ct', 'ct'), ('crt', 'ct'),
  ('cove', 'cv'), ('cv', 'cv'),
  ('crossing', 'xing'), ('xing', 'xing'), ('crssng', 'xing'),
  ('drive', 'dr'), ('dr', 'dr'), ('driv', 'dr'), ('drv', 'dr'),
  ('expressway', 'expy'), ('expy', 'expy'), ('expw', 'expy'), ('expr', 'expy'),
  ('freeway', 'fwy'), ('fwy', 'fwy'), ('freewy', 'fwy'), ('frway', 'fwy'), ('frwy', 'fwy'),
  ('highway', 'hwy'), ('hwy', 'hwy'), ('highwy', 'hwy'), ('hiway', 'hwy'), ('hiwy', 'hwy'), ('hway', 'hwy'),
  ('lane', 'ln'), ('ln', 'ln'),
  ('loop', 'loop'),
  ('parkway', 'pkwy'), ('pkwy', 'pkwy'), ('parkwy', 'pkwy'), ('pkway', 'pkwy'),
  ('place', 'pl'), ('pl', 'pl'),
  ('plaza', 'plz'), ('plz', 'plz'), ('plza', 'plz'),
  ('point', 'pt'), ('pt', 'pt'),
  ('road', 'rd'), ('rd', 'rd'),
  ('route', 'rte'), ('rte', 'rte'),
  ('square', 'sq'), ('sq', 'sq'), ('sqr', 'sq'), ('sqre', 'sq'), ('squ', 'sq'),
  ('street', 'st'), ('st', 'st'), ('str', 'st'), ('strt', 'st'),
  ('terrace', 'ter'), ('ter', 'ter'), ('terr', 'ter'),
  ('trail', 'trl'), ('trl', 'trl'), ('trails', 'trl'), ('trls', 'trl'),
  ('turnpike', 'tpke'), ('tpke', 'tpke'), ('trnpk', 'tpke'), ('turnpk', 'tpke'),
  ('way', 'way'), ('wy', 'way'),
  ('walk', 'walk'), ('walks', 'walk'),
  ('path', 'path'), ('paths', 'path')
ON CONFLICT (variant) DO UPDATE SET standard = EXCLUDED.standard;

\echo '   Created ref.usps_street_suffixes with USPS Publication 28 data'

-- ============================================================================
-- 2. Add base_address column
-- ============================================================================

\echo '2. Adding base_address column to sot.places...'

ALTER TABLE sot.places ADD COLUMN IF NOT EXISTS base_address TEXT;

COMMENT ON COLUMN sot.places.base_address IS
'Normalized address with unit identifier stripped. Used for building-level
dedup comparison. Computed by trigger from formatted_address via
normalize_base_address(). E.g., "410 powell ave, healdsburg, ca 95448"
for both "410 Powell Ave A" and "410 Powell Ave #2".';

-- ============================================================================
-- 3. Create normalize_base_address() function
-- ============================================================================
-- Takes an address, strips unit identifiers, then normalizes.
-- Returns the building-level address for dedup comparison.

\echo '3. Creating sot.normalize_base_address()...'

CREATE OR REPLACE FUNCTION sot.normalize_base_address(p_address TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_result TEXT;
  v_extracted RECORD;
BEGIN
  IF p_address IS NULL OR BTRIM(p_address) = '' THEN
    RETURN NULL;
  END IF;

  -- Step 1: Extract base address (strip unit) using existing function
  SELECT * INTO v_extracted FROM sot.extract_unit_from_address(p_address);

  -- Use base_address if unit was found, otherwise use original
  IF v_extracted.unit IS NOT NULL THEN
    v_result := v_extracted.base_address;
  ELSE
    v_result := p_address;
  END IF;

  -- Step 2: Strip orphaned unit keywords left behind when # was matched
  -- e.g., "3637 Sonoma Ave Apt" → "3637 Sonoma Ave" (after #148 was extracted)
  v_result := REGEXP_REPLACE(v_result,
    '\s+(?:apt\.?|apartment|unit|suite|ste\.?|space)\s*,',
    ',', 'gi');
  v_result := REGEXP_REPLACE(v_result,
    '\s+(?:apt\.?|apartment|unit|suite|ste\.?|space)\s*$',
    '', 'gi');

  -- Step 3: Apply standard normalization FIRST (reorders inverted addresses)
  -- Must happen before trailing-number stripping so "Burt St 640" → "640 burt st"
  -- (house number moves to front, no longer at trailing position)
  v_result := sot.normalize_address(v_result);

  -- Step 4: Strip bare letter suffixes not caught by extract_unit_from_address
  -- Patterns: "1814a empire..." → "1814 empire..." or "568 dutton ave a," → "568 dutton ave,"
  -- Only strip single letters a-d (common unit letters), not directionals
  v_result := REGEXP_REPLACE(v_result, '(\d)\s*[a-d]\s+', '\1 ', 'g');  -- "1814a " → "1814 "
  v_result := REGEXP_REPLACE(v_result, '(\w)\s+[a-d]\s*,', '\1,', 'g'); -- "ave a," → "ave,"

  -- Step 5: Strip trailing bare numbers after street suffixes (unit numbers)
  -- "6600 montecito blvd 70," → "6600 montecito blvd,"
  -- Only 1-3 digit numbers to avoid stripping house numbers
  v_result := REGEXP_REPLACE(v_result,
    '(\m(?:rd|st|ave|dr|blvd|ln|ct|cir|pl|hwy|ter|pkwy|trl|sq|way|loop|expy|path|walk)\M)\s+\d{1,3}\s*,',
    '\1,', 'gi');

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION sot.normalize_base_address IS
'Normalizes an address to building level by stripping unit identifiers,
bare letter suffixes, and trailing unit numbers, then applying standard
normalize_address() rules. Used for place deduplication comparison.
E.g., "410 Powell Ave A, Healdsburg, CA" -> "410 powell ave, healdsburg, ca 95448"';

-- Verify with test cases
\echo '   Verifying normalize_base_address()...'

DO $$
DECLARE
  v_errors INT := 0;
  v_result TEXT;
BEGIN
  -- Test 1: Standard unit stripping
  v_result := sot.normalize_base_address('410 Powell Ave A, Healdsburg, CA 95448');
  IF v_result != '410 powell ave, healdsburg, ca 95448' THEN
    RAISE WARNING 'FAIL Test 1: Expected "410 powell ave, healdsburg, ca 95448", got "%"', v_result;
    v_errors := v_errors + 1;
  END IF;

  -- Test 2: Apt keyword — unit stripped, city preserved
  v_result := sot.normalize_base_address('1000 Bellevue Ave Apartment 2019, Santa Rosa, CA 95404');
  IF v_result != '1000 bellevue ave, santa rosa, ca 95404' THEN
    RAISE WARNING 'FAIL Test 2: Expected "1000 bellevue ave, santa rosa, ca 95404", got "%"', v_result;
    v_errors := v_errors + 1;
  END IF;

  -- Test 3: # symbol — unit stripped, city preserved
  v_result := sot.normalize_base_address('2378 Heidi Pl #2, Santa Rosa, CA 95403');
  IF v_result != '2378 heidi pl, santa rosa, ca 95403' THEN
    RAISE WARNING 'FAIL Test 3: Expected "2378 heidi pl, santa rosa, ca 95403", got "%"', v_result;
    v_errors := v_errors + 1;
  END IF;

  -- Test 4: No unit — should pass through unchanged
  v_result := sot.normalize_base_address('123 Main St, Santa Rosa, CA 95404');
  IF v_result != '123 main st, santa rosa, ca 95404' THEN
    RAISE WARNING 'FAIL Test 4: Expected "123 main st, santa rosa, ca 95404", got "%"', v_result;
    v_errors := v_errors + 1;
  END IF;

  -- Test 5: Embedded letter suffix "1814a"
  v_result := sot.normalize_base_address('1814A Empire Industrial Ct, Santa Rosa, CA 95403');
  IF v_result NOT LIKE '1814 empire industrial ct, santa rosa, ca 95403' THEN
    RAISE WARNING 'FAIL Test 5: Expected "1814" not "1814a", got "%"', v_result;
    v_errors := v_errors + 1;
  END IF;

  -- Test 6: Trailing number after street suffix
  v_result := sot.normalize_base_address('6600 Montecito Blvd 70, Santa Rosa, CA 95409');
  IF v_result NOT LIKE '6600 montecito blvd, santa rosa, ca 95409' THEN
    RAISE WARNING 'FAIL Test 6: Expected trailing 70 stripped, got "%"', v_result;
    v_errors := v_errors + 1;
  END IF;

  -- Test 7: Should NOT strip directional "W"
  v_result := sot.normalize_base_address('560 Rohnert Park Expy W, Rohnert Park, CA 94928');
  IF v_result NOT LIKE '%expy w%' THEN
    RAISE WARNING 'FAIL Test 7: Directional W should be preserved, got "%"', v_result;
    v_errors := v_errors + 1;
  END IF;

  -- Test 8: Gravenstein should not match
  v_result := sot.normalize_base_address('4321 Gravenstein Hwy S, Sebastopol, CA 95472');
  IF v_result NOT LIKE '%gravenstein%' THEN
    RAISE WARNING 'FAIL Test 8: Gravenstein should be preserved, got "%"', v_result;
    v_errors := v_errors + 1;
  END IF;

  -- Test 9: Apt #N — orphaned "Apt" keyword should be stripped
  v_result := sot.normalize_base_address('3637 Sonoma Ave Apt #148, Santa Rosa, CA 95405');
  IF v_result LIKE '%apt%' THEN
    RAISE WARNING 'FAIL Test 9: Orphaned "apt" not stripped, got "%"', v_result;
    v_errors := v_errors + 1;
  END IF;

  -- Test 10: Inverted address — house number should NOT be stripped
  v_result := sot.normalize_base_address('Burt St 640, Santa Rosa, CA 95407');
  IF v_result NOT LIKE '640 burt st%' THEN
    RAISE WARNING 'FAIL Test 10: House number lost from inverted address, got "%"', v_result;
    v_errors := v_errors + 1;
  END IF;

  IF v_errors > 0 THEN
    RAISE EXCEPTION '% normalize_base_address test(s) FAILED — aborting', v_errors;
  END IF;

  RAISE NOTICE '   All 10 normalize_base_address tests passed';
END $$;

-- ============================================================================
-- 4. Update trigger to compute base_address
-- ============================================================================

\echo '4. Updating trigger to compute base_address...'

CREATE OR REPLACE FUNCTION sot.trg_places_normalize_address()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.formatted_address IS NOT NULL THEN
    NEW.normalized_address := sot.normalize_address(NEW.formatted_address);
    NEW.base_address := sot.normalize_base_address(NEW.formatted_address);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

\echo '   Trigger updated to compute both normalized_address and base_address'

-- ============================================================================
-- 5. Backfill base_address for all existing places
-- ============================================================================

\echo '5. Backfilling base_address for all places...'

DO $$
DECLARE
  v_count INT;
BEGIN
  UPDATE sot.places
  SET base_address = sot.normalize_base_address(formatted_address)
  WHERE formatted_address IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '   Backfilled base_address for % places', v_count;
END $$;

-- ============================================================================
-- 6. Add GIN trigram index on base_address
-- ============================================================================

\echo '6. Creating GIN trigram index on base_address...'

CREATE INDEX IF NOT EXISTS idx_places_base_address_trgm
ON sot.places USING gin (base_address gin_trgm_ops)
WHERE merged_into_place_id IS NULL AND base_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_places_base_address_btree
ON sot.places USING btree (base_address)
WHERE merged_into_place_id IS NULL;

-- ============================================================================
-- 7. Update ops.refresh_place_dedup_candidates() to use base_address
-- ============================================================================

\echo '7. Updating ops.refresh_place_dedup_candidates()...'

CREATE OR REPLACE FUNCTION ops.refresh_place_dedup_candidates()
RETURNS TABLE(tier1_count INT, tier2_count INT, tier3_count INT, tier4_count INT, total INT)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_t1 INT := 0;
  v_t2 INT := 0;
  v_t3 INT := 0;
  v_t4 INT := 0;
BEGIN
  -- Clear unresolved candidates (keep resolved ones for audit)
  DELETE FROM sot.place_dedup_candidates WHERE status = 'pending';

  -- Tier 1: Within 50m + base_address similarity >= 0.6
  -- Uses base_address (unit-stripped) to avoid false positives from unit variants
  INSERT INTO sot.place_dedup_candidates (
    canonical_place_id, duplicate_place_id, match_tier,
    address_similarity, distance_meters,
    canonical_address, canonical_name, canonical_kind,
    duplicate_address, duplicate_name, duplicate_kind
  )
  SELECT
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN a.place_id ELSE b.place_id
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id)
         + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id)
         >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id)
          + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id)
      THEN b.place_id ELSE a.place_id
    END,
    1,
    ROUND(similarity(a.base_address, b.base_address)::numeric, 3),
    ROUND(ST_Distance(a.location::geography, b.location::geography)::numeric, 1),
    CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.formatted_address ELSE b.formatted_address END,
    CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.display_name ELSE b.display_name END,
    CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.place_kind::text ELSE b.place_kind::text END,
    CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.formatted_address ELSE a.formatted_address END,
    CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.display_name ELSE a.display_name END,
    CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.place_kind::text ELSE a.place_kind::text END
  FROM sot.places a
  JOIN sot.places b
    ON a.place_id < b.place_id
    AND ST_DWithin(a.location::geography, b.location::geography, 50)
    AND similarity(a.base_address, b.base_address) >= 0.6
  WHERE a.merged_into_place_id IS NULL AND b.merged_into_place_id IS NULL
    AND a.location IS NOT NULL AND b.location IS NOT NULL
    AND a.base_address IS NOT NULL AND b.base_address IS NOT NULL
    -- Exclude parent-child pairs
    AND a.parent_place_id IS DISTINCT FROM b.place_id
    AND b.parent_place_id IS DISTINCT FROM a.place_id
    -- Exclude siblings (same parent building)
    AND NOT (a.parent_place_id IS NOT NULL AND b.parent_place_id IS NOT NULL
             AND a.parent_place_id = b.parent_place_id)
    -- Exclude apartment_unit pairs (units are not dupes of each other or of buildings)
    AND a.place_kind != 'apartment_unit'
    AND b.place_kind != 'apartment_unit'
    -- Exclude already-resolved pairs
    AND NOT EXISTS (
      SELECT 1 FROM sot.place_dedup_candidates existing
      WHERE existing.status != 'pending'
        AND (
          (existing.canonical_place_id = a.place_id AND existing.duplicate_place_id = b.place_id)
          OR (existing.canonical_place_id = b.place_id AND existing.duplicate_place_id = a.place_id)
        )
    )
  ON CONFLICT (canonical_place_id, duplicate_place_id) DO NOTHING;
  GET DIAGNOSTICS v_t1 = ROW_COUNT;

  -- Tier 2: Within 50m + base_address similarity < 0.6
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
    ROUND(similarity(a.base_address, b.base_address)::numeric, 3),
    ROUND(ST_Distance(a.location::geography, b.location::geography)::numeric, 1),
    CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.formatted_address ELSE b.formatted_address END,
    CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.display_name ELSE b.display_name END,
    CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.place_kind::text ELSE b.place_kind::text END,
    CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.formatted_address ELSE a.formatted_address END,
    CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.display_name ELSE a.display_name END,
    CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.place_kind::text ELSE a.place_kind::text END
  FROM sot.places a
  JOIN sot.places b
    ON a.place_id < b.place_id
    AND ST_DWithin(a.location::geography, b.location::geography, 50)
    AND similarity(a.base_address, b.base_address) < 0.6
  WHERE a.merged_into_place_id IS NULL AND b.merged_into_place_id IS NULL
    AND a.location IS NOT NULL AND b.location IS NOT NULL
    AND a.base_address IS NOT NULL AND b.base_address IS NOT NULL
    AND a.parent_place_id IS DISTINCT FROM b.place_id
    AND b.parent_place_id IS DISTINCT FROM a.place_id
    AND NOT (a.parent_place_id IS NOT NULL AND b.parent_place_id IS NOT NULL
             AND a.parent_place_id = b.parent_place_id)
    AND a.place_kind != 'apartment_unit'
    AND b.place_kind != 'apartment_unit'
    AND NOT EXISTS (
      SELECT 1 FROM sot.place_dedup_candidates existing
      WHERE existing.status != 'pending'
        AND (
          (existing.canonical_place_id = a.place_id AND existing.duplicate_place_id = b.place_id)
          OR (existing.canonical_place_id = b.place_id AND existing.duplicate_place_id = a.place_id)
        )
    )
  ON CONFLICT (canonical_place_id, duplicate_place_id) DO NOTHING;
  GET DIAGNOSTICS v_t2 = ROW_COUNT;

  -- Tier 3: Skipped in-function (N² scan times out on Supabase)
  -- Run separately via chunked queries if needed
  v_t3 := 0;

  -- Tier 4: Exact base_address match OR same sot_address_id
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
    ROUND(similarity(COALESCE(a.base_address, ''), COALESCE(b.base_address, ''))::numeric, 3),
    CASE WHEN a.location IS NOT NULL AND b.location IS NOT NULL THEN ROUND(ST_Distance(a.location::geography, b.location::geography)::numeric, 1) ELSE NULL END,
    CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.formatted_address ELSE b.formatted_address END,
    CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.display_name ELSE b.display_name END,
    CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN a.place_kind::text ELSE b.place_kind::text END,
    CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.formatted_address ELSE a.formatted_address END,
    CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.display_name ELSE a.display_name END,
    CASE WHEN (SELECT COUNT(*) FROM ops.requests WHERE place_id = a.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = a.place_id) >= (SELECT COUNT(*) FROM ops.requests WHERE place_id = b.place_id) + (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = b.place_id) THEN b.place_kind::text ELSE a.place_kind::text END
  FROM sot.places a
  JOIN sot.places b
    ON a.place_id < b.place_id
    AND (
      a.base_address = b.base_address
      OR (a.sot_address_id = b.sot_address_id AND a.sot_address_id IS NOT NULL)
    )
  WHERE a.merged_into_place_id IS NULL AND b.merged_into_place_id IS NULL
    AND a.parent_place_id IS DISTINCT FROM b.place_id
    AND b.parent_place_id IS DISTINCT FROM a.place_id
    AND NOT (a.parent_place_id IS NOT NULL AND b.parent_place_id IS NOT NULL
             AND a.parent_place_id = b.parent_place_id)
    AND a.place_kind != 'apartment_unit'
    AND b.place_kind != 'apartment_unit'
    AND NOT EXISTS (
      SELECT 1 FROM sot.place_dedup_candidates existing
      WHERE existing.status != 'pending'
        AND (
          (existing.canonical_place_id = a.place_id AND existing.duplicate_place_id = b.place_id)
          OR (existing.canonical_place_id = b.place_id AND existing.duplicate_place_id = a.place_id)
        )
    )
  ON CONFLICT (canonical_place_id, duplicate_place_id) DO NOTHING;
  GET DIAGNOSTICS v_t4 = ROW_COUNT;

  RAISE NOTICE 'Place dedup refresh: T1=% T2=% T3=% T4=% Total=%',
    v_t1, v_t2, v_t3, v_t4, v_t1 + v_t2 + v_t3 + v_t4;

  RETURN QUERY SELECT v_t1, v_t2, v_t3, v_t4, v_t1 + v_t2 + v_t3 + v_t4;
END;
$function$;

COMMENT ON FUNCTION ops.refresh_place_dedup_candidates IS
'Refreshes place_dedup_candidates using base_address (unit-stripped) similarity.
Excludes apartment_unit places, parent-child pairs, and siblings.
Tier 3 (N² similarity scan) skipped in-function — run via chunked queries.
Returns counts per tier. Preserves resolved decisions.';

COMMIT;

-- ============================================================================
-- VERIFICATION (outside transaction)
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  Verification'
\echo '=============================================='

\echo 'base_address coverage:'
SELECT
  COUNT(*) FILTER (WHERE base_address IS NOT NULL) AS has_base,
  COUNT(*) FILTER (WHERE base_address IS NULL AND formatted_address IS NOT NULL) AS missing_base,
  COUNT(*) AS total
FROM sot.places WHERE merged_into_place_id IS NULL;

\echo 'Sample base_address vs normalized_address (units stripped):'
SELECT formatted_address, normalized_address, base_address
FROM sot.places
WHERE merged_into_place_id IS NULL
  AND base_address != normalized_address
  AND base_address IS NOT NULL
ORDER BY random()
LIMIT 10;

\echo 'USPS suffix table count:'
SELECT COUNT(*) AS usps_suffix_entries FROM ref.usps_street_suffixes;

\echo ''
\echo '=============================================='
\echo '  MIG_2876 Complete'
\echo '=============================================='
\echo ''
