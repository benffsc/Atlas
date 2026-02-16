-- ============================================================================
-- MIG_2320: Add Enriched Columns to ops.appointments
-- ============================================================================
-- Issue: V2 ops.appointments is missing columns that existed in V1, causing
-- the appointment detail API to fail with "column does not exist" errors.
--
-- Missing columns from V1:
-- - clinic_day_number (MIG_870)
-- - Health screening flags (has_uri, has_fleas, etc.) (MIG_870)
-- - Misc flags (has_polydactyl, has_cryptorchid, etc.) (MIG_899)
-- - Financial (total_invoiced, subsidy_value) (MIG_871)
-- - Cat vitals (cat_weight_lbs, cat_age_years, cat_age_months) (MIG_870)
-- - felv_fiv_result, body_composition_score, no_surgery_reason (MIG_870)
-- - ownership_type (MIG_2054)
-- - resolved_person_id (identity resolution) (MIG_2058)
-- - clinichq_appointment_id (MIG_2058)
--
-- This migration:
-- 1. Adds missing columns to ops.appointments
-- 2. Updates ops.v_appointment_detail view to include all columns
-- 3. Backfills columns from ops.staged_records where available
-- ============================================================================

\echo '=== MIG_2320: Add Enriched Columns to ops.appointments ==='
\echo ''

BEGIN;

-- ============================================================================
-- Phase 1: Add Missing Columns
-- ============================================================================

\echo 'Phase 1: Adding missing columns to ops.appointments...'

-- Clinic day number for scheduling
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS clinic_day_number INTEGER;

-- Health screening flags (MIG_870)
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS has_uri BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS has_dental_disease BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS has_ear_issue BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS has_eye_issue BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS has_skin_issue BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS has_mouth_issue BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS has_fleas BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS has_ticks BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS has_tapeworms BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS has_ear_mites BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS has_ringworm BOOLEAN DEFAULT FALSE;

-- Misc flags (MIG_899)
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS has_polydactyl BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS has_bradycardia BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS has_too_young_for_rabies BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS has_cryptorchid BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS has_hernia BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS has_pyometra BOOLEAN DEFAULT FALSE;

-- Test results and body condition
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS felv_fiv_result TEXT;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS body_composition_score TEXT;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS no_surgery_reason TEXT;

-- Financial
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS total_invoiced NUMERIC(10,2);
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS subsidy_value NUMERIC(10,2);

-- Cat snapshot at appointment time
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS cat_weight_lbs NUMERIC(5,2);
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS cat_age_years INTEGER;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS cat_age_months INTEGER;

-- Ownership type
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS ownership_type TEXT;

-- Identity resolution
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS resolved_person_id UUID REFERENCES sot.people(person_id);
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS clinichq_appointment_id TEXT;

\echo 'Added columns to ops.appointments'

-- ============================================================================
-- Phase 2: Update the View
-- ============================================================================

\echo ''
\echo 'Phase 2: Updating ops.v_appointment_detail view...'

-- Must drop first because column order changed
DROP VIEW IF EXISTS ops.v_appointment_detail;

