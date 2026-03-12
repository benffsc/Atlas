-- MIG_2899: Consolidate API export data from ops.appointments → sot.cats + observation tables (FFS-410)
--
-- Problem: MIG_2896-2898 backfilled from scrape only. But ops.appointments has
-- structured API export data for 8,223 cats missing weight and 8,415 missing age
-- that didn't come through the scrape path.
--
-- Also consolidates structured clinical observations from appointment booleans
-- into ops.cat_clinical_observations (1,147 cats with conditions not yet captured).
--
-- And fills reproductive observations from API structured fields (60 cats).
--
-- Safety: Only fills NULLs. Merge-aware. ON CONFLICT DO NOTHING.

BEGIN;

-- =============================================================================
-- Step 1: Backfill weight from ops.appointments → sot.cats
-- (8,223 cats have weight in appointments but not in sot.cats)
-- =============================================================================

WITH latest_weight AS (
    SELECT DISTINCT ON (a.cat_id)
        a.cat_id,
        a.cat_weight_lbs
    FROM ops.appointments a
    WHERE a.cat_id IS NOT NULL
      AND a.cat_weight_lbs IS NOT NULL
      AND a.cat_weight_lbs > 0
      AND a.cat_weight_lbs <= 30  -- Sanity cap
    ORDER BY a.cat_id, a.appointment_date DESC
)
UPDATE sot.cats c
SET weight_lbs = lw.cat_weight_lbs, updated_at = NOW()
FROM latest_weight lw
WHERE lw.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NULL
  AND c.weight_lbs IS NULL;

-- =============================================================================
-- Step 2: Backfill age from ops.appointments → sot.cats
-- (8,415 cats have age in appointments but not in sot.cats)
-- =============================================================================

WITH latest_age AS (
    SELECT DISTINCT ON (a.cat_id)
        a.cat_id,
        a.appointment_date,
        a.cat_age_years,
        a.cat_age_months
    FROM ops.appointments a
    WHERE a.cat_id IS NOT NULL
      AND a.cat_age_years IS NOT NULL
    ORDER BY a.cat_id, a.appointment_date DESC
)
UPDATE sot.cats c
SET
    estimated_birth_date = la.appointment_date - (la.cat_age_years * 365 + COALESCE(la.cat_age_months, 0) * 30)::int,
    age_group = CASE
        WHEN (la.cat_age_years * 12 + COALESCE(la.cat_age_months, 0)) < 6 THEN 'kitten'
        WHEN (la.cat_age_years * 12 + COALESCE(la.cat_age_months, 0)) < 12 THEN 'juvenile'
        WHEN (la.cat_age_years * 12 + COALESCE(la.cat_age_months, 0)) < 84 THEN 'adult'
        ELSE 'senior'
    END,
    updated_at = NOW()
FROM latest_age la
WHERE la.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NULL
  AND c.estimated_birth_date IS NULL;

-- =============================================================================
-- Step 3: Insert structured clinical observations from API appointments
-- Only for cats NOT already in cat_clinical_observations for that condition+date
-- =============================================================================

-- URI
INSERT INTO ops.cat_clinical_observations (
    cat_id, appointment_date, condition_code, source_field,
    source_system, evidence_source, extraction_confidence
)
SELECT DISTINCT ON (a.cat_id, a.appointment_date)
    a.cat_id, a.appointment_date, 'uri', 'has_uri',
    'clinichq', 'api_export_structured', 0.95
FROM ops.appointments a
WHERE a.cat_id IS NOT NULL AND a.has_uri = TRUE
  AND NOT EXISTS (
      SELECT 1 FROM ops.cat_clinical_observations o
      WHERE o.cat_id = a.cat_id AND o.condition_code = 'uri' AND o.appointment_date = a.appointment_date
  )
ORDER BY a.cat_id, a.appointment_date;

