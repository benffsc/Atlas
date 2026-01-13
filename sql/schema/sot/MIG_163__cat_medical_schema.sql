-- MIG_163__cat_medical_schema.sql
-- Create comprehensive cat medical data schema
--
-- This establishes the foundation for Atlas to become the source of truth
-- for cat medical records, eventually replacing ClinicHQ.
--
-- Tables created:
--   1. cat_vitals - point-in-time vital signs (temperature, weight)
--   2. cat_conditions - diagnosed conditions with severity
--   3. cat_test_results - lab/diagnostic test results
--   4. cat_procedures - surgeries and medical procedures
--   5. cat_medications - vaccinations and medications given
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_163__cat_medical_schema.sql

\echo ''
\echo 'MIG_163: Cat Medical Schema'
\echo '==========================='
\echo ''

-- ============================================================
-- 1. ENUMS for medical data
-- ============================================================

\echo 'Creating enums...'

-- Condition severity levels
DO $$ BEGIN
    CREATE TYPE trapper.condition_severity AS ENUM ('mild', 'moderate', 'severe', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Test result values
DO $$ BEGIN
    CREATE TYPE trapper.test_result AS ENUM ('positive', 'negative', 'inconclusive', 'not_performed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Procedure status
DO $$ BEGIN
    CREATE TYPE trapper.procedure_status AS ENUM ('completed', 'attempted', 'deferred', 'not_needed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. CAT_VITALS - Point-in-time vital signs
-- ============================================================

\echo 'Creating cat_vitals table...'

CREATE TABLE IF NOT EXISTS trapper.cat_vitals (
    vital_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),
    appointment_id UUID REFERENCES trapper.sot_appointments(appointment_id),

    -- Vital measurements
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL,
    temperature_f NUMERIC(4,1),  -- e.g., 101.5
    weight_lbs NUMERIC(5,2),     -- e.g., 8.50
    body_score TEXT,             -- Body Composition Score (thin, normal, overweight, obese)

    -- Reproductive status at time of visit
    is_pregnant BOOLEAN,
    is_lactating BOOLEAN,
    is_in_heat BOOLEAN,

    -- Source tracking
    source_system TEXT NOT NULL,
    source_record_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cat_vitals_cat ON trapper.cat_vitals(cat_id);
CREATE INDEX IF NOT EXISTS idx_cat_vitals_date ON trapper.cat_vitals(recorded_at);

-- ============================================================
-- 3. CAT_CONDITIONS - Diagnosed conditions
-- ============================================================

\echo 'Creating cat_conditions table...'

CREATE TABLE IF NOT EXISTS trapper.cat_conditions (
    condition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),
    appointment_id UUID REFERENCES trapper.sot_appointments(appointment_id),

    -- Condition details
    condition_type TEXT NOT NULL,  -- dental_disease, uri, ear_infection, fleas, etc.
    severity trapper.condition_severity,
    diagnosed_at DATE NOT NULL,
    resolved_at DATE,              -- NULL if ongoing/chronic
    is_chronic BOOLEAN DEFAULT FALSE,

    -- Additional details
    notes TEXT,
    treated BOOLEAN DEFAULT FALSE,

    -- Source tracking
    source_system TEXT NOT NULL,
    source_record_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cat_conditions_cat ON trapper.cat_conditions(cat_id);
CREATE INDEX IF NOT EXISTS idx_cat_conditions_type ON trapper.cat_conditions(condition_type);
CREATE INDEX IF NOT EXISTS idx_cat_conditions_active ON trapper.cat_conditions(cat_id) WHERE resolved_at IS NULL;

-- ============================================================
-- 4. CAT_TEST_RESULTS - Lab and diagnostic tests
-- ============================================================

\echo 'Creating cat_test_results table...'

CREATE TABLE IF NOT EXISTS trapper.cat_test_results (
    test_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),
    appointment_id UUID REFERENCES trapper.sot_appointments(appointment_id),

    -- Test details
    test_type TEXT NOT NULL,       -- felv_fiv, skin_scrape, ringworm_woods_lamp, bmbt, heartworm
    test_date DATE NOT NULL,
    result trapper.test_result NOT NULL,
    result_detail TEXT,            -- Additional result info (e.g., "FeLV+/FIV-")

    -- Source tracking
    source_system TEXT NOT NULL,
    source_record_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cat_tests_cat ON trapper.cat_test_results(cat_id);
CREATE INDEX IF NOT EXISTS idx_cat_tests_type ON trapper.cat_test_results(test_type);

-- ============================================================
-- 5. CAT_PROCEDURES - Surgeries and medical procedures
-- ============================================================

\echo 'Creating cat_procedures table...'

CREATE TABLE IF NOT EXISTS trapper.cat_procedures (
    procedure_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),
    appointment_id UUID REFERENCES trapper.sot_appointments(appointment_id),

    -- Procedure details
    procedure_type TEXT NOT NULL,  -- spay, neuter, dental_cleaning, microchip, etc.
    procedure_date DATE NOT NULL,
    status trapper.procedure_status NOT NULL DEFAULT 'completed',

    -- Surgical details
    performed_by TEXT,             -- Vet name
    technician TEXT,

    -- Complications/notes
    complications TEXT[],          -- Array of complications (cryptorchid, hernia, pyometra, etc.)
    post_op_notes TEXT,            -- Bruising expected, cold compress, etc.
    staples_used BOOLEAN DEFAULT FALSE,

    -- For spay/neuter specifically
    is_spay BOOLEAN,
    is_neuter BOOLEAN,
    is_cryptorchid BOOLEAN,
    is_pre_scrotal BOOLEAN,

    -- Source tracking
    source_system TEXT NOT NULL,
    source_record_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cat_procedures_cat ON trapper.cat_procedures(cat_id);
CREATE INDEX IF NOT EXISTS idx_cat_procedures_type ON trapper.cat_procedures(procedure_type);
CREATE INDEX IF NOT EXISTS idx_cat_procedures_date ON trapper.cat_procedures(procedure_date);

-- ============================================================
-- 6. CAT_MEDICATIONS - Vaccinations and medications
-- ============================================================

\echo 'Creating cat_medications table...'

CREATE TABLE IF NOT EXISTS trapper.cat_medications (
    medication_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),
    appointment_id UUID REFERENCES trapper.sot_appointments(appointment_id),

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
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cat_medications_cat ON trapper.cat_medications(cat_id);
CREATE INDEX IF NOT EXISTS idx_cat_medications_type ON trapper.cat_medications(medication_type);

-- ============================================================
-- 7. Convenience views
-- ============================================================

\echo 'Creating views...'

-- View: Current cat health status (latest vitals + active conditions)
CREATE OR REPLACE VIEW trapper.v_cat_health_summary AS
SELECT
    c.cat_id,
    c.display_name,
    c.sex,
    c.altered_status,

    -- Latest vitals
    lv.temperature_f AS last_temperature,
    lv.weight_lbs AS last_weight,
    lv.recorded_at AS last_vital_date,

    -- Test results
    (SELECT result FROM trapper.cat_test_results tr
     WHERE tr.cat_id = c.cat_id AND tr.test_type = 'felv_fiv'
     ORDER BY tr.test_date DESC LIMIT 1) AS felv_fiv_status,

    -- Active conditions count
    (SELECT COUNT(*) FROM trapper.cat_conditions cc
     WHERE cc.cat_id = c.cat_id AND cc.resolved_at IS NULL) AS active_conditions,

    -- Procedure counts
    (SELECT COUNT(*) FROM trapper.cat_procedures cp
     WHERE cp.cat_id = c.cat_id AND cp.is_spay = TRUE) AS spay_count,
    (SELECT COUNT(*) FROM trapper.cat_procedures cp
     WHERE cp.cat_id = c.cat_id AND cp.is_neuter = TRUE) AS neuter_count,

    -- Total appointments
    (SELECT COUNT(*) FROM trapper.sot_appointments a
     WHERE a.cat_id = c.cat_id) AS total_appointments

FROM trapper.sot_cats c
LEFT JOIN LATERAL (
    SELECT temperature_f, weight_lbs, recorded_at
    FROM trapper.cat_vitals cv
    WHERE cv.cat_id = c.cat_id
    ORDER BY cv.recorded_at DESC
    LIMIT 1
) lv ON TRUE;

\echo ''
\echo '====== SCHEMA CREATED ======'

-- Summary of tables
SELECT 'cat_vitals' as table_name,
       (SELECT COUNT(*) FROM trapper.cat_vitals) as row_count
UNION ALL
SELECT 'cat_conditions', (SELECT COUNT(*) FROM trapper.cat_conditions)
UNION ALL
SELECT 'cat_test_results', (SELECT COUNT(*) FROM trapper.cat_test_results)
UNION ALL
SELECT 'cat_procedures', (SELECT COUNT(*) FROM trapper.cat_procedures)
UNION ALL
SELECT 'cat_medications', (SELECT COUNT(*) FROM trapper.cat_medications);

SELECT 'MIG_163 Complete' AS status;
