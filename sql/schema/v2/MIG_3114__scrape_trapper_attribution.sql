-- MIG_3114: Trapper Attribution from Scraped Data
--
-- Creates a staging/review table for trapper name → person matching.
-- The CSV animal_trapper field (1,870 records) contains trapper names.
-- Name-only matching is PROHIBITED by invariant (Identity By Identifier Only).
--
-- Approach: Stage trapper names, then manually review/approve matches.
--
-- Created: 2026-04-25

\echo ''
\echo '=============================================='
\echo '  MIG_3114: Trapper Attribution Staging'
\echo '=============================================='
\echo ''

BEGIN;

-- Staging table for trapper name resolution
CREATE TABLE IF NOT EXISTS ops.scrape_trapper_staging (
  id            SERIAL PRIMARY KEY,
  trapper_name  TEXT NOT NULL,
  appointment_count INTEGER NOT NULL DEFAULT 0,

  -- Resolution (filled during manual review)
  matched_person_id   UUID REFERENCES sot.people(person_id),
  match_confidence    TEXT CHECK (match_confidence IN ('high', 'medium', 'low', 'rejected')),
  match_method        TEXT,  -- 'exact_name', 'fuzzy_name', 'manual'
  reviewed_at         TIMESTAMPTZ,
  reviewed_by         TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for quick lookup
CREATE INDEX IF NOT EXISTS idx_trapper_staging_name
  ON ops.scrape_trapper_staging(LOWER(trapper_name));

COMMENT ON TABLE ops.scrape_trapper_staging IS
'Staging table for trapper name → person resolution from ClinicHQ scrape.
Populated by backfill-scraped-appointments.ts --mode trapper-staging.
Must be MANUALLY REVIEWED before linking — name-only matching is prohibited (INV-5).';

COMMIT;

\echo ''
\echo 'Created ops.scrape_trapper_staging table.'
\echo ''
\echo 'After running the backfill script with --mode trapper-staging,'
\echo 'review matches with:'
\echo ''
\echo '  SELECT s.trapper_name, s.appointment_count,'
\echo '         p.display_name, p.person_id'
\echo '  FROM ops.scrape_trapper_staging s'
\echo '  LEFT JOIN sot.people p ON LOWER(p.display_name) = LOWER(s.trapper_name)'
\echo '  ORDER BY s.appointment_count DESC;'
\echo ''
