-- MIG_562: Backfill Appointment Source Categories
--
-- Populates appointment_source_category for all existing appointments
-- by looking up owner info from staged_records.
--
-- Dependencies: MIG_560 (column), MIG_561 (classification function)

\echo ''
\echo '========================================================'
\echo 'MIG_562: Backfill Appointment Source Categories'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Backfill Function
-- ============================================================

\echo 'Creating backfill_appointment_source_categories() function...'

CREATE OR REPLACE FUNCTION trapper.backfill_appointment_source_categories(
  p_batch_size INT DEFAULT 1000
)
RETURNS TABLE (
  processed INT,
  updated INT,
  already_set INT,
  no_staged_record INT
)
LANGUAGE plpgsql AS $$
DECLARE
  v_processed INT := 0;
  v_updated INT := 0;
  v_already_set INT := 0;
  v_no_staged_record INT := 0;
  v_rec RECORD;
  v_category TEXT;
  v_owner_first TEXT;
  v_owner_last TEXT;
  v_ownership_type TEXT;
  v_appt_notes TEXT;
BEGIN
  -- Process appointments that don't have a category yet
  FOR v_rec IN
    SELECT
      a.appointment_id,
      a.source_record_id
    FROM trapper.sot_appointments a
    WHERE a.appointment_source_category IS NULL
    LIMIT p_batch_size
  LOOP
    v_processed := v_processed + 1;

    -- Try to find staged record with owner info
    SELECT
      sr.payload->>'Owner First Name',
      sr.payload->>'Owner Last Name',
      sr.payload->>'Ownership',
      sr.payload->>'Appointment Notes'
    INTO v_owner_first, v_owner_last, v_ownership_type, v_appt_notes
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND sr.source_row_id = v_rec.source_record_id
    LIMIT 1;

    -- If no owner_info, try appointment_info
    IF v_owner_first IS NULL THEN
      SELECT
        sr.payload->>'Client First Name',
        sr.payload->>'Client Last Name',
        sr.payload->>'Ownership Type',
        sr.payload->>'Notes'
      INTO v_owner_first, v_owner_last, v_ownership_type, v_appt_notes
      FROM trapper.staged_records sr
      WHERE sr.source_system = 'clinichq'
        AND sr.source_table = 'appointment_info'
        AND sr.source_row_id = v_rec.source_record_id
      LIMIT 1;
    END IF;

    IF v_owner_first IS NOT NULL OR v_owner_last IS NOT NULL THEN
      v_category := trapper.classify_appointment_source(
        v_owner_first,
        v_owner_last,
        v_ownership_type,
        v_appt_notes
      );

      UPDATE trapper.sot_appointments
      SET appointment_source_category = v_category
      WHERE appointment_id = v_rec.appointment_id;

      IF FOUND THEN
        v_updated := v_updated + 1;
      END IF;
    ELSE
      v_no_staged_record := v_no_staged_record + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_updated, v_already_set, v_no_staged_record;
END;
$$;

COMMENT ON FUNCTION trapper.backfill_appointment_source_categories IS
'Backfills appointment_source_category for existing appointments by looking up
owner info from staged_records. Run repeatedly until no more uncategorized appointments.

Returns: (processed, updated, already_set, no_staged_record)';

-- ============================================================
-- PART 2: Run Initial Backfill
-- ============================================================

\echo ''
\echo 'Running initial backfill (may take a few minutes)...'

-- Run in batches to avoid long transaction
DO $$
DECLARE
  v_result RECORD;
  v_total_updated INT := 0;
  v_iteration INT := 0;
BEGIN
  LOOP
    v_iteration := v_iteration + 1;

    SELECT * INTO v_result
    FROM trapper.backfill_appointment_source_categories(2000);

    v_total_updated := v_total_updated + v_result.updated;

    RAISE NOTICE 'Iteration %: processed=%, updated=%, no_staged=%',
      v_iteration, v_result.processed, v_result.updated, v_result.no_staged_record;

    -- Exit when no more to process
    EXIT WHEN v_result.processed = 0;

    -- Safety limit
    EXIT WHEN v_iteration > 100;
  END LOOP;

  RAISE NOTICE 'Backfill complete. Total updated: %', v_total_updated;
END $$;

-- ============================================================
-- PART 3: Handle Appointments Without Staged Records
-- ============================================================

\echo ''
\echo 'Setting uncategorized appointments to regular...'

-- For appointments where we couldn't find staged records, default to 'regular'
UPDATE trapper.sot_appointments
SET appointment_source_category = 'regular'
WHERE appointment_source_category IS NULL;

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Category Distribution:'

SELECT
  appointment_source_category,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as pct
FROM trapper.sot_appointments
GROUP BY appointment_source_category
ORDER BY count DESC;

\echo ''
\echo 'Sample of each category:'

SELECT DISTINCT ON (appointment_source_category)
  appointment_source_category,
  appointment_number,
  appointment_date
FROM trapper.sot_appointments
WHERE appointment_source_category IS NOT NULL
ORDER BY appointment_source_category, appointment_date DESC;

\echo ''
\echo '========================================================'
\echo 'MIG_562 Complete!'
\echo '========================================================'
\echo ''
\echo 'Next: Apply MIG_563 for foster parent name extraction'
\echo ''
