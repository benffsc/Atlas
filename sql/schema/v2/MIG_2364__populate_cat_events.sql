-- MIG_2364: Populate Cat Lifecycle Events from Existing Data
-- Purpose: Backfill cat_lifecycle_events from ops.appointments and sot.cats
--
-- Sources:
-- 1. ops.appointments (is_spay OR is_neuter) -> tnr_procedure events
-- 2. sot.cats (is_deceased = true) -> mortality events

-- Step 1: Insert TNR procedure events from appointments
INSERT INTO sot.cat_lifecycle_events (
  cat_id,
  event_type,
  event_subtype,
  event_at,
  person_id,
  place_id,
  metadata,
  source_system,
  source_record_id
)
SELECT
  a.cat_id,
  'tnr_procedure',
  CASE
    WHEN a.is_spay THEN 'spay'
    WHEN a.is_neuter THEN 'neuter'
    ELSE 'unknown'
  END as event_subtype,
  a.appointment_date::timestamptz as event_at,
  COALESCE(a.person_id, a.resolved_person_id) as person_id,
  COALESCE(a.place_id, a.inferred_place_id) as place_id,
  jsonb_build_object(
    'appointment_number', a.appointment_number,
    'has_ear_tip', a.has_ear_tip,
    'vet_name', a.vet_name,
    'technician', a.technician,
    'service_type', a.service_type,
    'felv_fiv_result', a.felv_fiv_result
  ) as metadata,
  'clinichq' as source_system,
  a.clinichq_appointment_id as source_record_id
FROM ops.appointments a
WHERE a.cat_id IS NOT NULL
  AND (a.is_spay = true OR a.is_neuter = true)
  -- Avoid duplicates
  AND NOT EXISTS (
    SELECT 1 FROM sot.cat_lifecycle_events e
    WHERE e.cat_id = a.cat_id
      AND e.event_type = 'tnr_procedure'
      AND e.source_record_id = a.clinichq_appointment_id
  );

-- Step 2: Insert mortality events from deceased cats
INSERT INTO sot.cat_lifecycle_events (
  cat_id,
  event_type,
  event_subtype,
  event_at,
  metadata,
  source_system,
  source_record_id
)
SELECT
  c.cat_id,
  'mortality',
  'unknown' as event_subtype,  -- We don't have cause of death in current data
  COALESCE(c.deceased_at, c.updated_at) as event_at,
  jsonb_build_object(
    'source', 'sot.cats.is_deceased'
  ) as metadata,
  COALESCE(c.source_system, 'atlas') as source_system,
  c.cat_id::text as source_record_id
FROM sot.cats c
WHERE c.is_deceased = true
  AND c.merged_into_cat_id IS NULL
  -- Avoid duplicates
  AND NOT EXISTS (
    SELECT 1 FROM sot.cat_lifecycle_events e
    WHERE e.cat_id = c.cat_id
      AND e.event_type = 'mortality'
  );

-- Report results
DO $$
DECLARE
  v_tnr_count INT;
  v_mortality_count INT;
  v_total INT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM sot.cat_lifecycle_events;
  SELECT COUNT(*) INTO v_tnr_count FROM sot.cat_lifecycle_events WHERE event_type = 'tnr_procedure';
  SELECT COUNT(*) INTO v_mortality_count FROM sot.cat_lifecycle_events WHERE event_type = 'mortality';

  RAISE NOTICE 'MIG_2364: Cat lifecycle events populated';
  RAISE NOTICE '  Total events: %', v_total;
  RAISE NOTICE '  TNR procedures: %', v_tnr_count;
  RAISE NOTICE '  Mortality events: %', v_mortality_count;
END $$;
