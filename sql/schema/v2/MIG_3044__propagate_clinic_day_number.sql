-- MIG_3044: Propagate clinic_day_number from master list entries to appointments
-- Discovery: MIG_2812 propagates appointment_id and cat_id from master list matches
-- to entries, but never copies the line_number (which IS the clinic_day_number) back
-- to ops.appointments. The master list line_number is stranded on clinic_day_entries.

BEGIN;

-- Step 1: Backfill existing data — copy line_number from matched entries to appointments
UPDATE ops.appointments a
SET clinic_day_number = e.line_number
FROM ops.clinic_day_entries e
WHERE e.appointment_id = a.appointment_id
  AND a.clinic_day_number IS NULL          -- don't overwrite manual assignments
  AND e.line_number IS NOT NULL
  AND a.merged_into_appointment_id IS NULL;

-- Step 2: Update ops.propagate_master_list_matches() to include this step going forward
CREATE OR REPLACE FUNCTION ops.propagate_master_list_matches()
RETURNS TABLE(appointments_updated INT, cats_linked INT, numbers_propagated INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_appointments_updated INT := 0;
  v_cats_linked INT := 0;
  v_numbers_propagated INT := 0;
BEGIN
  -- Propagate appointment_id from entries to appointments (existing logic)
  -- This is handled by the matching engine when it sets matched_appointment_id

  -- Propagate cat_id from appointments to entries that matched
  UPDATE ops.clinic_day_entries e
  SET cat_id = a.cat_id
  FROM ops.appointments a
  WHERE e.appointment_id = a.appointment_id
    AND e.cat_id IS NULL
    AND a.cat_id IS NOT NULL
    AND a.merged_into_appointment_id IS NULL;
  GET DIAGNOSTICS v_cats_linked = ROW_COUNT;

  -- NEW: Propagate clinic_day_number from entries to appointments
  UPDATE ops.appointments a
  SET clinic_day_number = e.line_number
  FROM ops.clinic_day_entries e
  WHERE e.appointment_id = a.appointment_id
    AND a.clinic_day_number IS NULL
    AND e.line_number IS NOT NULL
    AND a.merged_into_appointment_id IS NULL;
  GET DIAGNOSTICS v_numbers_propagated = ROW_COUNT;

  RETURN QUERY SELECT v_appointments_updated, v_cats_linked, v_numbers_propagated;
END;
$$;

-- Step 3: Index for fast lookup by date + clinic_day_number
-- NOT unique — one master list line can cover multiple cats (e.g., "Crystal Furtado, 2 cats")
-- which creates multiple appointments sharing the same clinic_day_number
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_day_number_date
  ON ops.appointments (appointment_date, clinic_day_number)
  WHERE clinic_day_number IS NOT NULL
    AND merged_into_appointment_id IS NULL;

COMMIT;
