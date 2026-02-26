-- MIG_2412: Add has_ear_tip Column to Appointments
-- Fixes: DATA_GAP_036 - Ear tip rate tracking
--
-- Adds a dedicated column to track ear tip status for easier querying
-- and to handle the case where ear tip data is unknown (NULL) vs confirmed absent (FALSE)

-- Add column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'ops' AND table_name = 'appointments' AND column_name = 'has_ear_tip'
  ) THEN
    ALTER TABLE ops.appointments ADD COLUMN has_ear_tip BOOLEAN;
    COMMENT ON COLUMN ops.appointments.has_ear_tip IS
      'Whether ear tip service was performed. NULL = unknown (export broken), FALSE = confirmed no ear tip, TRUE = ear tipped';
  END IF;
END $$;

-- Backfill from raw service data
-- Join appointments to their service lines using appointment_number (matches raw Number field)
WITH ear_tip_data AS (
  SELECT DISTINCT
    payload->>'Number' as appt_num,
    TRUE as has_ear_tip
  FROM source.clinichq_raw
  WHERE record_type = 'appointment_service'
    AND payload->>'Service / Subsidy' ILIKE '%ear tip%'
)
UPDATE ops.appointments a
SET has_ear_tip = COALESCE(e.has_ear_tip, FALSE)
FROM (
  -- Get appointments that have service data in raw (i.e., we can determine ear tip status)
  SELECT DISTINCT payload->>'Number' as appt_num
  FROM source.clinichq_raw
  WHERE record_type = 'appointment_service'
) s
LEFT JOIN ear_tip_data e ON e.appt_num = s.appt_num
WHERE a.appointment_number = s.appt_num
  AND a.has_ear_tip IS NULL;

-- Report results
DO $$
DECLARE
  v_total INT;
  v_true INT;
  v_false INT;
  v_null INT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM ops.appointments;
  SELECT COUNT(*) INTO v_true FROM ops.appointments WHERE has_ear_tip = TRUE;
  SELECT COUNT(*) INTO v_false FROM ops.appointments WHERE has_ear_tip = FALSE;
  SELECT COUNT(*) INTO v_null FROM ops.appointments WHERE has_ear_tip IS NULL;

  RAISE NOTICE 'has_ear_tip backfill complete:';
  RAISE NOTICE '  Total appointments: %', v_total;
  RAISE NOTICE '  Has ear tip (TRUE): %', v_true;
  RAISE NOTICE '  No ear tip (FALSE): %', v_false;
  RAISE NOTICE '  Unknown (NULL): %', v_null;
END $$;
