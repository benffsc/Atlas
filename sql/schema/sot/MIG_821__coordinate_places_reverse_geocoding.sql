\echo '=== MIG_821: Coordinate Places & Reverse Geocoding Infrastructure ==='
\echo 'Enables coordinate-only places from Google Maps data, adds reverse geocoding'
\echo 'pipeline to resolve them to real addresses, and completes the bulk migration'
\echo 'of ~1,590 unlinked GM entries into Atlas reference pins.'
\echo ''

-- ============================================================================
-- A. FIX ACOS BUG IN try_match_google_map_entries_to_place()
-- Problem: Manual haversine formula produces acos(>1.0) when coordinates are
-- near-identical, causing "input is out of range" error.
-- Fix: Replace with PostGIS ST_Distance / ST_DWithin (correct + uses spatial index).
-- ============================================================================

\echo '--- A: Fix acos bug in auto-match function ---'

CREATE OR REPLACE FUNCTION trapper.try_match_google_map_entries_to_place(
    p_place_id UUID
)
RETURNS INTEGER AS $$
DECLARE
    v_location geography;
    v_matched INTEGER := 0;
BEGIN
    -- Get place location
    SELECT location INTO v_location
    FROM trapper.places
    WHERE place_id = p_place_id
      AND location IS NOT NULL;

    IF v_location IS NULL THEN
        RETURN 0;
    END IF;

    -- Match any unmatched entries within 50m using PostGIS
    UPDATE trapper.google_map_entries
    SET
        place_id = p_place_id,
        match_status = 'matched',
        match_distance_m = ST_Distance(
            ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
            v_location
        ),
        matched_at = NOW()
    WHERE match_status IN ('unmatched', 'uncertain')
      AND place_id IS NULL
      AND lat IS NOT NULL AND lng IS NOT NULL
      AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
          v_location,
          50  -- 50 meter threshold
      );

    GET DIAGNOSTICS v_matched = ROW_COUNT;
    RETURN v_matched;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.try_match_google_map_entries_to_place IS
'MIG_821: Replaced manual haversine (acos bug) with PostGIS ST_Distance/ST_DWithin.
Matches orphaned Google Map entries to a place within 50m.';

\echo '  → Auto-match function fixed (PostGIS replaces manual haversine)'

-- ============================================================================
-- B. ADD google_maps TO place_origin CHECK CONSTRAINT
-- ============================================================================

\echo '--- B: Add google_maps to place_origin constraint ---'

ALTER TABLE trapper.places DROP CONSTRAINT IF EXISTS places_place_origin_check;
ALTER TABLE trapper.places ADD CONSTRAINT places_place_origin_check
  CHECK (place_origin = ANY (ARRAY['geocoded','manual','atlas','auto_parent','google_maps']));

\echo '  → place_origin constraint updated (added google_maps)'

-- ============================================================================
-- C. CREATE create_place_from_coordinates() FUNCTION
-- Centralized function for creating coordinate-only places.
-- Used by: this migration (bulk), future pin-placing UI.
-- ============================================================================

\echo '--- C: Create create_place_from_coordinates() function ---'

CREATE OR REPLACE FUNCTION trapper.create_place_from_coordinates(
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_display_name TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'google_maps'
)
RETURNS UUID AS $$
DECLARE
    v_place_id UUID;
    v_existing_id UUID;
    v_point geography;
    v_origin TEXT;
BEGIN
    -- Validate coordinates
    IF p_lat IS NULL OR p_lng IS NULL THEN
        RETURN NULL;
    END IF;
    IF p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN
        RAISE NOTICE 'Invalid coordinates: %, %', p_lat, p_lng;
        RETURN NULL;
    END IF;

    v_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;

    -- Dedup: check for existing place within 10m
    SELECT place_id INTO v_existing_id
    FROM trapper.places
    WHERE location IS NOT NULL
      AND merged_into_place_id IS NULL
      AND ST_DWithin(location, v_point, 10)
    ORDER BY ST_Distance(location, v_point), created_at
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        RETURN v_existing_id;
    END IF;

    -- Determine place_origin from source
    v_origin := CASE
        WHEN p_source_system = 'google_maps' THEN 'google_maps'
        WHEN p_source_system IN ('atlas_ui', 'web_app') THEN 'manual'
        ELSE 'atlas'
    END;

    -- Create coordinate-only place
    INSERT INTO trapper.places (
        display_name,
        location,
        place_kind,
        is_address_backed,
        place_origin,
        data_source,
        location_type,
        quality_tier,
        geocode_attempts,
        geocode_next_attempt,
        geocode_failed
    ) VALUES (
        COALESCE(
            NULLIF(TRIM(p_display_name), ''),
            'Pin at ' || ROUND(p_lat::numeric, 5) || ', ' || ROUND(p_lng::numeric, 5)
        ),
        v_point,
        'unknown',
        FALSE,
        v_origin,
        p_source_system::trapper.data_source,
        'approximate',
        'D',
        0,
        NOW(),   -- immediately eligible for reverse geocoding
        FALSE
    )
    RETURNING place_id INTO v_place_id;

    RETURN v_place_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.create_place_from_coordinates IS
