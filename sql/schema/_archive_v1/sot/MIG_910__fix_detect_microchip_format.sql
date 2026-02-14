-- =====================================================
-- MIG_910: Fix detect_microchip_format() to Reject ShelterLuv+Chip Concatenation
-- =====================================================
-- Problem: Animal Name like "Macy - A439019 - 981020039875779" would get
-- stripped to "439019981020039875779" (21 digits) and accepted as a microchip.
--
-- Root Cause: detect_microchip_format() strips all non-alphanumeric characters
-- before analysis, concatenating the ShelterLuv ID with the actual microchip.
--
-- Solution:
--   1. Add rejection for digit strings > 15 that contain SL ID patterns
--   2. Extract the actual 15-digit microchip from concatenated values
--   3. Return NULL (rejection) for ambiguous concatenations
--
-- Impact: Prevents duplicate cat creation from concatenated identifiers
-- =====================================================

\echo '=== MIG_910: Fix detect_microchip_format() for SL+Chip Concatenation ==='
\echo ''

-- ============================================================
-- 1. Update detect_microchip_format() to handle concatenation
-- ============================================================

\echo 'Step 1: Updating detect_microchip_format() function...'

CREATE OR REPLACE FUNCTION trapper.detect_microchip_format(p_value text)
 RETURNS TABLE(cleaned_value text, id_type text, confidence text, notes text)
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_cleaned TEXT;
  v_digits_only TEXT;
  v_len INT;
  v_possible_chip TEXT;
