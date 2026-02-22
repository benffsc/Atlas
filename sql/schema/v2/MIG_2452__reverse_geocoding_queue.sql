-- MIG_2452: Reverse Geocoding Queue System for V2
--
-- Handles coordinate-only places (from pin placing, Google Maps data).
-- Resolves coordinates to addresses via Google Geocoding API.
-- On match: merges into existing place. No match: upgrades with address.
--
-- Adapted from V1 MIG_821 for V2 schema (sot.places, ops schema for functions)

BEGIN;

-- ============================================
-- PART 1: Function to get reverse geocoding queue
-- ============================================

CREATE OR REPLACE FUNCTION ops.get_reverse_geocoding_queue(p_limit INT DEFAULT 50)
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
        ST_Y(p.location::geometry)::DOUBLE PRECISION as lat,
        ST_X(p.location::geometry)::DOUBLE PRECISION as lng,
        p.display_name,
        COALESCE(p.geocode_attempts, 0) as geocode_attempts
    FROM sot.places p
    WHERE p.location IS NOT NULL
      AND (p.is_address_backed = FALSE OR p.is_address_backed IS NULL)
      AND p.formatted_address IS NULL
      AND COALESCE(p.geocode_failed, FALSE) = FALSE
      AND COALESCE(p.geocode_next_attempt, NOW()) <= NOW()
    ORDER BY
        COALESCE(p.geocode_attempts, 0) ASC,
        p.created_at ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.get_reverse_geocoding_queue IS
'Returns coordinate-only places that need reverse geocoding.
Prioritizes places with fewer attempts, then oldest first.
Used by /api/cron/geocode to process reverse geocoding alongside forward.';

-- ============================================
-- PART 2: Function to record reverse geocoding result
-- ============================================

CREATE OR REPLACE FUNCTION ops.record_reverse_geocoding_result(
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
BEGIN
    -- Get current attempt count
    SELECT COALESCE(geocode_attempts, 0) INTO v_attempts
    FROM sot.places WHERE place_id = p_place_id;

    IF p_success AND p_google_address IS NOT NULL THEN
        -- Check if an address-backed place already exists with this address
        -- Use formatted_address comparison (not normalized since V2 may not have that column yet)
        SELECT p.place_id INTO v_existing_place_id
        FROM sot.places p
        WHERE LOWER(TRIM(p.formatted_address)) = LOWER(TRIM(p_google_address))
          AND p.place_id != p_place_id
          AND p.location IS NOT NULL
        LIMIT 1;

        IF v_existing_place_id IS NOT NULL THEN
            -- MERGE: Transfer all relationships to the existing place

            -- Person-place relationships (dedupe first)
            DELETE FROM sot.person_place ppr1
            WHERE ppr1.place_id = p_place_id
              AND EXISTS (
                SELECT 1 FROM sot.person_place ppr2
                WHERE ppr2.place_id = v_existing_place_id
                  AND ppr2.person_id = ppr1.person_id
                  AND ppr2.role = ppr1.role
              );
            UPDATE sot.person_place
            SET place_id = v_existing_place_id
            WHERE place_id = p_place_id;

            -- Cat-place relationships (dedupe first)
            DELETE FROM sot.cat_place cpr1
            WHERE cpr1.place_id = p_place_id
              AND EXISTS (
                SELECT 1 FROM sot.cat_place cpr2
                WHERE cpr2.place_id = v_existing_place_id
                  AND cpr2.cat_id = cpr1.cat_id
              );
            UPDATE sot.cat_place
            SET place_id = v_existing_place_id
            WHERE place_id = p_place_id;

            -- Requests
            UPDATE ops.requests
            SET place_id = v_existing_place_id
            WHERE place_id = p_place_id;

            -- Colony estimates
            UPDATE sot.place_colony_estimates
            SET place_id = v_existing_place_id
            WHERE place_id = p_place_id;

            -- Place disease status (if table exists)
            BEGIN
                DELETE FROM ops.place_disease_status pds1
                WHERE pds1.place_id = p_place_id
                  AND EXISTS (
                    SELECT 1 FROM ops.place_disease_status pds2
                    WHERE pds2.place_id = v_existing_place_id
                      AND pds2.disease_type_key = pds1.disease_type_key
                  );
                UPDATE ops.place_disease_status
                SET place_id = v_existing_place_id
                WHERE place_id = p_place_id;
            EXCEPTION WHEN undefined_table THEN
                -- Table doesn't exist, skip
                NULL;
            END;

            -- Mark coordinate-only place as deleted (soft delete)
            -- V2 doesn't have merged_into_place_id on places, so we just delete
            DELETE FROM sot.places WHERE place_id = p_place_id;

            RAISE NOTICE 'Reverse geocode merged % into % (%)',
                p_place_id, v_existing_place_id, p_google_address;

            RETURN jsonb_build_object(
                'action', 'merged',
                'source_place_id', p_place_id,
                'target_place_id', v_existing_place_id,
                'google_address', p_google_address
            );
        ELSE
            -- NO MATCH: Upgrade place with resolved address
            UPDATE sot.places
            SET formatted_address = p_google_address,
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
            UPDATE sot.places
            SET geocode_attempts = v_attempts,
                geocode_last_attempt = NOW(),
                geocode_next_attempt = NULL,
                geocode_error = p_error,
                geocode_failed = TRUE,
                updated_at = NOW()
            WHERE place_id = p_place_id;

            RAISE NOTICE 'Reverse geocode failed permanently for %: %', p_place_id, p_error;
        ELSE
            UPDATE sot.places
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

COMMENT ON FUNCTION ops.record_reverse_geocoding_result IS
'Records reverse geocoding result for coordinate-only places.
On success: If Google address matches existing place → merges (transfers all links).
If no match → upgrades place with formatted_address.
On failure: Exponential backoff (1, 5, 15, 60 min), then permanent failure after 5.';

-- ============================================
-- PART 3: Reverse geocoding stats view
-- ============================================

DROP VIEW IF EXISTS ops.v_reverse_geocoding_stats CASCADE;
CREATE VIEW ops.v_reverse_geocoding_stats AS
SELECT
    (SELECT COUNT(*) FROM sot.places
     WHERE (is_address_backed = FALSE OR is_address_backed IS NULL)
       AND location IS NOT NULL) as coordinate_only_total,
    (SELECT COUNT(*) FROM sot.places
     WHERE (is_address_backed = FALSE OR is_address_backed IS NULL)
       AND formatted_address IS NULL
       AND location IS NOT NULL
       AND COALESCE(geocode_failed, FALSE) = FALSE) as pending_reverse,
    (SELECT COUNT(*) FROM sot.places
     WHERE (is_address_backed = FALSE OR is_address_backed IS NULL)
       AND geocode_failed = TRUE) as failed_reverse,
    (SELECT COUNT(*) FROM sot.places
     WHERE (is_address_backed = FALSE OR is_address_backed IS NULL)
       AND formatted_address IS NULL
       AND location IS NOT NULL
       AND geocode_next_attempt <= NOW()
       AND COALESCE(geocode_failed, FALSE) = FALSE) as ready_to_process;

COMMENT ON VIEW ops.v_reverse_geocoding_stats IS
'Stats for reverse geocoding queue: coordinate-only places that need addresses.';

COMMIT;

-- Verification
SELECT 'Reverse geocoding queue system created' AS info;
SELECT * FROM ops.v_reverse_geocoding_stats;
