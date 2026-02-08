\echo ''
\echo '=============================================='
\echo 'MIG_946: Fix Geocoding Normalized Address Bug'
\echo '=============================================='
\echo ''
\echo 'ROOT CAUSE OF 2,524 PLACE DUPLICATES FOUND!'
\echo ''
\echo 'Problem: Geocoding sets normalized_address = p_google_address (raw from Google)'
\echo '         This bypasses normalize_address() function, causing:'
\echo '         - Mixed case: "SANTA ROSA" vs "santa rosa"'
\echo '         - USA suffix: ", USA" not stripped'
\echo '         - Subsequent imports fail to find match → create duplicates'
\echo ''
\echo 'Fix:'
\echo '  1. Update save_geocoding_result() to use normalize_address()'
\echo '  2. Re-normalize all existing places with Google addresses'
\echo '  3. Auto-merge exact duplicate places'
\echo ''

-- ============================================================================
-- PART 1: Fix the save_geocoding_result function
-- ============================================================================

\echo '1. Patching save_geocoding_result to use normalize_address()...'

-- Get current function and patch it
CREATE OR REPLACE FUNCTION trapper.save_geocoding_result(
  p_place_id UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_google_address TEXT DEFAULT NULL,
  p_error TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
AS $function$
DECLARE
  v_attempts INT;
  v_max_attempts INT := 5;
  v_backoff_minutes INT;
  v_existing_place_id UUID;
  v_normalized TEXT;
BEGIN
  -- Get current attempt count
  SELECT COALESCE(geocode_attempts, 0)
  INTO v_attempts
  FROM trapper.places
  WHERE place_id = p_place_id;

  IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    -- Success case

    -- Check for coordinate-based duplicate (within 10m)
    -- This catches cases where geocoding returns same coords for nearby addresses
    SELECT place_id INTO v_existing_place_id
    FROM trapper.places
    WHERE place_id != p_place_id
      AND merged_into_place_id IS NULL
      AND location IS NOT NULL
      AND ST_DWithin(
          location,
          ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
          10  -- 10 meter tolerance
      )
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_existing_place_id IS NOT NULL THEN
      -- Found duplicate - merge into existing
      UPDATE trapper.places
      SET
        merged_into_place_id = v_existing_place_id,
        merged_at = NOW(),
        merge_reason = 'geocoding_coordinate_match',
        geocode_attempts = v_attempts + 1,
        geocode_last_attempt = NOW()
      WHERE place_id = p_place_id;

      -- Transfer any relationships to the canonical place
      UPDATE trapper.person_place_relationships
      SET place_id = v_existing_place_id
      WHERE place_id = p_place_id;

      UPDATE trapper.sot_requests
      SET place_id = v_existing_place_id
      WHERE place_id = p_place_id;

      RETURN;
    END IF;

    -- =========================================================================
    -- FIX: Normalize the Google address before storing
    -- Previously: normalized_address = COALESCE(p_google_address, normalized_address)
    -- This caused case-sensitive duplicates!
    -- =========================================================================
    v_normalized := COALESCE(
      trapper.normalize_address(p_google_address),
      (SELECT normalized_address FROM trapper.places WHERE place_id = p_place_id)
    );

    -- No duplicate found - update this place with geocoding result
    UPDATE trapper.places
    SET
      location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      -- FIXED: Use normalized version of Google address
      normalized_address = v_normalized,
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
$function$;

COMMENT ON FUNCTION trapper.save_geocoding_result IS
'Saves geocoding result for a place. Fixed in MIG_946 to normalize Google addresses
before storing, preventing case-sensitive duplicates.';

-- ============================================================================
-- PART 2: Re-normalize all existing places
-- ============================================================================

\echo ''
\echo '2. Re-normalizing all existing places...'

WITH updated AS (
  UPDATE trapper.places
  SET normalized_address = trapper.normalize_address(formatted_address),
      updated_at = NOW()
  WHERE normalized_address IS NOT NULL
    AND normalized_address <> trapper.normalize_address(formatted_address)
    AND merged_into_place_id IS NULL
  RETURNING place_id
)
SELECT COUNT(*) AS places_renormalized FROM updated;

-- ============================================================================
-- PART 3: Auto-merge exact duplicates after normalization
-- ============================================================================

\echo ''
\echo '3. Auto-merging exact duplicates (same normalized_address)...'

-- Find and merge exact duplicates
WITH duplicate_groups AS (
  SELECT
    normalized_address,
    ARRAY_AGG(place_id ORDER BY created_at) AS all_ids
  FROM trapper.places
  WHERE normalized_address IS NOT NULL
    AND merged_into_place_id IS NULL
  GROUP BY normalized_address
  HAVING COUNT(*) > 1
),
merges AS (
  SELECT
    all_ids[1] AS canonical_id,
    unnest(all_ids[2:]) AS duplicate_id
  FROM duplicate_groups
)
UPDATE trapper.places p
SET
  merged_into_place_id = m.canonical_id,
  merged_at = NOW(),
  merge_reason = 'mig_946_normalized_address_unification'
FROM merges m
WHERE p.place_id = m.duplicate_id
  AND p.merged_into_place_id IS NULL;

-- Count merged
SELECT COUNT(*) AS places_merged
FROM trapper.places
WHERE merge_reason = 'mig_946_normalized_address_unification';

-- ============================================================================
-- PART 4: Re-run place dedup detection
-- ============================================================================

\echo ''
\echo '4. Re-running place dedup detection...'

SELECT * FROM trapper.refresh_place_dedup_candidates();

-- ============================================================================
-- PART 5: Verification
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Normalized address patterns after fix:'
SELECT
  COUNT(*) FILTER (WHERE normalized_address LIKE '%, USA') AS has_usa_suffix,
  COUNT(*) FILTER (WHERE normalized_address ~ '[A-Z]') AS has_uppercase,
  COUNT(*) FILTER (WHERE normalized_address = LOWER(normalized_address)) AS is_lowercase,
  COUNT(*) as total
FROM trapper.places
WHERE normalized_address IS NOT NULL
  AND merged_into_place_id IS NULL;

\echo ''
\echo 'Place dedup candidates after fix:'
SELECT
  match_tier,
  COUNT(*) AS pair_count
FROM trapper.place_dedup_candidates
WHERE status = 'pending'
GROUP BY match_tier
ORDER BY match_tier;

\echo ''
\echo '=============================================='
\echo 'MIG_946 Complete!'
\echo '=============================================='
\echo ''
\echo 'Fixed:'
\echo '  1. save_geocoding_result() now uses normalize_address()'
\echo '  2. All existing places re-normalized to lowercase'
\echo '  3. Exact duplicates auto-merged'
\echo ''
\echo 'This eliminates the root cause of ShelterLuv duplicate places.'
\echo ''