'MIG_821: Creates a coordinate-only place (no address). Dedup within 10m.
Queued for reverse geocoding immediately. Used for Google Maps entries
and future pin-placing UI. Only google_maps and atlas_ui sources allowed.';

\echo '  → create_place_from_coordinates() function created'

-- ============================================================================
-- D. REVERSE GEOCODING QUEUE FUNCTION
-- Returns coordinate-only places that need reverse geocoding.
-- ============================================================================

\echo '--- D: Create reverse geocoding queue function ---'

CREATE OR REPLACE FUNCTION trapper.get_reverse_geocoding_queue(p_limit INT DEFAULT 50)
RETURNS TABLE (
    place_id UUID,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    display_name TEXT,
    geocode_attempts INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.place_id,
        ST_Y(p.location::geometry) as lat,
        ST_X(p.location::geometry) as lng,
        p.display_name,
        COALESCE(p.geocode_attempts, 0) as geocode_attempts
    FROM trapper.places p
    WHERE p.location IS NOT NULL
      AND p.is_address_backed = FALSE
      AND p.formatted_address IS NULL
      AND COALESCE(p.geocode_failed, FALSE) = FALSE
      AND COALESCE(p.geocode_next_attempt, NOW()) <= NOW()
      AND p.merged_into_place_id IS NULL
    ORDER BY
        COALESCE(p.geocode_attempts, 0) ASC,
        p.created_at ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.get_reverse_geocoding_queue IS
'MIG_821: Returns coordinate-only places that need reverse geocoding.
Prioritizes places with fewer attempts, then oldest first.
Used by /api/cron/geocode to process reverse geocoding alongside forward.';

\echo '  → get_reverse_geocoding_queue() function created'

-- ============================================================================
-- E. REVERSE GEOCODING RESULT RECORDING
-- Handles success (upgrade or merge) and failure (exponential backoff).
-- ============================================================================

\echo '--- E: Create record_reverse_geocoding_result() function ---'

CREATE OR REPLACE FUNCTION trapper.record_reverse_geocoding_result(
    p_place_id UUID,
    p_success BOOLEAN,
    p_google_address TEXT DEFAULT NULL,
    p_error TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_attempts INT;
    v_max_attempts INT := 5;
    v_backoff_minutes INT;
    v_existing_place_id UUID;
    v_normalized TEXT;
BEGIN
    -- Get current attempt count
    SELECT COALESCE(geocode_attempts, 0) INTO v_attempts
    FROM trapper.places WHERE place_id = p_place_id;

    IF p_success AND p_google_address IS NOT NULL THEN
        -- Normalize the Google address
        v_normalized := trapper.normalize_address(p_google_address);

        -- Check if an address-backed place already exists with this address
        IF v_normalized IS NOT NULL THEN
            SELECT p.place_id INTO v_existing_place_id
            FROM trapper.places p
            WHERE p.normalized_address = v_normalized
              AND p.place_id != p_place_id
              AND p.merged_into_place_id IS NULL
            LIMIT 1;
        END IF;

        IF v_existing_place_id IS NOT NULL THEN
            -- MERGE: Transfer all relationships to the existing place

            -- Google Map entries
            UPDATE trapper.google_map_entries
            SET linked_place_id = v_existing_place_id
            WHERE linked_place_id = p_place_id;

            UPDATE trapper.google_map_entries
            SET place_id = v_existing_place_id
            WHERE place_id = p_place_id;

            -- Person-place relationships (dedupe first)
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

            -- Cat-place relationships (dedupe first)
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
            SET place_id = v_existing_place_id
            WHERE place_id = p_place_id;

            -- Colony estimates
            UPDATE trapper.place_colony_estimates
            SET place_id = v_existing_place_id
            WHERE place_id = p_place_id;

            -- Place contexts (dedupe first)
            DELETE FROM trapper.place_contexts pc1
            WHERE pc1.place_id = p_place_id
              AND EXISTS (
                SELECT 1 FROM trapper.place_contexts pc2
                WHERE pc2.place_id = v_existing_place_id
                  AND pc2.context_type = pc1.context_type
              );
            UPDATE trapper.place_contexts
            SET place_id = v_existing_place_id
            WHERE place_id = p_place_id;

            -- Place disease status
            DELETE FROM trapper.place_disease_status pds1
            WHERE pds1.place_id = p_place_id
              AND EXISTS (
                SELECT 1 FROM trapper.place_disease_status pds2
                WHERE pds2.place_id = v_existing_place_id
                  AND pds2.disease_type_key = pds1.disease_type_key
              );
            UPDATE trapper.place_disease_status
            SET place_id = v_existing_place_id
            WHERE place_id = p_place_id;

            -- Mark coordinate-only place as merged
            UPDATE trapper.places
            SET merged_into_place_id = v_existing_place_id,
                merge_reason = 'reverse_geocode_match',
                merged_at = NOW(),
                updated_at = NOW()
            WHERE place_id = p_place_id;

            RAISE NOTICE 'Reverse geocode merged % into % (%)',
                p_place_id, v_existing_place_id, p_google_address;

            RETURN jsonb_build_object(
                'action', 'merged',
                'source_place_id', p_place_id,
                'target_place_id', v_existing_place_id,
                'google_address', p_google_address
            );
        ELSE
            -- NO MATCH: Upgrade this place to address-backed
            UPDATE trapper.places
            SET formatted_address = p_google_address,
                -- normalized_address set by trg_normalize_place_address trigger
                is_address_backed = TRUE,
                quality_tier = 'C',
                geocode_attempts = v_attempts + 1,
                geocode_last_attempt = NOW(),
                geocode_next_attempt = NULL,
                geocode_error = NULL,
                geocode_failed = FALSE,
                updated_at = NOW()
            WHERE place_id = p_place_id;

            RETURN jsonb_build_object(
                'action', 'upgraded',
                'place_id', p_place_id,
                'google_address', p_google_address
            );
        END IF;
    ELSE
        -- FAILURE: Exponential backoff (same pattern as forward geocoding)
        v_attempts := v_attempts + 1;
        v_backoff_minutes := CASE v_attempts
            WHEN 1 THEN 1 WHEN 2 THEN 5
            WHEN 3 THEN 15 WHEN 4 THEN 60
            ELSE NULL
        END;

        IF v_attempts >= v_max_attempts THEN
            UPDATE trapper.places
            SET geocode_attempts = v_attempts,
                geocode_last_attempt = NOW(),
                geocode_next_attempt = NULL,
                geocode_error = p_error,
                geocode_failed = TRUE,
                updated_at = NOW()
            WHERE place_id = p_place_id;

            RAISE NOTICE 'Reverse geocode failed permanently for %: %', p_place_id, p_error;
        ELSE
            UPDATE trapper.places
            SET geocode_attempts = v_attempts,
                geocode_last_attempt = NOW(),
                geocode_next_attempt = NOW() + (v_backoff_minutes || ' minutes')::INTERVAL,
                geocode_error = p_error,
                updated_at = NOW()
            WHERE place_id = p_place_id;
        END IF;

        RETURN jsonb_build_object('action', 'failed', 'error', p_error, 'attempts', v_attempts);
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.record_reverse_geocoding_result IS
'MIG_821: Records reverse geocoding result for coordinate-only places.
On success: If Google address matches existing place → merges (transfers all links).
If no match → upgrades place to address-backed (quality D→C).
On failure: Exponential backoff (1, 5, 15, 60 min), then permanent failure after 5.';

\echo '  → record_reverse_geocoding_result() function created'

-- ============================================================================
-- F. REVERSE GEOCODING STATS VIEW
-- ============================================================================

\echo '--- F: Create reverse geocoding stats view ---'

CREATE OR REPLACE VIEW trapper.v_reverse_geocoding_stats AS
SELECT
    (SELECT COUNT(*) FROM trapper.places
     WHERE is_address_backed = FALSE AND location IS NOT NULL
       AND merged_into_place_id IS NULL) as coordinate_only_total,
    (SELECT COUNT(*) FROM trapper.places
     WHERE is_address_backed = FALSE AND formatted_address IS NULL
       AND location IS NOT NULL AND COALESCE(geocode_failed, FALSE) = FALSE
       AND merged_into_place_id IS NULL) as pending_reverse,
    (SELECT COUNT(*) FROM trapper.places
     WHERE is_address_backed = FALSE AND geocode_failed = TRUE
       AND merged_into_place_id IS NULL) as failed_reverse,
    (SELECT COUNT(*) FROM trapper.places
     WHERE is_address_backed = FALSE AND formatted_address IS NULL
       AND location IS NOT NULL AND geocode_next_attempt <= NOW()
       AND COALESCE(geocode_failed, FALSE) = FALSE
       AND merged_into_place_id IS NULL) as ready_to_process;

\echo '  → v_reverse_geocoding_stats view created'

-- ============================================================================
-- G. BULK CREATE PLACES FROM GM COORDINATES (~1,590)
-- ============================================================================

\echo ''
\echo '--- G: Bulk create places from GM coordinates ---'

-- Build temp mapping table
CREATE TEMP TABLE _gme_new_places AS
SELECT
    gme.entry_id,
    gen_random_uuid() as new_place_id,
    gme.kml_name,
    gme.lat,
    gme.lng
FROM trapper.google_map_entries gme
WHERE gme.linked_place_id IS NULL
  AND gme.place_id IS NULL
  AND gme.lat IS NOT NULL
  AND gme.lng IS NOT NULL;

\echo '  → Temp table created'

-- Disable ALL user triggers during bulk insert
-- (trg_match_google_map_entries would scan GM entries 1,590 times,
--  trg_place_created_check_google has a batch_id bug in processing_jobs)
ALTER TABLE trapper.places DISABLE TRIGGER USER;

\echo '  → All user triggers disabled for bulk insert'

-- Create coordinate-only places
INSERT INTO trapper.places (
    place_id, display_name, location,
    place_kind, is_address_backed, place_origin, data_source,
    location_type, quality_tier,
    geocode_attempts, geocode_next_attempt, geocode_failed
)
SELECT
    gnp.new_place_id,
    gnp.kml_name,
    ST_SetSRID(ST_MakePoint(gnp.lng, gnp.lat), 4326)::geography,
    'unknown',
    FALSE,
    'google_maps',
    'google_maps',
    'approximate',
    'D',
    0,
    NOW(),     -- queued for reverse geocoding
    FALSE
FROM _gme_new_places gnp;

-- Re-enable all user triggers
ALTER TABLE trapper.places ENABLE TRIGGER USER;

\echo '  → All user triggers re-enabled'

-- Link GM entries to their new places
UPDATE trapper.google_map_entries gme
SET linked_place_id = gnp.new_place_id
FROM _gme_new_places gnp
WHERE gme.entry_id = gnp.entry_id;

SELECT count(*) as created_count FROM _gme_new_places \gset

\echo '  → Created :created_count coordinate-only places from GM coordinates'
\echo '  → All GM entries linked to new places'
\echo '  → All queued for reverse geocoding'

DROP TABLE _gme_new_places;

-- ============================================================================
-- H. VERIFY
-- ============================================================================

\echo ''
\echo '--- H: Verification ---'

SELECT count(*) as remaining_unlinked
FROM trapper.google_map_entries
WHERE linked_place_id IS NULL AND place_id IS NULL
  AND lat IS NOT NULL AND lng IS NOT NULL \gset

\echo '  → Remaining unlinked GM entries: :remaining_unlinked (should be 0)'

SELECT * FROM trapper.v_reverse_geocoding_stats \gset

\echo '  → Reverse geocoding queue: :pending_reverse pending'

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=== MIG_821 Complete ==='
\echo 'Changes:'
\echo '  A. Fixed acos bug in auto-match (PostGIS ST_Distance replaces haversine)'
\echo '  B. Added google_maps to place_origin constraint'
\echo '  C. Created create_place_from_coordinates() function'
\echo '  D. Created get_reverse_geocoding_queue() function'
\echo '  E. Created record_reverse_geocoding_result() function (merge + upgrade)'
\echo '  F. Created v_reverse_geocoding_stats view'
\echo '  G. Bulk created ~1,590 coordinate-only places from GM coordinates'
\echo ''
\echo 'Next steps:'
\echo '  - Extend /api/cron/geocode to process reverse geocoding queue'
\echo '  - Remove historical_pins layer from frontend (now returns 0 rows)'
\echo '  - Fix reference pin popups to use drawer'
