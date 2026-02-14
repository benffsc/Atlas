-- MIG_227: Geocoding Queue System
--
-- Adds async geocoding with retry logic and failure flagging.
-- Places can be created with addresses, queued for geocoding, and retried
-- automatically. After max retries, places are flagged for manual review.

\echo ''
\echo '=============================================='
\echo 'MIG_227: Geocoding Queue System'
\echo '=============================================='
\echo ''

-- ============================================
-- PART 1: Add geocoding queue columns to sot_addresses
-- ============================================

-- Add columns if they don't exist
DO $$
BEGIN
  -- Retry tracking
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'sot_addresses' AND column_name = 'geocode_attempts') THEN
    ALTER TABLE trapper.sot_addresses ADD COLUMN geocode_attempts INT DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'sot_addresses' AND column_name = 'geocode_last_attempt') THEN
    ALTER TABLE trapper.sot_addresses ADD COLUMN geocode_last_attempt TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'sot_addresses' AND column_name = 'geocode_next_attempt') THEN
    ALTER TABLE trapper.sot_addresses ADD COLUMN geocode_next_attempt TIMESTAMPTZ DEFAULT NOW();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'sot_addresses' AND column_name = 'geocode_error') THEN
    ALTER TABLE trapper.sot_addresses ADD COLUMN geocode_error TEXT;
  END IF;
END $$;

-- Add similar columns to places (for places without sot_address link)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'places' AND column_name = 'geocode_attempts') THEN
    ALTER TABLE trapper.places ADD COLUMN geocode_attempts INT DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'places' AND column_name = 'geocode_last_attempt') THEN
    ALTER TABLE trapper.places ADD COLUMN geocode_last_attempt TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'places' AND column_name = 'geocode_next_attempt') THEN
    ALTER TABLE trapper.places ADD COLUMN geocode_next_attempt TIMESTAMPTZ DEFAULT NOW();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'places' AND column_name = 'geocode_error') THEN
    ALTER TABLE trapper.places ADD COLUMN geocode_error TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'places' AND column_name = 'geocode_failed') THEN
    ALTER TABLE trapper.places ADD COLUMN geocode_failed BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- ============================================
-- PART 2: Function to get next places to geocode
-- ============================================

