-- MIG_2453: Nearby Places Function for Map Preview
--
-- Returns places near a location with pin styling data for static map markers.
-- Includes cat counts, disease risk, watch list status.
-- Used by /api/requests/[id]/map for enhanced map previews.

BEGIN;

CREATE OR REPLACE FUNCTION ops.nearby_places(
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_radius_meters INT DEFAULT 5000,
    p_exclude_place_id UUID DEFAULT NULL,
    p_limit INT DEFAULT 30
)
RETURNS TABLE (
    place_id UUID,
    display_name TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    distance_meters DOUBLE PRECISION,
    cat_count INT,
    disease_risk BOOLEAN,
    watch_list BOOLEAN,
    active_request_count INT,
    pin_style TEXT
) AS $$
DECLARE
    v_center GEOGRAPHY;
BEGIN
    v_center := ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography;

    RETURN QUERY
    SELECT
        p.place_id,
        COALESCE(p.display_name, p.formatted_address)::TEXT as display_name,
        ST_Y(p.location::geometry)::DOUBLE PRECISION AS latitude,
        ST_X(p.location::geometry)::DOUBLE PRECISION AS longitude,
        ST_Distance(p.location, v_center) AS distance_meters,
        COALESCE(cc.cat_count, 0)::INT as cat_count,
        COALESCE(ds.disease_risk, FALSE) as disease_risk,
        COALESCE(p.watch_list, FALSE) as watch_list,
        COALESCE(rc.active_count, 0)::INT as active_request_count,
        CASE
            WHEN COALESCE(ds.disease_risk, FALSE) THEN 'disease'
            WHEN COALESCE(p.watch_list, FALSE) THEN 'watch_list'
            WHEN COALESCE(cc.cat_count, 0) > 0 THEN 'active'
            WHEN COALESCE(rc.active_count, 0) > 0 THEN 'active_requests'
            ELSE 'minimal'
        END::TEXT AS pin_style
    FROM sot.places p
    LEFT JOIN (
        SELECT cp.place_id, COUNT(*)::INT as cat_count
        FROM sot.cat_place cp
        JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
        GROUP BY cp.place_id
    ) cc ON cc.place_id = p.place_id
    LEFT JOIN (
        SELECT pds.place_id, TRUE as disease_risk
        FROM ops.place_disease_status pds
        WHERE pds.status IN ('confirmed_active', 'suspected')
        GROUP BY pds.place_id
    ) ds ON ds.place_id = p.place_id
    LEFT JOIN (
        SELECT r.place_id, COUNT(*)::INT as active_count
        FROM ops.requests r
        WHERE r.status NOT IN ('completed', 'cancelled')
        GROUP BY r.place_id
    ) rc ON rc.place_id = p.place_id
    WHERE p.location IS NOT NULL
      AND p.merged_into_place_id IS NULL
      AND ST_DWithin(p.location, v_center, p_radius_meters)
      AND (p_exclude_place_id IS NULL OR p.place_id != p_exclude_place_id)
      -- Only include places with some activity
      AND (COALESCE(cc.cat_count, 0) > 0
           OR COALESCE(ds.disease_risk, FALSE)
           OR COALESCE(p.watch_list, FALSE)
           OR COALESCE(rc.active_count, 0) > 0)
    ORDER BY
        -- Priority: disease first, then watch list, then by distance
        CASE
            WHEN COALESCE(ds.disease_risk, FALSE) THEN 0
            WHEN COALESCE(p.watch_list, FALSE) THEN 1
            ELSE 2
        END,
        ST_Distance(p.location, v_center)
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION ops.nearby_places IS
'Returns nearby places with pin data for map markers.
Includes cat count, disease risk, watch list status, and computed pin_style.
Prioritizes disease and watch_list places. Default 5km radius.
Used by /api/requests/[id]/map for enhanced map previews.';

COMMIT;

-- Verification
SELECT 'Nearby places function created' AS info;
