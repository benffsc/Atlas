-- ============================================================================
-- MIG_556: Queue Non-Address-Backed Places for Geocoding
-- ============================================================================
-- 4,850+ places from VolunteerHub, ShelterLuv, and ClinicHQ have coordinates
-- and formatted addresses but never went through the geocoding/normalization
-- pipeline. They have no sot_address_id, can't be deduplicated, and person
-- primary_address_id can't be set.
--
-- Why: queue_ungeocoded_places() only queues places where location IS NULL.
-- These places already had coordinates from their source systems.
--
-- Fix: Reset location so the geocoding pipeline picks them up. The pipeline
-- (record_geocoding_result) will:
--   - Re-geocode the formatted_address via Google
--   - Normalize and create sot_address records
--   - Deduplicate against existing places (merge if canonical match found)
--   - Transfer relationships when merging
--
-- After running, the geocoding cron (/api/cron/geocode) processes in batches.
-- ============================================================================

\echo '=== MIG_556: Queue Non-Address-Backed Places for Geocoding ==='

-- Preview how many places will be queued
\echo 'Places to queue by data source:'
SELECT data_source, COUNT(*) AS place_count
FROM trapper.places
WHERE merged_into_place_id IS NULL
  AND is_address_backed = FALSE
  AND sot_address_id IS NULL
  AND formatted_address IS NOT NULL
  AND data_source IN ('volunteerhub', 'shelterluv', 'clinichq')
GROUP BY data_source
ORDER BY data_source;

-- Reset location and queue for geocoding
UPDATE trapper.places
SET location = NULL,
    geocode_next_attempt = NOW(),
    geocode_attempts = 0,
    geocode_failed = FALSE,
    geocode_error = NULL
WHERE merged_into_place_id IS NULL
  AND is_address_backed = FALSE
  AND sot_address_id IS NULL
  AND formatted_address IS NOT NULL
  AND data_source IN ('volunteerhub', 'shelterluv', 'clinichq');

\echo 'Places queued for geocoding:'
SELECT COUNT(*) AS queued
FROM trapper.places
WHERE geocode_next_attempt IS NOT NULL
  AND location IS NULL
  AND merged_into_place_id IS NULL;

\echo ''
\echo 'Next step: Run geocoding cron repeatedly until all are processed.'
\echo 'Then run MIG_557 to backfill primary_address_id.'
\echo '=== MIG_556 Complete ==='
