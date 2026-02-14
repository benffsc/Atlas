\echo '=== MIG_334: Geocoding Queue Completion ==='
\echo 'Queues all ungeocoded places for processing'
\echo ''

-- ============================================================================
-- PROBLEM
-- 726 places (~6.4%) lack geocoded locations.
-- This affects:
-- - Beacon map visualization
-- - DBSCAN clustering
-- - Distance-based queries
-- - Volunteer proximity features
-- ============================================================================

\echo 'Step 1: Current geocoding status...'

SELECT
    COUNT(*) as total_places,
    COUNT(*) FILTER (WHERE location IS NOT NULL) as geocoded,
    COUNT(*) FILTER (WHERE location IS NULL) as ungeocoded,
    ROUND(100.0 * COUNT(*) FILTER (WHERE location IS NOT NULL) / COUNT(*), 1) as geocoded_pct
FROM trapper.places
WHERE merged_into_place_id IS NULL;

\echo ''
\echo 'Step 2: Breakdown of ungeocoded places...'

SELECT
    CASE
        WHEN geocode_failed = TRUE THEN 'Failed (bad address)'
        WHEN geocode_next_attempt IS NOT NULL THEN 'Queued'
        ELSE 'Never attempted'
    END as status,
    COUNT(*) as count
FROM trapper.places
WHERE merged_into_place_id IS NULL
  AND location IS NULL
GROUP BY 1
ORDER BY count DESC;

-- ============================================================================
-- Step 3: Queue ungeocoded places for processing
-- ============================================================================

\echo ''
\echo 'Step 3: Queueing ungeocoded places...'

-- Reset failed flags and queue for retry (some may have been bad addresses
-- that could now be improved with better normalization)
WITH queued AS (
    UPDATE trapper.places
    SET geocode_next_attempt = NOW(),
        geocode_failed = FALSE,
        geocode_fail_reason = NULL
    WHERE merged_into_place_id IS NULL
      AND location IS NULL
      AND (
          geocode_failed IS NULL
          OR geocode_failed = FALSE
          OR geocode_fail_reason LIKE '%rate limit%'  -- Retry rate-limited
          OR geocode_fail_reason LIKE '%timeout%'     -- Retry timeouts
      )
    RETURNING place_id
)
SELECT COUNT(*) as places_queued FROM queued;

-- ============================================================================
-- Step 4: Prioritize places with cat activity
-- ============================================================================

\echo ''
\echo 'Step 4: Prioritizing places with cat activity...'

-- Places with more cat activity should be geocoded first
-- Set earlier next_attempt times for high-priority places
WITH prioritized AS (
    UPDATE trapper.places p
    SET geocode_next_attempt = NOW() - INTERVAL '1 hour'  -- Process first
    WHERE p.merged_into_place_id IS NULL
      AND p.location IS NULL
      AND p.geocode_next_attempt IS NOT NULL
      AND (
          p.has_cat_activity = TRUE
          OR EXISTS (
              SELECT 1 FROM trapper.sot_requests r
              WHERE r.place_id = p.place_id
          )
          OR EXISTS (
              SELECT 1 FROM trapper.cat_place_relationships cpr
              WHERE cpr.place_id = p.place_id
          )
      )
    RETURNING p.place_id
)
SELECT COUNT(*) as high_priority_places FROM prioritized;

-- ============================================================================
-- Step 5: Summary
-- ============================================================================

\echo ''
\echo '=== Geocoding Queue Summary ==='

SELECT
    COUNT(*) FILTER (WHERE location IS NOT NULL) as already_geocoded,
    COUNT(*) FILTER (WHERE location IS NULL AND geocode_next_attempt IS NOT NULL) as queued_for_geocoding,
    COUNT(*) FILTER (WHERE location IS NULL AND geocode_failed = TRUE AND geocode_next_attempt IS NULL) as permanently_failed
FROM trapper.places
WHERE merged_into_place_id IS NULL;

\echo ''
\echo '=== MIG_334 Complete ==='
\echo 'Ungeocoded places queued for processing.'
\echo ''
\echo 'The geocoding cron job will process these automatically.'
\echo 'To check progress: SELECT COUNT(*) FROM trapper.places WHERE location IS NULL;'
\echo ''

