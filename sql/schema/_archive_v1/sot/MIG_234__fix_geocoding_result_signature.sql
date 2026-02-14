-- MIG_234: Fix record_geocoding_result Function Signature
--
-- Problem: The geocode-queue API route calls record_geocoding_result with 6 parameters
-- including the Google canonical address, but the function only accepts 5 parameters.
-- This causes HTTP 500 errors when running geocoding.
--
-- Solution: Update the function to accept the Google canonical address and use it
-- for deduplication - if another place already has the same canonical address, merge.
--
-- MANUAL APPLY:
--   source .env.local && psql "$DATABASE_URL" -f sql/schema/sot/MIG_234__fix_geocoding_result_signature.sql

\echo ''
\echo '=============================================='
\echo 'MIG_234: Fix record_geocoding_result Signature'
\echo '=============================================='
\echo ''

-- Drop existing function signatures to avoid conflicts
DROP FUNCTION IF EXISTS trapper.record_geocoding_result(uuid, boolean, double precision, double precision, text);
DROP FUNCTION IF EXISTS trapper.record_geocoding_result(uuid, boolean, double precision, double precision, text, text);

-- Update record_geocoding_result to accept Google canonical address
CREATE OR REPLACE FUNCTION trapper.record_geocoding_result(
  p_place_id UUID,
  p_success BOOLEAN,
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL,
  p_error TEXT DEFAULT NULL,
  p_google_address TEXT DEFAULT NULL  -- NEW: Google's canonical formatted address
) RETURNS VOID AS $$
DECLARE
  v_attempts INT;
  v_max_attempts INT := 5;
  v_backoff_minutes INT;
  v_existing_place_id UUID;
  v_current_address TEXT;
BEGIN
  -- Get current attempt count and address
  SELECT COALESCE(geocode_attempts, 0), formatted_address
  INTO v_attempts, v_current_address
  FROM trapper.places WHERE place_id = p_place_id;

  IF p_success THEN
    -- Check if another place already has this Google canonical address
    IF p_google_address IS NOT NULL THEN
      SELECT place_id INTO v_existing_place_id
      FROM trapper.places
      WHERE normalized_address = p_google_address
        AND place_id != p_place_id
        AND merged_into_place_id IS NULL
      LIMIT 1;

      IF v_existing_place_id IS NOT NULL THEN
        -- DEDUP: Another place has this canonical address - merge into it
        RAISE NOTICE 'Geocoding detected duplicate: % merging into % (canonical: %)',
          p_place_id, v_existing_place_id, p_google_address;

        -- Transfer all relationships to the existing place
        -- Person-place relationships (delete duplicates first)
        DELETE FROM trapper.person_place_relationships ppr1
        WHERE ppr1.place_id = p_place_id
          AND EXISTS (
            SELECT 1 FROM trapper.person_place_relationships ppr2
            WHERE ppr2.place_id = v_existing_place_id
              AND ppr2.person_id = ppr1.person_id
              AND ppr2.role = ppr1.role
          );

        UPDATE trapper.person_place_relationships
        SET place_id = v_existing_place_id
        WHERE place_id = p_place_id;

        -- Cat-place relationships (delete duplicates first)
        DELETE FROM trapper.cat_place_relationships cpr1
        WHERE cpr1.place_id = p_place_id
          AND EXISTS (
            SELECT 1 FROM trapper.cat_place_relationships cpr2
            WHERE cpr2.place_id = v_existing_place_id
              AND cpr2.cat_id = cpr1.cat_id
          );

        UPDATE trapper.cat_place_relationships
        SET place_id = v_existing_place_id
        WHERE place_id = p_place_id;

        -- Requests
        UPDATE trapper.sot_requests
        SET place_id = v_existing_place_id
        WHERE place_id = p_place_id;

        -- Intake submissions
        UPDATE trapper.web_intake_submissions
        SET place_id = v_existing_place_id,
            matched_place_id = v_existing_place_id
        WHERE place_id = p_place_id OR matched_place_id = p_place_id;

        -- Colony estimates
        UPDATE trapper.place_colony_estimates
        SET place_id = v_existing_place_id
        WHERE place_id = p_place_id;

        -- Mark the source place as merged
        UPDATE trapper.places
        SET merged_into_place_id = v_existing_place_id,
            merge_reason = 'geocode_canonical_match',
            merged_at = NOW(),
            updated_at = NOW()
        WHERE place_id = p_place_id;

        -- Update the canonical place with geocoding result if it doesn't have coords
        UPDATE trapper.places
        SET
          location = CASE
            WHEN location IS NULL THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
            ELSE location
          END,
          updated_at = NOW()
        WHERE place_id = v_existing_place_id;

        RETURN;
      END IF;
    END IF;

    -- No duplicate found - update this place with geocoding result
    UPDATE trapper.places
    SET
      location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      -- Update normalized_address to Google's canonical if provided
      normalized_address = COALESCE(p_google_address, normalized_address),
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
'Records the result of a geocoding attempt.

On success:
  - Sets location coordinates
  - Updates normalized_address to Google canonical (if provided)
  - Checks for duplicates by canonical address and merges if found

On failure:
  - Schedules retry with exponential backoff (1, 5, 15, 60 min)
  - After 5 failures, marks place as geocode_failed for manual review

Parameters:
  - p_place_id: The place being geocoded
  - p_success: Whether geocoding succeeded
  - p_lat, p_lng: Coordinates from Google
  - p_error: Error message on failure
  - p_google_address: Google canonical formatted_address for dedup';

\echo ''
\echo '=============================================='
\echo 'MIG_234 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  - record_geocoding_result now accepts 6th parameter (p_google_address)'
\echo '  - On success, updates normalized_address to Google canonical'
\echo '  - Checks for duplicate places with same canonical address'
\echo '  - Auto-merges duplicates detected during geocoding'
\echo ''
\echo 'The geocoding queue API will now work correctly.'
\echo ''
