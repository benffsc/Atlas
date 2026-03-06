-- MIG_2824: Backfill Apartment Hierarchy (FFS-165)
--
-- PROBLEM: 377 apartment_unit places have parent_place_id = NULL.
--          385/395 Liberty Rd (~33m apart) are not linked as same property.
--
-- SOLUTION:
-- 1. Port extract_unit_from_address() from V1 MIG_190 to sot schema
-- 2. Port find_or_create_parent_building() adapted for V2 schema
-- 3. Backfill apartment hierarchy for orphaned units
-- 4. Merge 385/395 Liberty Rd via merge_place_into()
--
-- Created: 2026-03-05

\echo ''
\echo '=============================================='
\echo '  MIG_2824: Backfill Apartment Hierarchy'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. PORT extract_unit_from_address() TO SOT SCHEMA
-- ============================================================================

\echo '1. Creating sot.extract_unit_from_address()...'

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

  -- Try to extract unit patterns (case insensitive)
  -- Pattern: "123 Main St Apt 5" or "123 Main St, Apt 5" or "123 Main St #5"
  -- Require text keywords to be at word boundary (\m) AND followed by whitespace.
  -- This prevents matching "Steele", "Western", "Gravenstein", "Este Madera" etc.
  -- The # symbol can be immediately followed by the unit number (e.g., "#5").
  v_match := REGEXP_MATCH(v_addr,
    '(.*?),?\s*((?:(?:\mapt\.?|\mapartment|\munit|\msuite|\mste\.?|\mspace)\s+|#)\s*[a-z0-9-]+)\s*,?\s*(.*)',
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

COMMENT ON FUNCTION sot.extract_unit_from_address IS
'Extracts unit designations from formatted addresses.
Handles: Apt, Apartment, Unit, Suite, Ste, Space, #
Returns (base_address, unit) — unit is NULL if no unit found.
Ported from V1 trapper.extract_unit_from_address() (MIG_190).';

\echo '   Created sot.extract_unit_from_address()'

-- ============================================================================
-- 2. PORT find_or_create_parent_building() ADAPTED FOR V2
-- ============================================================================

\echo ''
\echo '2. Creating sot.find_or_create_parent_building()...'

CREATE OR REPLACE FUNCTION sot.find_or_create_parent_building(
  p_unit_place_id UUID,
  p_created_by TEXT DEFAULT 'system'
) RETURNS UUID AS $$
DECLARE
  v_unit_place RECORD;
  v_extracted RECORD;
  v_parent_id UUID;
  v_normalized_base TEXT;
BEGIN
  -- Get the unit place info
  SELECT p.place_id, p.formatted_address, p.display_name, p.location,
         a.latitude, a.longitude
  INTO v_unit_place
  FROM sot.places p
  LEFT JOIN sot.addresses a ON a.address_id = COALESCE(p.sot_address_id, p.address_id)
  WHERE p.place_id = p_unit_place_id;

  IF v_unit_place IS NULL THEN
    RETURN NULL;
  END IF;

  -- Extract base address and unit
  SELECT * INTO v_extracted
  FROM sot.extract_unit_from_address(v_unit_place.formatted_address);

  IF v_extracted.unit IS NULL THEN
    -- No unit in address, this isn't a unit place
    RETURN NULL;
  END IF;

  -- Normalize the base address for matching
  v_normalized_base := sot.normalize_address(v_extracted.base_address);

  -- Look for existing parent building using pre-computed normalized_address column
  SELECT p.place_id INTO v_parent_id
  FROM sot.places p
  WHERE p.normalized_address = v_normalized_base
    AND p.merged_into_place_id IS NULL
    AND (p.place_kind = 'apartment_building' OR p.unit_identifier IS NULL)
    AND p.place_id != p_unit_place_id
  ORDER BY
    CASE WHEN p.place_kind = 'apartment_building' THEN 0 ELSE 1 END,
    p.created_at ASC
  LIMIT 1;

  IF v_parent_id IS NOT NULL THEN
    -- Found existing building, update it to be apartment_building if not already
    UPDATE sot.places
    SET place_kind = 'apartment_building'
    WHERE place_id = v_parent_id
      AND place_kind NOT IN ('apartment_building', 'business', 'clinic');

    RETURN v_parent_id;
  END IF;

  -- No existing building found, create one
  INSERT INTO sot.places (
    display_name,
    formatted_address,
    location,
    place_kind,
    place_origin,
    source_system
  ) VALUES (
    v_extracted.base_address,
    v_extracted.base_address,
    v_unit_place.location,
    'apartment_building',
    'auto_created_parent',
    'atlas_ui'
  )
  RETURNING place_id INTO v_parent_id;

  RETURN v_parent_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.find_or_create_parent_building IS
'Creates or finds a parent building for an apartment unit.
Strips unit suffix from address, normalizes, then searches for existing building.
If none found, creates a new apartment_building place.
Ported from V1 trapper.find_or_create_parent_building() (MIG_190), adapted for V2 schema.';

\echo '   Created sot.find_or_create_parent_building()'

-- ============================================================================
-- 3. CREATE BACKFILL FUNCTION
-- ============================================================================

\echo ''
\echo '3. Creating sot.backfill_apartment_hierarchy()...'

CREATE OR REPLACE FUNCTION sot.backfill_apartment_hierarchy(
  p_dry_run BOOLEAN DEFAULT TRUE
) RETURNS TABLE(
  units_found INT,
  parents_created INT,
  units_linked INT
) AS $$
DECLARE
  v_units_found INT := 0;
  v_parents_created INT := 0;
  v_units_linked INT := 0;
  v_place RECORD;
  v_extracted RECORD;
  v_parent_id UUID;
  v_parent_existed BOOLEAN;
BEGIN
  -- Find all places that look like they have units but aren't linked
  FOR v_place IN
    SELECT p.place_id, p.formatted_address, p.display_name, p.place_kind
    FROM sot.places p
    WHERE p.merged_into_place_id IS NULL
      AND p.parent_place_id IS NULL  -- Not already linked
      AND p.formatted_address IS NOT NULL
      AND p.formatted_address ~* '((?:\mapt\.?|\mapartment|\munit|\msuite|\mste\.?|\mspace)\s+|#\s*)[a-z0-9]'
  LOOP
    v_units_found := v_units_found + 1;

    -- Extract the unit
    SELECT * INTO v_extracted
    FROM sot.extract_unit_from_address(v_place.formatted_address);

    IF v_extracted.unit IS NULL THEN
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      RAISE NOTICE 'DRY RUN: Would link "%" (unit: %) to building "%"',
        v_place.display_name, v_extracted.unit, v_extracted.base_address;
      v_units_linked := v_units_linked + 1;
    ELSE
      -- Check if parent will be created (for counting)
      SELECT EXISTS (
        SELECT 1 FROM sot.places
        WHERE normalized_address = sot.normalize_address(v_extracted.base_address)
          AND merged_into_place_id IS NULL
          AND place_id != v_place.place_id
      ) INTO v_parent_existed;

      -- Find or create parent
      v_parent_id := sot.find_or_create_parent_building(v_place.place_id, 'MIG_2824');

      IF v_parent_id IS NOT NULL THEN
        -- Update the unit place
        UPDATE sot.places
        SET parent_place_id = v_parent_id,
            unit_identifier = v_extracted.unit,
            place_kind = CASE
              WHEN place_kind = 'unknown' THEN 'apartment_unit'
              ELSE place_kind
            END
        WHERE place_id = v_place.place_id;

        v_units_linked := v_units_linked + 1;

        IF NOT v_parent_existed THEN
          v_parents_created := v_parents_created + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_units_found, v_parents_created, v_units_linked;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.backfill_apartment_hierarchy IS
'Scans sot.places for unit-pattern addresses with parent_place_id IS NULL.
Calls find_or_create_parent_building() to link units to buildings.
Use p_dry_run = TRUE to preview changes before committing.';

\echo '   Created sot.backfill_apartment_hierarchy()'

-- ============================================================================
-- 4. MERGE 385/395 LIBERTY RD
-- ============================================================================

\echo ''
\echo '4. Merging 385/395 Liberty Rd...'

-- These are ~33m apart (won't auto-match by dedup) but are the same property.
-- 395 Liberty Rd (loser) → 385 Liberty Rd (winner)
-- Verify both places exist before merging
DO $$
DECLARE
  v_loser_exists BOOLEAN;
  v_winner_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM sot.places
    WHERE place_id = 'c7ade9a9-2260-4203-a3ac-830ecfc45196'
      AND merged_into_place_id IS NULL
  ) INTO v_loser_exists;

  SELECT EXISTS(
    SELECT 1 FROM sot.places
    WHERE place_id = 'a86acd37-800f-48ce-b864-b4ce3a60e7d8'
      AND merged_into_place_id IS NULL
  ) INTO v_winner_exists;

  IF v_loser_exists AND v_winner_exists THEN
    PERFORM sot.merge_place_into(
      'c7ade9a9-2260-4203-a3ac-830ecfc45196',  -- 395 Liberty Rd (loser)
      'a86acd37-800f-48ce-b864-b4ce3a60e7d8',  -- 385 Liberty Rd (winner)
      'same_property_cal_eggs',
      'MIG_2824'
    );
    RAISE NOTICE 'Merged 395 Liberty Rd → 385 Liberty Rd';
  ELSE
    RAISE NOTICE 'Skipping Liberty Rd merge: loser_exists=%, winner_exists=%',
      v_loser_exists, v_winner_exists;
  END IF;
END $$;

-- ============================================================================
-- 5. EXECUTE BACKFILL
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'DRY RUN: Checking for units to link...'
\echo '=============================================='

SELECT * FROM sot.backfill_apartment_hierarchy(TRUE);

\echo ''
\echo '=============================================='
\echo 'EXECUTING HIERARCHY BACKFILL...'
\echo '=============================================='

SELECT * FROM sot.backfill_apartment_hierarchy(FALSE);

-- ============================================================================
-- 6. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo '6a. Orphaned apartment units (should be near 0):'
SELECT COUNT(*) as orphaned_units
FROM sot.places
WHERE place_kind = 'apartment_unit'
  AND parent_place_id IS NULL
  AND merged_into_place_id IS NULL;

\echo ''
\echo '6b. Place family for 607e5d25 (should include Unit 74):'
SELECT p.place_id, p.display_name, p.place_kind, p.unit_identifier
FROM UNNEST(sot.get_place_family('607e5d25-ee86-423e-969b-fbd48c52aa25')) AS fam(pid)
JOIN sot.places p ON p.place_id = fam.pid;

\echo ''
\echo '6c. Top apartment buildings by unit count:'
SELECT
  b.place_id,
  b.display_name as building,
  COUNT(u.place_id) as unit_count
FROM sot.places b
JOIN sot.places u ON u.parent_place_id = b.place_id AND u.merged_into_place_id IS NULL
WHERE b.place_kind = 'apartment_building'
  AND b.merged_into_place_id IS NULL
GROUP BY b.place_id, b.display_name
ORDER BY unit_count DESC
LIMIT 10;

\echo ''
\echo '6d. Summary:'
SELECT
  COUNT(*) FILTER (WHERE parent_place_id IS NOT NULL) as units_with_parents,
  COUNT(*) FILTER (WHERE place_kind = 'apartment_building') as apartment_buildings,
  COUNT(*) FILTER (WHERE unit_identifier IS NOT NULL) as places_with_units
FROM sot.places
WHERE merged_into_place_id IS NULL;

\echo ''
\echo '=============================================='
\echo '  MIG_2824 Complete'
\echo '=============================================='
\echo ''
