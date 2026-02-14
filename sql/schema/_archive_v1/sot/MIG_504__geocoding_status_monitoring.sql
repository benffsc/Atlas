-- MIG_504: Geocoding Status Monitoring
--
-- Problem:
--   Tests show 0% geocoding rate but there's no easy way to monitor
--   geocoding health or identify issues.
--
-- Solution:
--   1. Create v_geocoding_status view for monitoring
--   2. Create queue_ungeocoded_places() function for manual queueing
--   3. Create v_geocoding_failures view to identify problematic addresses
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_504__geocoding_status_monitoring.sql

\echo ''
\echo '=============================================='
\echo 'MIG_504: Geocoding Status Monitoring'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Create geocoding status monitoring view
-- ============================================================

\echo '1. Creating v_geocoding_status monitoring view...'

CREATE OR REPLACE VIEW trapper.v_geocoding_status AS
SELECT
  -- Overall counts
  (SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL) AS total_places,
  (SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL AND location IS NOT NULL) AS geocoded,
  (SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL AND location IS NULL) AS ungeocoded,
  -- Rate
  ROUND(100.0 *
    (SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL AND location IS NOT NULL) /
    NULLIF((SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL), 0), 1
  ) AS geocoded_pct,
  -- Queue status
  (SELECT COUNT(*) FROM trapper.places
   WHERE merged_into_place_id IS NULL
     AND location IS NULL
     AND geocode_next_attempt IS NOT NULL
     AND geocode_next_attempt <= NOW()) AS ready_to_process,
  (SELECT COUNT(*) FROM trapper.places
   WHERE merged_into_place_id IS NULL
     AND location IS NULL
     AND geocode_next_attempt IS NOT NULL
     AND geocode_next_attempt > NOW()) AS scheduled,
  (SELECT COUNT(*) FROM trapper.places
   WHERE merged_into_place_id IS NULL
     AND location IS NULL
     AND geocode_failed = TRUE) AS permanently_failed,
  (SELECT COUNT(*) FROM trapper.places
   WHERE merged_into_place_id IS NULL
     AND location IS NULL
     AND geocode_next_attempt IS NULL
     AND (geocode_failed IS NULL OR geocode_failed = FALSE)) AS never_attempted;

COMMENT ON VIEW trapper.v_geocoding_status IS
'Dashboard view for geocoding pipeline health monitoring.
Shows counts for: geocoded, queued, failed, never attempted.';

-- ============================================================
-- 2. Create function to queue ungeocoded places
-- ============================================================

\echo '2. Creating queue_ungeocoded_places function...'

CREATE OR REPLACE FUNCTION trapper.queue_ungeocoded_places(
  p_retry_failed BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
  queued_count INT,
  skipped_permanently_failed INT,
  already_queued INT
) AS $$
DECLARE
  v_queued INT := 0;
  v_skipped INT := 0;
  v_already INT := 0;
