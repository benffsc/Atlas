-- MIG_3084: Fix find_or_create_address to backfill coords on dedup match
--
-- DATA_GAP_067 / FFS-1250
--
-- Problem: find_or_create_address() finds existing addresses via dedup but
-- returns early WITHOUT updating NULL coordinates, even when the caller
-- provides lat/lng. This causes addresses created before geocoding to stay
-- coord-less forever.
--
-- Fix: After each dedup match, if existing address has NULL lat/lng and
-- caller provides coords, UPDATE them (gap-fill only, never overwrite).

CREATE OR REPLACE FUNCTION sot.find_or_create_address(
    p_raw_input TEXT,
    p_formatted_address TEXT DEFAULT NULL,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL,
    p_source_system TEXT DEFAULT 'atlas'
)
RETURNS UUID
LANGUAGE plpgsql
AS $function$
DECLARE
    v_address_id UUID;
    v_clean_raw TEXT;
    v_clean_formatted TEXT;
BEGIN
    -- Normalize input
    v_clean_raw := TRIM(p_raw_input);
    v_clean_formatted := COALESCE(TRIM(p_formatted_address), v_clean_raw);

    -- Guard: Empty input
    IF v_clean_raw IS NULL OR v_clean_raw = '' THEN
        RETURN NULL;
    END IF;

    -- DEDUP CHECK 1: Exact raw_input match (canonical lookup key)
    SELECT address_id INTO v_address_id
    FROM sot.addresses
    WHERE raw_input = v_clean_raw
      AND merged_into_address_id IS NULL
    LIMIT 1;

    IF v_address_id IS NOT NULL THEN
        -- FFS-1250: Backfill coords if existing address lacks them
        IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
            UPDATE sot.addresses SET
                latitude = p_lat,
                longitude = p_lng,
                location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
                geocoding_status = COALESCE(geocoding_status, 'success'),
                updated_at = NOW()
            WHERE address_id = v_address_id
              AND latitude IS NULL;  -- gap-fill only, never overwrite
        END IF;
        RETURN v_address_id;
    END IF;

    -- DEDUP CHECK 2: formatted_address match (normalized comparison)
    SELECT address_id INTO v_address_id
    FROM sot.addresses
    WHERE LOWER(TRIM(formatted_address)) = LOWER(v_clean_formatted)
      AND merged_into_address_id IS NULL
    LIMIT 1;

    IF v_address_id IS NOT NULL THEN
        -- FFS-1250: Backfill coords if existing address lacks them
        IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
            UPDATE sot.addresses SET
                latitude = p_lat,
                longitude = p_lng,
                location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
                geocoding_status = COALESCE(geocoding_status, 'success'),
                updated_at = NOW()
            WHERE address_id = v_address_id
              AND latitude IS NULL;  -- gap-fill only, never overwrite
        END IF;
        RETURN v_address_id;
    END IF;

    -- CREATE NEW ADDRESS
    INSERT INTO sot.addresses (
        address_id,
        raw_input,
        raw_address,
        formatted_address,
        display_address,
        display_line,
        latitude,
        longitude,
        location,
        geocoding_status,
        source_system,
        created_at,
        updated_at
    ) VALUES (
        gen_random_uuid(),
        v_clean_raw,
        v_clean_raw,
        v_clean_formatted,
        v_clean_formatted,
        v_clean_formatted,
        p_lat,
        p_lng,
        CASE
            WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
            ELSE NULL
        END,
        CASE
            WHEN p_lat IS NOT NULL THEN 'success'
            ELSE 'pending'
        END,
        p_source_system,
        NOW(),
        NOW()
    )
    RETURNING address_id INTO v_address_id;

    RETURN v_address_id;
END;
$function$;

COMMENT ON FUNCTION sot.find_or_create_address IS 'Find or create address with dedup. FFS-1250: now backfills NULL coords on dedup match when caller provides lat/lng.';
