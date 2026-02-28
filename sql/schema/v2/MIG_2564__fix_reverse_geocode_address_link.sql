-- MIG_2564: Fix record_reverse_geocoding_result to Create Address Links
--
-- Problem (DATA_GAP_058): When reverse geocoding upgrades a coordinate-only
-- place with a Google address, it sets formatted_address but does NOT create
-- an sot.addresses record or set sot_address_id.
--
-- Fix: In the "NO MATCH" branch (upgrade path), create address record and
-- link it to the place.
--
-- Created: 2026-02-27

\echo ''
\echo '=============================================='
\echo '  MIG_2564: Fix record_reverse_geocoding_result'
\echo '=============================================='
\echo ''

-- First, verify MIG_2562 was applied
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'sot' AND p.proname = 'find_or_create_address'
    ) THEN
        RAISE EXCEPTION 'MIG_2562 must be applied first (find_or_create_address not found)';
    END IF;
END $$;

\echo 'Prerequisite check passed: sot.find_or_create_address exists'

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
    v_address_id UUID;  -- NEW: For address linking
    v_place_lat DOUBLE PRECISION;
    v_place_lng DOUBLE PRECISION;
BEGIN
    -- Get current attempt count and coordinates
    SELECT COALESCE(geocode_attempts, 0),
           ST_Y(location::geometry),
           ST_X(location::geometry)
    INTO v_attempts, v_place_lat, v_place_lng
    FROM sot.places WHERE place_id = p_place_id;

    IF p_success AND p_google_address IS NOT NULL THEN
        -- Check if an address-backed place already exists with this address
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
                NULL;
            END;

            -- Mark coordinate-only place as deleted
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
            -- FIX (MIG_2564): Create address record and link it
            v_address_id := sot.find_or_create_address(
                p_google_address,
                p_google_address,
                v_place_lat,
                v_place_lng,
                'google_geocode'
            );

            UPDATE sot.places
            SET formatted_address = p_google_address,
                sot_address_id = v_address_id,  -- NEW: Link to address
                is_address_backed = TRUE,       -- NEW: Mark as address-backed
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
                'google_address', p_google_address,
                'address_id', v_address_id  -- NEW: Include address_id in response
            );
        END IF;
    ELSE
        -- FAILURE: Exponential backoff
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

FIXED (MIG_2564): Now creates sot.addresses record when upgrading a place
with a Google-resolved address, ensuring proper address linking.

On success:
- If Google address matches existing place → merges (transfers all links)
- If no match → upgrades place with formatted_address AND creates address link

On failure: Exponential backoff (1, 5, 15, 60 min), then permanent failure after 5.

See DATA_GAP_058 for why address linking is critical.';

\echo ''
\echo '=============================================='
\echo '  MIG_2564 Complete'
\echo '=============================================='
\echo ''
