-- MIG_223: Fix Procedures to Use Service Type (Not Status Flags)
--
-- Problem: cat_procedures was populated based on the 'Spay' = 'Yes' and 'Neuter' = 'Yes'
-- flags from ClinicHQ, which indicate the cat's CURRENT altered status, not whether
-- the clinic performed the procedure.
--
-- The correct field is 'Service / Subsidy' (service_type) which shows what the clinic
-- actually did:
--   - "Cat Spay / FF - FREE" = clinic performed spay
--   - "Cat Neuter /" = clinic performed neuter
--
-- Impact: ~5,237 spays and ~4,634 neuters were missing from cat_procedures
--         (cats where clinic did the surgery but is_spay/is_neuter flag was FALSE)
--
-- Example: Microchip 981020019760160 had service_type = 'Cat Spay / FF - FREE' in 2017
--          but is_spay = FALSE, so it wasn't counted.
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_223__fix_procedures_by_service_type.sql

\echo ''
\echo '=============================================='
\echo 'MIG_223: Fix Procedures to Use Service Type'
\echo '=============================================='
\echo ''

-- First, let's see the current state
\echo 'Current cat_procedures count:'
SELECT COUNT(*) as total_procedures,
       COUNT(*) FILTER (WHERE is_spay) as spays,
       COUNT(*) FILTER (WHERE is_neuter) as neuters
FROM trapper.cat_procedures;

-- ============================================================
-- 1. CLEANUP: Remove incorrectly linked procedures
--    These were created by MIG_164 based on status flags, linking
--    spay/neuter procedures to unrelated appointments (vaccines, etc.)
-- ============================================================

\echo ''
\echo 'Removing incorrectly linked SPAY procedures (linked to non-spay appointments)...'

DELETE FROM trapper.cat_procedures cp
USING trapper.sot_appointments a
WHERE cp.appointment_id = a.appointment_id
  AND cp.is_spay = TRUE
  AND a.service_type NOT ILIKE '%spay%';

\echo 'Removing incorrectly linked NEUTER procedures (linked to non-neuter appointments)...'

DELETE FROM trapper.cat_procedures cp
USING trapper.sot_appointments a
WHERE cp.appointment_id = a.appointment_id
  AND cp.is_neuter = TRUE
  AND a.service_type NOT ILIKE '%neuter%';

-- ============================================================
-- 2. Add procedures for appointments with spay service_type
--    that are missing from cat_procedures
-- ============================================================

\echo ''
\echo 'Adding missing SPAY procedures based on service_type...'