CREATE VIEW ops.v_appointment_detail AS
SELECT
  a.appointment_id,
  a.appointment_date,
  a.appointment_number,
  a.clinic_day_number,
  a.clinichq_appointment_id,
  -- Computed appointment category
  CASE
    WHEN a.is_spay OR a.is_neuter THEN 'Spay/Neuter'
    WHEN a.service_type ILIKE '%wellness%' OR a.service_type ILIKE '%exam%' THEN 'Wellness'
    WHEN a.service_type ILIKE '%recheck%' OR a.service_type ILIKE '%follow%' THEN 'Recheck'
    WHEN a.service_type ILIKE '%euthan%' THEN 'Euthanasia'
    ELSE 'Other'
  END AS appointment_category,
  a.service_type,
  a.is_spay,
  a.is_neuter,
  a.is_alteration,
  a.vet_name,
  a.technician,
  a.temperature,
  a.medical_notes,
  a.is_lactating,
  a.is_pregnant,
  a.is_in_heat,
  -- Health screening flags
  COALESCE(a.has_uri, FALSE) AS has_uri,
  COALESCE(a.has_dental_disease, FALSE) AS has_dental_disease,
  COALESCE(a.has_ear_issue, FALSE) AS has_ear_issue,
  COALESCE(a.has_eye_issue, FALSE) AS has_eye_issue,
  COALESCE(a.has_skin_issue, FALSE) AS has_skin_issue,
  COALESCE(a.has_mouth_issue, FALSE) AS has_mouth_issue,
  COALESCE(a.has_fleas, FALSE) AS has_fleas,
  COALESCE(a.has_ticks, FALSE) AS has_ticks,
  COALESCE(a.has_tapeworms, FALSE) AS has_tapeworms,
  COALESCE(a.has_ear_mites, FALSE) AS has_ear_mites,
  COALESCE(a.has_ringworm, FALSE) AS has_ringworm,
  -- Misc flags
  COALESCE(a.has_polydactyl, FALSE) AS has_polydactyl,
  COALESCE(a.has_bradycardia, FALSE) AS has_bradycardia,
  COALESCE(a.has_too_young_for_rabies, FALSE) AS has_too_young_for_rabies,
  COALESCE(a.has_cryptorchid, FALSE) AS has_cryptorchid,
  COALESCE(a.has_hernia, FALSE) AS has_hernia,
  COALESCE(a.has_pyometra, FALSE) AS has_pyometra,
  -- Test results / body condition
  a.felv_fiv_result,
  a.body_composition_score,
  a.no_surgery_reason,
  -- Financial
  a.total_invoiced,
  a.subsidy_value,
  -- Cat vitals snapshot
  a.cat_weight_lbs,
  a.cat_age_years,
  a.cat_age_months,
  -- Ownership
  a.ownership_type,
  -- Cat info
  a.cat_id,
  c.name AS cat_name,
  c.microchip AS cat_microchip,
  c.sex AS cat_sex,
  c.altered_status AS cat_altered_status,
  c.breed AS cat_breed,
  c.primary_color AS cat_color,
  c.secondary_color AS cat_secondary_color,
  -- Person info (resolved or original)
  COALESCE(a.resolved_person_id, a.person_id) AS person_id,
  COALESCE(p.display_name, p.first_name || ' ' || p.last_name) AS person_name,
  -- Contact info (from person identifiers)
  (SELECT pi.id_value_raw FROM sot.person_identifiers pi
   WHERE pi.person_id = COALESCE(a.resolved_person_id, a.person_id)
   AND pi.id_type = 'email' AND pi.confidence >= 0.5
   ORDER BY pi.confidence DESC LIMIT 1) AS contact_email,
  (SELECT pi.id_value_norm FROM sot.person_identifiers pi
   WHERE pi.person_id = COALESCE(a.resolved_person_id, a.person_id)
   AND pi.id_type = 'phone' AND pi.confidence >= 0.5
   ORDER BY pi.confidence DESC LIMIT 1) AS contact_phone,
  -- Place info (inferred takes precedence)
  COALESCE(a.inferred_place_id, a.place_id) AS place_id,
  pl.display_name AS place_name,
  pl.formatted_address AS place_address,
  -- Owner info from raw payload (denormalized)
  a.owner_email,
  a.owner_phone,
  a.owner_first_name,
  a.owner_last_name,
  a.owner_address,
  COALESCE(NULLIF(TRIM(a.owner_first_name || ' ' || COALESCE(a.owner_last_name, '')), ''), '') AS client_name,
  a.owner_address AS client_address,
  -- Source tracking
  a.source_system,
  a.source_record_id,
  a.created_at,
  a.updated_at,
  a.original_created_at
FROM ops.appointments a
LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
LEFT JOIN sot.people p ON p.person_id = COALESCE(a.resolved_person_id, a.person_id) AND p.merged_into_person_id IS NULL
LEFT JOIN sot.places pl ON pl.place_id = COALESCE(a.inferred_place_id, a.place_id) AND pl.merged_into_place_id IS NULL;

\echo 'Updated ops.v_appointment_detail view'

