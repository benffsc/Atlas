-- MIG_3082: Flag Ben's manual clinic_day_number assignments as manually overridden
-- FFS-1233: Ben manually assigned clinic_day_numbers from ~Feb 2026 through mid-March 2026
-- by reviewing clinic day photos, finding cats via waiver/microchip, and assigning numbers.
-- These were set BEFORE the debug trigger (MIG_3048) existed, so they have no audit trail.
-- The 04/08 master list backfill (FFS-1088) respected them (WHERE clinic_day_number IS NULL).
--
-- This migration:
-- 1. Flags them as manually_overridden so CDS/propagation never touches them
-- 2. Sets clinic_day_number_source = 'manual' for provenance
-- These serve as GROUND TRUTH for CDS benchmarking.

-- Step 1: Flag manual CDN assignments
-- Criteria: has clinic_day_number but NO debug_clinic_day_number_writes entry
-- (meaning set before the trigger existed — Ben's manual work)
UPDATE ops.appointments a
SET
  manually_overridden_fields = array_append(
    COALESCE(manually_overridden_fields, '{}'),
    'clinic_day_number'
  ),
  clinic_day_number_source = 'manual'
WHERE a.clinic_day_number IS NOT NULL
  AND a.merged_into_appointment_id IS NULL
  AND NOT ('clinic_day_number' = ANY(COALESCE(a.manually_overridden_fields, '{}')))
  AND NOT EXISTS (
    SELECT 1 FROM ops.debug_clinic_day_number_writes d
    WHERE d.appointment_id = a.appointment_id
  );

-- Verification
DO $$
DECLARE
  v_protected INT;
  v_by_date RECORD;
BEGIN
  SELECT COUNT(*) INTO v_protected
  FROM ops.appointments
  WHERE 'clinic_day_number' = ANY(manually_overridden_fields)
    AND merged_into_appointment_id IS NULL;

  RAISE NOTICE 'MIG_3082: % appointments now have clinic_day_number flagged as manually overridden', v_protected;
  RAISE NOTICE '';
  RAISE NOTICE 'By date (Ben''s manual ground truth):';

  FOR v_by_date IN
    SELECT appointment_date, COUNT(*) as ct
    FROM ops.appointments
    WHERE 'clinic_day_number' = ANY(manually_overridden_fields)
      AND merged_into_appointment_id IS NULL
      AND appointment_date >= '2026-01-01'
    GROUP BY appointment_date ORDER BY appointment_date
  LOOP
    RAISE NOTICE '  %: % appointments', v_by_date.appointment_date, v_by_date.ct;
  END LOOP;
END $$;
