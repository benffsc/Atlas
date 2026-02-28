-- MIG_2563: Fix find_or_create_place_deduped to Ensure Address Linking
--
-- Problem (DATA_GAP_058): find_or_create_place_deduped returns early for
-- existing places WITHOUT ensuring they have sot_address_id linked.
-- This allows places with formatted_address to exist without address records.
--
-- Fix: When returning an existing place, check if it needs address linking
-- and create the address record if missing.
--
-- Created: 2026-02-27

\echo ''
\echo '=============================================='
\echo '  MIG_2563: Fix find_or_create_place_deduped'
\echo '=============================================='
\echo ''

-- First, verify MIG_2562 was applied (find_or_create_address exists)
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

-- Drop existing function to allow signature change
DROP FUNCTION IF EXISTS sot.find_or_create_place_deduped(TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT);

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
    v_address_id UUID;
    v_needs_address_link BOOLEAN;
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
        -- FIX: Ensure existing place has address link
        SELECT (sot_address_id IS NULL AND formatted_address IS NOT NULL)
        INTO v_needs_address_link
        FROM sot.places WHERE place_id = v_existing_id;

        IF v_needs_address_link THEN
            v_address_id := sot.find_or_create_address(
                p_formatted_address,
                p_formatted_address,
                p_lat,
                p_lng,
                p_source_system
            );

            IF v_address_id IS NOT NULL THEN
                UPDATE sot.places
                SET sot_address_id = v_address_id,
                    is_address_backed = TRUE,
                    updated_at = NOW()
                WHERE place_id = v_existing_id;
            END IF;
        END IF;

        RETURN v_existing_id;
    END IF;

    -- DEDUP CHECK 2: Coordinate match (within 10 meters)
    v_has_coords := (p_lat IS NOT NULL AND p_lng IS NOT NULL);

    IF v_has_coords THEN
        SELECT place_id INTO v_existing_id
        FROM sot.places
        WHERE location IS NOT NULL
          AND merged_into_place_id IS NULL
          AND (unit_identifier IS NULL OR unit_identifier = '')
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
            -- FIX: Ensure existing place has address link
            SELECT (sot_address_id IS NULL AND p_formatted_address IS NOT NULL)
            INTO v_needs_address_link
            FROM sot.places WHERE place_id = v_existing_id;

            IF v_needs_address_link THEN
                v_address_id := sot.find_or_create_address(
                    p_formatted_address,
                    p_formatted_address,
                    p_lat,
                    p_lng,
                    p_source_system
                );

                IF v_address_id IS NOT NULL THEN
                    UPDATE sot.places
                    SET sot_address_id = v_address_id,
                        is_address_backed = TRUE,
                        formatted_address = COALESCE(formatted_address, p_formatted_address),
                        updated_at = NOW()
                    WHERE place_id = v_existing_id;
                END IF;
            END IF;

            RETURN v_existing_id;
        END IF;
    END IF;

    -- CREATE NEW PLACE WITH ADDRESS
    -- First create address record
    v_address_id := sot.find_or_create_address(
        p_formatted_address,
        p_formatted_address,
        p_lat,
        p_lng,
        p_source_system
    );

    INSERT INTO sot.places (
        place_id,
        display_name,
        formatted_address,
        normalized_address,
        location,
        source_system,
        sot_address_id,
        is_address_backed,
        created_at
    ) VALUES (
        gen_random_uuid(),
        COALESCE(p_display_name, p_formatted_address),
        p_formatted_address,
        v_normalized,
        CASE WHEN v_has_coords THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography ELSE NULL END,
        p_source_system,
        v_address_id,
        (v_address_id IS NOT NULL),
        NOW()
    )
    RETURNING place_id INTO v_new_id;

    RETURN v_new_id;
END;
$function$;

COMMENT ON FUNCTION sot.find_or_create_place_deduped IS
'Creates or finds a place with proper deduplication and address linking.

FIXED (MIG_2563): Now ensures all places with formatted_address have a
corresponding sot.addresses record linked via sot_address_id.

Deduplication order:
1. Exact normalized_address match
2. Coordinate match (within 10 meters, non-unit only)
3. Create new if no match

Address linking:
- New places: Always creates address record first
- Existing places: Creates address record if missing

See DATA_GAP_058 for context on why address linking is critical.';

\echo ''
\echo '=============================================='
\echo '  MIG_2563 Complete'
\echo '=============================================='
\echo ''