-- ============================================================================
-- Phase 3: Backfill from source.clinichq_raw (appointment_service records)
-- ============================================================================
-- Note: Requires MIG_2319 to have been applied first (creates sot.is_positive_value)
-- V2 stores raw data in source.clinichq_raw, not ops.staged_records
-- Join via clinichq_appointment_id which is 'YYYY-MM-DD_microchip'

\echo ''
\echo 'Phase 3: Backfilling health flags from source.clinichq_raw...'

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Check if is_positive_value exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'sot' AND p.proname = 'is_positive_value'
  ) THEN
    RAISE NOTICE 'sot.is_positive_value() does not exist. Run MIG_2319 first.';
    RAISE NOTICE 'Skipping backfill.';
    RETURN;
  END IF;

  -- Backfill health flags from appointment_service records
  WITH raw_appt AS (
    SELECT
      a.appointment_id,
      -- Health screening (only set TRUE, never overwrite with FALSE)
      sot.is_positive_value(COALESCE(cr.payload->>'URI', cr.payload->>'Upper Respiratory Issue')) AS has_uri,
      sot.is_positive_value(cr.payload->>'Dental Disease') AS has_dental_disease,
      sot.is_positive_value(COALESCE(cr.payload->>'Ear Issue', cr.payload->>'Ear infections')) AS has_ear_issue,
      sot.is_positive_value(cr.payload->>'Eye Issue') AS has_eye_issue,
      sot.is_positive_value(cr.payload->>'Skin Issue') AS has_skin_issue,
      sot.is_positive_value(cr.payload->>'Mouth Issue') AS has_mouth_issue,
      sot.is_positive_value(COALESCE(cr.payload->>'Fleas', cr.payload->>'Fleas/Ticks')) AS has_fleas,
      sot.is_positive_value(cr.payload->>'Ticks') AS has_ticks,
      sot.is_positive_value(cr.payload->>'Tapeworms') AS has_tapeworms,
      sot.is_positive_value(cr.payload->>'Ear mites') AS has_ear_mites,
      sot.is_positive_value(cr.payload->>'Wood''s Lamp Ringworm Test') AS has_ringworm,
      -- Misc flags
      sot.is_positive_value(cr.payload->>'Polydactyl') AS has_polydactyl,
      sot.is_positive_value(cr.payload->>'Bradycardia Intra-Op') AS has_bradycardia,
      sot.is_positive_value(cr.payload->>'Too young for rabies') AS has_too_young_for_rabies,
      sot.is_positive_value(cr.payload->>'Cryptorchid') AS has_cryptorchid,
      sot.is_positive_value(cr.payload->>'Hernia') AS has_hernia,
      sot.is_positive_value(cr.payload->>'Pyometra') AS has_pyometra,
      -- Text fields
      NULLIF(TRIM(cr.payload->>'FeLV/FIV (SNAP test, in-house)'), '') AS felv_fiv_result,
      NULLIF(TRIM(cr.payload->>'Body Composition Score'), '') AS body_composition_score,
      NULLIF(TRIM(cr.payload->>'No Surgery Reason'), '') AS no_surgery_reason,
      NULLIF(TRIM(cr.payload->>'Service / Subsidy'), '') AS service_type_raw,
      cr.payload->>'Number' AS appointment_number_raw,
      -- Financial
      CASE
        WHEN cr.payload->>'Total Invoiced' ~ '^[\$]?[0-9]+\.?[0-9]*$'
        THEN REPLACE(cr.payload->>'Total Invoiced', '$', '')::NUMERIC(10,2)
        ELSE NULL
      END AS total_invoiced,
      CASE
        WHEN cr.payload->>'Sub Value' ~ '^[\$]?[0-9]+\.?[0-9]*$'
        THEN REPLACE(cr.payload->>'Sub Value', '$', '')::NUMERIC(10,2)
        ELSE NULL
      END AS subsidy_value
    FROM ops.appointments a
    JOIN source.clinichq_raw cr ON (
      cr.record_type = 'appointment_service'
      AND cr.payload->>'Microchip Number' = SPLIT_PART(a.clinichq_appointment_id, '_', 2)
      AND TO_DATE(cr.payload->>'Date', 'MM/DD/YYYY') = a.appointment_date
    )
    WHERE a.clinichq_appointment_id IS NOT NULL
  )
  UPDATE ops.appointments a
  SET
    -- Health flags: only set TRUE, preserve existing TRUE values
    has_uri = a.has_uri OR COALESCE(r.has_uri, FALSE),
    has_dental_disease = a.has_dental_disease OR COALESCE(r.has_dental_disease, FALSE),
    has_ear_issue = a.has_ear_issue OR COALESCE(r.has_ear_issue, FALSE),
    has_eye_issue = a.has_eye_issue OR COALESCE(r.has_eye_issue, FALSE),
    has_skin_issue = a.has_skin_issue OR COALESCE(r.has_skin_issue, FALSE),
    has_mouth_issue = a.has_mouth_issue OR COALESCE(r.has_mouth_issue, FALSE),
    has_fleas = a.has_fleas OR COALESCE(r.has_fleas, FALSE),
    has_ticks = a.has_ticks OR COALESCE(r.has_ticks, FALSE),
    has_tapeworms = a.has_tapeworms OR COALESCE(r.has_tapeworms, FALSE),
    has_ear_mites = a.has_ear_mites OR COALESCE(r.has_ear_mites, FALSE),
    has_ringworm = a.has_ringworm OR COALESCE(r.has_ringworm, FALSE),
    has_polydactyl = a.has_polydactyl OR COALESCE(r.has_polydactyl, FALSE),
    has_bradycardia = a.has_bradycardia OR COALESCE(r.has_bradycardia, FALSE),
    has_too_young_for_rabies = a.has_too_young_for_rabies OR COALESCE(r.has_too_young_for_rabies, FALSE),
    has_cryptorchid = a.has_cryptorchid OR COALESCE(r.has_cryptorchid, FALSE),
    has_hernia = a.has_hernia OR COALESCE(r.has_hernia, FALSE),
    has_pyometra = a.has_pyometra OR COALESCE(r.has_pyometra, FALSE),
    -- Text fields: fill only if empty
    felv_fiv_result = COALESCE(a.felv_fiv_result, r.felv_fiv_result),
    body_composition_score = COALESCE(a.body_composition_score, r.body_composition_score),
    no_surgery_reason = COALESCE(a.no_surgery_reason, r.no_surgery_reason),
    service_type = COALESCE(a.service_type, r.service_type_raw),
    appointment_number = COALESCE(a.appointment_number, r.appointment_number_raw),
    total_invoiced = COALESCE(a.total_invoiced, r.total_invoiced),
    subsidy_value = COALESCE(a.subsidy_value, r.subsidy_value),
    updated_at = NOW()
  FROM raw_appt r
  WHERE a.appointment_id = r.appointment_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'MIG_2320: Backfilled health flags for % appointments', v_count;
