-- MIG_2403__drop_redundant_unique_constraints.sql
-- Drop redundant unique constraints that cause INSERT failures
--
-- Issue: Multiple unique constraints on the same logical data caused
-- ON CONFLICT clauses to miss certain constraint violations.
--
-- appointments had:
--   - (appointment_number, appointment_date) - PRIMARY dedup
--   - clinichq_appointment_id - REDUNDANT
--   - source_record_id - REDUNDANT
--
-- clinic_accounts had:
--   - (owner_first_name, owner_last_name, owner_email) - conflicts with function logic
--
-- The function upsert_clinic_account_for_owner() uses source_record_id as primary
-- dedup key, but the name+email constraint would fire first, causing failures.

\echo ''
\echo '=============================================='
\echo '  MIG_2403: Drop Redundant Unique Constraints'
\echo '=============================================='
\echo ''

-- Drop appointments constraints (keep appointment_number + appointment_date as primary)
ALTER TABLE ops.appointments DROP CONSTRAINT IF EXISTS appointments_clinichq_id_unique;
DROP INDEX IF EXISTS ops.appointments_source_record_id_unique;

-- Drop clinic_accounts name+email constraint (function handles dedup differently)
ALTER TABLE ops.clinic_accounts DROP CONSTRAINT IF EXISTS clinic_accounts_name_email_key;

\echo ''
\echo '  MIG_2403 Complete!'
\echo '=============================================='
\echo ''
