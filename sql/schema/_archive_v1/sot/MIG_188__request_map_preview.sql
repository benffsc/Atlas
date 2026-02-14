-- MIG_188: Request Map Preview
--
-- Adds map preview support for request cards:
-- 1. Store lat/lng coordinates on requests
-- 2. Track map image cache (to avoid regenerating)
-- 3. Backfill from Airtable payload

BEGIN;

-- ============================================================================
-- 1. ADD COORDINATES TO SOT_REQUESTS
-- ============================================================================

ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 7),
ADD COLUMN IF NOT EXISTS longitude DECIMAL(10, 7),
ADD COLUMN IF NOT EXISTS map_preview_path TEXT,
ADD COLUMN IF NOT EXISTS map_preview_generated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sot_requests_coords
ON trapper.sot_requests(latitude, longitude)
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

COMMENT ON COLUMN trapper.sot_requests.latitude IS 'WGS84 latitude from address geocoding';
COMMENT ON COLUMN trapper.sot_requests.longitude IS 'WGS84 longitude from address geocoding';
COMMENT ON COLUMN trapper.sot_requests.map_preview_path IS 'Path to cached static map image';

-- ============================================================================
-- 2. BACKFILL FROM AIRTABLE PAYLOAD
-- ============================================================================

UPDATE trapper.sot_requests r
SET
    latitude = (sr.payload->>'Latitude')::DECIMAL(10, 7),
    longitude = (sr.payload->>'Longitude')::DECIMAL(10, 7)
FROM trapper.staged_records sr
WHERE sr.source_system = 'airtable'
  AND sr.source_table = 'trapping_requests'
  AND sr.source_row_id = r.source_record_id
  AND sr.payload->>'Latitude' IS NOT NULL
  AND r.latitude IS NULL;

-- ============================================================================
-- 3. VIEW: NEARBY REQUESTS FOR MAP MARKERS
-- ============================================================================
-- Returns requests within ~5 miles (0.07 degrees) for map markers

CREATE OR REPLACE FUNCTION trapper.nearby_requests(
    p_latitude DECIMAL,
    p_longitude DECIMAL,
    p_radius_degrees DECIMAL DEFAULT 0.07,
    p_exclude_request_id UUID DEFAULT NULL
)
RETURNS TABLE (
    request_id UUID,
    summary TEXT,
    latitude DECIMAL,
    longitude DECIMAL,
    estimated_cat_count INT,
    status TEXT,
    marker_size TEXT  -- 'small', 'medium', 'large' based on cat count
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.request_id,
        r.summary,
        r.latitude,
        r.longitude,
        r.estimated_cat_count,
        r.status::TEXT,
        CASE
            WHEN COALESCE(r.estimated_cat_count, 0) >= 20 THEN 'large'
            WHEN COALESCE(r.estimated_cat_count, 0) >= 7 THEN 'medium'
            WHEN COALESCE(r.estimated_cat_count, 0) >= 2 THEN 'small'
            ELSE 'tiny'
        END as marker_size
    FROM trapper.sot_requests r
    WHERE r.latitude IS NOT NULL
      AND r.longitude IS NOT NULL
      AND r.latitude BETWEEN (p_latitude - p_radius_degrees) AND (p_latitude + p_radius_degrees)
      AND r.longitude BETWEEN (p_longitude - p_radius_degrees) AND (p_longitude + p_radius_degrees)
      AND (p_exclude_request_id IS NULL OR r.request_id != p_exclude_request_id)
      AND r.status NOT IN ('cancelled', 'completed')
    ORDER BY
        -- Distance approximation (Pythagorean)
        SQRT(POWER(r.latitude - p_latitude, 2) + POWER(r.longitude - p_longitude, 2));
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.nearby_requests IS
'Returns nearby active requests for map markers. Radius is in degrees (~0.07 = 5 miles).';

-- ============================================================================
-- 4. VIEW: REQUESTS WITH MAP DATA
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_requests_with_map AS
SELECT
    r.request_id,
    r.status,
    r.priority,
    r.summary,
    r.estimated_cat_count,
    r.has_kittens,
    r.latitude,
    r.longitude,
    r.map_preview_path,
    r.created_at,
    r.scheduled_date,
    r.assigned_to,
    pl.display_name as place_name,
    pl.formatted_address as place_address,
    p.display_name as requester_name,
    CASE
        WHEN COALESCE(r.estimated_cat_count, 0) >= 20 THEN 'large'
        WHEN COALESCE(r.estimated_cat_count, 0) >= 7 THEN 'medium'
        WHEN COALESCE(r.estimated_cat_count, 0) >= 2 THEN 'small'
        ELSE 'tiny'
    END as colony_size,
    (SELECT COUNT(*) FROM trapper.nearby_requests(r.latitude, r.longitude, 0.07, r.request_id)) as nearby_count
FROM trapper.sot_requests r
LEFT JOIN trapper.places pl ON pl.place_id = r.place_id
LEFT JOIN trapper.sot_people p ON p.person_id = r.requester_person_id
WHERE r.latitude IS NOT NULL AND r.longitude IS NOT NULL;

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT 'Requests with coordinates:' as info,
       COUNT(*) FILTER (WHERE latitude IS NOT NULL) as with_coords,
       COUNT(*) as total
FROM trapper.sot_requests;
