-- MIG_2854: Backfill is_alteration on appointments + re-geocode intake submissions
--
-- Part 1: is_alteration was never populated during ingest (FFS-261).
--   The dashboard stats query was fixed to use (is_spay OR is_neuter),
--   and the ingest INSERT was updated to compute is_alteration.
--   This backfills all existing appointments.
--
-- Part 2: Intake submissions written since FFS-128 (inline geocoding)
--   had coordinates written to wrong columns (geo_lat/geo_lng instead of
--   geo_latitude/geo_longitude). The route was fixed in FFS-261, but
--   submissions created during the bug window need their linked places
--   checked and flagged for re-geocoding.

\echo 'MIG_2854: Backfill is_alteration on ops.appointments...'

-- Part 1: Backfill is_alteration
UPDATE ops.appointments
SET is_alteration = TRUE,
    updated_at = NOW()
WHERE is_alteration IS NOT TRUE
  AND (is_spay = TRUE OR is_neuter = TRUE);

\echo '  Backfilled is_alteration'

-- Also set is_alteration = FALSE for appointments that are NOT alterations
-- (so the column is fully populated, not NULL)
UPDATE ops.appointments
SET is_alteration = FALSE,
    updated_at = NOW()
WHERE is_alteration IS NULL
  AND (is_spay IS NOT TRUE AND is_neuter IS NOT TRUE);

\echo '  Set is_alteration = FALSE for non-alterations'

-- Part 2: Flag intake submissions that may need re-geocoding
-- These are submissions with an address but no coordinates, created after
-- inline geocoding was added. The geocode cron should pick these up.
\echo ''
\echo 'Intake submissions needing re-geocode (missing coordinates despite having address):'
SELECT COUNT(*) AS needs_regeocode
FROM ops.intake_submissions
WHERE geo_latitude IS NULL
  AND cats_address IS NOT NULL
  AND cats_address != ''
  AND place_id IS NULL
  AND submitted_at > '2026-03-01';

\echo 'MIG_2854 complete'
