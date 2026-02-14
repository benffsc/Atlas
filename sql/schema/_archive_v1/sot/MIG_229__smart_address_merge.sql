-- MIG_229: Smart Address Merge
--
-- Creates function to intelligently combine address fields from Airtable.
-- Handles cases where unit/apt numbers are split into separate fields.
--
-- Example:
--   clean_address = "665 Russell Ave, Santa Rosa, CA 95403"
--   clean_address_cats = "#4"
--   Result = "665 Russell Ave #4, Santa Rosa, CA 95403"

\echo ''
\echo '=============================================='
\echo 'MIG_229: Smart Address Merge'
\echo '=============================================='
\echo ''

-- ============================================
-- PART 1: Pattern detection functions
-- ============================================

-- Check if a string looks like a unit/apartment number
CREATE OR REPLACE FUNCTION trapper.looks_like_unit_number(s TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  IF s IS NULL OR TRIM(s) = '' THEN
    RETURN FALSE;
  END IF;

  -- Normalize
  s := TRIM(s);

  -- Patterns that indicate unit/apartment numbers:
  -- #4, #123, Apt 4, Apt. 12, Unit 3, Suite 100, etc.
  -- Also just bare numbers like "4" or "123"
  RETURN s ~ '^#\d+[A-Za-z]?$'                    -- #4, #123, #4A
      OR s ~ '^(?i)(apt|apartment|unit|suite|ste|bldg|building)\.?\s*#?\d+[A-Za-z]?$'
      OR s ~ '^\d{1,4}[A-Za-z]?$'                 -- 4, 123, 4A
      OR LENGTH(s) <= 6;                          -- Very short strings are likely unit numbers
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.looks_like_unit_number IS
'Returns TRUE if the string looks like a unit/apartment number (e.g., #4, Apt 3, Unit 12, 4A).
Used to detect when address line 2 should be merged with address line 1.';

-- Check if an address looks complete (has street, city pattern)
CREATE OR REPLACE FUNCTION trapper.looks_like_full_address(s TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  IF s IS NULL OR TRIM(s) = '' THEN
    RETURN FALSE;
  END IF;

  -- A full address typically has:
  -- - A street number and name
  -- - Contains a comma (city separator)
  -- - Contains state abbreviation or "CA"
  -- - Longer than 15 characters
  RETURN LENGTH(TRIM(s)) > 15
     AND s ~ '^\d+\s+\w+'           -- Starts with street number
     AND (s ~ ',\s*[A-Za-z]+'       -- Has comma + city
          OR s ~ ',\s*CA\s*\d{5}'   -- Has CA + zip
          OR s ~ 'CA\s*\d{5}');     -- Has CA + zip
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.looks_like_full_address IS
'Returns TRUE if the string looks like a complete address (has street, city, state pattern).';

-- ============================================
-- PART 2: Smart address merge function
-- ============================================

CREATE OR REPLACE FUNCTION trapper.smart_merge_address(
  p_address_1 TEXT,        -- Primary address (e.g., "Clean Address")
  p_address_2 TEXT,        -- Secondary/unit field (e.g., "Clean Address (Cats)")
  p_street_field TEXT DEFAULT NULL,    -- Original street field if available
  p_city TEXT DEFAULT NULL,
  p_zip TEXT DEFAULT NULL
) RETURNS TEXT AS $$
DECLARE
  v_result TEXT;
  v_addr1 TEXT := TRIM(COALESCE(p_address_1, ''));
  v_addr2 TEXT := TRIM(COALESCE(p_address_2, ''));
BEGIN
  -- Case 1: Both empty
  IF v_addr1 = '' AND v_addr2 = '' THEN
    -- Try to construct from street/city/zip
    IF p_street_field IS NOT NULL AND TRIM(p_street_field) != '' THEN
      v_result := TRIM(p_street_field);
      IF p_city IS NOT NULL AND TRIM(p_city) != '' THEN
        v_result := v_result || ', ' || TRIM(p_city);
      END IF;
      IF p_zip IS NOT NULL AND TRIM(p_zip) != '' THEN
        v_result := v_result || ' ' || TRIM(p_zip);
      END IF;
      RETURN v_result;
    END IF;
    RETURN NULL;
  END IF;

  -- Case 2: Only addr1 has value
  IF v_addr2 = '' THEN
    RETURN v_addr1;
  END IF;

  -- Case 3: Only addr2 has value
  IF v_addr1 = '' THEN
    -- If addr2 looks like a full address, use it
    IF trapper.looks_like_full_address(v_addr2) THEN
      RETURN v_addr2;
    END IF;
    -- Otherwise it might be just a unit number - can't do much
    RETURN v_addr2;
  END IF;

  -- Case 4: Both have values
  -- If addr2 looks like a unit number and addr1 is a full address, merge them
  IF trapper.looks_like_unit_number(v_addr2) AND trapper.looks_like_full_address(v_addr1) THEN
    -- Insert unit number after street address, before city
    -- Example: "665 Russell Ave, Santa Rosa, CA" + "#4" -> "665 Russell Ave #4, Santa Rosa, CA"
    IF v_addr1 ~ ',\s*[A-Za-z]' THEN
      -- Has comma separator - insert before first comma
      v_result := REGEXP_REPLACE(v_addr1, ',', ' ' || v_addr2 || ',', 1);
    ELSE
      -- No comma - just append
      v_result := v_addr1 || ' ' || v_addr2;
    END IF;
    RETURN v_result;
  END IF;

  -- Case 5: If addr2 looks like a full address and addr1 doesn't, prefer addr2
  IF trapper.looks_like_full_address(v_addr2) AND NOT trapper.looks_like_full_address(v_addr1) THEN
    RETURN v_addr2;
  END IF;

  -- Default: prefer addr1 (the "clean" address)
  RETURN v_addr1;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.smart_merge_address IS
'Intelligently merges address fields from Airtable.
Handles cases where unit/apt numbers are split into separate fields.

Examples:
  ("665 Russell Ave, Santa Rosa, CA", "#4") -> "665 Russell Ave #4, Santa Rosa, CA"
  ("", "123 Main St, City, CA 12345") -> "123 Main St, City, CA 12345"
  ("123 Main St, City", "") -> "123 Main St, City"';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'Testing smart_merge_address:'

SELECT
  trapper.smart_merge_address(
    '665 Russell Ave, Santa Rosa, CA 95403, USA',
    '#4'
  ) AS "Full + Unit",
  trapper.smart_merge_address(
    '',
    '123 Main St, Santa Rosa, CA 95401'
  ) AS "Empty + Full",
  trapper.smart_merge_address(
    '100 Oak St, City, CA',
    ''
  ) AS "Full + Empty",
  trapper.smart_merge_address(
    '200 Pine Ave, Town, CA 90210',
    'Apt 5B'
  ) AS "Full + Apt";

\echo ''
\echo 'MIG_229 complete!'
\echo ''
\echo 'New functions:'
\echo '  - looks_like_unit_number(text): Detects unit/apt patterns'
\echo '  - looks_like_full_address(text): Detects complete addresses'
\echo '  - smart_merge_address(addr1, addr2, ...): Intelligently combines address fields'
\echo ''
