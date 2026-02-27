-- MIG_2528: Tippy Spatial Analysis
-- Date: 2026-02-26
--
-- Purpose: Give Tippy geospatial reasoning capabilities
-- When searching for an address:
--   1. Check if we have data at that exact address
--   2. If not, use word-by-word matching to find nearby location
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
    v_nearest JSONB;
    v_search_words TEXT[];
BEGIN
    -- Step 1: Try to find exact address match
    SELECT p.place_id INTO v_place_id
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

    -- If exact match found, return full report with nearby context
    IF v_place_id IS NOT NULL THEN
        SELECT ops.tippy_place_full_report(p_address) INTO v_exact_match;

        SELECT p.location INTO v_search_point
        FROM sot.places p WHERE p.place_id = v_place_id;

        SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
            'place_id', p.place_id,
            'display_name', p.display_name,
            'distance_meters', ROUND(ST_Distance(p.location, v_search_point)::NUMERIC, 0),
            'cat_count', (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = p.place_id),
            'has_active_request', EXISTS (
                SELECT 1 FROM ops.requests r
                WHERE r.place_id = p.place_id AND r.status NOT IN ('completed', 'cancelled')
            )
        ) ORDER BY ST_Distance(p.location, v_search_point)), '[]'::JSONB)
        INTO v_nearby_places
        FROM sot.places p
        WHERE p.place_id != v_place_id
        AND p.merged_into_place_id IS NULL
        AND p.location IS NOT NULL
        AND ST_DWithin(p.location, v_search_point, 500)
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

    -- Step 2: No exact match - try coordinates or word-by-word partial match
    IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
        v_search_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;
    ELSE
        -- Split address into words and try to find any matching place
        v_search_words := regexp_split_to_array(p_address, '[,\s]+');

        -- Try each word (prioritize city names which are usually 1 word)
        FOR i IN 1..array_length(v_search_words, 1) LOOP
            IF length(v_search_words[i]) > 3 THEN  -- Skip short words
                SELECT p.location INTO v_search_point
                FROM sot.places p
                LEFT JOIN sot.addresses a ON a.address_id = p.sot_address_id
                WHERE p.merged_into_place_id IS NULL
                AND p.location IS NOT NULL
                AND (
                    a.city ILIKE v_search_words[i]
                    OR p.display_name ILIKE '%' || v_search_words[i] || '%'
                )
                LIMIT 1;

                EXIT WHEN v_search_point IS NOT NULL;
            END IF;
        END LOOP;
    END IF;

    IF v_search_point IS NULL THEN
        RETURN JSONB_BUILD_OBJECT(
            'search_type', 'no_match',
            'found_at_address', false,
            'searched_address', p_address,
            'message', 'Could not find or locate address: ' || p_address,
            'suggestion', 'Try a city name, street name, or provide coordinates'
        );
    END IF;

    -- Step 3: Build nearby places result
    SELECT JSONB_BUILD_OBJECT(
        'within_100m', (
            SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
                'place_id', p.place_id,
                'display_name', p.display_name,
                'distance_meters', ROUND(ST_Distance(p.location, v_search_point)::NUMERIC, 0),
                'cat_count', (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = p.place_id)
            ) ORDER BY ST_Distance(p.location, v_search_point)), '[]'::JSONB)
            FROM sot.places p
            WHERE p.merged_into_place_id IS NULL AND p.location IS NOT NULL
            AND ST_DWithin(p.location, v_search_point, 100)
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
            WHERE p.merged_into_place_id IS NULL AND p.location IS NOT NULL
            AND ST_DWithin(p.location, v_search_point, 500)
            AND NOT ST_DWithin(p.location, v_search_point, 100)
            AND EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.place_id = p.place_id)
        )
    ) INTO v_nearby_places;

    -- Find nearest
    SELECT JSONB_BUILD_OBJECT(
        'place_id', p.place_id,
        'display_name', p.display_name,
        'distance_meters', ROUND(ST_Distance(p.location, v_search_point)::NUMERIC, 0),
        'distance_description', CASE
            WHEN ST_Distance(p.location, v_search_point) < 100 THEN 'very close (under 100m)'
            WHEN ST_Distance(p.location, v_search_point) < 500 THEN 'nearby (under 500m)'
            WHEN ST_Distance(p.location, v_search_point) < 1000 THEN 'in the area (under 1km)'
            ELSE 'distant (' || ROUND(ST_Distance(p.location, v_search_point)::NUMERIC / 1000, 1) || 'km away)'
        END,
        'cat_count', (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = p.place_id)
    ) INTO v_nearest
    FROM sot.places p
    WHERE p.merged_into_place_id IS NULL AND p.location IS NOT NULL
    AND EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.place_id = p.place_id)
    ORDER BY ST_Distance(p.location, v_search_point)
    LIMIT 1;

    -- Calculate totals
    DECLARE
        v_total_nearby INT;
        v_total_cats INT;
        v_zone_assessment TEXT;
    BEGIN
        v_total_nearby := JSONB_ARRAY_LENGTH(v_nearby_places->'within_100m') +
                          JSONB_ARRAY_LENGTH(v_nearby_places->'within_500m');

        SELECT COALESCE(SUM((item->>'cat_count')::INT), 0) INTO v_total_cats
        FROM (
            SELECT jsonb_array_elements(v_nearby_places->'within_100m') as item
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
                    WHEN 'hot_zone' THEN 'HOT ZONE: ' || v_total_nearby || ' locations with ' || v_total_cats || ' cats within 500m'
                    WHEN 'active_area' THEN 'Active area: ' || v_total_nearby || ' location(s) within 500m'
                    WHEN 'some_nearby_activity' THEN 'Some nearby activity within 500m'
                    ELSE 'No activity within 500m. Nearest: ' || COALESCE(v_nearest->>'display_name', 'unknown')
                END
            ]
        );
    END;
END;
$$;

COMMENT ON FUNCTION ops.tippy_spatial_analysis(TEXT, DOUBLE PRECISION, DOUBLE PRECISION) IS
'Geospatial analysis for Tippy - finds nearby activity, hot zones, nearest locations. Uses word-by-word matching for partial addresses.';

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Test 1: Exact match (15760 Pozzan)...'
SELECT ops.tippy_spatial_analysis('15760 Pozzan')->>'search_type' as result;

\echo ''
\echo 'Test 2: Spatial search (15700 Pozzan, Healdsburg - does not exist)...'
SELECT
    r->>'search_type' as search_type,
    r->'summary'->>'zone_assessment' as zone,
    r->'summary'->>'places_within_500m' as nearby
FROM (SELECT ops.tippy_spatial_analysis('15700 Pozzan, Healdsburg') as r) x;

\echo ''
\echo '=============================================='
\echo '  MIG_2528 Complete!'
\echo '=============================================='
