-- MIG_2062: Create remaining ops medical tables for V2
-- Date: 2026-02-13
--
-- Creates:
--   - ops.cat_conditions (diagnosed conditions)
--   - ops.cat_vitals (temperature, weight, body score)
--   - ops.cat_medications (vaccines, flea treatment, dewormer)
--
-- Backfills from V1 trapper.* tables if they exist.

\echo ''
\echo '=============================================='
\echo '  MIG_2062: ops medical tables'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE ENUMS
-- ============================================================================

\echo '1. Creating enums...'

DO $$ BEGIN
    CREATE TYPE ops.condition_severity AS ENUM ('mild', 'moderate', 'severe', 'critical');
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'ops.condition_severity enum already exists';
END $$;

-- ============================================================================
-- 2. CAT_CONDITIONS TABLE
-- ============================================================================

\echo ''
\echo '2. Creating ops.cat_conditions table...'

CREATE TABLE IF NOT EXISTS ops.cat_conditions (
    condition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL REFERENCES sot.cats(cat_id),
    appointment_id UUID REFERENCES ops.appointments(appointment_id),

    -- Condition details
    condition_type TEXT NOT NULL,  -- dental_disease, uri, ear_infection, fleas, ringworm, etc.
    severity ops.condition_severity,
    diagnosed_at DATE NOT NULL,
    resolved_at DATE,              -- NULL if ongoing/chronic
    is_chronic BOOLEAN DEFAULT FALSE,

    -- Additional details
    notes TEXT,
    treated BOOLEAN DEFAULT FALSE,

    -- Source tracking
    source_system TEXT NOT NULL,
    source_record_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_cat_conditions_cat ON ops.cat_conditions(cat_id);
CREATE INDEX IF NOT EXISTS idx_ops_cat_conditions_type ON ops.cat_conditions(condition_type);
CREATE INDEX IF NOT EXISTS idx_ops_cat_conditions_active ON ops.cat_conditions(cat_id) WHERE resolved_at IS NULL;

-- Backfill from V1
DO $$
DECLARE v_count INT;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'cat_conditions') THEN
        INSERT INTO ops.cat_conditions (
            condition_id, cat_id, appointment_id,
            condition_type, severity, diagnosed_at, resolved_at, is_chronic,
            notes, treated, source_system, source_record_id, created_at
        )
        SELECT
            v1.condition_id, COALESCE(c.cat_id, v1.cat_id), NULL,
            v1.condition_type, v1.severity::text::ops.condition_severity,
            v1.diagnosed_at, v1.resolved_at, COALESCE(v1.is_chronic, FALSE),
            v1.notes, COALESCE(v1.treated, FALSE),
            v1.source_system, v1.source_record_id, v1.created_at
        FROM trapper.cat_conditions v1
        LEFT JOIN sot.cats c ON c.microchip = (SELECT microchip FROM trapper.sot_cats WHERE cat_id = v1.cat_id)
        WHERE NOT EXISTS (SELECT 1 FROM ops.cat_conditions o WHERE o.condition_id = v1.condition_id);
        GET DIAGNOSTICS v_count = ROW_COUNT;
        RAISE NOTICE 'Backfilled % conditions from V1', v_count;
    END IF;
END $$;

\echo '   Created ops.cat_conditions'

-- ============================================================================
-- 3. CAT_VITALS TABLE
-- ============================================================================

\echo ''
\echo '3. Creating ops.cat_vitals table...'

