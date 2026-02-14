-- ============================================================================
-- MIG_935: Fix LMFM Hyphenated Name Pattern (DATA_GAP_026)
-- ============================================================================
-- Problem: The LMFM ALL CAPS detection pattern [A-Z ]+ excludes hyphens.
--          Names like "MARY-JANE SMITH" would not be detected as LMFM.
--
-- Current Impact: Low - no confirmed cases in current data
-- Fix: Update is_lmfm_appointment() to allow hyphens in ALL CAPS names
-- ============================================================================

\echo '=== MIG_935: Fix LMFM Hyphenated Name Pattern ==='
\echo ''

-- ============================================================================
-- Phase 1: Update the is_lmfm_appointment function
-- ============================================================================

\echo 'Phase 1: Updating is_lmfm_appointment() to handle hyphens...'

CREATE OR REPLACE FUNCTION trapper.is_lmfm_appointment(
  p_owner_first_name TEXT,
  p_owner_last_name TEXT,
  p_appointment_notes TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_full_name TEXT;
  v_first TEXT;
  v_last TEXT;
BEGIN
  v_first := TRIM(COALESCE(p_owner_first_name, ''));
  v_last := TRIM(COALESCE(p_owner_last_name, ''));
  v_full_name := v_first || ' ' || v_last;

  -- ==========================================================================
  -- Signal 1 (Strongest): $LMFM marker in appointment notes
  -- ==========================================================================
  IF p_appointment_notes IS NOT NULL AND p_appointment_notes ILIKE '%$LMFM%' THEN
    RETURN TRUE;
  END IF;

  -- ==========================================================================
  -- Signal 2: Legacy LMFM prefix in first name
  -- ==========================================================================
  IF UPPER(v_first) = 'LMFM' THEN
    RETURN TRUE;
  END IF;

  -- ==========================================================================
  -- Signal 3: ALL CAPS owner name pattern
  -- Updated to allow hyphens, apostrophes, and periods in names
  -- ==========================================================================

  -- Must have both first and last name with minimum length
  IF LENGTH(v_first) > 1 AND LENGTH(v_last) > 1 THEN
    -- Check if BOTH names are ALL CAPS (allowing hyphens, apostrophes, periods, spaces)
    -- Pattern: Only uppercase letters, hyphens, apostrophes, periods, and spaces
    IF v_full_name ~ '^[A-Z\-''. ]+$' THEN
      -- Exclude patterns that look like SCAS IDs (A-123456)
      IF v_first ~ '^[AS]-?[0-9]+$' THEN
        RETURN FALSE;  -- This is SCAS, not LMFM
      END IF;

      -- Exclude very short combinations that might be initials only
      -- Must have at least one name part > 2 chars that's not all initials
      IF LENGTH(v_first) > 2 OR LENGTH(v_last) > 2 THEN
        RETURN TRUE;
      END IF;
    END IF;
  END IF;

  RETURN FALSE;
END;
$function$;

COMMENT ON FUNCTION trapper.is_lmfm_appointment IS
'MIG_935: Updated to handle hyphenated names like MARY-JANE SMITH.
Pattern now accepts: MARY-JANE SMITH, O''CONNOR JOHN, DR. JANE DOE (all caps)

Detection signals in priority order:
1. $LMFM marker in notes (strongest)
2. First name = "LMFM" (legacy format)
3. ALL CAPS full name (allows hyphens, apostrophes, periods)

Excludes SCAS IDs that look like A-123456.
Fixes DATA_GAP_026.';

-- ============================================================================
-- Phase 2: Re-classify affected appointments
-- ============================================================================

\echo ''
\echo 'Phase 2: Checking for appointments that should now be LMFM...'

-- Find appointments that now match LMFM pattern
WITH lmfm_candidates AS (
  SELECT a.appointment_id, cv.client_first_name, cv.client_last_name
  FROM trapper.sot_appointments a
  JOIN trapper.clinichq_visits cv ON cv.appointment_number = a.appointment_number
  WHERE trapper.is_lmfm_appointment(cv.client_first_name, cv.client_last_name, cv.internal_notes)
    AND a.appointment_source_category <> 'lmfm'
)
SELECT 'Potential LMFM reclassifications:' as header, COUNT(*) as count FROM lmfm_candidates;

-- Show examples of what would be reclassified
SELECT 'Examples of newly detected LMFM:' as header;
SELECT DISTINCT cv.client_first_name, cv.client_last_name, a.appointment_source_category
FROM trapper.sot_appointments a
JOIN trapper.clinichq_visits cv ON cv.appointment_number = a.appointment_number
WHERE trapper.is_lmfm_appointment(cv.client_first_name, cv.client_last_name, cv.internal_notes)
  AND a.appointment_source_category <> 'lmfm'
LIMIT 10;

-- Apply reclassification
UPDATE trapper.sot_appointments a
SET appointment_source_category = 'lmfm'
FROM trapper.clinichq_visits cv
WHERE cv.appointment_number = a.appointment_number
  AND trapper.is_lmfm_appointment(cv.client_first_name, cv.client_last_name, cv.internal_notes)
  AND a.appointment_source_category <> 'lmfm'
  AND a.appointment_source_category NOT IN ('county_scas', 'foster_program');  -- Don't override higher-priority categories

-- ============================================================================
-- Phase 3: Verify the fix
-- ============================================================================

\echo ''
\echo 'Phase 3: Verification...'

-- Test the function with various patterns
SELECT 'Testing is_lmfm_appointment():' as header;

SELECT
  'DANIELLE' as first, 'HALL' as last, NULL as notes,
  trapper.is_lmfm_appointment('DANIELLE', 'HALL', NULL) as result,
  'Expected: TRUE (ALL CAPS)' as expected;

SELECT
  'MARY-JANE' as first, 'SMITH' as last, NULL as notes,
  trapper.is_lmfm_appointment('MARY-JANE', 'SMITH', NULL) as result,
  'Expected: TRUE (hyphenated ALL CAPS)' as expected;

SELECT
  'O''CONNOR' as first, 'JOHN' as last, NULL as notes,
  trapper.is_lmfm_appointment('O''CONNOR', 'JOHN', NULL) as result,
  'Expected: TRUE (apostrophe ALL CAPS)' as expected;

SELECT
  'John' as first, 'Doe' as last, 'Collect $LMFM' as notes,
  trapper.is_lmfm_appointment('John', 'Doe', 'Collect $LMFM') as result,
  'Expected: TRUE ($LMFM marker)' as expected;

SELECT
  'A-416620' as first, 'SCAS' as last, NULL as notes,
  trapper.is_lmfm_appointment('A-416620', 'SCAS', NULL) as result,
  'Expected: FALSE (SCAS, not LMFM)' as expected;

SELECT
  'John' as first, 'Doe' as last, NULL as notes,
  trapper.is_lmfm_appointment('John', 'Doe', NULL) as result,
  'Expected: FALSE (mixed case)' as expected;

-- Current LMFM count
SELECT 'Current lmfm appointments:' as header;
SELECT COUNT(*) as count FROM trapper.sot_appointments
WHERE appointment_source_category = 'lmfm';

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_935 Complete!'
\echo '=============================================='
\echo ''
\echo 'DATA_GAP_026: LMFM Hyphenated Name Pattern - FIXED'
\echo ''
\echo 'Changes made:'
\echo '  1. Updated is_lmfm_appointment() to allow hyphens, apostrophes, periods'
\echo '  2. Added exclusion for SCAS IDs (A-123456)'
\echo '  3. Re-classified any newly detected LMFM appointments'
\echo ''
\echo 'Pattern now matches:'
\echo '  - MARY-JANE SMITH (hyphenated)'
\echo '  - O''CONNOR JOHN (apostrophe)'
\echo '  - DR. JANE DOE (period)'
\echo ''
