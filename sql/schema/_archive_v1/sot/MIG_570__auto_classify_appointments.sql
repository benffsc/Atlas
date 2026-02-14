-- MIG_570: Auto-Classify Appointments on Insert/Update
--
-- Ensures appointment_source_category is always populated:
-- 1. Creates a trigger that classifies new appointments
-- 2. Re-classifies when owner info is linked
--
-- This makes the classification stable across syncs.

\echo ''
\echo '========================================================'
\echo 'MIG_570: Auto-Classify Appointments'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Function to classify appointment from clinichq_visits
-- ============================================================

\echo 'Creating classify_appointment_from_visits() function...'

CREATE OR REPLACE FUNCTION trapper.classify_appointment_from_visits()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_category TEXT;
BEGIN
  -- Look up owner info from clinichq_visits
  SELECT trapper.classify_appointment_source(
    cv.client_first_name,
    cv.client_last_name,
    cv.ownership_type,
    cv.internal_notes
  ) INTO v_category
  FROM trapper.clinichq_visits cv
  WHERE cv.appointment_number = NEW.appointment_number
  LIMIT 1;

  -- Set category if found
  IF v_category IS NOT NULL THEN
    NEW.appointment_source_category := v_category;
  ELSE
    -- Default to 'regular' if no visit found
    NEW.appointment_source_category := COALESCE(NEW.appointment_source_category, 'regular');
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trapper.classify_appointment_from_visits IS
'Trigger function to auto-classify appointment_source_category based on clinichq_visits data.
Ensures all new appointments are categorized for foster/county/LMFM reporting.';

-- ============================================================
-- PART 2: Create Trigger
-- ============================================================

\echo 'Creating trigger on sot_appointments...'

-- Drop if exists to allow re-running
DROP TRIGGER IF EXISTS trg_classify_appointment ON trapper.sot_appointments;

CREATE TRIGGER trg_classify_appointment
  BEFORE INSERT OR UPDATE OF appointment_number
  ON trapper.sot_appointments
  FOR EACH ROW
  WHEN (NEW.appointment_source_category IS NULL OR NEW.appointment_source_category = 'regular')
  EXECUTE FUNCTION trapper.classify_appointment_from_visits();

COMMENT ON TRIGGER trg_classify_appointment ON trapper.sot_appointments IS
'Auto-classifies appointments into foster_program, county_scas, lmfm, etc.
Only fires when category is NULL or regular (allows manual overrides to persist).';

-- ============================================================
-- PART 3: Update function to re-classify on clinichq_visits update
-- ============================================================

\echo 'Creating sync_appointment_category_from_visits() function...'

CREATE OR REPLACE FUNCTION trapper.sync_appointment_category_from_visits()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- Update any appointments that match this visit
  UPDATE trapper.sot_appointments
  SET appointment_source_category = trapper.classify_appointment_source(
    NEW.client_first_name,
    NEW.client_last_name,
    NEW.ownership_type,
    NEW.internal_notes
  )
  WHERE appointment_number = NEW.appointment_number
    AND (appointment_source_category IS NULL OR appointment_source_category = 'regular');

  RETURN NEW;
END;
$$;

-- Create trigger on clinichq_visits to sync categories
DROP TRIGGER IF EXISTS trg_sync_appt_category ON trapper.clinichq_visits;

CREATE TRIGGER trg_sync_appt_category
  AFTER INSERT OR UPDATE OF client_first_name, client_last_name, ownership_type, internal_notes
  ON trapper.clinichq_visits
  FOR EACH ROW
  EXECUTE FUNCTION trapper.sync_appointment_category_from_visits();

COMMENT ON TRIGGER trg_sync_appt_category ON trapper.clinichq_visits IS
'When clinichq_visits owner info changes, sync the category to sot_appointments.
Ensures categories stay in sync as data is ingested.';

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Triggers created:'

SELECT tgname, tgrelid::regclass, tgenabled
FROM pg_trigger
WHERE tgname IN ('trg_classify_appointment', 'trg_sync_appt_category')
ORDER BY tgrelid::regclass::text;

\echo ''
\echo '========================================================'
\echo 'MIG_570 Complete!'
\echo '========================================================'
\echo ''
\echo 'New appointments will be auto-classified based on:'
\echo '  - Owner name patterns (foster, SCAS, LMFM)'
\echo '  - ownership_type field'
\echo '  - $LMFM markers in notes'
\echo ''
\echo 'Classifications are stable:'
\echo '  - New ingests trigger re-classification'
\echo '  - Manual overrides (non-regular) are preserved'
\echo ''
