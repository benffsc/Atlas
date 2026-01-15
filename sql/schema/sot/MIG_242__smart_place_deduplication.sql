\echo '=== MIG_242: Smart Place Deduplication ==='
\echo 'Merge duplicate places while preserving unit numbers'

-- ============================================================
-- 1. Function to extract unit number from address
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.extract_unit_number(p_address TEXT)
RETURNS TEXT AS $$
DECLARE
  v_unit TEXT;
BEGIN
  IF p_address IS NULL THEN
    RETURN NULL;
  END IF;

  -- Match patterns like:
  -- #4, #123, Apt 4, Apt. 12, Unit 3, Suite 100, Space 5, Bldg A
  -- Also handles: Apartment 42, unit #5
  v_unit := (
    SELECT (REGEXP_MATCHES(
      p_address,
      '(?i)(?:apt|apartment|unit|suite|ste|space|bldg|building|#)\s*\.?\s*#?(\d+[A-Za-z]?)',
      'i'
    ))[1]
  );

  RETURN UPPER(TRIM(COALESCE(v_unit, '')));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.extract_unit_number IS
'Extracts unit/apartment number from an address string.
Returns NULL if no unit number found.
Examples:
  "123 Main St Apt 4" -> "4"
  "456 Oak Ave #12B" -> "12B"
  "789 Pine Rd Unit 100" -> "100"
  "321 Elm St" -> NULL';

-- Test the function
\echo ''
\echo 'Testing extract_unit_number:'
SELECT
  trapper.extract_unit_number('123 Main St Apt 4') as "Apt 4",
  trapper.extract_unit_number('456 Oak Ave #12B') as "#12B",
  trapper.extract_unit_number('789 Pine Rd Unit 100') as "Unit 100",
  trapper.extract_unit_number('321 Elm St') as "No unit",
  trapper.extract_unit_number('7272 Camino Colegio Apartment 42') as "Apartment 42";

-- ============================================================
-- 2. Add unit_number column to places
-- ============================================================

\echo ''
\echo 'Adding unit_number column to places...'

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS unit_number TEXT;

-- Populate for existing records
UPDATE trapper.places
SET unit_number = trapper.extract_unit_number(formatted_address)
WHERE unit_number IS NULL;

-- Create index for lookups
CREATE INDEX IF NOT EXISTS idx_places_unit_number
ON trapper.places(unit_number) WHERE unit_number IS NOT NULL;

\echo 'Unit numbers extracted:'
SELECT
  COUNT(*) FILTER (WHERE unit_number IS NOT NULL) as with_unit,
  COUNT(*) FILTER (WHERE unit_number IS NULL) as without_unit
FROM trapper.places WHERE merged_into_place_id IS NULL;

-- ============================================================
-- 3. Smart merge function that respects unit numbers
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.smart_merge_duplicate_places()
RETURNS TABLE(merged_count INT, skipped_count INT) AS $$
DECLARE
  v_dup RECORD;
  v_merged INT := 0;
  v_skipped INT := 0;
  v_keep_id UUID;
  v_remove_id UUID;
BEGIN
  -- Find places with exact same coordinates but only merge if:
  -- 1. Both have NO unit number, OR
  -- 2. Both have the SAME unit number
  FOR v_dup IN
    SELECT
      p1.place_id as id_1,
      p2.place_id as id_2,
      p1.formatted_address as addr_1,
      p2.formatted_address as addr_2,
      p1.unit_number as unit_1,
      p2.unit_number as unit_2,
      LENGTH(COALESCE(p1.formatted_address, '')) as len_1,
      LENGTH(COALESCE(p2.formatted_address, '')) as len_2
    FROM trapper.places p1
    JOIN trapper.places p2 ON p1.place_id < p2.place_id
    WHERE p1.location IS NOT NULL
      AND p2.location IS NOT NULL
      AND p1.merged_into_place_id IS NULL
      AND p2.merged_into_place_id IS NULL
      AND ST_DWithin(p1.location, p2.location, 0.1) -- Same coordinates
      -- Only merge if unit numbers match (both null or both same value)
      AND (
        (p1.unit_number IS NULL AND p2.unit_number IS NULL)
        OR (p1.unit_number = p2.unit_number)
      )
  LOOP
    -- Keep the one with longer (more complete) address
    IF v_dup.len_1 >= v_dup.len_2 THEN
      v_keep_id := v_dup.id_1;
      v_remove_id := v_dup.id_2;
    ELSE
      v_keep_id := v_dup.id_2;
      v_remove_id := v_dup.id_1;
    END IF;

    BEGIN
      PERFORM trapper.merge_places(v_keep_id, v_remove_id, 'smart_coordinate_match');
      v_merged := v_merged + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_merged, v_skipped;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.smart_merge_duplicate_places IS
'Merges duplicate places that have the same coordinates AND same unit number.
Places with different unit numbers at the same address are kept separate.
Returns count of merged and skipped places.';

-- ============================================================
-- 4. Trigger to extract unit number on insert/update
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.trg_extract_place_unit_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.unit_number := trapper.extract_unit_number(NEW.formatted_address);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_extract_place_unit_number ON trapper.places;
CREATE TRIGGER trg_extract_place_unit_number
    BEFORE INSERT OR UPDATE OF formatted_address ON trapper.places
    FOR EACH ROW
    EXECUTE FUNCTION trapper.trg_extract_place_unit_number();

-- ============================================================
-- 5. Run the smart merge
-- ============================================================

\echo ''
\echo 'Running smart deduplication (preserving unit numbers)...'

SELECT * FROM trapper.smart_merge_duplicate_places();

-- Show final stats
\echo ''
\echo 'Final place statistics:'
SELECT
  COUNT(*) as total_places,
  COUNT(*) FILTER (WHERE merged_into_place_id IS NULL) as active_places,
  COUNT(*) FILTER (WHERE merged_into_place_id IS NOT NULL) as merged_places,
  COUNT(*) FILTER (WHERE unit_number IS NOT NULL AND merged_into_place_id IS NULL) as with_unit_numbers
FROM trapper.places;

\echo ''
\echo 'MIG_242 complete!'
\echo ''
\echo 'New features:'
\echo '  - unit_number column on places (auto-extracted from address)'
\echo '  - extract_unit_number(text) function'
\echo '  - smart_merge_duplicate_places() - respects unit numbers'
\echo ''
\echo 'Places with different unit numbers at same address are preserved!'
\echo ''
