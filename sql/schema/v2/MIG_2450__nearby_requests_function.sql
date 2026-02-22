-- MIG_2450: Nearby Requests Function for Map Preview (V2, PostGIS Best Practices)
--
-- Industry-standard implementation using:
-- - Meters for radius (not degrees) - matches Google Places API, OGC API Features
-- - ST_DWithin for indexed spatial filtering (uses GIST index)
-- - ST_Distance for accurate geographic sorting (spheroid)
-- - Geography type preserved (no unnecessary geometry cast)
--
-- V2 schema: coordinates are on sot.places (PostGIS location column)
-- instead of directly on requests table.

BEGIN;

-- Drop old function if exists (signature may differ)
DROP FUNCTION IF EXISTS ops.nearby_requests(DECIMAL, DECIMAL, DECIMAL, UUID);

-- ============================================================================
-- 1. CREATE NEARBY_REQUESTS FUNCTION (Industry Standard)
-- ============================================================================
-- Returns requests within a radius (in meters) for map markers.
-- Default 8000m ≈ 5 miles.

CREATE OR REPLACE FUNCTION ops.nearby_requests(
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_radius_meters INT DEFAULT 8000,  -- ~5 miles in meters (industry standard)
    p_exclude_request_id UUID DEFAULT NULL,
    p_limit INT DEFAULT 50  -- Pagination support
)
RETURNS TABLE (
    request_id UUID,
    summary TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    distance_meters DOUBLE PRECISION,  -- Industry standard: return distance
    estimated_cat_count INT,
    status TEXT,
    marker_size TEXT  -- 'tiny', 'small', 'medium', 'large' based on cat count
) AS $$
DECLARE
    v_center GEOGRAPHY;
BEGIN
    -- Pre-compute center point for efficiency
    v_center := ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography;

    RETURN QUERY
    SELECT
        r.request_id,
        r.summary,
        ST_Y(p.location::geometry)::DOUBLE PRECISION AS latitude,
        ST_X(p.location::geometry)::DOUBLE PRECISION AS longitude,
        ST_Distance(p.location, v_center) AS distance_meters,
        r.estimated_cat_count,
        r.status::TEXT,
        CASE
            WHEN COALESCE(r.estimated_cat_count, 0) >= 20 THEN 'large'
            WHEN COALESCE(r.estimated_cat_count, 0) >= 7 THEN 'medium'
            WHEN COALESCE(r.estimated_cat_count, 0) >= 2 THEN 'small'
            ELSE 'tiny'
        END AS marker_size
    FROM ops.requests r
    JOIN sot.places p ON p.place_id = r.place_id
    WHERE p.location IS NOT NULL
      AND ST_DWithin(p.location, v_center, p_radius_meters)  -- Uses GIST index
      AND (p_exclude_request_id IS NULL OR r.request_id != p_exclude_request_id)
      AND r.status NOT IN ('cancelled', 'completed')
    ORDER BY ST_Distance(p.location, v_center)
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION ops.nearby_requests IS
'Returns nearby active requests for map markers using PostGIS best practices.
Radius is in meters (default 8000m ≈ 5 miles). Uses ST_DWithin for indexed filtering
and ST_Distance for accurate geographic sorting. Returns distance_meters per result.
Industry standard: matches Google Places API, OGC API Features patterns.';

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Test the function (will return empty if no requests with coordinates)
SELECT 'Nearby requests function created (industry-standard PostGIS)' AS info;