CREATE TABLE IF NOT EXISTS ops.cat_vitals (
    vital_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL REFERENCES sot.cats(cat_id),
    appointment_id UUID REFERENCES ops.appointments(appointment_id),

    -- Vital measurements
    recorded_at TIMESTAMPTZ NOT NULL,
    temperature_f NUMERIC(4,1),  -- e.g., 101.5
    weight_lbs NUMERIC(5,2),     -- e.g., 8.50
    body_score TEXT,             -- Body Condition Score (thin, normal, overweight, obese)

    -- Reproductive status at time of visit
    is_pregnant BOOLEAN,
    is_lactating BOOLEAN,
    is_in_heat BOOLEAN,

    -- Source tracking
    source_system TEXT NOT NULL,
    source_record_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_cat_vitals_cat ON ops.cat_vitals(cat_id);
CREATE INDEX IF NOT EXISTS idx_ops_cat_vitals_date ON ops.cat_vitals(recorded_at);

-- Backfill from V1
DO $$
DECLARE v_count INT;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'cat_vitals') THEN
        INSERT INTO ops.cat_vitals (
            vital_id, cat_id, appointment_id,
            recorded_at, temperature_f, weight_lbs, body_score,
            is_pregnant, is_lactating, is_in_heat,
            source_system, source_record_id, created_at
        )
        SELECT
            v1.vital_id, COALESCE(c.cat_id, v1.cat_id), NULL,
            v1.recorded_at, v1.temperature_f, v1.weight_lbs, v1.body_score,
            v1.is_pregnant, v1.is_lactating, v1.is_in_heat,
            v1.source_system, v1.source_record_id, v1.created_at
        FROM trapper.cat_vitals v1
        LEFT JOIN sot.cats c ON c.microchip = (SELECT microchip FROM trapper.sot_cats WHERE cat_id = v1.cat_id)
        WHERE NOT EXISTS (SELECT 1 FROM ops.cat_vitals o WHERE o.vital_id = v1.vital_id);
        GET DIAGNOSTICS v_count = ROW_COUNT;
        RAISE NOTICE 'Backfilled % vitals from V1', v_count;
    END IF;
END $$;

-- Also extract vitals from ops.appointments
INSERT INTO ops.cat_vitals (
    cat_id, appointment_id, recorded_at, temperature_f,
    is_pregnant, is_lactating, is_in_heat,
    source_system, created_at
)
SELECT
    a.cat_id,
    a.appointment_id,
    a.appointment_date::timestamptz,
    a.temperature,
    a.is_pregnant,
    a.is_lactating,
    a.is_in_heat,
    'clinichq',
    a.created_at
FROM ops.appointments a
WHERE a.cat_id IS NOT NULL
  AND (a.temperature IS NOT NULL OR a.is_pregnant OR a.is_lactating OR a.is_in_heat)
  AND NOT EXISTS (
      SELECT 1 FROM ops.cat_vitals v
      WHERE v.cat_id = a.cat_id AND v.appointment_id = a.appointment_id
  );

\echo '   Created ops.cat_vitals'

-- ============================================================================
-- 4. CAT_MEDICATIONS TABLE
-- ============================================================================

\echo ''
\echo '4. Creating ops.cat_medications table...'

CREATE TABLE IF NOT EXISTS ops.cat_medications (
    medication_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL REFERENCES sot.cats(cat_id),
    appointment_id UUID REFERENCES ops.appointments(appointment_id),

    -- Medication details
    medication_type TEXT NOT NULL,  -- vaccine_rabies, vaccine_fvrcp, flea_treatment, dewormer, etc.
    medication_name TEXT,           -- Specific product name if known
    administered_at DATE NOT NULL,

    -- For vaccines
    is_vaccine BOOLEAN DEFAULT FALSE,
    vaccine_due_date DATE,          -- When next dose is due

    -- Dosage info
    dose TEXT,
    route TEXT,                     -- oral, injection, topical

    -- Source tracking
    source_system TEXT NOT NULL,
    source_record_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_cat_medications_cat ON ops.cat_medications(cat_id);
CREATE INDEX IF NOT EXISTS idx_ops_cat_medications_type ON ops.cat_medications(medication_type);
CREATE INDEX IF NOT EXISTS idx_ops_cat_medications_vaccine ON ops.cat_medications(cat_id) WHERE is_vaccine = TRUE;

-- Backfill from V1
DO $$
DECLARE v_count INT;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'cat_medications') THEN
        INSERT INTO ops.cat_medications (
            medication_id, cat_id, appointment_id,
            medication_type, medication_name, administered_at,
            is_vaccine, vaccine_due_date, dose, route,
            source_system, source_record_id, created_at
        )
        SELECT
            v1.medication_id, COALESCE(c.cat_id, v1.cat_id), NULL,
            v1.medication_type, v1.medication_name, v1.administered_at,
            COALESCE(v1.is_vaccine, FALSE), v1.vaccine_due_date, v1.dose, v1.route,
            v1.source_system, v1.source_record_id, v1.created_at
        FROM trapper.cat_medications v1
        LEFT JOIN sot.cats c ON c.microchip = (SELECT microchip FROM trapper.sot_cats WHERE cat_id = v1.cat_id)
        WHERE NOT EXISTS (SELECT 1 FROM ops.cat_medications o WHERE o.medication_id = v1.medication_id);
        GET DIAGNOSTICS v_count = ROW_COUNT;
        RAISE NOTICE 'Backfilled % medications from V1', v_count;
    END IF;
