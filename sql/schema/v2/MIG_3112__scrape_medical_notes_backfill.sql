-- MIG_3112: ClinicHQ Scraped Medical Notes Backfill
--
-- NO SCHEMA CHANGES — ops.appointments.medical_notes already exists (MIG_2070).
--
-- This migration documents the backfill and provides verification queries.
-- Actual data loading is done by:
--   scripts/pipeline/backfill-scraped-appointments.ts --mode medical-notes
--
-- Join strategy:
--   CSV record_id = ops.appointments.source_record_id (ClinicHQ numeric ID)
--   Only UPDATE where DB medical_notes IS NULL/empty
--   Do NOT overwrite existing staff-entered notes
--
-- Expected impact:
--   - medical_notes: ~685 → ~6,756 (6,071 new)
--
-- Created: 2026-04-25

\echo ''
\echo '=============================================='
\echo '  MIG_3112: Scraped Medical Notes (verify only)'
\echo '=============================================='
\echo ''

-- Baseline counts
\echo 'Current state (before backfill):'

SELECT
  COUNT(*) AS total_appointments,
  COUNT(*) FILTER (WHERE medical_notes IS NOT NULL AND medical_notes != '') AS with_medical_notes,
  COUNT(*) FILTER (WHERE source_system = 'clinichq') AS clinichq_appointments,
  COUNT(*) FILTER (WHERE source_record_id ~ '^\d+$') AS with_numeric_source_id
FROM ops.appointments;

\echo ''
\echo 'Run the backfill script:'
\echo '  source apps/web/.env.local && npx tsx scripts/pipeline/backfill-scraped-appointments.ts \'
\echo '    --csv "/Users/benmisdiaz/Documents/SCraped data/clinichq_appointments_medical_merged.csv" \'
\echo '    --mode medical-notes'
\echo ''
