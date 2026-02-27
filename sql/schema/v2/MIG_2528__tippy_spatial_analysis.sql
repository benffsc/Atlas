-- MIG_2528: Tippy Spatial Analysis
-- Date: 2026-02-26
--
-- Purpose: Give Tippy geospatial reasoning capabilities
-- When searching for an address:
--   1. Check if we have data at that exact address
--   2. If not, look for nearby places (50m, 100m, 500m, 1km)
--   3. Identify hot zones (clusters of activity)
--   4. Report nearest known location and distance

\echo ''
\echo '=============================================='
\echo '  MIG_2528: Tippy Spatial Analysis'
\echo '=============================================='
\echo ''

CREATE OR REPLACE FUNCTION ops.tippy_spatial_analysis(
    p_address TEXT,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_search_point geography;
    v_place_id UUID;
    v_exact_match JSONB;
    v_nearby_places JSONB;
    v_hot_zones JSONB;
    v_nearest JSONB;
    v_result JSONB;
BEGIN
    -- Step 1: Try to find exact address match
    SELECT place_id INTO v_place_id
    FROM sot.places p
    LEFT JOIN sot.addresses a ON a.address_id = p.sot_address_id
    WHERE p.merged_into_place_id IS NULL
    AND p.location IS NOT NULL
    AND (
        p.display_name ILIKE '%' || p_address || '%'
        OR a.display_address ILIKE '%' || p_address || '%'
    )
    ORDER BY
        CASE WHEN p.display_name ILIKE p_address THEN 0
             WHEN p.display_name ILIKE p_address || '%' THEN 1
             ELSE 2 END,
        (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = p.place_id) DESC
    LIMIT 1;

    -- If exact match found, return full report
    IF v_place_id IS NOT NULL THEN
        SELECT ops.tippy_place_full_report(p_address) INTO v_exact_match;

        -- Get the location for nearby search
        SELECT location INTO v_search_point
        FROM sot.places WHERE place_id = v_place_id;

        -- Also find nearby places for context
        SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
            'place_id', p.place_id,
            'display_name', p.display_name,
            'distance_meters', ROUND(ST_Distance(p.location, v_search_point)::NUMERIC, 0),
            'cat_count', (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = p.place_id),
            'has_active_request', EXISTS (
                SELECT 1 FROM ops.requests r
                WHERE r.place_id = p.place_id
                AND r.status NOT IN ('completed', 'cancelled')
            )
        ) ORDER BY ST_Distance(p.location, v_search_point)), '[]'::JSONB)
        INTO v_nearby_places
        FROM sot.places p
        WHERE p.place_id != v_place_id
        AND p.merged_into_place_id IS NULL
        AND p.location IS NOT NULL
        AND ST_DWithin(p.location, v_search_point, 500)  -- Within 500m
        AND EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.place_id = p.place_id);

        RETURN JSONB_BUILD_OBJECT(
            'search_type', 'exact_match',
            'found_at_address', true,
            'place', v_exact_match->'place',
            'people', v_exact_match->'people',
            'cat_statistics', v_exact_match->'cat_statistics',
            'status_assessment', v_exact_match->'status_assessment',
            'appointment_timeline', v_exact_match->'appointment_timeline',
            'disease_testing', v_exact_match->'disease_testing',
            'request_history', v_exact_match->'request_history',
            'nearby_activity', JSONB_BUILD_OBJECT(
                'places_within_500m', v_nearby_places,
                'count', JSONB_ARRAY_LENGTH(v_nearby_places),
                'interpretation', CASE
                    WHEN JSONB_ARRAY_LENGTH(v_nearby_places) >= 3 THEN 'hot_zone'
                    WHEN JSONB_ARRAY_LENGTH(v_nearby_places) >= 1 THEN 'nearby_activity'
                    ELSE 'isolated'
                END
            )
        );
    END IF;

    -- Step 2: No exact match - try to geocode or use provided coordinates
    IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
        v_search_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;
    ELSE
        -- Try to find any partial match to get coordinates
        SELECT location INTO v_search_point
        FROM sot.places p
        LEFT JOIN sot.addresses a ON a.address_id = p.sot_address_id
        WHERE p.merged_into_place_id IS NULL
        AND p.location IS NOT NULL
        AND (
            -- Match city or street name
            a.city ILIKE '%' || p_address || '%'
            OR p.display_name ILIKE '%' || p_address || '%'
        )
        LIMIT 1;
    END IF;

    IF v_search_point IS NULL THEN
        RETURN JSONB_BUILD_OBJECT(
            'search_type', 'no_match',
            'found_at_address', false,
            'message', 'Could not find or geocode address: ' || p_address,
            'suggestion', 'Try a more specific address or provide coordinates'
        );
    END IF;

    -- Step 3: Find nearby places at different radii
    SELECT JSONB_BUILD_OBJECT(
        'within_50m', (
            SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
                'place_id', p.place_id,
                'display_name', p.display_name,
                'distance_meters', ROUND(ST_Distance(p.location, v_search_point)::NUMERIC, 0),
                'cat_count', (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = p.place_id),
                'alteration_rate', (
                    SELECT ROUND(
                        COUNT(*) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered'))::NUMERIC
                        / NULLIF(COUNT(*), 0) * 100, 1
                    )
                    FROM sot.cat_place cp
                    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
                    WHERE cp.place_id = p.place_id
                )
            ) ORDER BY ST_Distance(p.location, v_search_point)), '[]'::JSONB)
            FROM sot.places p
            WHERE p.merged_into_place_id IS NULL
            AND p.location IS NOT NULL
            AND ST_DWithin(p.location, v_search_point, 50)
            AND EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.place_id = p.place_id)
        ),
        'within_100m', (
            SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
                'place_id', p.place_id,
                'display_name', p.display_name,
                'distance_meters', ROUND(ST_Distance(p.location, v_search_point)::NUMERIC, 0),
                'cat_count', (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = p.place_id)
            ) ORDER BY ST_Distance(p.location, v_search_point)), '[]'::JSONB)
            FROM sot.places p
            WHERE p.merged_into_place_id IS NULL
            AND p.location IS NOT NULL
            AND ST_DWithin(p.location, v_search_point, 100)
            AND NOT ST_DWithin(p.location, v_search_point, 50)  -- Exclude already counted
            AND EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.place_id = p.place_id)
        ),
        'within_500m', (
            SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
                'place_id', p.place_id,
                'display_name', p.display_name,
                'distance_meters', ROUND(ST_Distance(p.location, v_search_point)::NUMERIC, 0),
                'cat_count', (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = p.place_id)
            ) ORDER BY ST_Distance(p.location, v_search_point)), '[]'::JSONB)
            FROM sot.places p
            WHERE p.merged_into_place_id IS NULL
            AND p.location IS NOT NULL
            AND ST_DWithin(p.location, v_search_point, 500)
            AND NOT ST_DWithin(p.location, v_search_point, 100)
            AND EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.place_id = p.place_id)
        ),
        'within_1km', (
            SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
                'place_id', p.place_id,
                'display_name', p.display_name,
                'distance_meters', ROUND(ST_Distance(p.location, v_search_point)::NUMERIC, 0),
                'cat_count', (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = p.place_id)
            ) ORDER BY ST_Distance(p.location, v_search_point)), '[]'::JSONB)
            FROM sot.places p
            WHERE p.merged_into_place_id IS NULL
            AND p.location IS NOT NULL
            AND ST_DWithin(p.location, v_search_point, 1000)
            AND NOT ST_DWithin(p.location, v_search_point, 500)
            AND EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.place_id = p.place_id)
        )
    ) INTO v_nearby_places;

    -- Step 4: Find nearest place with cats (regardless of distance)
    SELECT JSONB_BUILD_OBJECT(
        'place_id', p.place_id,
        'display_name', p.display_name,
        'distance_meters', ROUND(ST_Distance(p.location, v_search_point)::NUMERIC, 0),
        'distance_description', CASE
            WHEN ST_Distance(p.location, v_search_point) < 100 THEN 'very close (under 100m)'
            WHEN ST_Distance(p.location, v_search_point) < 500 THEN 'nearby (under 500m)'
            WHEN ST_Distance(p.location, v_search_point) < 1000 THEN 'in the area (under 1km)'
            WHEN ST_Distance(p.location, v_search_point) < 5000 THEN 'in the neighborhood (under 5km)'
            ELSE 'distant (' || ROUND(ST_Distance(p.location, v_search_point)::NUMERIC / 1000, 1) || 'km away)'
        END,
        'cat_count', (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = p.place_id)
    ) INTO v_nearest
    FROM sot.places p
    WHERE p.merged_into_place_id IS NULL
    AND p.location IS NOT NULL
    AND EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.place_id = p.place_id)
    ORDER BY ST_Distance(p.location, v_search_point)
    LIMIT 1;

    -- Calculate total nearby activity
    DECLARE
        v_total_nearby INT;
        v_total_cats INT;
        v_zone_assessment TEXT;
    BEGIN
        v_total_nearby := JSONB_ARRAY_LENGTH(v_nearby_places->'within_50m') +
                          JSONB_ARRAY_LENGTH(v_nearby_places->'within_100m') +
                          JSONB_ARRAY_LENGTH(v_nearby_places->'within_500m');

        -- Sum cats within 500m
        SELECT COALESCE(SUM((item->>'cat_count')::INT), 0) INTO v_total_cats
        FROM (
            SELECT jsonb_array_elements(v_nearby_places->'within_50m') as item
            UNION ALL
            SELECT jsonb_array_elements(v_nearby_places->'within_100m')
            UNION ALL
            SELECT jsonb_array_elements(v_nearby_places->'within_500m')
        ) x;

        v_zone_assessment := CASE
            WHEN v_total_nearby >= 5 THEN 'hot_zone'
            WHEN v_total_nearby >= 2 THEN 'active_area'
            WHEN v_total_nearby >= 1 THEN 'some_nearby_activity'
            ELSE 'no_nearby_activity'
        END;

        RETURN JSONB_BUILD_OBJECT(
            'search_type', 'spatial_search',
            'found_at_address', false,
            'searched_address', p_address,
            'nearby_places', v_nearby_places,
            'nearest_known_location', v_nearest,
            'summary', JSONB_BUILD_OBJECT(
                'places_within_500m', v_total_nearby,
                'total_cats_nearby', v_total_cats,
                'zone_assessment', v_zone_assessment
            ),
            'interpretation_hints', ARRAY[
                CASE v_zone_assessment
                    WHEN 'hot_zone' THEN 'This is a HOT ZONE with ' || v_total_nearby || ' locations and ' || v_total_cats || ' cats within 500m. High likelihood of cat activity in this area.'
                    WHEN 'active_area' THEN 'There is nearby activity - ' || v_total_nearby || ' location(s) within 500m. Cats in the area may roam to this address.'
                    WHEN 'some_nearby_activity' THEN 'Limited nearby activity. One location with cats within 500m.'
                    ELSE 'No cat activity within 500m of this address. The nearest known location is ' ||
                         COALESCE((v_nearest->>'distance_description'), 'unknown') || '.'
                END,
                CASE
                    WHEN (v_nearest->>'distance_meters')::INT > 5000
                    THEN 'The nearest known location is over 5km away. This appears to be a new area with no prior TNR history.'
                    WHEN (v_nearest->>'distance_meters')::INT > 1000
                    THEN 'Nearest activity is ' || (v_nearest->>'distance_meters') || 'm away. This location may be unrelated to nearby colonies.'
                    ELSE NULL
                END
            ]
        );
    END;
END;
$$;

COMMENT ON FUNCTION ops.tippy_spatial_analysis(TEXT, DOUBLE PRECISION, DOUBLE PRECISION) IS
'Geospatial analysis for Tippy - finds nearby activity, hot zones, and nearest known locations';

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Testing with known address (should find exact match)...'
SELECT jsonb_pretty(ops.tippy_spatial_analysis('15760 Pozzan')->'nearby_activity');

\echo ''
\echo 'Testing search type detection...'
SELECT ops.tippy_spatial_analysis('15760 Pozzan')->>'search_type' as search_type;

\echo ''
\echo '=============================================='
\echo '  MIG_2528 Complete!'
\echo '=============================================='
