-- MIG_2318: Backfill alteration data from cat.altered_status to appointments
--
-- Problem: Many appointments have is_spay/is_neuter = FALSE even when the cat
-- is altered. This is because the ingest didn't parse service items properly.
--
-- This migration:
-- 1. Updates ops.appointments.is_neuter from sot.cats.altered_status = 'neutered'
-- 2. Updates ops.appointments.is_spay from sot.cats.altered_status = 'spayed'
-- 3. Creates ops.cat_procedures records for altered cats without procedures
-- 4. Updates service_type on appointments that performed alterations
--
-- Usage: psql -f MIG_2318__backfill_alteration_data.sql

BEGIN;

-- ============================================================
-- 1. Backfill is_neuter on appointments for neutered cats
-- ============================================================

DO $$
DECLARE
  v_neutered_count INTEGER;
BEGIN
  -- Update appointments where cat is neutered but is_neuter = FALSE
  -- Only update the EARLIEST appointment (likely the alteration appointment)
  WITH earliest_appts AS (
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
  )
  UPDATE ops.appointments a
  SET
    is_neuter = TRUE,
    service_type = CASE
      WHEN a.service_type IS NULL OR a.service_type = '' THEN 'Cat Neuter (backfilled)'
      ELSE a.service_type || '; Cat Neuter (backfilled)'
    END,
    updated_at = NOW()
  FROM earliest_appts e
  WHERE a.appointment_id = e.appointment_id;

  GET DIAGNOSTICS v_neutered_count = ROW_COUNT;
  RAISE NOTICE 'MIG_2318: Updated % appointments with is_neuter = TRUE', v_neutered_count;
END;
$$;

-- ============================================================
-- 2. Backfill is_spay on appointments for spayed cats
-- ============================================================

DO $$
DECLARE
  v_spayed_count INTEGER;
BEGIN
  WITH earliest_appts AS (
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
  )
  UPDATE ops.appointments a
  SET
    is_spay = TRUE,
    service_type = CASE
      WHEN a.service_type IS NULL OR a.service_type = '' THEN 'Cat Spay (backfilled)'
      ELSE a.service_type || '; Cat Spay (backfilled)'
    END,
    updated_at = NOW()
  FROM earliest_appts e
  WHERE a.appointment_id = e.appointment_id;

  GET DIAGNOSTICS v_spayed_count = ROW_COUNT;
  RAISE NOTICE 'MIG_2318: Updated % appointments with is_spay = TRUE', v_spayed_count;
END;
$$;

-- ============================================================
-- 3. Create cat_procedures for altered cats missing procedures
-- ============================================================

DO $$
DECLARE
  v_neuter_procs INTEGER;
  v_spay_procs INTEGER;
BEGIN
  -- Create neuter procedures
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
    'backfill_mig_2318',
    NOW()
  FROM ops.appointments a
  JOIN sot.cats c ON c.cat_id = a.cat_id
  WHERE a.is_neuter = TRUE
    AND NOT EXISTS (
      SELECT 1 FROM ops.cat_procedures cp
      WHERE cp.cat_id = a.cat_id AND cp.is_neuter = TRUE
    )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_neuter_procs = ROW_COUNT;
  RAISE NOTICE 'MIG_2318: Created % neuter procedures', v_neuter_procs;

  -- Create spay procedures
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
    'backfill_mig_2318',
    NOW()
  FROM ops.appointments a
  JOIN sot.cats c ON c.cat_id = a.cat_id
  WHERE a.is_spay = TRUE
    AND NOT EXISTS (
      SELECT 1 FROM ops.cat_procedures cp
      WHERE cp.cat_id = a.cat_id AND cp.is_spay = TRUE
    )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_spay_procs = ROW_COUNT;
  RAISE NOTICE 'MIG_2318: Created % spay procedures', v_spay_procs;
END;
$$;

-- ============================================================
-- 4. Verification
-- ============================================================

DO $$
DECLARE
  v_altered_cats INTEGER;
  v_cats_with_procs INTEGER;
  v_appts_with_alteration INTEGER;
BEGIN
  -- Count altered cats
  SELECT COUNT(*) INTO v_altered_cats
  FROM sot.cats
  WHERE altered_status IN ('spayed', 'neutered')
    AND merged_into_cat_id IS NULL;

  -- Count cats with procedures
  SELECT COUNT(DISTINCT cat_id) INTO v_cats_with_procs
  FROM ops.cat_procedures
  WHERE is_spay = TRUE OR is_neuter = TRUE;

  -- Count appointments with alteration flags
  SELECT COUNT(*) INTO v_appts_with_alteration
  FROM ops.appointments
  WHERE is_spay = TRUE OR is_neuter = TRUE;

  RAISE NOTICE '=== MIG_2318 Verification ===';
  RAISE NOTICE 'Altered cats: %', v_altered_cats;
  RAISE NOTICE 'Cats with alteration procedures: %', v_cats_with_procs;
  RAISE NOTICE 'Appointments with alteration flags: %', v_appts_with_alteration;
END;
$$;

COMMIT;
