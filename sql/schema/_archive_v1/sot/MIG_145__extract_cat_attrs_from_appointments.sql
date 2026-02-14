-- MIG_145__extract_cat_attrs_from_appointments.sql
-- Extract cat attributes (sex, altered_status) from ClinicHQ appointment_info
--
-- Problem:
--   Many cats have empty sex/altered_status because they only have appointment_info
--   records (no cat_info record). Example: microchip 981020053084012 has Spay=Yes
--   but the cat record shows sex=NULL, altered_status=NULL.
--
-- Solution:
--   Infer sex and altered_status from appointment_info:
--   - Spay = Yes → sex = 'Female', altered_status = 'Yes'
--   - Neuter = Yes → sex = 'Male', altered_status = 'Yes'
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_145__extract_cat_attrs_from_appointments.sql

-- ============================================================
-- 1. Create a view of surgery info from appointment_info
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_appointment_surgery_info AS
SELECT DISTINCT ON (microchip)
    payload->>'Microchip Number' AS microchip,
    payload->>'Date' AS procedure_date,
    payload->>'Spay' AS spay_status,
    payload->>'Neuter' AS neuter_status,
    payload->>'Vet Name' AS vet_name,
    payload->>'Technician' AS technician,
    payload->>'Internal Medical Notes' AS medical_notes,
    -- Inferred attributes
    CASE
        WHEN payload->>'Spay' = 'Yes' THEN 'Female'
        WHEN payload->>'Neuter' = 'Yes' THEN 'Male'
        ELSE NULL
    END AS inferred_sex,
    CASE
        WHEN payload->>'Spay' = 'Yes' OR payload->>'Neuter' = 'Yes' THEN 'Yes'
        ELSE NULL
    END AS inferred_altered_status
FROM trapper.staged_records
WHERE source_system = 'clinichq'
  AND source_table = 'appointment_info'
  AND payload->>'Microchip Number' IS NOT NULL
  AND payload->>'Microchip Number' <> ''
  AND (payload->>'Spay' = 'Yes' OR payload->>'Neuter' = 'Yes')
ORDER BY microchip, payload->>'Date' DESC;  -- Most recent surgery first

COMMENT ON VIEW trapper.v_appointment_surgery_info IS
'Surgery info extracted from ClinicHQ appointment_info records.
Used to infer sex and altered_status for cats missing this data.';

-- ============================================================
-- 2. Check how many cats can be updated
-- ============================================================

\echo ''
\echo 'Cats that can have sex/altered_status filled from appointment_info:'
SELECT
    COUNT(*) as cats_to_update,
    COUNT(*) FILTER (WHERE asi.inferred_sex = 'Female') as will_be_female,
    COUNT(*) FILTER (WHERE asi.inferred_sex = 'Male') as will_be_male
FROM trapper.sot_cats c
JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
JOIN trapper.v_appointment_surgery_info asi ON asi.microchip = ci.id_value
WHERE (c.sex IS NULL OR c.sex = '')
   OR (c.altered_status IS NULL OR c.altered_status = '');

-- ============================================================
-- 3. Update cats with inferred attributes
-- ============================================================

\echo ''
\echo 'Updating cats with sex and altered_status from appointment_info...'

WITH updates AS (
    SELECT
        c.cat_id,
        asi.inferred_sex,
        asi.inferred_altered_status,
        asi.procedure_date
    FROM trapper.sot_cats c
    JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
    JOIN trapper.v_appointment_surgery_info asi ON asi.microchip = ci.id_value
    WHERE (c.sex IS NULL OR c.sex = '')
       OR (c.altered_status IS NULL OR c.altered_status = '')
)
UPDATE trapper.sot_cats c
SET
    sex = COALESCE(NULLIF(c.sex, ''), u.inferred_sex),
    altered_status = COALESCE(NULLIF(c.altered_status, ''), u.inferred_altered_status),
    updated_at = NOW()
FROM updates u
WHERE c.cat_id = u.cat_id;

-- ============================================================
-- 4. Verification
-- ============================================================

\echo ''
\echo 'After update - cats with sex/altered_status:'
SELECT
    COUNT(*) as total_cats,
    COUNT(*) FILTER (WHERE sex IS NOT NULL AND sex <> '') as has_sex,
    COUNT(*) FILTER (WHERE altered_status IS NOT NULL AND altered_status <> '') as has_altered,
    COUNT(*) FILTER (WHERE sex = 'Female') as female,
    COUNT(*) FILTER (WHERE sex = 'Male') as male
FROM trapper.sot_cats;

\echo ''
\echo 'Verify the example cat (981020053084012):'
SELECT c.display_name, c.sex, c.altered_status, c.data_source
FROM trapper.sot_cats c
JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id
WHERE ci.id_value = '981020053084012';

SELECT 'MIG_145 Complete' AS status;