-- Fleas
INSERT INTO ops.cat_clinical_observations (
    cat_id, appointment_date, condition_code, source_field,
    source_system, evidence_source, extraction_confidence
)
SELECT DISTINCT ON (a.cat_id, a.appointment_date)
    a.cat_id, a.appointment_date, 'fleas', 'has_fleas',
    'clinichq', 'api_export_structured', 0.95
FROM ops.appointments a
WHERE a.cat_id IS NOT NULL AND a.has_fleas = TRUE
  AND NOT EXISTS (
      SELECT 1 FROM ops.cat_clinical_observations o
      WHERE o.cat_id = a.cat_id AND o.condition_code = 'fleas' AND o.appointment_date = a.appointment_date
  )
ORDER BY a.cat_id, a.appointment_date;

-- Ear mites
INSERT INTO ops.cat_clinical_observations (
    cat_id, appointment_date, condition_code, source_field,
    source_system, evidence_source, extraction_confidence
)
SELECT DISTINCT ON (a.cat_id, a.appointment_date)
    a.cat_id, a.appointment_date, 'ear_mites', 'has_ear_mites',
    'clinichq', 'api_export_structured', 0.95
FROM ops.appointments a
WHERE a.cat_id IS NOT NULL AND a.has_ear_mites = TRUE
  AND NOT EXISTS (
      SELECT 1 FROM ops.cat_clinical_observations o
      WHERE o.cat_id = a.cat_id AND o.condition_code = 'ear_mites' AND o.appointment_date = a.appointment_date
  )
ORDER BY a.cat_id, a.appointment_date;

-- Tapeworms
INSERT INTO ops.cat_clinical_observations (
    cat_id, appointment_date, condition_code, source_field,
    source_system, evidence_source, extraction_confidence
)
SELECT DISTINCT ON (a.cat_id, a.appointment_date)
    a.cat_id, a.appointment_date, 'tapeworm', 'has_tapeworms',
    'clinichq', 'api_export_structured', 0.95
FROM ops.appointments a
WHERE a.cat_id IS NOT NULL AND a.has_tapeworms = TRUE
  AND NOT EXISTS (
      SELECT 1 FROM ops.cat_clinical_observations o
      WHERE o.cat_id = a.cat_id AND o.condition_code = 'tapeworm' AND o.appointment_date = a.appointment_date
  )
ORDER BY a.cat_id, a.appointment_date;

-- Cryptorchid
INSERT INTO ops.cat_clinical_observations (
    cat_id, appointment_date, condition_code, source_field,
    source_system, evidence_source, extraction_confidence
)
SELECT DISTINCT ON (a.cat_id, a.appointment_date)
    a.cat_id, a.appointment_date, 'cryptorchid', 'has_cryptorchid',
    'clinichq', 'api_export_structured', 0.95
FROM ops.appointments a
WHERE a.cat_id IS NOT NULL AND a.has_cryptorchid = TRUE
  AND NOT EXISTS (
      SELECT 1 FROM ops.cat_clinical_observations o
      WHERE o.cat_id = a.cat_id AND o.condition_code = 'cryptorchid' AND o.appointment_date = a.appointment_date
  )
ORDER BY a.cat_id, a.appointment_date;

-- Hernia
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

-- Pyometra
INSERT INTO ops.cat_clinical_observations (
    cat_id, appointment_date, condition_code, source_field,
    source_system, evidence_source, extraction_confidence
)
SELECT DISTINCT ON (a.cat_id, a.appointment_date)
    a.cat_id, a.appointment_date, 'pyometra', 'has_pyometra',
    'clinichq', 'api_export_structured', 0.95
FROM ops.appointments a
WHERE a.cat_id IS NOT NULL AND a.has_pyometra = TRUE
  AND NOT EXISTS (
      SELECT 1 FROM ops.cat_clinical_observations o
      WHERE o.cat_id = a.cat_id AND o.condition_code = 'pyometra' AND o.appointment_date = a.appointment_date
  )
ORDER BY a.cat_id, a.appointment_date;

-- Dental disease
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

