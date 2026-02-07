-- MIG_569: Backfill Appointment Categories via clinichq_visits
--
-- Uses the unified clinichq_visits table to properly classify appointments.
-- This is more reliable than staged_records since clinichq_visits has data
-- for all historical appointments.
--
-- Dependencies: MIG_560-561 (column and classification function)

\echo ''
\echo '========================================================'
\echo 'MIG_569: Backfill via clinichq_visits'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Create Backfill Function
-- ============================================================

\echo 'Creating backfill_categories_via_clinichq_visits() function...'

CREATE OR REPLACE FUNCTION trapper.backfill_categories_via_clinichq_visits()
RETURNS TABLE (
  total_appointments INT,
  matched_to_visits INT,
  foster_program INT,
  county_scas INT,
  lmfm INT,
  other_internal INT,
  regular INT
)
LANGUAGE plpgsql AS $$
DECLARE
  v_total INT;
  v_matched INT := 0;
  v_foster INT := 0;
  v_scas INT := 0;
  v_lmfm INT := 0;
  v_internal INT := 0;
  v_regular INT := 0;
BEGIN
  -- Get total appointments
  SELECT COUNT(*) INTO v_total FROM trapper.sot_appointments;

  -- Update using clinichq_visits join
  WITH classified AS (
    SELECT
      a.appointment_id,
      trapper.classify_appointment_source(
        cv.client_first_name,
        cv.client_last_name,
        cv.ownership_type,
        cv.internal_notes  -- Note: $LMFM marker may be in internal_notes
      ) as category
    FROM trapper.sot_appointments a
    JOIN trapper.clinichq_visits cv ON cv.appointment_number = a.appointment_number
  )
  UPDATE trapper.sot_appointments a
  SET appointment_source_category = c.category
  FROM classified c
  WHERE a.appointment_id = c.appointment_id
    AND a.appointment_source_category IS DISTINCT FROM c.category;

  GET DIAGNOSTICS v_matched = ROW_COUNT;

  -- Count by category
  SELECT COUNT(*) INTO v_foster
  FROM trapper.sot_appointments WHERE appointment_source_category = 'foster_program';

  SELECT COUNT(*) INTO v_scas
  FROM trapper.sot_appointments WHERE appointment_source_category = 'county_scas';

  SELECT COUNT(*) INTO v_lmfm
  FROM trapper.sot_appointments WHERE appointment_source_category = 'lmfm';

  SELECT COUNT(*) INTO v_internal
  FROM trapper.sot_appointments WHERE appointment_source_category = 'other_internal';

  SELECT COUNT(*) INTO v_regular
  FROM trapper.sot_appointments WHERE appointment_source_category = 'regular';

  RETURN QUERY SELECT v_total, v_matched, v_foster, v_scas, v_lmfm, v_internal, v_regular;
END;
$$;

COMMENT ON FUNCTION trapper.backfill_categories_via_clinichq_visits IS
'Backfills appointment_source_category using clinichq_visits unified table.
More reliable than staged_records for historical data.';

-- ============================================================
-- PART 2: Run the Backfill
-- ============================================================

\echo ''
\echo 'Running backfill...'

SELECT * FROM trapper.backfill_categories_via_clinichq_visits();

-- ============================================================
-- PART 3: Handle Remaining Uncategorized
-- ============================================================

\echo ''
\echo 'Setting remaining appointments without match to regular...'

-- Appointments without clinichq_visits match get 'regular'
UPDATE trapper.sot_appointments
SET appointment_source_category = 'regular'
WHERE appointment_source_category IS NULL;

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Final Category Distribution:'

SELECT
  appointment_source_category,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as pct
FROM trapper.sot_appointments
GROUP BY appointment_source_category
ORDER BY count DESC;

\echo ''
\echo 'Foster Program YTD (should have data now):'

SELECT * FROM trapper.v_foster_program_ytd;

\echo ''
\echo 'County Cat YTD (should have data now):'

SELECT * FROM trapper.v_county_cat_ytd;

\echo ''
\echo 'Program Comparison:'

SELECT year, foster_alterations, county_alterations, lmfm_alterations, total_alterations,
       foster_pct, county_pct, lmfm_pct
FROM trapper.v_program_comparison_ytd
WHERE year >= 2022
ORDER BY year DESC;

\echo ''
\echo '========================================================'
\echo 'MIG_569 Complete!'
\echo '========================================================'
\echo ''