END;
$$;

-- ============================================================================
-- Phase 4: Backfill weight and age from source.clinichq_raw (cat records)
-- ============================================================================

\echo ''
\echo 'Phase 4: Backfilling weight and age from cat records...'

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH raw_cat AS (
    SELECT
      a.appointment_id,
      CASE
        WHEN cr.payload->>'Weight' ~ '^[0-9]+\.?[0-9]*$'
        THEN (cr.payload->>'Weight')::NUMERIC(5,2)
        ELSE NULL
      END AS cat_weight_lbs,
      CASE
        WHEN cr.payload->>'Age Years' ~ '^[0-9]+$'
        THEN (cr.payload->>'Age Years')::INTEGER
        ELSE NULL
      END AS cat_age_years,
      CASE
        WHEN cr.payload->>'Age Months' ~ '^[0-9]+$'
        THEN (cr.payload->>'Age Months')::INTEGER
        ELSE NULL
      END AS cat_age_months
    FROM ops.appointments a
    JOIN source.clinichq_raw cr ON (
      cr.record_type = 'cat'
      AND cr.payload->>'Microchip Number' = SPLIT_PART(a.clinichq_appointment_id, '_', 2)
      AND TO_DATE(cr.payload->>'Date', 'MM/DD/YYYY') = a.appointment_date
    )
    WHERE a.clinichq_appointment_id IS NOT NULL
  )
  UPDATE ops.appointments a
  SET
    cat_weight_lbs = COALESCE(a.cat_weight_lbs, r.cat_weight_lbs),
    cat_age_years = COALESCE(a.cat_age_years, r.cat_age_years),
    cat_age_months = COALESCE(a.cat_age_months, r.cat_age_months),
    updated_at = NOW()
  FROM raw_cat r
  WHERE a.appointment_id = r.appointment_id
    AND r.cat_weight_lbs IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'MIG_2320: Backfilled weight/age for % appointments', v_count;
