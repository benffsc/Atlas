-- MIG_3111: ClinicHQ Scraped People Notes Backfill
--
-- NO SCHEMA CHANGES — this is documentation + verification only.
--
-- The people notes backfill uses the EXISTING infrastructure:
--   - ops.upsert_clinichq_notes() function (MIG_2550)
--   - scripts/ingest-v2/clinichq_notes_ingest.ts
--
-- Run:
--   source apps/web/.env.local && npx tsx scripts/ingest-v2/clinichq_notes_ingest.ts \
--     --csv "/Users/benmisdiaz/Documents/SCraped data/clinichq_people_notes.csv"
--
-- Expected impact:
--   - ~415 new quick_notes on ops.clinic_accounts
--   - ~538 new long_notes on ops.clinic_accounts
--   - 11,761 rows with clinichq_client_id linked
--
-- Safe because: Notes go to ops.clinic_accounts (source layer), not sot.people.
-- No entity creation, no identity resolution.
--
-- Created: 2026-04-25

\echo ''
\echo '=============================================='
\echo '  MIG_3111: Scraped People Notes (verify only)'
\echo '=============================================='
\echo ''

-- Verification: baseline counts before running the script
\echo 'Current state (before backfill):'

SELECT
  COUNT(*) AS total_accounts,
  COUNT(*) FILTER (WHERE clinichq_client_id IS NOT NULL) AS with_client_id,
  COUNT(*) FILTER (WHERE quick_notes IS NOT NULL AND quick_notes != '') AS with_quick_notes,
  COUNT(*) FILTER (WHERE long_notes IS NOT NULL AND long_notes != '') AS with_long_notes,
  COUNT(*) FILTER (WHERE tags IS NOT NULL AND tags != '') AS with_tags
FROM ops.clinic_accounts
WHERE merged_into_account_id IS NULL;

\echo ''
\echo 'Run the ingest script to populate notes:'
\echo '  source apps/web/.env.local && npx tsx scripts/ingest-v2/clinichq_notes_ingest.ts \'
\echo '    --csv "/Users/benmisdiaz/Documents/SCraped data/clinichq_people_notes.csv"'
\echo ''
