-- MIG_561: Classify Appointment Source Function
--
-- Determines the source category for an appointment based on:
-- - Owner name patterns (SCAS, Foster, LMFM)
-- - Ownership type field
-- - Appointment notes ($LMFM marker)
-- - Internal account patterns
--
-- Dependencies: MIG_560 (appointment_source_category column)

\echo ''
\echo '========================================================'
\echo 'MIG_561: Classify Appointment Source Function'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Helper Function - Check if LMFM
-- ============================================================

\echo 'Creating is_lmfm_appointment() helper...'

CREATE OR REPLACE FUNCTION trapper.is_lmfm_appointment(
  p_owner_first_name TEXT,
  p_owner_last_name TEXT,
  p_appointment_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_full_name TEXT;
BEGIN
  -- Check for $LMFM marker in appointment notes (strongest signal)
  IF p_appointment_notes IS NOT NULL AND p_appointment_notes ILIKE '%$LMFM%' THEN
    RETURN TRUE;
  END IF;

  -- Check for legacy LMFM prefix in owner name
  IF UPPER(TRIM(p_owner_first_name)) = 'LMFM' THEN
    RETURN TRUE;
  END IF;

  v_full_name := TRIM(COALESCE(p_owner_first_name, '') || ' ' || COALESCE(p_owner_last_name, ''));

  -- Check for ALL CAPS owner name (current LMFM pattern)
  -- Must be at least 3 chars, all uppercase letters/spaces
  -- Exclude single-word names to avoid false positives
  IF LENGTH(v_full_name) >= 3
     AND v_full_name ~ '^[A-Z ]+$'
     AND v_full_name LIKE '% %'  -- Must have at least one space (first + last)
     AND LENGTH(TRIM(p_owner_first_name)) > 1
     AND LENGTH(TRIM(p_owner_last_name)) > 1
  THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION trapper.is_lmfm_appointment IS
'Detects Love Me Fix Me waiver program appointments via:
1. $LMFM marker in appointment notes
2. Legacy "LMFM" prefix in owner first name
3. ALL CAPS owner name (current booking pattern, e.g., "DANIELLE HALL")';

-- ============================================================
-- PART 2: Helper Function - Check if SCAS/County
-- ============================================================

\echo 'Creating is_scas_appointment() helper...'

CREATE OR REPLACE FUNCTION trapper.is_scas_appointment(
  p_owner_first_name TEXT,
  p_owner_last_name TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  -- SCAS pattern: Last name is "SCAS", First name is A followed by digits (A439019)
  IF UPPER(TRIM(p_owner_last_name)) = 'SCAS'
     AND TRIM(p_owner_first_name) ~ '^A[0-9]+$'
  THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION trapper.is_scas_appointment IS
'Detects SCAS (Sonoma County Animal Services) county contract appointments.
Pattern: Owner last name = "SCAS", first name = SCAS animal ID (A439019 format)';

-- ============================================================
-- PART 3: Helper Function - Check if Foster Program
-- ============================================================

\echo 'Creating is_foster_program_appointment() helper...'

CREATE OR REPLACE FUNCTION trapper.is_foster_program_appointment(
  p_owner_first_name TEXT,
  p_owner_last_name TEXT,
  p_ownership_type TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_full_name TEXT;
BEGIN
  -- Check ownership_type field first (explicit Foster designation)
  IF LOWER(TRIM(COALESCE(p_ownership_type, ''))) = 'foster' THEN
    RETURN TRUE;
  END IF;

  v_full_name := LOWER(TRIM(COALESCE(p_owner_first_name, '') || ' ' || COALESCE(p_owner_last_name, '')));

  -- Check for foster account name patterns
  IF v_full_name LIKE '%forgotten felines foster%'
     OR v_full_name LIKE '%ff foster%'
     OR v_full_name LIKE '%ffsc foster%'
     OR v_full_name = 'foster program'
     OR v_full_name = 'foster'
  THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION trapper.is_foster_program_appointment IS
'Detects foster program appointments via:
1. ownership_type = "Foster" field
2. Owner name contains "Forgotten Felines Foster" or similar patterns';

-- ============================================================
-- PART 4: Main Classification Function
-- ============================================================

\echo 'Creating classify_appointment_source() function...'

CREATE OR REPLACE FUNCTION trapper.classify_appointment_source(
  p_owner_first_name TEXT,
  p_owner_last_name TEXT,
  p_ownership_type TEXT DEFAULT NULL,
  p_appointment_notes TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  -- Priority order matters: most specific patterns first

  -- 1. SCAS/County contract (most specific pattern)
  IF trapper.is_scas_appointment(p_owner_first_name, p_owner_last_name) THEN
    RETURN 'county_scas';
  END IF;

  -- 2. LMFM waiver program (check before foster since both can have special owners)
  IF trapper.is_lmfm_appointment(p_owner_first_name, p_owner_last_name, p_appointment_notes) THEN
    RETURN 'lmfm';
  END IF;

  -- 3. Foster program
  IF trapper.is_foster_program_appointment(p_owner_first_name, p_owner_last_name, p_ownership_type) THEN
    RETURN 'foster_program';
  END IF;

  -- 4. Other internal accounts (check against internal_account_types table)
  IF EXISTS (
    SELECT 1 FROM trapper.internal_account_types iat
    WHERE CASE iat.pattern_type
      WHEN 'exact' THEN LOWER(CONCAT_WS(' ', p_owner_first_name, p_owner_last_name)) = iat.account_pattern
      WHEN 'starts_with' THEN LOWER(CONCAT_WS(' ', p_owner_first_name, p_owner_last_name)) LIKE iat.account_pattern || '%'
      WHEN 'contains' THEN LOWER(CONCAT_WS(' ', p_owner_first_name, p_owner_last_name)) LIKE '%' || iat.account_pattern || '%'
      ELSE FALSE
    END
  ) THEN
    RETURN 'other_internal';
  END IF;

  -- 5. Default: regular public appointment
  RETURN 'regular';
END;
$$;

COMMENT ON FUNCTION trapper.classify_appointment_source IS
'Classifies an appointment into source categories for reporting:
- county_scas: SCAS county contract (A439019 SCAS pattern)
- lmfm: Love Me Fix Me waiver ($LMFM in notes or ALL CAPS name)
- foster_program: Foster account or ownership_type = Foster
- other_internal: Other FFSC internal accounts
- regular: Normal public appointments

Used to answer: "How many fosters/county cats did we fix?"';

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Testing classify_appointment_source():'

SELECT
  'SCAS cat (A439019)' as test_case,
  trapper.classify_appointment_source('A439019', 'SCAS', NULL, NULL) as result,
  'county_scas' as expected;

SELECT
  'LMFM via notes' as test_case,
  trapper.classify_appointment_source('John', 'Smith', NULL, '$LMFM Collect at discharge') as result,
  'lmfm' as expected;

SELECT
  'LMFM via ALL CAPS' as test_case,
  trapper.classify_appointment_source('DANIELLE', 'HALL', NULL, NULL) as result,
  'lmfm' as expected;

SELECT
  'Foster via ownership_type' as test_case,
  trapper.classify_appointment_source('Jane', 'Doe', 'Foster', NULL) as result,
  'foster_program' as expected;

SELECT
  'Foster via account name' as test_case,
  trapper.classify_appointment_source('Forgotten Felines', 'Foster', NULL, NULL) as result,
  'foster_program' as expected;

SELECT
  'Regular appointment' as test_case,
  trapper.classify_appointment_source('John', 'Smith', 'Owned', NULL) as result,
  'regular' as expected;

\echo ''
\echo '========================================================'
\echo 'MIG_561 Complete!'
\echo '========================================================'
\echo ''
\echo 'Next: Apply MIG_562 to backfill existing appointments'
\echo ''
