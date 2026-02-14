\echo '=== MIG_799: Harden normalize_address + extract_house_number ==='
\echo 'Fixes root cause of 3,317 duplicate place pairs.'
\echo 'Adds house number extraction for merge safety.'

-- =========================================================================
-- 1. Enhanced normalize_address()
-- =========================================================================
-- Addresses the following gaps in the original function:
--   - Missing TRIM (trailing/leading whitespace)
--   - ", USA" / ", US" suffix not stripped
--   - Periods in abbreviations (St. -> St, P.O. -> PO)
--   - Missing street suffix normalizations (Circle, Place, Way, etc.)
--   - Hyphens and em-dashes used as placeholders
--   - # prefix on unit numbers inconsistent
-- =========================================================================

CREATE OR REPLACE FUNCTION trapper.normalize_address(p_address text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_result text;
BEGIN
  IF p_address IS NULL OR BTRIM(p_address) = '' THEN
    RETURN NULL;
  END IF;

  v_result := BTRIM(p_address);

  -- Step 1: Strip ", USA" / ", US" suffix (case insensitive)
  v_result := REGEXP_REPLACE(v_result, ',\s*(USA|US|United States)\s*$', '', 'i');

  -- Step 2a: Strip em-dash city placeholder (", —," pattern from Airtable imports)
  v_result := REGEXP_REPLACE(v_result, ',\s*[—–]+\s*,', ',', 'g');  -- ", —," → ","
  v_result := REGEXP_REPLACE(v_result, ',\s*--+\s*,', ',', 'g');     -- ", --," → ","

  -- Step 2b: Strip trailing em-dash / double-dash
  v_result := REGEXP_REPLACE(v_result, '\s*[—–]+\s*$', '', 'g');
  v_result := REGEXP_REPLACE(v_result, '\s*--+\s*$', '', 'g');

  -- Step 2c: Normalize comma before zip (", CA, 95404" → ", CA 95404")
  v_result := REGEXP_REPLACE(v_result, ',\s*([A-Za-z]{2}),\s*(\d{5})', ', \1 \2', 'gi');

  -- Step 3: Remove periods from abbreviations (St. -> St, Ave. -> Ave, Dr. -> Dr, P.O. -> PO)
  -- But preserve decimal numbers (e.g., "5.5 miles")
  v_result := REGEXP_REPLACE(v_result, '\.(\s|,|$)', '\1', 'g');  -- period before space/comma/end
  v_result := REGEXP_REPLACE(v_result, '([A-Za-z])\.([A-Za-z])', '\1\2', 'g');  -- P.O. -> PO

  -- Step 4: Collapse whitespace
  v_result := REGEXP_REPLACE(v_result, '\s+', ' ', 'g');

  -- Step 5: Remove double commas, space before comma
  v_result := REGEXP_REPLACE(v_result, ',\s*,', ',', 'g');
  v_result := REGEXP_REPLACE(v_result, '\s+,', ',', 'g');

  -- Step 5b: Normalize apartment/unit spelling
  v_result := REGEXP_REPLACE(v_result, '\y(apartment)\y', 'apt', 'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(suite)\y', 'ste', 'gi');

  -- Step 5c: Strip comma between house number and street name ("1898, cooper rd" → "1898 cooper rd")
  v_result := REGEXP_REPLACE(v_result, '^(\d+),\s+', '\1 ', 'g');

  -- Step 6: Normalize street suffixes (comprehensive list)
  -- Original 6
  v_result := REGEXP_REPLACE(v_result, '\y(road)\y',      'rd',   'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(street)\y',    'st',   'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(avenue)\y',    'ave',  'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(drive)\y',     'dr',   'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(boulevard)\y', 'blvd', 'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(lane)\y',      'ln',   'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(court)\y',     'ct',   'gi');
  -- New additions
  v_result := REGEXP_REPLACE(v_result, '\y(circle)\y',    'cir',  'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(place)\y',     'pl',   'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(highway)\y',   'hwy',  'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(terrace)\y',   'ter',  'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(parkway)\y',   'pkwy', 'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(trail)\y',     'trl',  'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(square)\y',    'sq',   'gi');

  -- Step 7: Normalize directional abbreviations
  v_result := REGEXP_REPLACE(v_result, '\y(north)\y',     'n',  'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(south)\y',     's',  'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(east)\y',      'e',  'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(west)\y',      'w',  'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(northwest)\y', 'nw', 'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(northeast)\y', 'ne', 'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(southwest)\y', 'sw', 'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(southeast)\y', 'se', 'gi');

  -- Step 8: Normalize # prefix for units
  v_result := REGEXP_REPLACE(v_result, '\s*#\s*', ' #', 'g');

  -- Step 9: Final LOWER + TRIM
  v_result := LOWER(BTRIM(v_result));

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION trapper.normalize_address IS
  'Normalizes addresses for deduplication. Handles USA suffix, periods, street suffixes, directionals, whitespace. MIG_799 hardened version.';

-- =========================================================================
-- 2. extract_house_number() - Merge safety guard
-- =========================================================================
-- Extracts the leading house number from a normalized address.
-- Used to prevent merging different addresses on the same street
-- (e.g., "6000 blank rd" vs "6030 blank rd").
-- =========================================================================

CREATE OR REPLACE FUNCTION trapper.extract_house_number(p_normalized_address text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_match text[];
BEGIN
  IF p_normalized_address IS NULL THEN
    RETURN NULL;
  END IF;

  -- Match leading digits, possibly with letter suffix (123A) or hyphen (12-34)
  v_match := REGEXP_MATCH(p_normalized_address, '^\s*(\d+[-]?\d*[a-z]?)\s');

  IF v_match IS NOT NULL THEN
    RETURN v_match[1];
  END IF;

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION trapper.extract_house_number IS
  'Extracts leading house number from a normalized address for merge safety. Returns NULL for PO boxes, rural routes, etc.';

-- =========================================================================
-- 3. address_safe_to_merge() - Merge eligibility check
-- =========================================================================
-- Returns TRUE if two addresses are safe to merge.
-- Rejects pairs where house numbers differ (false positive guard).
-- =========================================================================

CREATE OR REPLACE FUNCTION trapper.address_safe_to_merge(
  p_addr_a text,
  p_addr_b text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_norm_a text;
  v_norm_b text;
  v_house_a text;
  v_house_b text;
BEGIN
  v_norm_a := trapper.normalize_address(p_addr_a);
  v_norm_b := trapper.normalize_address(p_addr_b);

  -- If normalization makes them identical, safe to merge
  IF v_norm_a = v_norm_b THEN
    RETURN TRUE;
  END IF;

  -- Extract house numbers
  v_house_a := trapper.extract_house_number(v_norm_a);
  v_house_b := trapper.extract_house_number(v_norm_b);

  -- REJECT: Different house numbers = different addresses
  IF v_house_a IS NOT NULL AND v_house_b IS NOT NULL AND v_house_a <> v_house_b THEN
    RETURN FALSE;
  END IF;

  -- If we get here, house numbers match (or one/both are NULL)
  -- Allow merge if high similarity after normalization
  IF similarity(v_norm_a, v_norm_b) > 0.85 THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$function$;

COMMENT ON FUNCTION trapper.address_safe_to_merge IS
  'Returns TRUE if two addresses are safe to merge. Rejects different house numbers even if street names are similar. MIG_799.';

-- =========================================================================
-- 4. Re-normalize ALL existing places
-- =========================================================================
-- Apply the hardened function to all existing normalized_address values.
-- This will collapse many duplicate pairs by producing identical
-- normalized values.
-- =========================================================================

\echo 'Re-normalizing all place addresses...'

UPDATE trapper.places
SET normalized_address = trapper.normalize_address(formatted_address),
    updated_at = NOW()
WHERE formatted_address IS NOT NULL
  AND (
    -- Only update if the new normalization differs
    normalized_address IS DISTINCT FROM trapper.normalize_address(formatted_address)
  );

\echo 'Re-normalization complete.'

-- =========================================================================
-- 5. Report: how many duplicate pairs remain after re-normalization
-- =========================================================================

\echo 'Counting remaining duplicate pairs after re-normalization...'

SELECT COUNT(*) AS remaining_exact_duplicate_pairs
FROM trapper.places a
JOIN trapper.places b
  ON a.normalized_address = b.normalized_address
  AND a.place_id < b.place_id
WHERE a.merged_into_place_id IS NULL
  AND b.merged_into_place_id IS NULL
  AND a.normalized_address IS NOT NULL;

\echo '=== MIG_799 complete ==='
\echo 'Created: normalize_address() v2, extract_house_number(), address_safe_to_merge()'
\echo 'Updated: All place normalized_address values re-computed'
