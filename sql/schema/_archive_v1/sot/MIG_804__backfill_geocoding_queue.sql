\echo '=== MIG_804: Backfill geocoding queue for orphaned places ==='
\echo 'Finds places with addresses but no coordinates and no geocoding queue state.'
\echo 'These were created by direct INSERTs that bypassed find_or_create_place_deduped().'

-- =========================================================================
-- 1. Re-queue places that have an address but were never queued for geocoding
-- =========================================================================
-- Criteria:
--   - Has a formatted_address (something to geocode)
--   - No location (not yet geocoded)
--   - Not merged into another place
--   - geocode_attempts IS NULL or geocode_next_attempt IS NULL
--     (indicating they were never properly queued)
--   - Not already marked as permanently failed
-- =========================================================================

DO $$
DECLARE
  v_count INT;
BEGIN
  UPDATE trapper.places
  SET
    geocode_attempts = COALESCE(geocode_attempts, 0),
    geocode_next_attempt = COALESCE(geocode_next_attempt, NOW()),
    geocode_failed = COALESCE(geocode_failed, FALSE)
  WHERE location IS NULL
    AND formatted_address IS NOT NULL
    AND formatted_address != ''
    AND merged_into_place_id IS NULL
    AND (
      geocode_attempts IS NULL
      OR geocode_next_attempt IS NULL
    )
    AND COALESCE(geocode_failed, FALSE) = FALSE;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Re-queued % places for geocoding', v_count;
END $$;

-- =========================================================================
-- 2. Also re-queue places that permanently failed but have active requests
-- =========================================================================
-- These are worth retrying since they matter for operations.
-- =========================================================================

DO $$
DECLARE
  v_count INT;
BEGIN
  UPDATE trapper.places p
  SET
    geocode_failed = FALSE,
    geocode_attempts = 0,
    geocode_next_attempt = NOW()
  WHERE p.geocode_failed = TRUE
    AND p.location IS NULL
    AND p.merged_into_place_id IS NULL
    AND EXISTS (
      SELECT 1 FROM trapper.sot_requests r
      WHERE r.place_id = p.place_id
        AND r.status NOT IN ('completed', 'cancelled')
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Re-queued % previously-failed places with active requests', v_count;
END $$;

-- =========================================================================
-- 3. Summary
-- =========================================================================

\echo ''
\echo '--- Current geocoding queue status ---'

SELECT
  COUNT(*) FILTER (WHERE location IS NOT NULL) AS geocoded,
  COUNT(*) FILTER (WHERE location IS NULL AND COALESCE(geocode_failed, FALSE) = FALSE AND formatted_address IS NOT NULL) AS pending_geocode,
  COUNT(*) FILTER (WHERE geocode_failed = TRUE) AS permanently_failed,
  COUNT(*) FILTER (WHERE location IS NULL AND formatted_address IS NULL) AS no_address
FROM trapper.places
WHERE merged_into_place_id IS NULL;

\echo '=== MIG_804 complete ==='
