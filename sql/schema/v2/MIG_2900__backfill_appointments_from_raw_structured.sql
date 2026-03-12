-- MIG_2900: Backfill ops.appointments columns from source.clinichq_raw structured fields (FFS-418)
--
-- Several structured fields in source.clinichq_raw appointment_service records
-- are NOT flowing to ops.appointments during ingest:
--   - temperature: 86,497 valid readings (90-110°F), 0 in appointments
--   - is_lactating: 5,015 "Yes" values, 0 in appointments
--   - has_dental_disease: 2,423 values (1,871 Severe + 552 Mild), 0 in appointments
--   - has_hernia: 74 values, 0 in appointments
--
-- Root cause: ingest pipeline casts "---" to NULL for these fields, but
-- may be failing silently or these fields were added after initial import.
--
-- This migration backfills from raw → appointments by matching on
-- appointment_number + appointment_date.
--
-- Safety: Only fills NULLs. Uses sot.is_positive_value() for boolean normalization.

BEGIN;

-- =============================================================================
-- Step 1: Backfill temperature
-- =============================================================================

UPDATE ops.appointments a
SET temperature = (r.payload->>'Temperature')::numeric
FROM source.clinichq_raw r
WHERE r.record_type = 'appointment_service'
  AND r.payload->>'Number' = a.appointment_number::text
  AND r.payload->>'Temperature' ~ '^\d+\.?\d*$'
  AND (r.payload->>'Temperature')::numeric BETWEEN 90 AND 110
  AND a.temperature IS NULL;

-- =============================================================================
-- Step 2: Backfill is_lactating
-- =============================================================================

UPDATE ops.appointments a
SET is_lactating = TRUE
FROM source.clinichq_raw r
WHERE r.record_type = 'appointment_service'
  AND r.payload->>'Number' = a.appointment_number::text
  AND sot.is_positive_value(r.payload->>'Lactating')
  AND (a.is_lactating IS NULL OR a.is_lactating = FALSE);

-- =============================================================================
-- Step 3: Backfill has_dental_disease
-- =============================================================================

UPDATE ops.appointments a
SET has_dental_disease = TRUE
FROM source.clinichq_raw r
WHERE r.record_type = 'appointment_service'
  AND r.payload->>'Number' = a.appointment_number::text
  AND r.payload->>'Dental Disease' IS NOT NULL
  AND r.payload->>'Dental Disease' NOT IN ('', '---', 'N/A', 'No', 'FALSE')
  AND (a.has_dental_disease IS NULL OR a.has_dental_disease = FALSE);

-- =============================================================================
-- Step 4: Backfill has_hernia
-- =============================================================================

UPDATE ops.appointments a
SET has_hernia = TRUE
FROM source.clinichq_raw r
WHERE r.record_type = 'appointment_service'
  AND r.payload->>'Number' = a.appointment_number::text
  AND sot.is_positive_value(r.payload->>'Hernia')
  AND (a.has_hernia IS NULL OR a.has_hernia = FALSE);

-- =============================================================================
-- Step 5: Flow new data to observation tables
-- =============================================================================

-- Lactating → reproductive observations (now that is_lactating is populated)
INSERT INTO ops.cat_reproductive_observations (
    cat_id, appointment_date, observation_type, is_lactating, source_field,
    source_system, evidence_source, extraction_confidence
)
SELECT DISTINCT ON (a.cat_id, a.appointment_date)
    a.cat_id, a.appointment_date, 'lactation', TRUE, 'is_lactating',
    'clinichq', 'api_export_structured', 0.95
FROM ops.appointments a
WHERE a.cat_id IS NOT NULL AND a.is_lactating = TRUE
  AND NOT EXISTS (
      SELECT 1 FROM ops.cat_reproductive_observations o
      WHERE o.cat_id = a.cat_id AND o.observation_type = 'lactation' AND o.appointment_date = a.appointment_date
  )
ORDER BY a.cat_id, a.appointment_date;

-- Dental disease → clinical observations
INSERT INTO ops.cat_clinical_observations (
    cat_id, appointment_date, condition_code, source_field,
    source_system, evidence_source, extraction_confidence
)
SELECT DISTINCT ON (a.cat_id, a.appointment_date)
    a.cat_id, a.appointment_date, 'dental_disease', 'has_dental_disease',
    'clinichq', 'api_export_structured', 0.95
FROM ops.appointments a
WHERE a.cat_id IS NOT NULL AND a.has_dental_disease = TRUE
  AND NOT EXISTS (
      SELECT 1 FROM ops.cat_clinical_observations o
      WHERE o.cat_id = a.cat_id AND o.condition_code = 'dental_disease' AND o.appointment_date = a.appointment_date
  )
ORDER BY a.cat_id, a.appointment_date;

-- Hernia → clinical observations
INSERT INTO ops.cat_clinical_observations (
    cat_id, appointment_date, condition_code, source_field,
    source_system, evidence_source, extraction_confidence
)
SELECT DISTINCT ON (a.cat_id, a.appointment_date)
    a.cat_id, a.appointment_date, 'hernia', 'has_hernia',
    'clinichq', 'api_export_structured', 0.95
FROM ops.appointments a
WHERE a.cat_id IS NOT NULL AND a.has_hernia = TRUE
  AND NOT EXISTS (
      SELECT 1 FROM ops.cat_clinical_observations o
      WHERE o.cat_id = a.cat_id AND o.condition_code = 'hernia' AND o.appointment_date = a.appointment_date
  )
ORDER BY a.cat_id, a.appointment_date;

-- =============================================================================
-- Verification
-- =============================================================================

DO $$
DECLARE
    v_temp INTEGER;
    v_lactating INTEGER;
    v_dental INTEGER;
    v_hernia INTEGER;
    v_clinical INTEGER;
    v_repro INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_temp FROM ops.appointments WHERE temperature IS NOT NULL;
    SELECT COUNT(*) INTO v_lactating FROM ops.appointments WHERE is_lactating = TRUE;
    SELECT COUNT(*) INTO v_dental FROM ops.appointments WHERE has_dental_disease = TRUE;
    SELECT COUNT(*) INTO v_hernia FROM ops.appointments WHERE has_hernia = TRUE;
    SELECT COUNT(*) INTO v_clinical FROM ops.cat_clinical_observations;
    SELECT COUNT(*) INTO v_repro FROM ops.cat_reproductive_observations;

    RAISE NOTICE 'MIG_2900: Backfill appointments from raw structured fields';
    RAISE NOTICE '  temperature: % appointments', v_temp;
    RAISE NOTICE '  is_lactating: % appointments', v_lactating;
    RAISE NOTICE '  has_dental_disease: % appointments', v_dental;
    RAISE NOTICE '  has_hernia: % appointments', v_hernia;
    RAISE NOTICE '  Clinical observations total: %', v_clinical;
    RAISE NOTICE '  Reproductive observations total: %', v_repro;
END $$;

COMMIT;
