-- ============================================================================
-- MIG_885: Geocoding Recovery — Re-queue Failed + Increase Max Attempts
-- ============================================================================
-- Problem: 91 places permanently failed after 5 attempts (max_attempts=5).
-- Some may have had transient Google API issues. 1,081 places awaiting geocoding.
--
-- Solution:
-- 1. Re-queue failed places for a second pass
-- 2. Increase max_attempts from 5 to 10 in record_geocoding_result()
-- 3. Let existing cron (*/30 * * * *) process the re-queued places
-- ============================================================================

\echo ''
\echo '============================================================'
\echo 'MIG_885: Geocoding Recovery'
\echo '============================================================'
\echo ''

-- ============================================================================
-- Phase 1: Pre-diagnostic
-- ============================================================================

\echo 'Phase 1: Geocoding baseline...'

SELECT
  (SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL) AS total_places,
  (SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL AND location IS NOT NULL) AS geocoded,
  (SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL AND geocode_failed = TRUE) AS failed,
  (SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL AND location IS NULL
    AND formatted_address IS NOT NULL AND TRIM(formatted_address) != ''
    AND COALESCE(geocode_failed, FALSE) = FALSE) AS in_queue,
  ROUND(100.0 * (SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL AND location IS NOT NULL) /
    NULLIF((SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL), 0), 1) AS pct_geocoded;

-- ============================================================================
-- Phase 2: Re-queue permanently failed places
-- ============================================================================

\echo ''
\echo 'Phase 2: Re-queueing failed places...'

WITH requeued AS (
  UPDATE trapper.places
  SET
    geocode_failed = FALSE,
    geocode_next_attempt = NOW(),
    geocode_error = NULL,
    updated_at = NOW()
  WHERE geocode_failed = TRUE
    AND merged_into_place_id IS NULL
    AND formatted_address IS NOT NULL
    AND TRIM(formatted_address) != ''
    AND LENGTH(TRIM(formatted_address)) > 5
  RETURNING place_id
)
SELECT COUNT(*) AS places_requeued FROM requeued;

-- ============================================================================
-- Phase 3: Update record_geocoding_result max_attempts from 5 to 10
-- ============================================================================

\echo ''
\echo 'Phase 3: Updating max_attempts to 10...'

CREATE OR REPLACE FUNCTION trapper.record_geocoding_result(
  p_place_id UUID,
  p_success BOOLEAN,
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL,
  p_error TEXT DEFAULT NULL,
  p_google_address TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_attempts INT;
  v_max_attempts INT := 10;  -- MIG_885: increased from 5 to 10
  v_backoff_minutes INT;
  v_existing_place_id UUID;
  v_current_address TEXT;
BEGIN
  -- Get current attempt count and address
  SELECT COALESCE(geocode_attempts, 0), formatted_address
  INTO v_attempts, v_current_address
  FROM trapper.places
  WHERE place_id = p_place_id;

  v_attempts := v_attempts + 1;

  IF p_success AND p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    -- Check for duplicate: another place with same Google canonical address
    IF p_google_address IS NOT NULL AND TRIM(p_google_address) != '' THEN
      SELECT place_id INTO v_existing_place_id
      FROM trapper.places
      WHERE normalized_address = UPPER(TRIM(p_google_address))
        AND place_id != p_place_id
        AND merged_into_place_id IS NULL
        AND location IS NOT NULL
      LIMIT 1;

      IF v_existing_place_id IS NOT NULL THEN
        -- Duplicate found: merge this place into the existing one
        PERFORM trapper.merge_places(p_place_id, v_existing_place_id);
        RETURN;
      END IF;
    END IF;

    -- Success: update location
    UPDATE trapper.places
    SET
      location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326),
      geocode_attempts = v_attempts,
      geocode_last_attempt = NOW(),
      geocode_next_attempt = NULL,
      geocode_error = NULL,
      geocode_failed = FALSE,
      normalized_address = CASE
        WHEN p_google_address IS NOT NULL AND TRIM(p_google_address) != ''
        THEN UPPER(TRIM(p_google_address))
        ELSE normalized_address
      END,
      updated_at = NOW()
    WHERE place_id = p_place_id;
  ELSE
    -- Failure: increment attempt, schedule retry with backoff
    v_backoff_minutes := CASE v_attempts
      WHEN 1 THEN 1
      WHEN 2 THEN 5
      WHEN 3 THEN 15
      WHEN 4 THEN 60
      WHEN 5 THEN 120
      WHEN 6 THEN 240
      WHEN 7 THEN 480
      WHEN 8 THEN 960
      WHEN 9 THEN 1440
      ELSE NULL
    END;

    IF v_attempts >= v_max_attempts THEN
      -- Max retries reached - flag as permanently failed
      UPDATE trapper.places
      SET
        geocode_attempts = v_attempts,
        geocode_last_attempt = NOW(),
        geocode_next_attempt = NULL,
        geocode_error = p_error,
        geocode_failed = TRUE,
        updated_at = NOW()
      WHERE place_id = p_place_id;
    ELSE
      -- Schedule next retry
      UPDATE trapper.places
      SET
        geocode_attempts = v_attempts,
        geocode_last_attempt = NOW(),
        geocode_next_attempt = NOW() + (v_backoff_minutes || ' minutes')::INTERVAL,
        geocode_error = p_error,
        updated_at = NOW()
      WHERE place_id = p_place_id;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.record_geocoding_result IS
'Records geocoding result. MIG_885: max_attempts increased from 5 to 10.
On success: sets coordinates, checks for duplicate canonical addresses (auto-merge).
On failure: exponential backoff (1, 5, 15, 60, 120, 240, 480, 960, 1440 min). Permanent fail at 10 attempts.';

-- ============================================================================
-- Phase 4: Verification
-- ============================================================================

\echo ''
\echo '=== Verification ==='

SELECT
  (SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL AND geocode_failed = TRUE) AS still_failed,
  (SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL AND location IS NULL
    AND formatted_address IS NOT NULL AND TRIM(formatted_address) != ''
    AND COALESCE(geocode_failed, FALSE) = FALSE) AS in_queue_after,
  ROUND(100.0 * (SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL AND location IS NOT NULL) /
    NULLIF((SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL), 0), 1) AS pct_geocoded_after;

\echo ''
\echo '=== MIG_885 Complete ==='
\echo 'Re-queued failed places. Cron (*/30 * * * *) will process them automatically.'
\echo 'Max attempts increased from 5 to 10 for extended retry coverage.'
