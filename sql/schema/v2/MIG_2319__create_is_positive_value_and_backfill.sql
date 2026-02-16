-- ============================================================================
-- MIG_2319: Create is_positive_value() and Backfill All Boolean Flags
-- ============================================================================
-- Root Cause: V2 ingest route calls sot.is_positive_value() but the function
-- doesn't exist in V2 schema. It was only defined in V1 as trapper.is_positive_value().
--
-- This migration:
-- 1. Creates sot.is_positive_value() function (required for ingest)
-- 2. Backfills is_spay/is_neuter from ops.staged_records
-- 3. Backfills is_spay/is_neuter from sot.cats.altered_status as fallback
-- 4. Creates missing ops.cat_procedures records
-- 5. Updates service_type with backfill markers
--
-- Usage: psql -f MIG_2319__create_is_positive_value_and_backfill.sql
-- ============================================================================

\echo '=== MIG_2319: Create is_positive_value() and Backfill Boolean Flags ==='
\echo ''

BEGIN;

-- ============================================================================
-- Phase 1: Create sot.is_positive_value() function
-- ============================================================================
-- This is the canonical boolean value checker for ClinicHQ fields.
-- Without this, the V2 ingest route's SQL fails silently.

\echo 'Phase 1: Creating sot.is_positive_value() function...'

