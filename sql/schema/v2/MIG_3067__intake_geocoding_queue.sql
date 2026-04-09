-- MIG_3067: Async Geocoding Queue for ops.intake_submissions
--
-- Part of FFS-1181 Follow-Up — Phase 4 (industry-standard reliability).
-- Replaces the inline best-effort geocoding pattern in /api/intake/public
-- (Phase 1c stopgap) with a queued retry pattern similar to what
-- Salesforce Field Service uses:
--
--   status FSM:
--     pending → ok               (success)
--             → failed            (5 retries exhausted = DLQ)
--             → zero_results      (Google returned ZERO_RESULTS)
--             → unreachable       (network / 5xx)
--             → manual_override   (staff entered lat/lng directly)
--             → skipped           (intentionally ungeocodable)
--
--   retry schedule: [1m, 5m, 30m, 2h, 12h] with ±30s jitter
--
-- Also adds ops.geocode_cache for address string → lat/lng cache to
-- reduce Google API hits on repeated colony addresses (expected 30–60%
-- hit rate based on volume).
--
-- Depends on:
--   - MIG_3064 (service_area_status trigger now reads from place)
--   - ops.intake_submissions
--
-- Created: 2026-04-07

\echo ''
\echo '=============================================='
\echo '  MIG_3067: intake_submissions geocoding queue'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. Queue columns on ops.intake_submissions
-- ============================================================================

\echo '1. Adding geocode_* columns to ops.intake_submissions...'

ALTER TABLE ops.intake_submissions
  ADD COLUMN IF NOT EXISTS geocode_status TEXT DEFAULT 'pending'
    CHECK (geocode_status IN (
      'pending','ok','failed','zero_results',
      'unreachable','manual_override','skipped'
    )),
  ADD COLUMN IF NOT EXISTS geocode_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS geocode_last_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS geocode_last_error TEXT,
  ADD COLUMN IF NOT EXISTS geocode_next_attempt_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_intake_geocode_queue
  ON ops.intake_submissions (geocode_next_attempt_at)
  WHERE geocode_status = 'pending';

COMMENT ON COLUMN ops.intake_submissions.geocode_status IS
'MIG_3067 (FFS-1181 follow-up): geocoding queue state.
  pending — awaiting cron pickup
  ok — geo_latitude/longitude populated
  failed — retries exhausted (DLQ)
  zero_results — Google returned ZERO_RESULTS
  unreachable — transient network / 5xx
  manual_override — staff entered lat/lng directly in the DLQ UI
  skipped — intentionally ungeocodable (e.g., remote forest)';

-- ============================================================================
-- 2. Backfill status for existing rows
-- ============================================================================

\echo '2. Backfilling geocode_status from existing data...'

UPDATE ops.intake_submissions
   SET geocode_status = 'ok',
       geocode_next_attempt_at = NULL
 WHERE geo_latitude IS NOT NULL
   AND geo_longitude IS NOT NULL
   AND geocode_status = 'pending';

UPDATE ops.intake_submissions
   SET geocode_status = 'pending',
       geocode_next_attempt_at = NOW()
 WHERE geo_latitude IS NULL
   AND cats_address IS NOT NULL
   AND cats_address <> ''
   AND geocode_status = 'pending';

-- Rows without cats_address can't be geocoded
UPDATE ops.intake_submissions
   SET geocode_status = 'skipped'
 WHERE (cats_address IS NULL OR cats_address = '')
   AND geocode_status = 'pending';

-- ============================================================================
-- 3. ops.geocode_cache — address string → result cache
-- ============================================================================

\echo '3. Creating ops.geocode_cache...'