BEGIN
  -- Count already queued
  SELECT COUNT(*) INTO v_already
  FROM trapper.places
  WHERE merged_into_place_id IS NULL
    AND location IS NULL
    AND geocode_next_attempt IS NOT NULL;

  -- Count permanently failed (won't queue unless p_retry_failed)
  SELECT COUNT(*) INTO v_skipped
  FROM trapper.places
  WHERE merged_into_place_id IS NULL
    AND location IS NULL
    AND geocode_failed = TRUE
    AND NOT p_retry_failed;

  -- Queue never-attempted places
  UPDATE trapper.places
  SET geocode_next_attempt = NOW()
  WHERE merged_into_place_id IS NULL
    AND location IS NULL
    AND geocode_next_attempt IS NULL
    AND (geocode_failed IS NULL OR geocode_failed = FALSE)
    AND formatted_address IS NOT NULL;

  GET DIAGNOSTICS v_queued = ROW_COUNT;

  -- Optionally retry failed
  IF p_retry_failed THEN
    WITH retried AS (
      UPDATE trapper.places
      SET geocode_next_attempt = NOW(),
          geocode_failed = FALSE,
          geocode_error = NULL
      WHERE merged_into_place_id IS NULL
        AND location IS NULL
        AND geocode_failed = TRUE
      RETURNING 1
    )
    SELECT v_queued + COUNT(*) INTO v_queued FROM retried;
    v_skipped := 0;
  END IF;

  RETURN QUERY SELECT v_queued, v_skipped, v_already;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.queue_ungeocoded_places IS
'Queues all ungeocoded places for processing.
Set p_retry_failed = TRUE to also retry permanently failed addresses.
Returns: queued_count, skipped_permanently_failed, already_queued';

-- ============================================================
-- 3. Create view for geocoding failures analysis
-- ============================================================

\echo '3. Creating v_geocoding_failures analysis view...'

CREATE OR REPLACE VIEW trapper.v_geocoding_failures AS
SELECT
  place_id,
  display_name,
  formatted_address,
  geocode_error,
  created_at,
  -- Categorize the failure
  CASE
    WHEN geocode_error ILIKE '%not found%' THEN 'address_not_found'
    WHEN geocode_error ILIKE '%rate limit%' THEN 'rate_limited'
    WHEN geocode_error ILIKE '%timeout%' THEN 'timeout'
    WHEN geocode_error ILIKE '%invalid%' THEN 'invalid_address'
    WHEN geocode_error ILIKE '%zero results%' THEN 'no_results'
    WHEN geocode_error IS NULL THEN 'unknown'
    ELSE 'other'
  END AS failure_category
FROM trapper.places
WHERE merged_into_place_id IS NULL
  AND location IS NULL
  AND geocode_failed = TRUE
ORDER BY created_at DESC;

COMMENT ON VIEW trapper.v_geocoding_failures IS
'Lists places that failed geocoding with categorized failure reasons.
Use to identify patterns in geocoding failures for address normalization improvements.';

-- ============================================================
-- 4. Summary by failure category
-- ============================================================

\echo '4. Creating v_geocoding_failure_summary...'

CREATE OR REPLACE VIEW trapper.v_geocoding_failure_summary AS
SELECT
  CASE
    WHEN geocode_error ILIKE '%not found%' THEN 'address_not_found'
    WHEN geocode_error ILIKE '%rate limit%' THEN 'rate_limited'
    WHEN geocode_error ILIKE '%timeout%' THEN 'timeout'
    WHEN geocode_error ILIKE '%invalid%' THEN 'invalid_address'
    WHEN geocode_error ILIKE '%zero results%' THEN 'no_results'
    WHEN geocode_error IS NULL THEN 'unknown'
    ELSE 'other'
  END AS failure_category,
  COUNT(*) AS count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM trapper.places
WHERE merged_into_place_id IS NULL
  AND location IS NULL
  AND geocode_failed = TRUE
GROUP BY 1
ORDER BY count DESC;

COMMENT ON VIEW trapper.v_geocoding_failure_summary IS
'Summary of geocoding failures by category for triage';

-- ============================================================
-- Summary
-- ============================================================

\echo ''
\echo '=============================================='
\echo 'MIG_504 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - v_geocoding_status: Overall geocoding health'
\echo '  - queue_ungeocoded_places(): Manual queue function'
\echo '  - v_geocoding_failures: Detailed failure list'
\echo '  - v_geocoding_failure_summary: Failure category breakdown'
\echo ''
\echo 'Usage:'
\echo '  SELECT * FROM trapper.v_geocoding_status;'
\echo '  SELECT * FROM trapper.queue_ungeocoded_places();'
\echo '  SELECT * FROM trapper.v_geocoding_failure_summary;'
\echo ''

-- Show current status
SELECT * FROM trapper.v_geocoding_status;

-- Record migration
SELECT trapper.record_migration(504, 'MIG_504__geocoding_status_monitoring');
