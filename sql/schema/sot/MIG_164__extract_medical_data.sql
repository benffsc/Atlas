-- MIG_164__extract_medical_data.sql
-- Extract medical data from staged_records into normalized tables
--
-- Extracts from appointment_info payload:
--   1. cat_vitals - temperature, reproductive status
--   2. cat_conditions - dental, ear, skin, URI, parasites
--   3. cat_test_results - FeLV/FIV, skin scrape, ringworm
--   4. cat_procedures - spay/neuter with surgical notes
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_164__extract_medical_data.sql

\echo ''
\echo 'MIG_164: Extract Medical Data'
\echo '=============================='
\echo ''

-- ============================================================
-- 1. EXTRACT VITALS (Temperature, Reproductive Status)
-- ============================================================

\echo 'Extracting vitals...'

INSERT INTO trapper.cat_vitals (
    cat_id,
    appointment_id,
    recorded_at,
    temperature_f,
    is_pregnant,
    is_lactating,
    is_in_heat,
    source_system,
    source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    a.appointment_date::timestamp with time zone,
    -- Parse temperature (handles "101.5" format)
    CASE
        WHEN sr.payload->>'Temperature' ~ '^\d+\.?\d*$'
        THEN (sr.payload->>'Temperature')::numeric(4,1)
        ELSE NULL
    END,
    -- Reproductive status
    sr.payload->>'Pregnant' = 'Yes' OR sr.payload->>'Pregnant_2' = 'Yes',
    sr.payload->>'Lactating' = 'Yes' OR sr.payload->>'Lactating_2' = 'Yes',
    sr.payload->>'In Heat' = 'Yes',
    'clinichq',
    sr.payload->>'Number'
FROM trapper.staged_records sr
JOIN trapper.sot_appointments a ON a.source_record_id = sr.payload->>'Number'
WHERE sr.source_table = 'appointment_info'
  AND a.cat_id IS NOT NULL
  AND (
    (sr.payload->>'Temperature' IS NOT NULL AND sr.payload->>'Temperature' NOT IN ('---', ''))
    OR sr.payload->>'Pregnant' = 'Yes'
    OR sr.payload->>'Lactating' = 'Yes'
    OR sr.payload->>'In Heat' = 'Yes'
  )
ON CONFLICT DO NOTHING;

\echo 'Vitals extracted:'
SELECT COUNT(*) as vital_records FROM trapper.cat_vitals;

-- ============================================================
-- 2. EXTRACT CONDITIONS
-- ============================================================

\echo ''
\echo 'Extracting conditions...'

-- Dental Disease
INSERT INTO trapper.cat_conditions (
    cat_id, appointment_id, condition_type, severity, diagnosed_at, source_system, source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    'dental_disease',
    CASE sr.payload->>'Dental Disease'
        WHEN 'Mild' THEN 'mild'::trapper.condition_severity
        WHEN 'Moderate' THEN 'moderate'::trapper.condition_severity
        WHEN 'Severe' THEN 'severe'::trapper.condition_severity
        ELSE NULL
    END,
    a.appointment_date,
    'clinichq',
    sr.payload->>'Number'
FROM trapper.staged_records sr
JOIN trapper.sot_appointments a ON a.source_record_id = sr.payload->>'Number'
WHERE sr.source_table = 'appointment_info'
  AND a.cat_id IS NOT NULL
  AND sr.payload->>'Dental Disease' IN ('Mild', 'Moderate', 'Severe')
ON CONFLICT DO NOTHING;

-- URI (Upper Respiratory Infection)
INSERT INTO trapper.cat_conditions (
    cat_id, appointment_id, condition_type, diagnosed_at, source_system, source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    'uri',
    a.appointment_date,
    'clinichq',
    sr.payload->>'Number'
FROM trapper.staged_records sr
JOIN trapper.sot_appointments a ON a.source_record_id = sr.payload->>'Number'
WHERE sr.source_table = 'appointment_info'
  AND a.cat_id IS NOT NULL
  AND (sr.payload->>'URI' = 'Yes' OR sr.payload->>'Upper Respiratory Issue' = 'Yes')
ON CONFLICT DO NOTHING;

-- Ear Infections
INSERT INTO trapper.cat_conditions (
    cat_id, appointment_id, condition_type, diagnosed_at, source_system, source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    'ear_infection',
    a.appointment_date,
    'clinichq',
    sr.payload->>'Number'
FROM trapper.staged_records sr
JOIN trapper.sot_appointments a ON a.source_record_id = sr.payload->>'Number'
WHERE sr.source_table = 'appointment_info'
  AND a.cat_id IS NOT NULL
  AND sr.payload->>'Ear infections' = 'Yes'
ON CONFLICT DO NOTHING;

-- Ear Mites
INSERT INTO trapper.cat_conditions (
    cat_id, appointment_id, condition_type, diagnosed_at, source_system, source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    'ear_mites',
    a.appointment_date,
    'clinichq',
    sr.payload->>'Number'
FROM trapper.staged_records sr
JOIN trapper.sot_appointments a ON a.source_record_id = sr.payload->>'Number'
WHERE sr.source_table = 'appointment_info'
  AND a.cat_id IS NOT NULL
  AND sr.payload->>'Ear mites' = 'Yes'
ON CONFLICT DO NOTHING;

-- Fleas
INSERT INTO trapper.cat_conditions (
    cat_id, appointment_id, condition_type, diagnosed_at, source_system, source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    'fleas',
    a.appointment_date,
    'clinichq',
    sr.payload->>'Number'
FROM trapper.staged_records sr
JOIN trapper.sot_appointments a ON a.source_record_id = sr.payload->>'Number'
WHERE sr.source_table = 'appointment_info'
  AND a.cat_id IS NOT NULL
  AND (sr.payload->>'Fleas' = 'Yes' OR sr.payload->>'Fleas_2' = 'Yes' OR sr.payload->>'Fleas/Ticks' = 'Yes')
ON CONFLICT DO NOTHING;

-- Ticks
INSERT INTO trapper.cat_conditions (
    cat_id, appointment_id, condition_type, diagnosed_at, source_system, source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    'ticks',
    a.appointment_date,
    'clinichq',
    sr.payload->>'Number'
FROM trapper.staged_records sr
JOIN trapper.sot_appointments a ON a.source_record_id = sr.payload->>'Number'
WHERE sr.source_table = 'appointment_info'
  AND a.cat_id IS NOT NULL
  AND (sr.payload->>'Ticks' = 'Yes' OR sr.payload->>'Ticks_2' = 'Yes')
ON CONFLICT DO NOTHING;

-- Tapeworms
INSERT INTO trapper.cat_conditions (
    cat_id, appointment_id, condition_type, diagnosed_at, source_system, source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    'tapeworms',
    a.appointment_date,
    'clinichq',
    sr.payload->>'Number'
FROM trapper.staged_records sr
JOIN trapper.sot_appointments a ON a.source_record_id = sr.payload->>'Number'
WHERE sr.source_table = 'appointment_info'
  AND a.cat_id IS NOT NULL
  AND (sr.payload->>'Tapeworms' = 'Yes' OR sr.payload->>'Tapeworms_2' = 'Yes')
ON CONFLICT DO NOTHING;

-- Skin Issues
INSERT INTO trapper.cat_conditions (
    cat_id, appointment_id, condition_type, diagnosed_at, source_system, source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    'skin_issue',
    a.appointment_date,
    'clinichq',
    sr.payload->>'Number'
FROM trapper.staged_records sr
JOIN trapper.sot_appointments a ON a.source_record_id = sr.payload->>'Number'
WHERE sr.source_table = 'appointment_info'
  AND a.cat_id IS NOT NULL
  AND sr.payload->>'Skin Issue' = 'Yes'
ON CONFLICT DO NOTHING;

-- Eye Issues
INSERT INTO trapper.cat_conditions (
    cat_id, appointment_id, condition_type, diagnosed_at, source_system, source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    'eye_issue',
    a.appointment_date,
    'clinichq',
    sr.payload->>'Number'
FROM trapper.staged_records sr
JOIN trapper.sot_appointments a ON a.source_record_id = sr.payload->>'Number'
WHERE sr.source_table = 'appointment_info'
  AND a.cat_id IS NOT NULL
  AND sr.payload->>'Eye Issue' = 'Yes'
ON CONFLICT DO NOTHING;

-- Hernia
INSERT INTO trapper.cat_conditions (
    cat_id, appointment_id, condition_type, diagnosed_at, source_system, source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    'hernia',
    a.appointment_date,
    'clinichq',
    sr.payload->>'Number'
FROM trapper.staged_records sr
JOIN trapper.sot_appointments a ON a.source_record_id = sr.payload->>'Number'
WHERE sr.source_table = 'appointment_info'
  AND a.cat_id IS NOT NULL
  AND sr.payload->>'Hernia' = 'Yes'
ON CONFLICT DO NOTHING;

-- Pyometra
INSERT INTO trapper.cat_conditions (
    cat_id, appointment_id, condition_type, severity, diagnosed_at, source_system, source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    'pyometra',
    'severe'::trapper.condition_severity,  -- Pyometra is always serious
    a.appointment_date,
    'clinichq',
    sr.payload->>'Number'
FROM trapper.staged_records sr
JOIN trapper.sot_appointments a ON a.source_record_id = sr.payload->>'Number'
WHERE sr.source_table = 'appointment_info'
  AND a.cat_id IS NOT NULL
  AND sr.payload->>'Pyometra' = 'Yes'
ON CONFLICT DO NOTHING;

\echo 'Conditions extracted:'
SELECT condition_type, COUNT(*) as count
FROM trapper.cat_conditions
GROUP BY condition_type
ORDER BY count DESC;

-- ============================================================
-- 3. EXTRACT TEST RESULTS
-- ============================================================

\echo ''
\echo 'Extracting test results...'

-- FeLV/FIV Tests
INSERT INTO trapper.cat_test_results (
    cat_id, appointment_id, test_type, test_date, result, result_detail, source_system, source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    'felv_fiv',
    a.appointment_date,
    CASE
        WHEN sr.payload->>'FeLV/FIV (SNAP test, in-house)' ILIKE '%negative%' THEN 'negative'::trapper.test_result
        WHEN sr.payload->>'FeLV/FIV (SNAP test, in-house)' ILIKE '%positive%' THEN 'positive'::trapper.test_result
        ELSE 'inconclusive'::trapper.test_result
    END,
    sr.payload->>'FeLV/FIV (SNAP test, in-house)',
    'clinichq',
    sr.payload->>'Number'
FROM trapper.staged_records sr
JOIN trapper.sot_appointments a ON a.source_record_id = sr.payload->>'Number'
WHERE sr.source_table = 'appointment_info'
  AND a.cat_id IS NOT NULL
  AND sr.payload->>'FeLV/FIV (SNAP test, in-house)' IS NOT NULL
  AND sr.payload->>'FeLV/FIV (SNAP test, in-house)' NOT IN ('---', '')
ON CONFLICT DO NOTHING;

-- Heartworm Tests
INSERT INTO trapper.cat_test_results (
    cat_id, appointment_id, test_type, test_date, result, source_system, source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    'heartworm',
    a.appointment_date,
    'positive'::trapper.test_result,
    'clinichq',
    sr.payload->>'Number'
FROM trapper.staged_records sr
JOIN trapper.sot_appointments a ON a.source_record_id = sr.payload->>'Number'
WHERE sr.source_table = 'appointment_info'
  AND a.cat_id IS NOT NULL
  AND sr.payload->>'Heartworm Positive' = 'Yes'
ON CONFLICT DO NOTHING;

-- Ringworm (Wood's Lamp)
INSERT INTO trapper.cat_test_results (
    cat_id, appointment_id, test_type, test_date, result, result_detail, source_system, source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    'ringworm_woods_lamp',
    a.appointment_date,
    CASE
        WHEN sr.payload->>'Wood''s Lamp Ringworm Test' ILIKE '%negative%' THEN 'negative'::trapper.test_result
        WHEN sr.payload->>'Wood''s Lamp Ringworm Test' ILIKE '%positive%' THEN 'positive'::trapper.test_result
        ELSE 'inconclusive'::trapper.test_result
    END,
    sr.payload->>'Wood''s Lamp Ringworm Test',
    'clinichq',
    sr.payload->>'Number'
FROM trapper.staged_records sr
JOIN trapper.sot_appointments a ON a.source_record_id = sr.payload->>'Number'
WHERE sr.source_table = 'appointment_info'
  AND a.cat_id IS NOT NULL
  AND sr.payload->>'Wood''s Lamp Ringworm Test' IS NOT NULL
  AND sr.payload->>'Wood''s Lamp Ringworm Test' NOT IN ('---', '')
ON CONFLICT DO NOTHING;

-- Skin Scrape Test
INSERT INTO trapper.cat_test_results (
    cat_id, appointment_id, test_type, test_date, result, result_detail, source_system, source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    'skin_scrape',
    a.appointment_date,
    CASE
        WHEN sr.payload->>'Skin Scrape Test' ILIKE '%negative%' THEN 'negative'::trapper.test_result
        WHEN sr.payload->>'Skin Scrape Test' ILIKE '%positive%' THEN 'positive'::trapper.test_result
        ELSE 'inconclusive'::trapper.test_result
    END,
    sr.payload->>'Skin Scrape Test',
    'clinichq',
    sr.payload->>'Number'
FROM trapper.staged_records sr
JOIN trapper.sot_appointments a ON a.source_record_id = sr.payload->>'Number'
WHERE sr.source_table = 'appointment_info'
  AND a.cat_id IS NOT NULL
  AND sr.payload->>'Skin Scrape Test' IS NOT NULL
  AND sr.payload->>'Skin Scrape Test' NOT IN ('---', '')
ON CONFLICT DO NOTHING;

\echo 'Test results extracted:'
SELECT test_type, result, COUNT(*) as count
FROM trapper.cat_test_results
GROUP BY test_type, result
ORDER BY test_type, result;

-- ============================================================
-- 4. EXTRACT PROCEDURES (Spay/Neuter with details)
-- ============================================================

\echo ''
\echo 'Extracting procedures...'

-- Spay procedures
INSERT INTO trapper.cat_procedures (
    cat_id, appointment_id, procedure_type, procedure_date, status,
    performed_by, technician,
    is_spay, is_neuter, is_cryptorchid, is_pre_scrotal,
    staples_used,
    complications,
    post_op_notes,
    source_system, source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    'spay',
    a.appointment_date,
    'completed'::trapper.procedure_status,
    sr.payload->>'Vet Name',
    NULLIF(sr.payload->>'Technician', '---'),
    TRUE,
    FALSE,
    FALSE,
    FALSE,
    sr.payload->>'Staples' = 'Yes',
    ARRAY_REMOVE(ARRAY[
        CASE WHEN sr.payload->>'Pyometra' = 'Yes' THEN 'pyometra' END,
        CASE WHEN sr.payload->>'Hernia' = 'Yes' THEN 'hernia' END,
        CASE WHEN sr.payload->>'Bradycardia Intra-Op' = 'Yes' THEN 'bradycardia' END
    ], NULL),
    NULLIF(CONCAT_WS('; ',
        CASE WHEN sr.payload->>'Bruising Expected' = 'Yes' THEN 'Bruising expected' END,
        CASE WHEN sr.payload->>'Swelling Expected' = 'Yes' THEN 'Swelling expected' END,
        CASE WHEN sr.payload->>'Cold Compress Recommended' = 'Yes' THEN 'Cold compress recommended' END,
        CASE WHEN sr.payload->>'Warm Compress (dry) Recommended' = 'Yes' THEN 'Warm compress (dry) recommended' END,
        CASE WHEN sr.payload->>'Warm Compress (wet) Recommended' = 'Yes' THEN 'Warm compress (wet) recommended' END
    ), ''),
    'clinichq',
    sr.payload->>'Number'
FROM trapper.staged_records sr
JOIN trapper.sot_appointments a ON a.source_record_id = sr.payload->>'Number'
WHERE sr.source_table = 'appointment_info'
  AND a.cat_id IS NOT NULL
  AND sr.payload->>'Spay' = 'Yes'
ON CONFLICT DO NOTHING;

-- Neuter procedures
INSERT INTO trapper.cat_procedures (
    cat_id, appointment_id, procedure_type, procedure_date, status,
    performed_by, technician,
    is_spay, is_neuter, is_cryptorchid, is_pre_scrotal,
    staples_used,
    complications,
    source_system, source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    'neuter',
    a.appointment_date,
    'completed'::trapper.procedure_status,
    sr.payload->>'Vet Name',
    NULLIF(sr.payload->>'Technician', '---'),
    FALSE,
    TRUE,
    sr.payload->>'Cryptorchid' = 'Yes',
    sr.payload->>'Pre-Scrotal Neuter' = 'Yes',
    sr.payload->>'Staples' = 'Yes',
    ARRAY_REMOVE(ARRAY[
        CASE WHEN sr.payload->>'Cryptorchid' = 'Yes' THEN 'cryptorchid' END,
        CASE WHEN sr.payload->>'Bradycardia Intra-Op' = 'Yes' THEN 'bradycardia' END
    ], NULL),
    'clinichq',
    sr.payload->>'Number'
FROM trapper.staged_records sr
JOIN trapper.sot_appointments a ON a.source_record_id = sr.payload->>'Number'
WHERE sr.source_table = 'appointment_info'
  AND a.cat_id IS NOT NULL
  AND sr.payload->>'Neuter' = 'Yes'
ON CONFLICT DO NOTHING;

\echo 'Procedures extracted:'
SELECT procedure_type, COUNT(*) as count
FROM trapper.cat_procedures
GROUP BY procedure_type
ORDER BY count DESC;

-- ============================================================
-- 5. VERIFICATION
-- ============================================================

\echo ''
\echo '====== EXTRACTION COMPLETE ======'

SELECT 'cat_vitals' as table_name, COUNT(*) as records FROM trapper.cat_vitals
UNION ALL
SELECT 'cat_conditions', COUNT(*) FROM trapper.cat_conditions
UNION ALL
SELECT 'cat_test_results', COUNT(*) FROM trapper.cat_test_results
UNION ALL
SELECT 'cat_procedures', COUNT(*) FROM trapper.cat_procedures
UNION ALL
SELECT 'cat_medications', COUNT(*) FROM trapper.cat_medications;

\echo ''
\echo 'Sample health summary:'
SELECT * FROM trapper.v_cat_health_summary
WHERE total_appointments > 0
LIMIT 5;

SELECT 'MIG_164 Complete' AS status;