CREATE TABLE IF NOT EXISTS ops.geocode_cache (
  address_norm      TEXT PRIMARY KEY,
  lat               NUMERIC,
  lng               NUMERIC,
  formatted_address TEXT,
  provider          TEXT NOT NULL DEFAULT 'google',
  status            TEXT NOT NULL CHECK (status IN ('ok','zero_results')),
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ,
  hit_count         INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_geocode_cache_expires
  ON ops.geocode_cache (expires_at)
  WHERE expires_at IS NOT NULL;

COMMENT ON TABLE ops.geocode_cache IS
'MIG_3067 (FFS-1181 follow-up): address cache to reduce repeat Google
Geocoding API calls. Key is the normalized address string (lowercased,
whitespace-collapsed). TTL via expires_at (NULL = permanent).';

-- ============================================================================
-- 4. Normalization helper
-- ============================================================================

\echo '4. Creating ops.normalize_address_for_cache()...'

CREATE OR REPLACE FUNCTION ops.normalize_address_for_cache(p_address TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT LOWER(TRIM(REGEXP_REPLACE(COALESCE(p_address, ''), '\s+', ' ', 'g')));
$$;

COMMENT ON FUNCTION ops.normalize_address_for_cache IS
'MIG_3067: lowercase + collapse whitespace for ops.geocode_cache keying.';

-- ============================================================================
-- 5. Queue reader — oldest N ready submissions
-- ============================================================================

\echo '5. Creating ops.get_intake_geocoding_queue()...'

CREATE OR REPLACE FUNCTION ops.get_intake_geocoding_queue(
  p_limit INT DEFAULT 50
) RETURNS TABLE (
  submission_id UUID,
  cats_address  TEXT,
  cats_city     TEXT,
  cats_zip      TEXT,
  attempts      INT
) AS $$
  SELECT
    s.submission_id,
    s.cats_address,
    s.cats_city,
    s.cats_zip,
    s.geocode_attempts
  FROM ops.intake_submissions s
  WHERE s.geocode_status = 'pending'
    AND s.cats_address IS NOT NULL
    AND s.cats_address <> ''
    AND (s.geocode_next_attempt_at IS NULL
         OR s.geocode_next_attempt_at <= NOW())
  ORDER BY s.geocode_next_attempt_at NULLS FIRST, s.created_at
  LIMIT p_limit;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION ops.get_intake_geocoding_queue IS
'MIG_3067: return up to p_limit intake submissions ready for geocoding.
Ordered oldest-first to prevent starvation.';

-- ============================================================================
-- 6. Result recorder (updates submission + writes cache)
-- ============================================================================

\echo '6. Creating ops.record_intake_geocoding_result()...'

CREATE OR REPLACE FUNCTION ops.record_intake_geocoding_result(
  p_submission_id      UUID,
  p_result             TEXT,   -- 'ok' | 'zero_results' | 'unreachable' | 'failed'
  p_lat                NUMERIC DEFAULT NULL,
  p_lng                NUMERIC DEFAULT NULL,
  p_formatted_address  TEXT DEFAULT NULL,
  p_error              TEXT DEFAULT NULL,
  p_cache_key          TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_attempts INT;
  v_max_attempts CONSTANT INT := 5;
  v_next_attempt TIMESTAMPTZ;
  v_jitter_seconds INT;
BEGIN
  -- Retry schedule: [1m, 5m, 30m, 2h, 12h] with ±30s jitter
  -- Jitter prevents thundering-herd on provider outages.
  v_jitter_seconds := (RANDOM() * 60)::INT - 30;

  IF p_result = 'ok' THEN
    UPDATE ops.intake_submissions
       SET geo_latitude            = p_lat,
           geo_longitude           = p_lng,
           geo_formatted_address   = COALESCE(p_formatted_address, geo_formatted_address),
           geo_confidence          = 1.0,
           geocode_status          = 'ok',
           geocode_attempts        = geocode_attempts + 1,
           geocode_last_attempted_at = NOW(),
           geocode_last_error      = NULL,
           geocode_next_attempt_at = NULL,
           updated_at              = NOW()
     WHERE submission_id = p_submission_id;

    -- Also populate linked place if missing (same pattern as /api/intake)
    UPDATE sot.places
       SET location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
           formatted_address = COALESCE(formatted_address, p_formatted_address),
           updated_at = NOW()
     WHERE place_id = (
       SELECT place_id FROM ops.intake_submissions WHERE submission_id = p_submission_id
     )
       AND location IS NULL;

    -- Cache the successful result
    IF p_cache_key IS NOT NULL THEN
      INSERT INTO ops.geocode_cache (
        address_norm, lat, lng, formatted_address, provider, status
      ) VALUES (
        p_cache_key, p_lat, p_lng, p_formatted_address, 'google', 'ok'
      )
      ON CONFLICT (address_norm) DO UPDATE
        SET lat = EXCLUDED.lat,
            lng = EXCLUDED.lng,
            formatted_address = EXCLUDED.formatted_address,
            fetched_at = NOW();
    END IF;

  ELSIF p_result = 'zero_results' THEN
    -- ZERO_RESULTS is terminal — don't retry, but still cache it
    UPDATE ops.intake_submissions
       SET geocode_status          = 'zero_results',
           geocode_attempts        = geocode_attempts + 1,
           geocode_last_attempted_at = NOW(),
           geocode_last_error      = COALESCE(p_error, 'ZERO_RESULTS'),
           geocode_next_attempt_at = NULL,
           updated_at              = NOW()
     WHERE submission_id = p_submission_id;

    IF p_cache_key IS NOT NULL THEN
      INSERT INTO ops.geocode_cache (
        address_norm, provider, status
      ) VALUES (
        p_cache_key, 'google', 'zero_results'
      )
      ON CONFLICT (address_norm) DO UPDATE
        SET status = EXCLUDED.status, fetched_at = NOW();
    END IF;

  ELSE
    -- 'unreachable' or transient failure: bump attempts, schedule retry
    SELECT geocode_attempts INTO v_attempts
      FROM ops.intake_submissions
     WHERE submission_id = p_submission_id;

    v_attempts := COALESCE(v_attempts, 0) + 1;

    IF v_attempts >= v_max_attempts THEN
      -- Retries exhausted → DLQ
      UPDATE ops.intake_submissions
         SET geocode_status          = 'failed',
             geocode_attempts        = v_attempts,
             geocode_last_attempted_at = NOW(),
             geocode_last_error      = p_error,
             geocode_next_attempt_at = NULL,
             updated_at              = NOW()
       WHERE submission_id = p_submission_id;
    ELSE
      v_next_attempt := NOW() + (
        CASE v_attempts
          WHEN 1 THEN INTERVAL '1 minute'
          WHEN 2 THEN INTERVAL '5 minutes'
          WHEN 3 THEN INTERVAL '30 minutes'
          WHEN 4 THEN INTERVAL '2 hours'
          ELSE        INTERVAL '12 hours'
        END
      ) + (v_jitter_seconds || ' seconds')::INTERVAL;

      UPDATE ops.intake_submissions
         SET geocode_status          = 'pending',
             geocode_attempts        = v_attempts,
             geocode_last_attempted_at = NOW(),
             geocode_last_error      = p_error,
             geocode_next_attempt_at = v_next_attempt,
             updated_at              = NOW()
       WHERE submission_id = p_submission_id;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.record_intake_geocoding_result IS
'MIG_3067: write a geocoding result to ops.intake_submissions with
retry scheduling + cache write. p_result is one of ok, zero_results,
unreachable, failed. Implements [1m, 5m, 30m, 2h, 12h] retry backoff
with ±30s jitter and max 5 attempts.';

-- ============================================================================
-- 7. Cache lookup helper
-- ============================================================================

\echo '7. Creating ops.lookup_geocode_cache()...'

CREATE OR REPLACE FUNCTION ops.lookup_geocode_cache(p_address_norm TEXT)
RETURNS TABLE (
  lat NUMERIC,
  lng NUMERIC,
  formatted_address TEXT,
  status TEXT
) AS $$
  UPDATE ops.geocode_cache
     SET hit_count = hit_count + 1
   WHERE address_norm = p_address_norm
     AND (expires_at IS NULL OR expires_at > NOW())
  RETURNING lat, lng, formatted_address, status;
$$ LANGUAGE sql;

COMMENT ON FUNCTION ops.lookup_geocode_cache IS
'MIG_3067: look up an address in the geocode cache, bumping hit_count
and returning (lat, lng, formatted_address, status). Empty result set
when not cached or expired.';

-- ============================================================================
-- 8. Health view
-- ============================================================================

\echo '8. Creating ops.v_intake_geocoding_health...'

CREATE OR REPLACE VIEW ops.v_intake_geocoding_health AS
SELECT
  COUNT(*) FILTER (WHERE geocode_status = 'pending')         AS pending,
  COUNT(*) FILTER (WHERE geocode_status = 'ok')              AS ok,
  COUNT(*) FILTER (WHERE geocode_status = 'failed')          AS failed,
  COUNT(*) FILTER (WHERE geocode_status = 'zero_results')    AS zero_results,
  COUNT(*) FILTER (WHERE geocode_status = 'unreachable')     AS unreachable,
  COUNT(*) FILTER (WHERE geocode_status = 'manual_override') AS manual_override,
  COUNT(*) FILTER (WHERE geocode_status = 'skipped')         AS skipped,
  EXTRACT(EPOCH FROM (
    NOW() - MIN(created_at) FILTER (WHERE geocode_status = 'pending')
  )) / 60 AS oldest_pending_age_minutes
FROM ops.intake_submissions;

COMMENT ON VIEW ops.v_intake_geocoding_health IS
'MIG_3067: queue health summary for /api/health/intake-geocoding.';

-- ============================================================================
-- 9. Verification
-- ============================================================================

\echo '9. Verification...'

DO $$
DECLARE
  v_pending INT;
  v_ok INT;
  v_skipped INT;
BEGIN
  SELECT pending, ok, skipped INTO v_pending, v_ok, v_skipped
    FROM ops.v_intake_geocoding_health;

  RAISE NOTICE '   Queue health: pending=%, ok=%, skipped=%',
    v_pending, v_ok, v_skipped;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'get_intake_geocoding_queue'
  ) THEN
    RAISE EXCEPTION 'get_intake_geocoding_queue() not created';
  END IF;
END $$;

COMMIT;

\echo ''
\echo '✓ MIG_3067 complete'
\echo ''
