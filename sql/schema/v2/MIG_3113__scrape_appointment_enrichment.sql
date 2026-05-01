-- MIG_3113: Add scraped appointment enrichment columns
--
-- New columns on ops.appointments for data only available via scraping:
--   - animal_quick_notes: staff observations about the animal (21,214 values)
--   - trapper_name: who trapped the cat (1,870 values)
--
-- Note: animal_caution was evaluated and found to be a single boilerplate value
-- ("This animal is anxious and/or has a potential to bite...") on 41,212 of 41,213
-- records. Not worth storing as a column.
--
-- Also backfills existing sparse columns via script:
--   - cat_weight_lbs (parse "7.82 lbs" → 7.82)
--   - cat_age_years / cat_age_months (parse "2 years, 0 months")
--   - ownership_type (map "Community Cat (Feral)" → "community_cat")
--
-- Created: 2026-04-25

\echo ''
\echo '=============================================='
\echo '  MIG_3113: Appointment Enrichment Columns'
\echo '=============================================='
\echo ''

BEGIN;

-- New columns
\echo '1. Adding new columns...'

ALTER TABLE ops.appointments
  ADD COLUMN IF NOT EXISTS animal_quick_notes TEXT;

ALTER TABLE ops.appointments
  ADD COLUMN IF NOT EXISTS trapper_name TEXT;

COMMENT ON COLUMN ops.appointments.animal_quick_notes IS
'Staff quick notes about the animal from ClinicHQ scrape. Per-appointment observations.';

COMMENT ON COLUMN ops.appointments.trapper_name IS
'Trapper name from ClinicHQ scrape. Free-text, not yet resolved to sot.people.';

COMMIT;

-- Verification
\echo ''
\echo '2. Verifying columns exist...'

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'appointments'
  AND column_name IN ('animal_quick_notes', 'trapper_name',
                      'cat_weight_lbs', 'cat_age_years', 'cat_age_months', 'ownership_type')
ORDER BY column_name;

-- Baseline
\echo ''
\echo '3. Current coverage (before backfill):'

SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE cat_weight_lbs IS NOT NULL) AS with_weight,
  COUNT(*) FILTER (WHERE cat_age_years IS NOT NULL OR cat_age_months IS NOT NULL) AS with_age,
  COUNT(*) FILTER (WHERE ownership_type IS NOT NULL AND ownership_type != '') AS with_ownership_type,
  COUNT(*) FILTER (WHERE animal_quick_notes IS NOT NULL) AS with_animal_quick_notes,
  COUNT(*) FILTER (WHERE trapper_name IS NOT NULL) AS with_trapper_name
FROM ops.appointments;

\echo ''
\echo 'Run the enrichment backfill:'
\echo '  source apps/web/.env.local && npx tsx scripts/pipeline/backfill-scraped-appointments.ts \'
\echo '    --csv "/Users/benmisdiaz/Documents/SCraped data/clinichq_appointments_medical_merged.csv" \'
\echo '    --mode enrichment'
\echo ''