-- Polydactyl
INSERT INTO ops.cat_clinical_observations (
    cat_id, appointment_date, condition_code, source_field,
    source_system, evidence_source, extraction_confidence
)
SELECT DISTINCT ON (a.cat_id, a.appointment_date)
    a.cat_id, a.appointment_date, 'polydactyl', 'has_polydactyl',
    'clinichq', 'api_export_structured', 0.95
FROM ops.appointments a
WHERE a.cat_id IS NOT NULL AND a.has_polydactyl = TRUE
  AND NOT EXISTS (
      SELECT 1 FROM ops.cat_clinical_observations o
      WHERE o.cat_id = a.cat_id AND o.condition_code = 'polydactyl' AND o.appointment_date = a.appointment_date
  )
ORDER BY a.cat_id, a.appointment_date;

-- =============================================================================
-- Step 4: Insert reproductive observations from API structured fields
-- =============================================================================

-- Pregnant from API
INSERT INTO ops.cat_reproductive_observations (
    cat_id, appointment_date, observation_type, source_field,
    source_system, evidence_source, extraction_confidence
)
SELECT DISTINCT ON (a.cat_id, a.appointment_date)
    a.cat_id, a.appointment_date, 'pregnancy', 'is_pregnant',
    'clinichq', 'api_export_structured', 0.95
FROM ops.appointments a
WHERE a.cat_id IS NOT NULL AND a.is_pregnant = TRUE
  AND NOT EXISTS (
      SELECT 1 FROM ops.cat_reproductive_observations o
      WHERE o.cat_id = a.cat_id AND o.observation_type = 'pregnancy' AND o.appointment_date = a.appointment_date
  )
ORDER BY a.cat_id, a.appointment_date;

-- Lactating from API
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

-- In Heat from API (store as reproductive observation)
INSERT INTO ops.cat_reproductive_observations (
    cat_id, appointment_date, observation_type, source_field,
    source_system, evidence_source, extraction_confidence
)
SELECT DISTINCT ON (a.cat_id, a.appointment_date)
    a.cat_id, a.appointment_date, 'in_heat', 'is_in_heat',
    'clinichq', 'api_export_structured', 0.95
FROM ops.appointments a
WHERE a.cat_id IS NOT NULL AND a.is_in_heat = TRUE
  AND NOT EXISTS (
      SELECT 1 FROM ops.cat_reproductive_observations o
      WHERE o.cat_id = a.cat_id AND o.observation_type = 'in_heat' AND o.appointment_date = a.appointment_date
  )
ORDER BY a.cat_id, a.appointment_date;

-- =============================================================================
-- Verification
-- =============================================================================

DO $$
DECLARE
    v_total INTEGER;
    v_weight INTEGER;
    v_age INTEGER;
    v_clinical INTEGER;
    v_repro INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total FROM sot.cats WHERE merged_into_cat_id IS NULL;
    SELECT COUNT(*) INTO v_weight FROM sot.cats WHERE merged_into_cat_id IS NULL AND weight_lbs IS NOT NULL;
    SELECT COUNT(*) INTO v_age FROM sot.cats WHERE merged_into_cat_id IS NULL AND estimated_birth_date IS NOT NULL;
    SELECT COUNT(*) INTO v_clinical FROM ops.cat_clinical_observations;
    SELECT COUNT(*) INTO v_repro FROM ops.cat_reproductive_observations;

    RAISE NOTICE 'MIG_2899: Consolidate API export data → sot.cats + observation tables';
    RAISE NOTICE '  Total cats: %', v_total;
    RAISE NOTICE '  Has weight: % (%.1f%%)', v_weight, (v_weight::numeric / v_total * 100);
    RAISE NOTICE '  Has age: % (%.1f%%)', v_age, (v_age::numeric / v_total * 100);
    RAISE NOTICE '  Clinical observations: %', v_clinical;
    RAISE NOTICE '  Reproductive observations: %', v_repro;
END $$;

COMMIT;
