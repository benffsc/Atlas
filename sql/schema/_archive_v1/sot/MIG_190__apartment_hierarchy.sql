-- MIG_190: Apartment Complex Hierarchy
-- Links apartment units to their parent buildings
--
-- Problem: Units like "850 Russell Ave Apt R6" and "850 Russell Ave Apt Q7"
-- are separate places with no connection.

\echo '=============================================='
\echo 'MIG_190: Apartment Complex Hierarchy'
\echo '=============================================='

-- ============================================
-- PART 1: Schema Changes
-- ============================================

\echo 'Adding hierarchy columns to places table...'

ALTER TABLE trapper.places
  ADD COLUMN IF NOT EXISTS parent_place_id UUID REFERENCES trapper.places(place_id),
  ADD COLUMN IF NOT EXISTS unit_identifier TEXT;

-- Index for finding children of a building
CREATE INDEX IF NOT EXISTS idx_places_parent
  ON trapper.places(parent_place_id)
  WHERE parent_place_id IS NOT NULL;

-- Index for finding places with units
CREATE INDEX IF NOT EXISTS idx_places_unit
  ON trapper.places(unit_identifier)
  WHERE unit_identifier IS NOT NULL;

COMMENT ON COLUMN trapper.places.parent_place_id IS
'For apartment units, references the parent building place. NULL for non-unit places.';

COMMENT ON COLUMN trapper.places.unit_identifier IS
'The unit designation (e.g., "Apt 5", "#12", "Unit B", "Space 42"). NULL for buildings/houses.';

-- ============================================
-- PART 2: Unit Extraction Function
-- ============================================

\echo 'Creating unit extraction function...'

