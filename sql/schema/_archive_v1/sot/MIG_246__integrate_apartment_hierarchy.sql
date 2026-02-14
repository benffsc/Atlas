\echo '=== MIG_246: Integrate Apartment Hierarchy into Place Dedup ==='

-- Problem: find_or_create_place_deduped doesn't use the apartment hierarchy
-- from MIG_190. Unit addresses like "Unit 26" and "Apartment 21" at the
-- same building create separate, unlinked places.
--
-- Fix: Update find_or_create_place_deduped to:
-- 1. Extract unit from address
-- 2. For unit addresses, find or create parent building
-- 3. Link unit to parent via parent_place_id
-- 4. Store unit_identifier

\echo 'Creating improved find_or_create_place_deduped with hierarchy support...'

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
    v_extracted RECORD;
    v_base_normalized TEXT;
    v_parent_id UUID;
BEGIN
    -- Normalize the address
    v_normalized := trapper.normalize_address(p_formatted_address);

    IF v_normalized IS NULL OR v_normalized = '' THEN
        RETURN NULL;
    END IF;

    -- Check for existing place with same normalized address (exact match first)
    SELECT place_id INTO v_existing_id
    FROM trapper.places
    WHERE normalized_address = v_normalized
      AND merged_into_place_id IS NULL
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        RETURN v_existing_id;
    END IF;

    -- Extract unit from address (MIG_190 function)
    SELECT * INTO v_extracted
    FROM trapper.extract_unit_from_address(p_formatted_address);

    -- Determine if we have coordinates
    v_has_coords := (p_lat IS NOT NULL AND p_lng IS NOT NULL);

    -- If we have coords, find or create the sot_address
    IF v_has_coords THEN
        SELECT address_id INTO v_address_id
        FROM trapper.sot_addresses
        WHERE formatted_address = p_formatted_address
        LIMIT 1;

        IF v_address_id IS NULL THEN
            BEGIN
                INSERT INTO trapper.sot_addresses (formatted_address, country)
                VALUES (p_formatted_address, 'USA')
                RETURNING address_id INTO v_address_id;
            EXCEPTION WHEN unique_violation THEN
                SELECT address_id INTO v_address_id
                FROM trapper.sot_addresses
                WHERE formatted_address = p_formatted_address
                LIMIT 1;
            END;
        END IF;
    END IF;

    -- Handle apartment hierarchy if this is a unit address
    IF v_extracted.unit IS NOT NULL THEN
        -- Normalize the base address (without unit)
        v_base_normalized := trapper.normalize_address(v_extracted.base_address);

        -- Look for existing parent building
        SELECT place_id INTO v_parent_id
        FROM trapper.places
        WHERE (normalized_address = v_base_normalized
               OR trapper.normalize_address(formatted_address) = v_base_normalized)
          AND merged_into_place_id IS NULL
          AND (parent_place_id IS NULL OR place_kind = 'apartment_building')
        ORDER BY
            CASE WHEN place_kind = 'apartment_building' THEN 0 ELSE 1 END,
            CASE WHEN parent_place_id IS NULL THEN 0 ELSE 1 END,
            created_at ASC
        LIMIT 1;

        -- Create parent building if not found
        IF v_parent_id IS NULL THEN
            INSERT INTO trapper.places (
                display_name,
                formatted_address,
                normalized_address,
                location,
                place_kind,
                is_address_backed,
                data_source,
                place_origin
            ) VALUES (
                v_extracted.base_address,
                v_extracted.base_address,
                v_base_normalized,
                CASE WHEN v_has_coords
                     THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
                     ELSE NULL END,
                'apartment_building',
                FALSE,
                p_source_system::trapper.data_source,
                'auto_parent'
            )
            RETURNING place_id INTO v_parent_id;

            RAISE NOTICE 'Created parent building place % for: %', v_parent_id, v_extracted.base_address;
        END IF;

        -- Create the unit place linked to parent
        INSERT INTO trapper.places (
            display_name,
            formatted_address,
            normalized_address,
            location,
            data_source,
            place_origin,
            is_address_backed,
            sot_address_id,
            parent_place_id,
            unit_identifier,
            place_kind,
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
            v_parent_id,
            v_extracted.unit,
            'apartment_unit',
            CASE WHEN v_has_coords THEN NULL ELSE 0 END,
            CASE WHEN v_has_coords THEN NULL ELSE NOW() END,
            FALSE
        )
        RETURNING place_id INTO v_new_id;

        RAISE NOTICE 'Created unit place % (%) linked to parent %',
            v_new_id, v_extracted.unit, v_parent_id;

        RETURN v_new_id;
    END IF;

    -- Non-unit address: create regular place
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
For unit addresses (Apt, Unit, #), automatically creates parent building
and links via parent_place_id. Also creates sot_address links when
coordinates are provided.';

-- ============================================
-- PART 2: Fix Existing Unit Places
-- ============================================

\echo ''
\echo 'Linking existing unit places to parent buildings...'

-- Use the backfill function from MIG_190
SELECT * FROM trapper.backfill_apartment_hierarchy(FALSE);

-- ============================================
-- PART 3: Create View for Building Overview
-- ============================================

\echo ''
\echo 'Creating/updating building overview view...'

CREATE OR REPLACE VIEW trapper.v_building_activity AS
SELECT
    COALESCE(b.place_id, p.place_id) as building_id,
    COALESCE(b.display_name, p.display_name) as building_name,
    COALESCE(b.formatted_address, p.formatted_address) as building_address,
    COALESCE(b.location, p.location) as location,
    -- Count units
    COUNT(DISTINCT CASE WHEN u.place_id IS NOT NULL THEN u.place_id END) as unit_count,
    -- Aggregate cat activity across building + all units
    (
        SELECT COUNT(DISTINCT cpr.cat_id)
        FROM trapper.cat_place_relationships cpr
        WHERE cpr.place_id = COALESCE(b.place_id, p.place_id)
           OR cpr.place_id IN (SELECT uu.place_id FROM trapper.places uu
                                WHERE uu.parent_place_id = COALESCE(b.place_id, p.place_id))
    ) as total_cats,
    -- Aggregate requests across building + all units
    (
        SELECT COUNT(DISTINCT r.request_id)
        FROM trapper.sot_requests r
        WHERE r.place_id = COALESCE(b.place_id, p.place_id)
           OR r.place_id IN (SELECT uu.place_id FROM trapper.places uu
                                WHERE uu.parent_place_id = COALESCE(b.place_id, p.place_id))
    ) as total_requests,
    -- List units
    ARRAY_AGG(DISTINCT u.unit_identifier ORDER BY u.unit_identifier)
        FILTER (WHERE u.unit_identifier IS NOT NULL) as units
FROM trapper.places p
LEFT JOIN trapper.places b ON p.parent_place_id = b.place_id
LEFT JOIN trapper.places u ON u.parent_place_id = COALESCE(b.place_id, p.place_id)
WHERE p.merged_into_place_id IS NULL
  AND (p.place_kind = 'apartment_building'
       OR p.parent_place_id IS NOT NULL
       OR p.unit_identifier IS NOT NULL)
GROUP BY COALESCE(b.place_id, p.place_id),
         COALESCE(b.display_name, p.display_name),
         COALESCE(b.formatted_address, p.formatted_address),
         COALESCE(b.location, p.location)
ORDER BY total_cats DESC, total_requests DESC;

COMMENT ON VIEW trapper.v_building_activity IS
'Shows apartment buildings with aggregated activity across all units.
Use this to see total cats/requests at a building regardless of unit.';

-- ============================================
-- PART 4: Verification
-- ============================================

\echo ''
\echo '=== Verification ==='

\echo 'Places with parent links:'
SELECT
    parent_place_id IS NOT NULL as has_parent,
    unit_identifier IS NOT NULL as has_unit_id,
    place_kind,
    COUNT(*) as count
FROM trapper.places
WHERE merged_into_place_id IS NULL
GROUP BY 1, 2, 3
ORDER BY count DESC;

\echo ''
\echo 'Top buildings by activity:'
SELECT
    building_name,
    unit_count,
    total_cats,
    total_requests,
    units
FROM trapper.v_building_activity
ORDER BY total_cats + total_requests DESC
LIMIT 15;

\echo ''
\echo '=== MIG_246 Complete ==='