END $$;

\echo '   Created ops.cat_medications'

-- ============================================================================
-- 5. CREATE COMPREHENSIVE HEALTH VIEW
-- ============================================================================

\echo ''
\echo '5. Creating v_cat_health_summary view...'

CREATE OR REPLACE VIEW ops.v_cat_health_summary AS
SELECT
    c.cat_id,
    c.name AS cat_name,
    c.microchip,
    c.sex,
    c.altered_status,

    -- Latest vitals
    (SELECT v.temperature_f FROM ops.cat_vitals v WHERE v.cat_id = c.cat_id ORDER BY v.recorded_at DESC LIMIT 1) AS last_temperature,
    (SELECT v.weight_lbs FROM ops.cat_vitals v WHERE v.cat_id = c.cat_id ORDER BY v.recorded_at DESC LIMIT 1) AS last_weight,
    (SELECT v.recorded_at FROM ops.cat_vitals v WHERE v.cat_id = c.cat_id ORDER BY v.recorded_at DESC LIMIT 1) AS last_vital_date,

    -- Disease status
    (SELECT ds.felv_status FROM ops.v_cat_disease_status ds WHERE ds.cat_id = c.cat_id) AS felv_status,
    (SELECT ds.fiv_status FROM ops.v_cat_disease_status ds WHERE ds.cat_id = c.cat_id) AS fiv_status,

    -- Active conditions
    (SELECT COUNT(*) FROM ops.cat_conditions cc WHERE cc.cat_id = c.cat_id AND cc.resolved_at IS NULL)::int AS active_conditions,

    -- Procedure summary
    (SELECT COUNT(*) FROM ops.cat_procedures p WHERE p.cat_id = c.cat_id AND p.is_spay)::int AS spay_count,
    (SELECT COUNT(*) FROM ops.cat_procedures p WHERE p.cat_id = c.cat_id AND p.is_neuter)::int AS neuter_count,

    -- Vaccination status
    (SELECT MAX(m.administered_at) FROM ops.cat_medications m WHERE m.cat_id = c.cat_id AND m.medication_type = 'vaccine_rabies') AS last_rabies_vaccine,
    (SELECT MAX(m.administered_at) FROM ops.cat_medications m WHERE m.cat_id = c.cat_id AND m.medication_type = 'vaccine_fvrcp') AS last_fvrcp_vaccine,

    -- Total appointments
    (SELECT COUNT(*) FROM ops.appointments a WHERE a.cat_id = c.cat_id)::int AS total_appointments

FROM sot.cats c
WHERE c.merged_into_cat_id IS NULL;

COMMENT ON VIEW ops.v_cat_health_summary IS 'Comprehensive cat health summary combining vitals, diseases, conditions, procedures, and vaccinations';

-- ============================================================================
-- 6. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Table row counts:'
SELECT 'cat_conditions' as table_name, COUNT(*) as count FROM ops.cat_conditions
UNION ALL SELECT 'cat_vitals', COUNT(*) FROM ops.cat_vitals
UNION ALL SELECT 'cat_medications', COUNT(*) FROM ops.cat_medications;

\echo ''
\echo '=============================================='
\echo '  MIG_2062 Complete!'
\echo '=============================================='
\echo ''