CREATE OR REPLACE FUNCTION trapper.get_geocoding_queue(p_limit INT DEFAULT 50)
RETURNS TABLE (
  place_id UUID,
  formatted_address TEXT,
  geocode_attempts INT,
  has_active_request BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.place_id,
    p.formatted_address,
    COALESCE(p.geocode_attempts, 0) as geocode_attempts,
    EXISTS (
      SELECT 1 FROM trapper.sot_requests r
      WHERE r.place_id = p.place_id
        AND r.status NOT IN ('completed', 'cancelled')
    ) as has_active_request
  FROM trapper.places p
  WHERE p.location IS NULL
    AND p.formatted_address IS NOT NULL
    AND p.formatted_address != ''
    AND COALESCE(p.geocode_failed, FALSE) = FALSE
    AND COALESCE(p.geocode_next_attempt, NOW()) <= NOW()
  ORDER BY
    -- Prioritize: active requests first, then by attempts (fewer first), then by queue time
    EXISTS (
      SELECT 1 FROM trapper.sot_requests r
      WHERE r.place_id = p.place_id
        AND r.status NOT IN ('completed', 'cancelled')
    ) DESC,
    COALESCE(p.geocode_attempts, 0) ASC,
    COALESCE(p.geocode_next_attempt, p.created_at) ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.get_geocoding_queue IS
'Returns places that need geocoding, prioritized by active requests and retry count.
Excludes places marked as permanently failed.';

-- ============================================
-- PART 3: Function to record geocoding result
-- ============================================

CREATE OR REPLACE FUNCTION trapper.record_geocoding_result(
  p_place_id UUID,
  p_success BOOLEAN,
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL,
  p_error TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_attempts INT;
  v_max_attempts INT := 5;
  v_backoff_minutes INT;
BEGIN
  -- Get current attempt count
  SELECT COALESCE(geocode_attempts, 0) INTO v_attempts
  FROM trapper.places WHERE place_id = p_place_id;

  IF p_success THEN
    -- Success: update location and clear error state
    UPDATE trapper.places
    SET
      location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
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
      UPDATE trapper.places
      SET
        geocode_attempts = v_attempts,
        geocode_last_attempt = NOW(),
        geocode_next_attempt = NULL,
        geocode_error = p_error,
        geocode_failed = TRUE,
        updated_at = NOW()
      WHERE place_id = p_place_id;

      -- Log the failure
      RAISE NOTICE 'Place % geocoding failed permanently after % attempts: %',
        p_place_id, v_attempts, p_error;
    ELSE
      -- Schedule retry
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
'Records the result of a geocoding attempt. On success, sets location.
On failure, schedules retry with exponential backoff (1, 5, 15, 60 min).
After 5 failures, marks place as geocode_failed for manual review.';

-- ============================================
-- PART 4: View for failed geocoding (needs manual review)
-- ============================================

CREATE OR REPLACE VIEW trapper.v_geocoding_failures AS
SELECT
  p.place_id,
  p.display_name,
  p.formatted_address,
  p.geocode_attempts,
  p.geocode_last_attempt,
  p.geocode_error,
  p.created_at,
  -- Context
  (SELECT COUNT(*) FROM trapper.sot_requests r WHERE r.place_id = p.place_id) as request_count,
  EXISTS (
    SELECT 1 FROM trapper.sot_requests r
    WHERE r.place_id = p.place_id AND r.status NOT IN ('completed', 'cancelled')
  ) as has_active_request
FROM trapper.places p
WHERE p.geocode_failed = TRUE
ORDER BY
  has_active_request DESC,
  p.geocode_last_attempt DESC;

COMMENT ON VIEW trapper.v_geocoding_failures IS
'Places that failed geocoding after max retries. These need manual review -
either fix the address or manually set coordinates.';

-- ============================================
-- PART 5: Stats view
-- ============================================

CREATE OR REPLACE VIEW trapper.v_geocoding_stats AS
SELECT
  (SELECT COUNT(*) FROM trapper.places WHERE location IS NOT NULL) as geocoded,
  (SELECT COUNT(*) FROM trapper.places
   WHERE location IS NULL AND formatted_address IS NOT NULL
     AND COALESCE(geocode_failed, FALSE) = FALSE) as pending,
  (SELECT COUNT(*) FROM trapper.places WHERE geocode_failed = TRUE) as failed,
  (SELECT COUNT(*) FROM trapper.places
   WHERE location IS NULL AND formatted_address IS NOT NULL
     AND geocode_next_attempt <= NOW()
     AND COALESCE(geocode_failed, FALSE) = FALSE) as ready_to_process,
  (SELECT COUNT(*) FROM trapper.places p
   WHERE p.location IS NULL
     AND EXISTS (SELECT 1 FROM trapper.sot_requests r
       WHERE r.place_id = p.place_id AND r.status NOT IN ('completed', 'cancelled'))
  ) as active_requests_pending;

COMMENT ON VIEW trapper.v_geocoding_stats IS
'Summary stats for geocoding queue: geocoded, pending, failed, ready to process.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'Verification:'

SELECT * FROM trapper.v_geocoding_stats;

\echo ''
\echo 'MIG_227 complete!'
\echo ''
\echo 'New functions:'
\echo '  - get_geocoding_queue(limit): Get places ready to geocode'
\echo '  - record_geocoding_result(place_id, success, lat, lng, error): Record result'
\echo ''
\echo 'New views:'
\echo '  - v_geocoding_failures: Places that need manual review'
\echo '  - v_geocoding_stats: Summary statistics'
\echo ''