INSERT INTO trapper.cat_procedures (
    cat_id, appointment_id, procedure_type, procedure_date, status,
    performed_by, technician,
    is_spay, is_neuter, is_cryptorchid, is_pre_scrotal,
    staples_used, complications, post_op_notes,
    source_system, source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    'spay',
    a.appointment_date,
    'completed'::trapper.procedure_status,
    a.vet_name,
    a.technician,
    TRUE,   -- is_spay based on SERVICE, not flag
    FALSE,
    FALSE,
    FALSE,
    FALSE,  -- staples_used default
    NULL,   -- complications
    NULL,   -- post_op_notes
    'clinichq',
    a.appointment_number
FROM trapper.sot_appointments a
WHERE a.cat_id IS NOT NULL
  AND a.service_type ILIKE '%spay%'
  -- Don't duplicate if we already have a procedure for this appointment
  AND NOT EXISTS (
    SELECT 1 FROM trapper.cat_procedures cp
    WHERE cp.appointment_id = a.appointment_id
      AND cp.is_spay = TRUE
  )
ON CONFLICT DO NOTHING;

\echo 'Added spay procedures:'
SELECT COUNT(*) as new_spays FROM trapper.cat_procedures
WHERE is_spay = TRUE;

-- ============================================================
-- 3. Add procedures for appointments with neuter service_type
--    that are missing from cat_procedures
-- ============================================================

\echo ''
\echo 'Adding missing NEUTER procedures based on service_type...'

INSERT INTO trapper.cat_procedures (
    cat_id, appointment_id, procedure_type, procedure_date, status,
    performed_by, technician,
    is_spay, is_neuter, is_cryptorchid, is_pre_scrotal,
    staples_used, complications, post_op_notes,
    source_system, source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    'neuter',
    a.appointment_date,
    'completed'::trapper.procedure_status,
    a.vet_name,
    a.technician,
    FALSE,
    TRUE,   -- is_neuter based on SERVICE, not flag
    FALSE,  -- is_cryptorchid
    FALSE,  -- is_pre_scrotal
    FALSE,  -- staples_used default
    NULL,   -- complications
    NULL,   -- post_op_notes
    'clinichq',
    a.appointment_number
FROM trapper.sot_appointments a
WHERE a.cat_id IS NOT NULL
  AND a.service_type ILIKE '%neuter%'
  -- Don't duplicate if we already have a procedure for this appointment
  AND NOT EXISTS (
    SELECT 1 FROM trapper.cat_procedures cp
    WHERE cp.appointment_id = a.appointment_id
      AND cp.is_neuter = TRUE
  )
ON CONFLICT DO NOTHING;

\echo 'Added neuter procedures:'
SELECT COUNT(*) as new_neuters FROM trapper.cat_procedures
WHERE is_neuter = TRUE;

-- ============================================================
-- 4. Verify the fix
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'New cat_procedures count:'
SELECT COUNT(*) as total_procedures,
       COUNT(*) FILTER (WHERE is_spay) as spays,
       COUNT(*) FILTER (WHERE is_neuter) as neuters
FROM trapper.cat_procedures;

\echo ''
\echo 'Verify Dawn Cerini cat 981020019760160 now has procedure:'
SELECT
  c.display_name as cat_name,
  ci.id_value as microchip,
  cp.procedure_type,
  cp.procedure_date,
  cp.is_spay,
  a.service_type
FROM trapper.cat_procedures cp
JOIN trapper.sot_cats c ON c.cat_id = cp.cat_id
JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
JOIN trapper.sot_appointments a ON a.appointment_id = cp.appointment_id
WHERE ci.id_value = '981020019760160';

\echo ''
\echo 'Sample of newly added procedures (service_type based):'
SELECT
  c.display_name,
  cp.procedure_type,
  cp.procedure_date,
  a.service_type,
  a.is_spay as appt_is_spay_flag,
  a.is_neuter as appt_is_neuter_flag
FROM trapper.cat_procedures cp
JOIN trapper.sot_cats c ON c.cat_id = cp.cat_id
JOIN trapper.sot_appointments a ON a.appointment_id = cp.appointment_id
WHERE (cp.is_spay = TRUE AND a.is_spay = FALSE)
   OR (cp.is_neuter = TRUE AND a.is_neuter = FALSE)
LIMIT 10;

-- ============================================================
-- 5. Update sot_cats altered_status for cats we fixed
-- ============================================================

\echo ''
\echo 'Updating sot_cats.altered_status for cats with clinic procedures...'

UPDATE trapper.sot_cats c
SET altered_status = 'spayed'
WHERE c.altered_status != 'spayed'
  AND EXISTS (
    SELECT 1 FROM trapper.cat_procedures cp
    WHERE cp.cat_id = c.cat_id AND cp.is_spay = TRUE
  );

UPDATE trapper.sot_cats c
SET altered_status = 'neutered'
WHERE c.altered_status != 'neutered'
  AND EXISTS (
    SELECT 1 FROM trapper.cat_procedures cp
    WHERE cp.cat_id = c.cat_id AND cp.is_neuter = TRUE
  );

\echo ''
\echo 'MIG_223 complete!'
\echo ''
\echo 'Key changes:'
\echo '  - cat_procedures now includes ALL appointments with spay/neuter service_type'
\echo '  - ~5,237 spays and ~4,634 neuters that were missed are now counted'
\echo '  - sot_cats.altered_status updated for cats with clinic procedures'
\echo ''
\echo 'IMPORTANT: The is_spay/is_neuter fields in sot_appointments indicate the'
\echo 'cat status, NOT whether the clinic performed surgery. Use service_type'
\echo 'or cat_procedures.is_spay/is_neuter for clinic-performed alterations.'
\echo ''

SELECT 'MIG_223 Complete' AS status;