BEGIN
  -- Return nothing for NULL or empty input
  IF p_value IS NULL OR TRIM(p_value) = '' THEN
    RETURN;
  END IF;

  -- Clean input: remove spaces, dashes, dots, parentheses
  v_cleaned := UPPER(TRIM(REGEXP_REPLACE(p_value, '[\s\.\-\(\)]', '', 'g')));
  v_digits_only := REGEXP_REPLACE(v_cleaned, '[^0-9]', '', 'g');
  v_len := LENGTH(v_digits_only);

  -- Skip if too short to be any valid format
  IF v_len < 9 THEN
    RETURN;
  END IF;

  -- =====================================================
  -- MIG_909: Handle ShelterLuv ID + Microchip concatenation
  -- Pattern: 6 digits (SL ID like 439019) + 15 digit microchip = 21 digits
  -- Solution: Extract the 15-digit chip using SPECIFIC prefixes
  -- Priority: 981 > 900 > 985 > 941 (most common to least)
  -- =====================================================
  IF v_len > 15 THEN
    -- Priority 1: Look for 981 prefix (most common ISO microchip)
    v_possible_chip := (REGEXP_MATCH(v_digits_only, '(981[0-9]{12})'))[1];
    IF v_possible_chip IS NOT NULL THEN
      RETURN QUERY SELECT v_possible_chip, 'microchip'::TEXT, 'medium'::TEXT,
        format('Extracted 981-prefix chip from %s-digit value', v_len)::TEXT;
      RETURN;
    END IF;

    -- Priority 2: Look for 900 prefix (ISO variant)
    v_possible_chip := (REGEXP_MATCH(v_digits_only, '(900[0-9]{12})'))[1];
    IF v_possible_chip IS NOT NULL THEN
      RETURN QUERY SELECT v_possible_chip, 'microchip'::TEXT, 'medium'::TEXT,
        format('Extracted 900-prefix chip from %s-digit value', v_len)::TEXT;
      RETURN;
    END IF;

    -- Priority 3: Look for 985 prefix (HomeAgain ISO)
    v_possible_chip := (REGEXP_MATCH(v_digits_only, '(985[0-9]{12})'))[1];
    IF v_possible_chip IS NOT NULL THEN
      RETURN QUERY SELECT v_possible_chip, 'microchip'::TEXT, 'medium'::TEXT,
        format('Extracted 985-prefix chip from %s-digit value', v_len)::TEXT;
      RETURN;
    END IF;

    -- Priority 4: Look for 941 prefix (Destron)
    v_possible_chip := (REGEXP_MATCH(v_digits_only, '(941[0-9]{12})'))[1];
    IF v_possible_chip IS NOT NULL THEN
      RETURN QUERY SELECT v_possible_chip, 'microchip'::TEXT, 'medium'::TEXT,
        format('Extracted 941-prefix chip from %s-digit value', v_len)::TEXT;
      RETURN;
    END IF;

    -- If > 15 digits and we can't find a valid embedded chip, reject it
    -- This prevents creation of malformed identifiers
    RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, 'reject'::TEXT,
      format('Rejected: %s digits - no valid chip prefix found', v_len)::TEXT;
    RETURN;
  END IF;

  -- Detect shelter animal IDs (start with A followed by 5-7 digits)
  IF v_cleaned ~ '^A[0-9]{5,7}$' THEN
    RETURN QUERY SELECT v_cleaned, 'shelter_animal_id'::TEXT, 'high'::TEXT,
      'Shelter animal ID format'::TEXT;
    RETURN;
  END IF;

  -- ISO 15-digit standard (most common)
  IF v_len = 15 AND v_digits_only ~ '^[0-9]+$' THEN
    RETURN QUERY SELECT v_digits_only, 'microchip'::TEXT, 'high'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- 14-digit truncated ISO (starts with known manufacturer prefixes)
  -- Common prefixes: 981 (ISO), 900 (ISO variant), 941 (Destron), 985 (HomeAgain ISO)
  IF v_len = 14 AND v_digits_only ~ '^(981|900|941|985)[0-9]+$' THEN
    RETURN QUERY SELECT v_digits_only, 'microchip_truncated'::TEXT, 'medium'::TEXT,
      'Likely ISO chip with 1 missing digit'::TEXT;
    RETURN;
  END IF;

  -- 9-digit AVID format (encrypted proprietary format)
  IF v_len = 9 AND v_digits_only ~ '^[0-9]+$' THEN
    RETURN QUERY SELECT v_digits_only, 'microchip_avid'::TEXT, 'high'::TEXT,
      'AVID 9-digit encrypted format'::TEXT;
    RETURN;
  END IF;

  -- 10-digit formats (HomeAgain, AVID Euro, may include hex characters)
  IF v_len = 10 AND v_digits_only ~ '^[0-9]+$' THEN
    RETURN QUERY SELECT v_digits_only, 'microchip_10digit'::TEXT, 'high'::TEXT,
      'HomeAgain or AVID Euro 10-digit format'::TEXT;
    RETURN;
  END IF;

  -- 10-character alphanumeric (AVID with hex)
  IF LENGTH(v_cleaned) = 10 AND v_cleaned ~ '^[0-9A-F]+$' THEN
    RETURN QUERY SELECT v_cleaned, 'microchip_avid_hex'::TEXT, 'high'::TEXT,
      'AVID 10-character hexadecimal format'::TEXT;
    RETURN;
  END IF;

  -- Fallback: 9-15 digit all-numeric as low confidence
  IF v_len >= 9 AND v_len <= 15 AND v_digits_only ~ '^[0-9]+$' THEN
    RETURN QUERY SELECT v_digits_only, 'microchip'::TEXT, 'low'::TEXT,
      format('Non-standard format: %s digits', v_len)::TEXT;
    RETURN;
  END IF;

  -- No valid format detected
  RETURN;
END;
$function$;

COMMENT ON FUNCTION trapper.detect_microchip_format(text) IS
'Detects microchip format from a raw value. Returns cleaned value, type, confidence, and notes.
Supported formats: ISO 15-digit, AVID 9-digit, HomeAgain 10-digit, truncated 14-digit, AVID hex.
MIG_909: Added detection and extraction of chips from ShelterLuv ID concatenations.';

-- ============================================================
-- 2. Test the fix
-- ============================================================

\echo ''
\echo 'Step 2: Testing the fix...'

SELECT
  'Macy - A439019 - 981020039875779' AS test_input,
  detected.*
FROM trapper.detect_microchip_format('Macy - A439019 - 981020039875779') detected;

SELECT
  'A426581    900085001797139' AS test_input,
  detected.*
FROM trapper.detect_microchip_format('A426581    900085001797139') detected;

SELECT
  '981020053927285' AS test_input,
  detected.*
FROM trapper.detect_microchip_format('981020053927285') detected;

-- ============================================================
-- 3. Verification
-- ============================================================

\echo ''
\echo '=== VERIFICATION ==='
\echo ''
\echo 'Function updated. The Macy case now extracts 981020039875779 instead of concatenating.'
\echo ''
\echo '=== MIG_909 Complete ==='
