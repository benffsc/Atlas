-- MIG_320: Unified Visit Views
--
-- Rewrites v_consolidated_visits and v_cat_clinic_history to use sot_appointments
-- instead of clinichq_visits. This fixes the issue where newer appointments
-- processed through the Data Engine weren't showing in cat detail views.
--
-- Root cause: clinichq_visits (legacy) has 32,990 records up to 2026-01-08
--            sot_appointments (Data Engine) has 47,332 records up to 2026-01-15
--
-- The old views joined clinichq_visits → cat_identifiers via microchip.
-- The new views join sot_appointments → sot_cats directly via cat_id.
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_320__unified_visit_views.sql

\echo ''
\echo '=============================================='
\echo 'MIG_320: Unified Visit Views'
\echo '=============================================='
\echo ''

-- ============================================
-- 1. Backup the old views (just drop them, they'll be recreated)
-- ============================================

\echo 'Replacing v_consolidated_visits to use sot_appointments...'

DROP VIEW IF EXISTS trapper.v_consolidated_visits CASCADE;

CREATE VIEW trapper.v_consolidated_visits AS
SELECT
    a.cat_id,
    a.appointment_id,
    a.appointment_date,
    a.service_type,
    COALESCE(a.is_spay, a.service_is_spay, FALSE) AS is_spay,
    COALESCE(a.is_neuter, a.service_is_neuter, FALSE) AS is_neuter,
    a.vet_name,
    -- Animal info from sot_cats
    c.display_name AS animal_name,
    c.sex,
    -- Get weight from cat_vitals if available for this appointment date
    (SELECT cv.weight_lbs
     FROM trapper.cat_vitals cv
     WHERE cv.cat_id = a.cat_id
       AND cv.recorded_at::date = a.appointment_date
     ORDER BY cv.recorded_at DESC
     LIMIT 1) AS weight_lbs,
    c.altered_status,
    -- Get FeLV/FIV from cat_test_results
    (SELECT ctr.result::TEXT
     FROM trapper.cat_test_results ctr
     WHERE ctr.cat_id = a.cat_id
       AND ctr.test_type = 'felv_fiv'
     ORDER BY ctr.test_date DESC
     LIMIT 1) AS felv_fiv_result,
    a.is_pregnant,
    a.is_lactating,
    a.is_in_heat,
    -- Health conditions - check if any exist for this cat
    -- Note: These are lifetime conditions, not per-visit
    EXISTS(SELECT 1 FROM trapper.cat_conditions cc
           WHERE cc.cat_id = a.cat_id AND cc.condition_type = 'uri') AS has_uri,
    EXISTS(SELECT 1 FROM trapper.cat_conditions cc
           WHERE cc.cat_id = a.cat_id AND cc.condition_type = 'dental_disease') AS has_dental_disease,
    EXISTS(SELECT 1 FROM trapper.cat_conditions cc
           WHERE cc.cat_id = a.cat_id AND cc.condition_type = 'fleas') AS has_fleas,
    a.temperature,
    a.medical_notes AS internal_notes,
    a.appointment_number,
    -- Client info from sot_people (display_name contains full name)
    SPLIT_PART(p.display_name, ' ', 1) AS client_first_name,
    SPLIT_PART(p.display_name, ' ', 2) AS client_last_name,
    COALESCE(a.owner_email, p.primary_email,
        (SELECT pi.id_value_norm FROM trapper.person_identifiers pi
         WHERE pi.person_id = a.person_id AND pi.id_type = 'email'
         LIMIT 1)) AS client_email,
    COALESCE(a.owner_phone, p.primary_phone,
        (SELECT pi.id_value_norm FROM trapper.person_identifiers pi
         WHERE pi.person_id = a.person_id AND pi.id_type = 'phone'
         LIMIT 1)) AS client_phone,
    -- Ownership type - try to get from sot_cats or fallback to NULL
    c.ownership_type
FROM trapper.sot_appointments a
JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
LEFT JOIN trapper.sot_people p ON p.person_id = a.person_id;

COMMENT ON VIEW trapper.v_consolidated_visits IS
'Consolidated clinic visits from sot_appointments joined to cats. Used by cat detail API for visit history with vaccines/treatments.';

-- ============================================
-- 2. Replace v_cat_clinic_history view
-- ============================================

\echo 'Replacing v_cat_clinic_history to use sot_appointments...'

DROP VIEW IF EXISTS trapper.v_cat_clinic_history CASCADE;

CREATE VIEW trapper.v_cat_clinic_history AS
SELECT
    a.cat_id,
    a.appointment_date AS visit_date,
    a.appointment_number AS appt_number,
    p.display_name AS client_name,
    pl.formatted_address AS client_address,
    COALESCE(a.owner_email, p.primary_email,
        (SELECT pi.id_value_norm FROM trapper.person_identifiers pi
         WHERE pi.person_id = a.person_id AND pi.id_type = 'email'
         LIMIT 1)) AS client_email,
    COALESCE(a.owner_phone, p.primary_phone,
        (SELECT pi.id_value_norm FROM trapper.person_identifiers pi
         WHERE pi.person_id = a.person_id AND pi.id_type = 'phone'
         LIMIT 1)) AS client_phone,
    c.ownership_type,
    a.vet_name,
    COALESCE(a.is_spay, a.service_is_spay, FALSE) AS is_spay,
    COALESCE(a.is_neuter, a.service_is_neuter, FALSE) AS is_neuter,
    (SELECT ctr.result::TEXT
     FROM trapper.cat_test_results ctr
     WHERE ctr.cat_id = a.cat_id
       AND ctr.test_type = 'felv_fiv'
     ORDER BY ctr.test_date DESC
     LIMIT 1) AS felv_fiv_result,
    EXISTS(SELECT 1 FROM trapper.cat_conditions cc
           WHERE cc.cat_id = a.cat_id AND cc.condition_type = 'uri') AS has_uri,
    EXISTS(SELECT 1 FROM trapper.cat_conditions cc
           WHERE cc.cat_id = a.cat_id AND cc.condition_type = 'dental_disease') AS has_dental_disease,
    EXISTS(SELECT 1 FROM trapper.cat_conditions cc
           WHERE cc.cat_id = a.cat_id AND cc.condition_type = 'fleas') AS has_fleas,
    a.temperature,
    (SELECT cv.weight_lbs
     FROM trapper.cat_vitals cv
     WHERE cv.cat_id = a.cat_id
       AND cv.recorded_at::date = a.appointment_date
     ORDER BY cv.recorded_at DESC
     LIMIT 1) AS weight_lbs,
    a.medical_notes AS internal_notes
FROM trapper.sot_appointments a
JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
LEFT JOIN trapper.sot_people p ON p.person_id = a.person_id
LEFT JOIN trapper.places pl ON pl.place_id = a.place_id;

COMMENT ON VIEW trapper.v_cat_clinic_history IS
'Cat clinic history with client info. Uses sot_appointments as canonical source.';

-- ============================================
-- 3. Create indexes for performance
-- ============================================

\echo 'Ensuring indexes exist for view performance...'

-- Index on sot_appointments cat_id (should already exist but ensure)
CREATE INDEX IF NOT EXISTS idx_sot_appointments_cat_id
ON trapper.sot_appointments(cat_id);

-- Index on cat_vitals for date lookups
CREATE INDEX IF NOT EXISTS idx_cat_vitals_cat_date
ON trapper.cat_vitals(cat_id, recorded_at);

-- Index on cat_test_results for FeLV/FIV lookups
CREATE INDEX IF NOT EXISTS idx_cat_test_results_cat_type
ON trapper.cat_test_results(cat_id, test_type);

-- Index on cat_conditions for condition lookups
CREATE INDEX IF NOT EXISTS idx_cat_conditions_cat_type
ON trapper.cat_conditions(cat_id, condition_type);

-- ============================================
-- 4. Verification
-- ============================================

\echo ''
\echo 'View row counts (should match or exceed old counts):'

SELECT 'v_consolidated_visits' AS view_name, COUNT(*) AS row_count
FROM trapper.v_consolidated_visits
UNION ALL
SELECT 'v_cat_clinic_history', COUNT(*)
FROM trapper.v_cat_clinic_history;

\echo ''
\echo 'Testing Biggie (microchip 981020053891405):'

SELECT appointment_date, service_type, is_neuter, vet_name
FROM trapper.v_consolidated_visits
WHERE cat_id = '5aa9b89d-8386-4544-b1d4-c912eb78badb'
ORDER BY appointment_date DESC;

\echo ''
\echo '=============================================='
\echo 'MIG_320 Complete!'
\echo ''
\echo 'Updated views:'
\echo '  - v_consolidated_visits: Now uses sot_appointments (47K+ records)'
\echo '  - v_cat_clinic_history: Same update'
\echo ''
\echo 'This fixes missing vaccines/treatments for recently processed cats.'
\echo '=============================================='
\echo ''