END;
$$;

-- ============================================================================
-- Phase 5: Backfill ownership_type from source.clinichq_raw (owner records)
-- ============================================================================

\echo ''
\echo 'Phase 5: Backfilling ownership_type from owner records...'

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH raw_owner AS (
    SELECT
      a.appointment_id,
      CASE TRIM(cr.payload->>'Ownership')
        WHEN 'Community Cat (Feral)' THEN 'feral'
        WHEN 'Community Cat (Friendly)' THEN 'community'
        WHEN 'Owned' THEN 'owned'
        WHEN 'Foster' THEN 'foster'
        WHEN 'Shelter' THEN 'shelter'
        ELSE NULL
      END AS ownership_type
    FROM ops.appointments a
    JOIN source.clinichq_raw cr ON (
      cr.record_type = 'owner'
      AND cr.payload->>'Microchip Number' = SPLIT_PART(a.clinichq_appointment_id, '_', 2)
      AND TO_DATE(cr.payload->>'Date', 'MM/DD/YYYY') = a.appointment_date
    )
    WHERE a.clinichq_appointment_id IS NOT NULL
      AND a.ownership_type IS NULL
  )
  UPDATE ops.appointments a
  SET
    ownership_type = r.ownership_type,
    updated_at = NOW()
  FROM raw_owner r
  WHERE a.appointment_id = r.appointment_id
    AND r.ownership_type IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'MIG_2320: Set ownership_type for % appointments', v_count;
END;
$$;

-- ============================================================================
-- Phase 6: Verification
-- ============================================================================

\echo ''
\echo 'Phase 6: Verification...'

DO $$
DECLARE
  v_total INTEGER;
  v_with_health_flags INTEGER;
  v_with_felv_fiv INTEGER;
  v_with_weight INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total FROM ops.appointments;
  SELECT COUNT(*) INTO v_with_health_flags FROM ops.appointments
    WHERE has_uri OR has_dental_disease OR has_fleas OR has_ticks;
  SELECT COUNT(*) INTO v_with_felv_fiv FROM ops.appointments WHERE felv_fiv_result IS NOT NULL;
  SELECT COUNT(*) INTO v_with_weight FROM ops.appointments WHERE cat_weight_lbs IS NOT NULL;

  RAISE NOTICE '=== MIG_2320 Verification ===';
  RAISE NOTICE 'Total appointments: %', v_total;
  RAISE NOTICE 'With health flags: %', v_with_health_flags;
  RAISE NOTICE 'With FeLV/FIV result: %', v_with_felv_fiv;
  RAISE NOTICE 'With weight: %', v_with_weight;
END;
$$;

COMMIT;

\echo ''
\echo '=============================================='
\echo 'MIG_2320 Complete!'
\echo '=============================================='
\echo ''
\echo 'Added columns:'
\echo '  - clinic_day_number'
\echo '  - Health flags (has_uri, has_fleas, etc.)'
\echo '  - Misc flags (has_polydactyl, has_cryptorchid, etc.)'
\echo '  - felv_fiv_result, body_composition_score, no_surgery_reason'
\echo '  - total_invoiced, subsidy_value'
\echo '  - cat_weight_lbs, cat_age_years, cat_age_months'
\echo '  - ownership_type, resolved_person_id, clinichq_appointment_id'
\echo ''
\echo 'Updated ops.v_appointment_detail view'
\echo 'Backfilled from staged_records'
\echo ''
