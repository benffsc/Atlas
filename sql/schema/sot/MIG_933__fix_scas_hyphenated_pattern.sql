-- ============================================================================
-- MIG_933: Fix SCAS Hyphenated ID Pattern (DATA_GAP_024)
-- ============================================================================
-- Problem: SCAS IDs with hyphens (A-416620) are not classified as county_scas
--          because the pattern ^A[0-9]+$ requires digits immediately after A.
--
-- Evidence: 1 appointment with "A-416620 SCAS" categorized as other_internal
--
-- Fix: Update is_scas_appointment() to allow optional hyphen in ID
-- ============================================================================

\echo '=== MIG_933: Fix SCAS Hyphenated ID Pattern ==='
\echo ''

-- ============================================================================
-- Phase 1: Update the is_scas_appointment function
-- ============================================================================

\echo 'Phase 1: Updating is_scas_appointment() to handle hyphens...'

CREATE OR REPLACE FUNCTION trapper.is_scas_appointment(
  p_owner_first_name TEXT,
  p_owner_last_name TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $function$
BEGIN
  -- SCAS appointments have:
  -- Last name = "SCAS" (case insensitive)
  -- First name = Animal ID like A439019 or A-439019 (with optional hyphen)
  -- Also allow S prefix for potential future format

  IF UPPER(TRIM(COALESCE(p_owner_last_name, ''))) = 'SCAS' THEN
    -- Check for SCAS animal ID pattern: A or S followed by optional hyphen then digits
    IF TRIM(COALESCE(p_owner_first_name, '')) ~ '^[AS]-?[0-9]+$' THEN
      RETURN TRUE;
    END IF;
  END IF;

  RETURN FALSE;
END;
$function$;

COMMENT ON FUNCTION trapper.is_scas_appointment IS
'MIG_933: Updated to handle hyphenated SCAS IDs like A-416620.
Pattern now accepts: A439019, A-439019, S123456, S-123456
Fixes DATA_GAP_024.';

-- ============================================================================
-- Phase 2: Re-classify affected appointments
-- ============================================================================

\echo ''
\echo 'Phase 2: Re-classifying appointments with hyphenated SCAS IDs...'

-- Find and update appointments that should now be county_scas
WITH scas_fixes AS (
  SELECT a.appointment_id, a.appointment_number
  FROM trapper.sot_appointments a
  JOIN trapper.clinichq_visits cv ON cv.appointment_number = a.appointment_number
  WHERE trapper.is_scas_appointment(cv.client_first_name, cv.client_last_name)
    AND a.appointment_source_category <> 'county_scas'
)
UPDATE trapper.sot_appointments a
SET appointment_source_category = 'county_scas'
FROM scas_fixes sf
WHERE a.appointment_id = sf.appointment_id;

SELECT 'Appointments reclassified to county_scas:' as info,
       COUNT(*) as count
FROM trapper.sot_appointments a
JOIN trapper.clinichq_visits cv ON cv.appointment_number = a.appointment_number
WHERE cv.client_first_name ~ '^[AS]-[0-9]+$'
  AND UPPER(cv.client_last_name) = 'SCAS'
  AND a.appointment_source_category = 'county_scas';

-- ============================================================================
-- Phase 3: Verify the fix
-- ============================================================================

\echo ''
\echo 'Phase 3: Verification...'

-- Test the function
SELECT 'Testing is_scas_appointment():' as header;

SELECT
  'A439019' as first_name, 'SCAS' as last_name,
  trapper.is_scas_appointment('A439019', 'SCAS') as result,
  'Expected: TRUE' as expected;

SELECT
  'A-416620' as first_name, 'SCAS' as last_name,
  trapper.is_scas_appointment('A-416620', 'SCAS') as result,
  'Expected: TRUE (was FALSE before)' as expected;

SELECT
  'S-123456' as first_name, 'SCAS' as last_name,
  trapper.is_scas_appointment('S-123456', 'SCAS') as result,
  'Expected: TRUE (future format)' as expected;

SELECT
  'John' as first_name, 'Doe' as last_name,
  trapper.is_scas_appointment('John', 'Doe') as result,
  'Expected: FALSE' as expected;

-- Check current SCAS count
SELECT 'Current county_scas appointments:' as header;
SELECT COUNT(*) as count FROM trapper.sot_appointments
WHERE appointment_source_category = 'county_scas';

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_933 Complete!'
\echo '=============================================='
\echo ''
\echo 'DATA_GAP_024: SCAS Hyphenated ID Pattern - FIXED'
\echo ''
\echo 'Changes made:'
\echo '  1. Updated is_scas_appointment() to accept hyphens'
\echo '  2. Pattern now matches: A439019, A-439019, S123456, S-123456'
\echo '  3. Re-classified affected appointments'
\echo ''
