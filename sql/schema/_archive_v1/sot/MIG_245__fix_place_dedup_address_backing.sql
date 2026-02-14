\echo '=== MIG_245: Fix find_or_create_place_deduped to properly link sot_addresses ==='

-- The original function creates places with is_address_backed=false even when
-- coordinates are provided. This fix creates the sot_address record and links it.

CREATE OR REPLACE FUNCTION trapper.find_or_create_place_deduped(
    p_formatted_address text,
    p_display_name text DEFAULT NULL::text,
    p_lat double precision DEFAULT NULL::double precision,
    p_lng double precision DEFAULT NULL::double precision,
    p_source_system text DEFAULT 'atlas'::text
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
    v_normalized TEXT;
    v_existing_id UUID;
    v_new_id UUID;
    v_has_coords BOOLEAN;
    v_address_id UUID;
BEGIN
    -- Normalize the address
    v_normalized := trapper.normalize_address(p_formatted_address);

    IF v_normalized IS NULL OR v_normalized = '' THEN
        RETURN NULL;
    END IF;

    -- Check for existing place with same normalized address
    SELECT place_id INTO v_existing_id
    FROM trapper.places
    WHERE normalized_address = v_normalized
      AND merged_into_place_id IS NULL
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        RETURN v_existing_id;
    END IF;

    -- Determine if we have coordinates
    v_has_coords := (p_lat IS NOT NULL AND p_lng IS NOT NULL);

    -- If we have coords, find or create the sot_address
    IF v_has_coords THEN
        -- Try to find existing address
        SELECT address_id INTO v_address_id
        FROM trapper.sot_addresses
        WHERE formatted_address = p_formatted_address
        LIMIT 1;

        -- Create address if not found
        IF v_address_id IS NULL THEN
            BEGIN
                INSERT INTO trapper.sot_addresses (formatted_address, country)
                VALUES (p_formatted_address, 'USA')
                RETURNING address_id INTO v_address_id;
            EXCEPTION WHEN unique_violation THEN
                -- Race condition - another process created it, fetch it
                SELECT address_id INTO v_address_id
                FROM trapper.sot_addresses
                WHERE formatted_address = p_formatted_address
                LIMIT 1;
            END;
        END IF;
    END IF;

    -- Create new place
    INSERT INTO trapper.places (
        display_name,
        formatted_address,
        normalized_address,
        location,
        data_source,
        place_origin,
        is_address_backed,
        sot_address_id,
        geocode_attempts,
        geocode_next_attempt,
        geocode_failed
    ) VALUES (
        COALESCE(p_display_name, p_formatted_address),
        p_formatted_address,
        v_normalized,
        CASE WHEN v_has_coords
             THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
             ELSE NULL END,
        p_source_system::trapper.data_source,
        'atlas',
        v_has_coords AND v_address_id IS NOT NULL,
        v_address_id,
        CASE WHEN v_has_coords THEN NULL ELSE 0 END,
        CASE WHEN v_has_coords THEN NULL ELSE NOW() END,
        FALSE
    )
    RETURNING place_id INTO v_new_id;

    IF NOT v_has_coords THEN
        RAISE NOTICE 'Place % created without coordinates, queued for geocoding: %',
            v_new_id, p_formatted_address;
    END IF;

    RETURN v_new_id;
END;
$function$;

COMMENT ON FUNCTION trapper.find_or_create_place_deduped IS
'Find existing place by normalized address or create new one.
When coordinates are provided, also creates/links sot_address record
and sets is_address_backed=true.';

-- Now fix existing places that have coordinates but are not properly backed
-- This creates sot_address records and links them

\echo 'Fixing existing places with coords but no address backing...'

WITH places_to_fix AS (
    SELECT
        p.place_id,
        p.formatted_address
    FROM trapper.places p
    WHERE p.merged_into_place_id IS NULL
      AND p.location IS NOT NULL
      AND p.formatted_address IS NOT NULL
      AND p.formatted_address != ''
      AND p.sot_address_id IS NULL
      AND p.is_address_backed = false
),
-- Find or create addresses
addresses AS (
    SELECT DISTINCT ON (formatted_address)
        formatted_address,
        COALESCE(
            (SELECT address_id FROM trapper.sot_addresses WHERE formatted_address = ptf.formatted_address),
            gen_random_uuid()
        ) as address_id,
        NOT EXISTS (SELECT 1 FROM trapper.sot_addresses WHERE formatted_address = ptf.formatted_address) as needs_insert
    FROM places_to_fix ptf
),
-- Insert missing addresses
new_addresses AS (
    INSERT INTO trapper.sot_addresses (address_id, formatted_address, country)
    SELECT address_id, formatted_address, 'USA'
    FROM addresses
    WHERE needs_insert
    ON CONFLICT DO NOTHING
    RETURNING address_id, formatted_address
)
-- Update places to link to addresses
UPDATE trapper.places p
SET
    sot_address_id = COALESCE(
        (SELECT address_id FROM trapper.sot_addresses WHERE formatted_address = p.formatted_address),
        p.sot_address_id
    ),
    is_address_backed = true
WHERE p.place_id IN (SELECT place_id FROM places_to_fix)
  AND p.sot_address_id IS NULL;

\echo 'Checking results...'
SELECT
    is_address_backed,
    sot_address_id IS NOT NULL as has_addr_link,
    location IS NOT NULL as has_coords,
    COUNT(*) as count
FROM trapper.places
WHERE merged_into_place_id IS NULL
GROUP BY 1, 2, 3
ORDER BY count DESC;

\echo '=== MIG_245 Complete ==='