CREATE OR REPLACE FUNCTION trapper.extract_unit_from_address(addr TEXT)
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
  v_match := REGEXP_MATCH(v_addr,
    '(.*?),?\s*((?:apt\.?|apartment|unit|suite|ste\.?|space|#)\s*[a-z0-9-]+)\s*,?\s*(.*)',
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

-- ============================================
-- PART 3: Find or Create Parent Building
-- ============================================

\echo 'Creating find_or_create_parent_building function...'

CREATE OR REPLACE FUNCTION trapper.find_or_create_parent_building(
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
  SELECT * INTO v_unit_place
  FROM trapper.places
  WHERE place_id = p_unit_place_id;

  IF v_unit_place IS NULL THEN
    RETURN NULL;
  END IF;

  -- Extract base address and unit
  SELECT * INTO v_extracted
  FROM trapper.extract_unit_from_address(v_unit_place.formatted_address);

  IF v_extracted.unit IS NULL THEN
    -- No unit in address, this isn't a unit place
    RETURN NULL;
  END IF;

  -- Normalize the base address for matching
  v_normalized_base := trapper.normalize_address(v_extracted.base_address);

  -- Look for existing parent building
  SELECT place_id INTO v_parent_id
  FROM trapper.places
  WHERE trapper.normalize_address(formatted_address) = v_normalized_base
    AND merged_into_place_id IS NULL
    AND (place_kind = 'apartment_building' OR unit_identifier IS NULL)
    AND place_id != p_unit_place_id
  ORDER BY
    CASE WHEN place_kind = 'apartment_building' THEN 0 ELSE 1 END,
    created_at ASC
  LIMIT 1;

  IF v_parent_id IS NOT NULL THEN
    -- Found existing building, update it to be apartment_building if not already
    UPDATE trapper.places
    SET place_kind = 'apartment_building'
    WHERE place_id = v_parent_id
      AND place_kind NOT IN ('apartment_building', 'business', 'clinic');

    RETURN v_parent_id;
  END IF;

  -- No existing building found, create one
  INSERT INTO trapper.places (
    display_name,
    formatted_address,
    location,
    place_kind,
    is_address_backed,
    data_source,
    place_origin
  ) VALUES (
    v_extracted.base_address,
    v_extracted.base_address,
    v_unit_place.location,
    'apartment_building',
    FALSE, -- Will be address-backed if we can find the sot_address
    'app',
    'auto_created_parent'
  )
  RETURNING place_id INTO v_parent_id;

  RETURN v_parent_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 4: Backfill Existing Units
-- ============================================

\echo 'Creating backfill function...'

CREATE OR REPLACE FUNCTION trapper.backfill_apartment_hierarchy(
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
  -- Find all places that look like they have units
  FOR v_place IN
    SELECT p.place_id, p.formatted_address, p.display_name
    FROM trapper.places p
    WHERE p.merged_into_place_id IS NULL
      AND p.parent_place_id IS NULL  -- Not already linked
      AND p.formatted_address IS NOT NULL
      AND p.formatted_address ~* '(apt\.?|apartment|unit|suite|ste\.?|space|#)\s*[a-z0-9]'
  LOOP
    v_units_found := v_units_found + 1;

    -- Extract the unit
    SELECT * INTO v_extracted
    FROM trapper.extract_unit_from_address(v_place.formatted_address);

    IF v_extracted.unit IS NULL THEN
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      RAISE NOTICE 'DRY RUN: Would link "%" (unit: %) to building "%"',
        v_place.display_name, v_extracted.unit, v_extracted.base_address;
      v_units_linked := v_units_linked + 1;
    ELSE
      -- Check if parent will be created
      SELECT EXISTS (
        SELECT 1 FROM trapper.places
        WHERE trapper.normalize_address(formatted_address) = trapper.normalize_address(v_extracted.base_address)
          AND merged_into_place_id IS NULL
          AND place_id != v_place.place_id
      ) INTO v_parent_existed;

      -- Find or create parent
      v_parent_id := trapper.find_or_create_parent_building(v_place.place_id, 'mig_190');

      IF v_parent_id IS NOT NULL THEN
        -- Update the unit place
        UPDATE trapper.places
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

-- ============================================
-- PART 5: View for Building with Units
-- ============================================

\echo 'Creating view for buildings and units...'

CREATE OR REPLACE VIEW trapper.v_apartment_buildings AS
SELECT
  b.place_id as building_id,
  b.display_name as building_name,
  b.formatted_address as building_address,
  COUNT(u.place_id) as unit_count,
  SUM((SELECT COUNT(*) FROM trapper.cat_place_relationships WHERE place_id = u.place_id)) as total_cats,
  SUM((SELECT COUNT(*) FROM trapper.sot_requests WHERE place_id = u.place_id)) as total_requests,
  ARRAY_AGG(u.unit_identifier ORDER BY u.unit_identifier) as units
FROM trapper.places b
LEFT JOIN trapper.places u ON u.parent_place_id = b.place_id AND u.merged_into_place_id IS NULL
WHERE b.place_kind = 'apartment_building'
  AND b.merged_into_place_id IS NULL
GROUP BY b.place_id, b.display_name, b.formatted_address
ORDER BY unit_count DESC;

-- ============================================
-- PART 6: Execute Backfill
-- ============================================

\echo ''
\echo '=============================================='
\echo 'DRY RUN: Checking for units to link...'
\echo '=============================================='

SELECT * FROM trapper.backfill_apartment_hierarchy(TRUE);

\echo ''
\echo '=============================================='
\echo 'EXECUTING HIERARCHY BACKFILL...'
\echo '=============================================='

SELECT * FROM trapper.backfill_apartment_hierarchy(FALSE);

\echo ''
\echo 'Hierarchy backfill complete!'

-- Show results
\echo ''
\echo 'Top apartment buildings by unit count:'
SELECT * FROM trapper.v_apartment_buildings LIMIT 15;

\echo ''
\echo 'Summary:'
SELECT
  COUNT(*) FILTER (WHERE parent_place_id IS NOT NULL) as units_with_parents,
  COUNT(*) FILTER (WHERE place_kind = 'apartment_building') as apartment_buildings,
  COUNT(*) FILTER (WHERE unit_identifier IS NOT NULL) as places_with_units
FROM trapper.places
WHERE merged_into_place_id IS NULL;
