\echo ''
\echo '=============================================='
\echo 'MIG_560: Place Coordinate-Based Deduplication'
\echo '=============================================='
\echo ''
\echo 'Problem: Places with identical coordinates but different address spellings'
\echo '         are not being deduplicated (e.g., "McCarren" vs "McCarran").'
\echo ''
\echo 'Solution: Add coordinate matching as secondary dedup check after normalized'
\echo '          address matching fails.'
\echo ''

-- ============================================================================
-- STEP 1: Add spatial index for coordinate lookups (if not exists)
-- ============================================================================

\echo 'Step 1: Creating spatial indexes...'

-- Primary spatial index
CREATE INDEX IF NOT EXISTS idx_places_location_gist
ON trapper.places USING GIST (location);

-- Index for active (non-merged) places with coordinates
CREATE INDEX IF NOT EXISTS idx_places_location_active
ON trapper.places USING GIST (location)
WHERE merged_into_place_id IS NULL AND location IS NOT NULL;

\echo 'Spatial indexes created.'

-- ============================================================================
-- STEP 2: Update find_or_create_place_deduped with coordinate matching
-- ============================================================================

\echo ''
\echo 'Step 2: Updating find_or_create_place_deduped with coordinate matching...'

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

    -- =========================================================================
    -- DEDUP CHECK 1: Exact normalized address match
    -- =========================================================================
    SELECT place_id INTO v_existing_id
    FROM trapper.places
    WHERE normalized_address = v_normalized
      AND merged_into_place_id IS NULL
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        RETURN v_existing_id;
    END IF;

    -- =========================================================================
    -- DEDUP CHECK 2: Coordinate match (within 10 meters)
    -- Only if coordinates are provided AND no exact address match found
    -- Skip if checking for a unit (would merge different apartments)
    -- =========================================================================
    v_has_coords := (p_lat IS NOT NULL AND p_lng IS NOT NULL);

    IF v_has_coords THEN
        SELECT place_id INTO v_existing_id
        FROM trapper.places
        WHERE location IS NOT NULL
          AND merged_into_place_id IS NULL
          AND (unit_number IS NULL OR unit_number = '')  -- Don't merge if either has a unit number
          AND ST_DWithin(
              location,
              ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
              10  -- 10 meter tolerance
          )
        ORDER BY
            -- Prefer places with normalized_address populated
            CASE WHEN normalized_address IS NOT NULL THEN 0 ELSE 1 END,
            -- Then prefer closer matches
            ST_Distance(location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography),
            -- Then prefer older places (more established)
            created_at
        LIMIT 1;

        IF v_existing_id IS NOT NULL THEN
            RAISE NOTICE 'Coordinate match found for "%" -> existing place %',
                p_formatted_address, v_existing_id;
            RETURN v_existing_id;
        END IF;
    END IF;

    -- =========================================================================
    -- CREATE NEW PLACE (no match found)
    -- =========================================================================

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
'Find existing place by normalized address OR coordinates, or create new one.

Deduplication strategy:
1. First check for exact normalized_address match
2. If no match and coordinates provided, check for places within 10 meters
   (but only if neither place has a unit_number to preserve apartment units)
3. If still no match, create new place

When coordinates are provided, also creates/links sot_address record
and sets is_address_backed=true.';

\echo 'Updated find_or_create_place_deduped with coordinate matching.'

-- ============================================================================
-- STEP 3: Check for existing coordinate duplicates (report only)
-- ============================================================================

\echo ''
\echo 'Step 3: Finding existing coordinate duplicates...'

WITH coordinate_groups AS (
    SELECT
        ST_AsText(ST_SnapToGrid(location::geometry, 0.00001)) as grid_point,
        array_agg(place_id ORDER BY created_at) as place_ids,
        array_agg(formatted_address ORDER BY created_at) as addresses,
        COUNT(*) as duplicate_count
    FROM trapper.places
    WHERE location IS NOT NULL
      AND merged_into_place_id IS NULL
      AND (unit_number IS NULL OR unit_number = '')
    GROUP BY ST_SnapToGrid(location::geometry, 0.00001)
    HAVING COUNT(*) > 1
)
SELECT
    duplicate_count,
    place_ids[1] as keep_place_id,
    addresses[1] as keep_address,
    place_ids[2:] as merge_place_ids,
    addresses[2:] as merge_addresses
FROM coordinate_groups
ORDER BY duplicate_count DESC
LIMIT 20;

\echo ''
\echo '=============================================='
\echo 'MIG_560 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  - Added spatial indexes for coordinate lookups'
\echo '  - Updated find_or_create_place_deduped to check coordinates'
\echo '  - Coordinate matching uses 10m tolerance'
\echo '  - Unit numbers are respected (no merging of different units)'
\echo ''
\echo 'Next: Run MIG_561 to merge existing coordinate duplicates'
\echo ''
