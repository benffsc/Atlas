-- MIG_2393: Fix find_or_create_place_deduped column name
--
-- Problem: Function references 'unit_number' but column is 'unit_identifier'
-- This broke place deduplication for atlas_ui request backfill.
--
-- Created: 2026-02-19

\echo 'MIG_2393: Fixing find_or_create_place_deduped column name...'

CREATE OR REPLACE FUNCTION sot.find_or_create_place_deduped(
    p_formatted_address TEXT,
    p_display_name TEXT DEFAULT NULL,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL,
    p_source_system TEXT DEFAULT 'atlas'
)
RETURNS UUID
LANGUAGE plpgsql AS $function$
DECLARE
    v_normalized TEXT;
    v_existing_id UUID;
    v_new_id UUID;
    v_has_coords BOOLEAN;
BEGIN
    -- Normalize the address
    v_normalized := sot.normalize_address(p_formatted_address);

    IF v_normalized IS NULL OR v_normalized = '' THEN
        RETURN NULL;
    END IF;

    -- DEDUP CHECK 1: Exact normalized address match
    SELECT place_id INTO v_existing_id
    FROM sot.places
    WHERE normalized_address = v_normalized
      AND merged_into_place_id IS NULL
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        RETURN v_existing_id;
    END IF;

    -- DEDUP CHECK 2: Coordinate match (within 10 meters)
    v_has_coords := (p_lat IS NOT NULL AND p_lng IS NOT NULL);

    IF v_has_coords THEN
        SELECT place_id INTO v_existing_id
        FROM sot.places
        WHERE location IS NOT NULL
          AND merged_into_place_id IS NULL
          AND (unit_identifier IS NULL OR unit_identifier = '')  -- FIXED: was unit_number
          AND ST_DWithin(
              location,
              ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
              10
          )
        ORDER BY
            CASE WHEN normalized_address IS NOT NULL THEN 0 ELSE 1 END,
            ST_Distance(location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography),
            created_at
        LIMIT 1;

        IF v_existing_id IS NOT NULL THEN
            RETURN v_existing_id;
        END IF;
    END IF;

    -- CREATE NEW PLACE
    INSERT INTO sot.places (
        place_id,
        display_name,
        formatted_address,
        normalized_address,
        location,
        source_system,
        created_at
    ) VALUES (
        gen_random_uuid(),
        COALESCE(p_display_name, p_formatted_address),
        p_formatted_address,
        v_normalized,
        CASE WHEN v_has_coords THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography ELSE NULL END,
        p_source_system,
        NOW()
    )
    RETURNING place_id INTO v_new_id;

    RETURN v_new_id;
END;
$function$;

\echo 'MIG_2393 complete!'
