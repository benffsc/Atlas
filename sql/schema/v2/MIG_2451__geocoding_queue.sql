-- MIG_2451: Geocoding Queue System for V2
--
-- Adds async geocoding with retry logic and failure flagging.
-- Places can be created with addresses, queued for geocoding, and retried
-- automatically. After max retries, places are flagged for manual review.
--
-- Adapted from V1 MIG_227 for V2 schema (sot.places, ops schema for functions)

BEGIN;

-- ============================================
-- PART 1: Add geocoding queue columns to sot.places
-- ============================================

ALTER TABLE sot.places
  ADD COLUMN IF NOT EXISTS geocode_attempts INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS geocode_last_attempt TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS geocode_next_attempt TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS geocode_error TEXT,
  ADD COLUMN IF NOT EXISTS geocode_failed BOOLEAN DEFAULT FALSE;

-- ============================================
-- PART 2: Function to get next places to geocode
-- ============================================

CREATE OR REPLACE FUNCTION ops.get_geocoding_queue(p_limit INT DEFAULT 50)
RETURNS TABLE (
  place_id UUID,
  formatted_address TEXT,
  geocode_attempts INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.place_id,
    p.formatted_address,
    COALESCE(p.geocode_attempts, 0) as geocode_attempts
  FROM sot.places p
  WHERE p.location IS NULL
    AND p.formatted_address IS NOT NULL
    AND p.formatted_address != ''
    AND COALESCE(p.geocode_failed, FALSE) = FALSE
    AND COALESCE(p.geocode_next_attempt, NOW()) <= NOW()
  ORDER BY
    -- Prioritize: active requests first, then by attempts (fewer first), then by queue time
    EXISTS (
      SELECT 1 FROM ops.requests r
      WHERE r.place_id = p.place_id
        AND r.status NOT IN ('completed', 'cancelled')
    ) DESC,
    COALESCE(p.geocode_attempts, 0) ASC,
    COALESCE(p.geocode_next_attempt, p.created_at) ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.get_geocoding_queue IS
'Returns places that need geocoding, prioritized by active requests and retry count.
Excludes places marked as permanently failed.';

-- ============================================
-- PART 3: Function to record geocoding result
-- ============================================

CREATE OR REPLACE FUNCTION ops.record_geocoding_result(
  p_place_id UUID,
  p_success BOOLEAN,
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL,
  p_error TEXT DEFAULT NULL,
  p_google_address TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_attempts INT;
  v_max_attempts INT := 5;
  v_backoff_minutes INT;
BEGIN
  -- Get current attempt count
  SELECT COALESCE(geocode_attempts, 0) INTO v_attempts
  FROM sot.places WHERE place_id = p_place_id;

  IF p_success THEN
    -- Success: update location and clear error state
    UPDATE sot.places
    SET
      location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      formatted_address = COALESCE(p_google_address, formatted_address),
      geocode_attempts = v_attempts + 1,
      geocode_last_attempt = NOW(),
      geocode_next_attempt = NULL,
      geocode_error = NULL,
      geocode_failed = FALSE,
      updated_at = NOW()
    WHERE place_id = p_place_id;

  ELSE
    -- Failure: increment attempts and schedule retry with exponential backoff
    v_attempts := v_attempts + 1;

    -- Backoff: 1min, 5min, 15min, 60min, then fail
    v_backoff_minutes := CASE v_attempts
      WHEN 1 THEN 1
      WHEN 2 THEN 5
      WHEN 3 THEN 15
      WHEN 4 THEN 60
      ELSE NULL
    END;

    IF v_attempts >= v_max_attempts THEN
      -- Max retries reached - flag as failed
      UPDATE sot.places
      SET
        geocode_attempts = v_attempts,
        geocode_last_attempt = NOW(),
        geocode_next_attempt = NULL,
        geocode_error = p_error,
        geocode_failed = TRUE,
        updated_at = NOW()
      WHERE place_id = p_place_id;

      RAISE NOTICE 'Place % geocoding failed permanently after % attempts: %',
        p_place_id, v_attempts, p_error;
    ELSE
      -- Schedule retry
      UPDATE sot.places
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

COMMENT ON FUNCTION ops.record_geocoding_result IS
'Records the result of a geocoding attempt. On success, sets location.
On failure, schedules retry with exponential backoff (1, 5, 15, 60 min).
After 5 failures, marks place as geocode_failed for manual review.';

-- ============================================
-- PART 4: Stats view
-- ============================================

DROP VIEW IF EXISTS ops.v_geocoding_stats CASCADE;
CREATE VIEW ops.v_geocoding_stats AS
SELECT
  (SELECT COUNT(*) FROM sot.places WHERE location IS NOT NULL) as geocoded,
  (SELECT COUNT(*) FROM sot.places
   WHERE location IS NULL AND formatted_address IS NOT NULL
     AND COALESCE(geocode_failed, FALSE) = FALSE) as pending,
  (SELECT COUNT(*) FROM sot.places WHERE geocode_failed = TRUE) as failed,
  (SELECT COUNT(*) FROM sot.places
   WHERE location IS NULL AND formatted_address IS NOT NULL
     AND geocode_next_attempt <= NOW()
     AND COALESCE(geocode_failed, FALSE) = FALSE) as ready_to_process;

COMMENT ON VIEW ops.v_geocoding_stats IS
'Summary stats for geocoding queue: geocoded, pending, failed, ready to process.';

-- ============================================
-- PART 5: View for failed geocoding (needs manual review)
-- ============================================

DROP VIEW IF EXISTS ops.v_geocoding_failures CASCADE;
CREATE VIEW ops.v_geocoding_failures AS
SELECT
  p.place_id,
  p.display_name,
  p.formatted_address,
  p.geocode_attempts,
  p.geocode_last_attempt,
  p.geocode_error,
  p.created_at,
  (SELECT COUNT(*) FROM ops.requests r WHERE r.place_id = p.place_id) as request_count
FROM sot.places p
WHERE p.geocode_failed = TRUE
ORDER BY
  p.geocode_last_attempt DESC;

COMMENT ON VIEW ops.v_geocoding_failures IS
'Places that failed geocoding after max retries. These need manual review.';

COMMIT;

-- Verification
SELECT 'Geocoding queue system created' AS info;
SELECT * FROM ops.v_geocoding_stats;