CREATE OR REPLACE FUNCTION sot.is_positive_value(val TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  -- Handles (case-insensitive):
  -- - Yes, TRUE, true, Y, Checked, Positive, 1
  -- - Left, Right, Bilateral (for cryptorchid location-specific fields)
  -- Returns FALSE for: NULL, empty string, any other value
  RETURN COALESCE(LOWER(TRIM(val)), '') IN
    ('yes', 'true', 'y', 'checked', 'positive', '1', 'left', 'right', 'bilateral');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION sot.is_positive_value IS
'Canonical boolean value checker for ClinicHQ fields.
Handles (case-insensitive): Yes, TRUE, true, Y, Checked, Positive, 1, Left, Right, Bilateral.
For location-specific fields like Cryptorchid, Left/Right/Bilateral indicate positive.

Usage:
  sot.is_positive_value(''Yes'') → TRUE
  sot.is_positive_value(''Checked'') → TRUE
  sot.is_positive_value(''Bilateral'') → TRUE (cryptorchid)
  sot.is_positive_value(''No'') → FALSE
  sot.is_positive_value(NULL) → FALSE

IMPORTANT: Always use this function for boolean extraction from raw payloads.
Never use = ''Yes'' or hardcoded IN clauses.';

\echo 'Created sot.is_positive_value() function.'

-- ============================================================================
-- Phase 2: Backfill from ops.staged_records (source of truth)
-- ============================================================================
-- The staged_records table contains the original ClinicHQ payload JSONB.
-- We can re-extract the boolean values using the new function.

\echo ''
\echo 'Phase 2: Backfilling is_spay/is_neuter from staged_records...'

DO $$
DECLARE
  v_from_staged INTEGER := 0;
  v_from_cats INTEGER := 0;
BEGIN
  -- Update appointments where we have matching staged records
  WITH staged_match AS (
    SELECT
      a.appointment_id,
      sot.is_positive_value(sr.payload->>'Spay') AS spay_from_staged,
      sot.is_positive_value(sr.payload->>'Neuter') AS neuter_from_staged,
      sr.payload->>'Service / Subsidy' AS service_from_staged,
      sr.payload->>'All Services' AS all_services_from_staged
    FROM ops.appointments a
    JOIN ops.staged_records sr ON (
      sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
      AND sr.payload->>'Number' = a.appointment_number
      AND sr.payload->>'Date' IS NOT NULL
      AND TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY') = a.appointment_date
    )
    WHERE a.source_system = 'clinichq'
      AND a.is_spay = FALSE
      AND a.is_neuter = FALSE
  ),
  updated AS (
    UPDATE ops.appointments a
    SET
      is_spay = sm.spay_from_staged,
      is_neuter = sm.neuter_from_staged,
      -- Also update service_type if it was empty
      service_type = CASE
        WHEN a.service_type IS NULL OR a.service_type = '' THEN
          COALESCE(NULLIF(sm.all_services_from_staged, ''), sm.service_from_staged)
        ELSE a.service_type
      END,
      updated_at = NOW()
    FROM staged_match sm
    WHERE a.appointment_id = sm.appointment_id
      AND (sm.spay_from_staged = TRUE OR sm.neuter_from_staged = TRUE)
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_from_staged FROM updated;

  RAISE NOTICE 'MIG_2319: Updated % appointments from staged_records', v_from_staged;

  -- ============================================================================
  -- Phase 3: Fallback to sot.cats.altered_status for remaining gaps
  -- ============================================================================
  -- For appointments where staged_records didn't have Spay/Neuter columns,
  -- use the cat's known altered_status (from cat_info processing).

  -- Update is_neuter from cats with altered_status = 'neutered'
  WITH earliest_neuter AS (
    SELECT DISTINCT ON (a.cat_id)
      a.appointment_id,
      a.cat_id,
      a.appointment_date
    FROM ops.appointments a
    JOIN sot.cats c ON c.cat_id = a.cat_id
    WHERE c.altered_status = 'neutered'
      AND c.sex = 'Male'
      AND a.is_neuter = FALSE
      AND a.is_spay = FALSE
    ORDER BY a.cat_id, a.appointment_date ASC
  ),
  neuter_updated AS (
    UPDATE ops.appointments a
    SET
      is_neuter = TRUE,
      service_type = CASE
        WHEN a.service_type IS NULL OR a.service_type = '' THEN 'Cat Neuter (backfilled from cat)'
        ELSE a.service_type || '; Cat Neuter (backfilled from cat)'
      END,
      updated_at = NOW()
    FROM earliest_neuter e
    WHERE a.appointment_id = e.appointment_id
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_from_cats FROM neuter_updated;

  RAISE NOTICE 'MIG_2319: Updated % neuter appointments from cat.altered_status', v_from_cats;

  -- Update is_spay from cats with altered_status = 'spayed'
  WITH earliest_spay AS (
    SELECT DISTINCT ON (a.cat_id)
      a.appointment_id,
      a.cat_id,
      a.appointment_date
    FROM ops.appointments a
    JOIN sot.cats c ON c.cat_id = a.cat_id
    WHERE c.altered_status = 'spayed'
      AND c.sex = 'Female'
      AND a.is_spay = FALSE
      AND a.is_neuter = FALSE
    ORDER BY a.cat_id, a.appointment_date ASC
  ),
  spay_updated AS (
    UPDATE ops.appointments a
    SET
      is_spay = TRUE,
      service_type = CASE
        WHEN a.service_type IS NULL OR a.service_type = '' THEN 'Cat Spay (backfilled from cat)'
        ELSE a.service_type || '; Cat Spay (backfilled from cat)'
      END,
      updated_at = NOW()
    FROM earliest_spay e
    WHERE a.appointment_id = e.appointment_id
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_from_cats FROM spay_updated;

  RAISE NOTICE 'MIG_2319: Updated % spay appointments from cat.altered_status', v_from_cats;
END;
$$;

-- ============================================================================
-- Phase 4: Create missing cat_procedures records
-- ============================================================================

\echo ''
\echo 'Phase 4: Creating missing cat_procedures records...'

DO $$
DECLARE
  v_neuter_procs INTEGER;
  v_spay_procs INTEGER;
BEGIN
  -- Create neuter procedures for appointments with is_neuter = TRUE
  INSERT INTO ops.cat_procedures (
    cat_id,
    appointment_id,
    procedure_type,
    procedure_date,
    status,
    is_spay,
    is_neuter,
    source_system,
    created_at
  )
  SELECT
    a.cat_id,
    a.appointment_id,
    'neuter',
    a.appointment_date,
    'completed',
    FALSE,
    TRUE,
    'backfill_mig_2319',
    NOW()
  FROM ops.appointments a
  WHERE a.is_neuter = TRUE
    AND a.cat_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM ops.cat_procedures cp
      WHERE cp.cat_id = a.cat_id AND cp.is_neuter = TRUE
    )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_neuter_procs = ROW_COUNT;
  RAISE NOTICE 'MIG_2319: Created % neuter procedures', v_neuter_procs;

  -- Create spay procedures for appointments with is_spay = TRUE
  INSERT INTO ops.cat_procedures (
    cat_id,
    appointment_id,
    procedure_type,
    procedure_date,
    status,
    is_spay,
    is_neuter,
    source_system,
    created_at
  )
  SELECT
    a.cat_id,
    a.appointment_id,
    'spay',
    a.appointment_date,
    'completed',
    TRUE,
    FALSE,
    'backfill_mig_2319',
    NOW()
  FROM ops.appointments a
  WHERE a.is_spay = TRUE
    AND a.cat_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM ops.cat_procedures cp
      WHERE cp.cat_id = a.cat_id AND cp.is_spay = TRUE
    )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_spay_procs = ROW_COUNT;
  RAISE NOTICE 'MIG_2319: Created % spay procedures', v_spay_procs;
END;
$$;

-- ============================================================================
-- Phase 5: Mark cats as altered_by_clinic where applicable
-- ============================================================================

\echo ''
\echo 'Phase 5: Marking cats as altered_by_clinic...'

DO $$
DECLARE
  v_marked INTEGER;
BEGIN
  UPDATE sot.cats c
  SET altered_by_clinic = TRUE
  FROM ops.appointments a
  WHERE a.cat_id = c.cat_id
    AND (a.is_spay = TRUE OR a.is_neuter = TRUE)
    AND c.altered_by_clinic IS DISTINCT FROM TRUE;

  GET DIAGNOSTICS v_marked = ROW_COUNT;
  RAISE NOTICE 'MIG_2319: Marked % cats as altered_by_clinic', v_marked;
END;
$$;

-- ============================================================================
-- Phase 6: Verification
-- ============================================================================

\echo ''
\echo 'Phase 6: Verification...'

DO $$
DECLARE
  v_total_appts INTEGER;
  v_with_spay INTEGER;
  v_with_neuter INTEGER;
  v_total_procs INTEGER;
  v_altered_cats INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total_appts FROM ops.appointments;
  SELECT COUNT(*) INTO v_with_spay FROM ops.appointments WHERE is_spay = TRUE;
  SELECT COUNT(*) INTO v_with_neuter FROM ops.appointments WHERE is_neuter = TRUE;
  SELECT COUNT(*) INTO v_total_procs FROM ops.cat_procedures;
  SELECT COUNT(*) INTO v_altered_cats FROM sot.cats WHERE altered_by_clinic = TRUE;

  RAISE NOTICE '=== MIG_2319 Verification ===';
  RAISE NOTICE 'Total appointments: %', v_total_appts;
  RAISE NOTICE 'Appointments with is_spay=TRUE: %', v_with_spay;
  RAISE NOTICE 'Appointments with is_neuter=TRUE: %', v_with_neuter;
  RAISE NOTICE 'Total cat_procedures: %', v_total_procs;
  RAISE NOTICE 'Cats marked altered_by_clinic: %', v_altered_cats;
END;
$$;

COMMIT;

\echo ''
\echo '=============================================='
\echo 'MIG_2319 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Created sot.is_positive_value() function'
\echo '  2. Backfilled is_spay/is_neuter from staged_records'
\echo '  3. Backfilled remaining gaps from cat.altered_status'
\echo '  4. Created missing cat_procedures records'
\echo '  5. Marked cats as altered_by_clinic'
\echo ''
\echo 'Root cause: sot.is_positive_value() did not exist in V2 schema.'
\echo 'The V2 ingest route called it, but the function was only in V1.'
\echo ''
