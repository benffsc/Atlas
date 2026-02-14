\echo '=== MIG_892: Process Euthanasia Appointments ==='
\echo ''
\echo 'Problem: Cats euthanized at clinic are not being marked as deceased,'
\echo 'and mortality events are not being created. This affects population'
\echo 'modeling and data completeness.'
\echo ''
\echo 'Solution: Function to detect euthanasia appointments and:'
\echo '  1. Mark the cat as deceased'
\echo '  2. Create a mortality event with death_cause = euthanasia'
\echo ''

-- ==============================================================
-- Create function to process euthanasia appointments
-- ==============================================================

CREATE OR REPLACE FUNCTION trapper.process_clinic_euthanasia(
  p_batch_size INT DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
  v_cats_marked_deceased INT := 0;
  v_mortality_events_created INT := 0;
  v_skipped_no_cat INT := 0;
  v_already_deceased INT := 0;
  v_rec RECORD;
BEGIN
  -- Find euthanasia appointments where cat is not marked deceased
  FOR v_rec IN
    SELECT DISTINCT ON (c.cat_id)
      a.appointment_id,
      a.appointment_date,
      a.service_type,
      a.medical_notes,
      a.place_id,
      c.cat_id,
      c.display_name,
      c.is_deceased
    FROM trapper.sot_appointments a
    JOIN trapper.sot_cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
    WHERE a.service_type ILIKE '%euthanasia%'
      AND c.is_deceased = FALSE
    ORDER BY c.cat_id, a.appointment_date DESC
    LIMIT p_batch_size
  LOOP
    -- Mark cat as deceased
    UPDATE trapper.sot_cats
    SET is_deceased = TRUE,
        deceased_date = v_rec.appointment_date,
        updated_at = NOW()
    WHERE cat_id = v_rec.cat_id
      AND is_deceased = FALSE;

    IF FOUND THEN
      v_cats_marked_deceased := v_cats_marked_deceased + 1;
    END IF;

    -- Create mortality event if doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM trapper.cat_mortality_events
      WHERE cat_id = v_rec.cat_id
    ) THEN
      INSERT INTO trapper.cat_mortality_events (
        cat_id,
        death_date,
        death_date_precision,
        death_year,
        death_month,
        death_cause,
        death_cause_notes,
        place_id,
        source_system,
        source_record_id,
        notes
      ) VALUES (
        v_rec.cat_id,
        v_rec.appointment_date,
        'exact',
        EXTRACT(YEAR FROM v_rec.appointment_date)::INT,
        EXTRACT(MONTH FROM v_rec.appointment_date)::INT,
        'euthanasia',
        v_rec.service_type,
        v_rec.place_id,
        'clinichq',
        v_rec.appointment_id::TEXT,
        v_rec.medical_notes
      );

      v_mortality_events_created := v_mortality_events_created + 1;
    END IF;
  END LOOP;

  -- Count appointments without cat links (for reporting)
  SELECT COUNT(*) INTO v_skipped_no_cat
  FROM trapper.sot_appointments a
  WHERE a.service_type ILIKE '%euthanasia%'
    AND a.cat_id IS NULL;

  -- Count already deceased
  SELECT COUNT(*) INTO v_already_deceased
  FROM trapper.sot_appointments a
  JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
  WHERE a.service_type ILIKE '%euthanasia%'
    AND c.is_deceased = TRUE;

  RETURN jsonb_build_object(
    'cats_marked_deceased', v_cats_marked_deceased,
    'mortality_events_created', v_mortality_events_created,
    'skipped_no_cat_linked', v_skipped_no_cat,
    'already_deceased', v_already_deceased
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_clinic_euthanasia IS
'Processes clinic euthanasia appointments to mark cats as deceased and create mortality events.
Called by entity-linking cron as part of catch-up processing.
Returns counts of cats marked deceased and mortality events created.';

-- ==============================================================
-- Run backfill
-- ==============================================================

\echo ''
\echo 'Running backfill for historical euthanasia appointments...'

SELECT * FROM trapper.process_clinic_euthanasia(1000);

\echo ''
\echo 'MIG_892 complete.'
\echo 'Euthanasia appointments now processed for mortality tracking.'
