-- MIG_307: Cat Visit Views
--
-- Creates missing views that the cat detail API expects:
--   - v_consolidated_visits: Cat visits from clinichq_visits with service categorization
--   - v_cat_clinic_history: Alias for v_cat_clinic_history_v2 with expected column names
--
-- These views provide a consistent interface for the cat detail page
-- to display clinic history and visit information.
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_307__cat_visit_views.sql

\echo ''
\echo '=============================================='
\echo 'MIG_307: Cat Visit Views'
\echo '=============================================='
\echo ''

-- ============================================
-- 1. Create v_consolidated_visits view
-- ============================================

\echo 'Creating v_consolidated_visits view...'

CREATE OR REPLACE VIEW trapper.v_consolidated_visits AS
SELECT
    ci.cat_id,
    cv.visit_id AS appointment_id,
    cv.visit_date AS appointment_date,
    -- Service type from internal_notes or constructed from flags
    CASE
        WHEN cv.is_spay THEN 'Spay'
        WHEN cv.is_neuter THEN 'Neuter'
        ELSE 'Exam'
    END AS service_type,
    cv.is_spay,
    cv.is_neuter,
    cv.vet_name,
    cv.animal_name,
    cv.sex,
    cv.weight_lbs,
    cv.altered_status,
    cv.felv_fiv_result,
    cv.is_pregnant,
    cv.is_lactating,
    cv.is_in_heat,
    cv.has_uri,
    cv.has_dental_disease,
    cv.has_fleas,
    cv.temperature,
    cv.internal_notes,
    cv.appointment_number,
    cv.client_first_name,
    cv.client_last_name,
    cv.client_email,
    cv.client_phone,
    cv.ownership_type
FROM trapper.clinichq_visits cv
JOIN trapper.cat_identifiers ci
    ON ci.id_type = 'microchip'
    AND ci.id_value = cv.microchip;

COMMENT ON VIEW trapper.v_consolidated_visits IS
'Consolidated clinic visits joined to cats via microchip. Used by cat detail API for visit history.';

-- ============================================
-- 2. Create v_cat_clinic_history view
-- ============================================

\echo 'Creating v_cat_clinic_history view...'

-- This view provides the expected column names for the cat detail API
-- It wraps v_cat_clinic_history_v2 but with the column names the API expects

CREATE OR REPLACE VIEW trapper.v_cat_clinic_history AS
SELECT
    ci.cat_id,
    cv.visit_date,
    cv.appointment_number AS appt_number,
    CONCAT_WS(' ', cv.client_first_name, cv.client_last_name) AS client_name,
    cv.client_address,
    cv.client_email,
    COALESCE(cv.client_cell_phone, cv.client_phone) AS client_phone,
    cv.ownership_type,
    cv.vet_name,
    cv.is_spay,
    cv.is_neuter,
    cv.felv_fiv_result,
    cv.has_uri,
    cv.has_dental_disease,
    cv.has_fleas,
    cv.temperature,
    cv.weight_lbs,
    cv.internal_notes
FROM trapper.clinichq_visits cv
JOIN trapper.cat_identifiers ci
    ON ci.id_type = 'microchip'
    AND ci.id_value = cv.microchip;

COMMENT ON VIEW trapper.v_cat_clinic_history IS
'Cat clinic history with expected column names for cat detail API. Keyed by microchip via cat_identifiers.';

-- ============================================
-- 3. Add indexes for performance
-- ============================================

\echo 'Ensuring indexes exist...'

-- Index on cat_identifiers for microchip lookups
CREATE INDEX IF NOT EXISTS idx_cat_identifiers_microchip
ON trapper.cat_identifiers(id_value)
WHERE id_type = 'microchip';

-- Index on clinichq_visits for microchip lookups
CREATE INDEX IF NOT EXISTS idx_clinichq_visits_microchip
ON trapper.clinichq_visits(microchip);

-- ============================================
-- 4. Summary
-- ============================================

\echo ''
\echo 'View row counts:'

SELECT 'v_consolidated_visits' AS view_name, COUNT(*) AS row_count
FROM trapper.v_consolidated_visits
UNION ALL
SELECT 'v_cat_clinic_history' AS view_name, COUNT(*) AS row_count
FROM trapper.v_cat_clinic_history;

\echo ''
\echo '=============================================='
\echo 'MIG_307 Complete!'
\echo ''
\echo 'Created views:'
\echo '  - v_consolidated_visits: Cat visits with service categorization'
\echo '  - v_cat_clinic_history: Clinic history with expected column names'
\echo ''
\echo 'These views enable the cat detail page to display visit history.'
\echo '=============================================='
\echo ''
