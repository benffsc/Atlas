-- MIG_2454: Fix Disease Filter in nearby_places()
--
-- ROOT CAUSE: MIG_2453 used 'suspected' status which includes unverified
-- AI-extracted disease mentions. Atlas Map uses only 'confirmed_active' + 'perpetual'.
--
-- THE BUG:
--   Request cards showed "⚠ 5 disease nearby" but Atlas Map showed NO disease pins
--   for the same location. This is inconsistent and confusing.
--
-- FIX: Align nearby_places() with v_place_disease_summary logic:
--   BEFORE: WHERE pds.status IN ('confirmed_active', 'suspected')
--   AFTER:  WHERE pds.status IN ('confirmed_active', 'perpetual')
--
-- DISEASE STATUS MEANINGS (from MIG_2110):
--   - confirmed_active: Test-confirmed positive, within decay window
--   - suspected: AI-extracted or mentioned, NOT test-confirmed (EXCLUDE from warnings)
--   - historical: Was positive but beyond decay window
--   - perpetual: Staff permanently flagged (never decays)
--
-- Also adds:
--   - Optional p_disease_lookback_months parameter for time filtering
--   - GIST index on sot.places.location for ST_DWithin performance

BEGIN;

-- Drop existing function(s) to avoid signature conflicts
DROP FUNCTION IF EXISTS ops.nearby_places(DOUBLE PRECISION, DOUBLE PRECISION, INT, UUID, INT);
DROP FUNCTION IF EXISTS ops.nearby_places(DOUBLE PRECISION, DOUBLE PRECISION, INT, UUID, INT, INT);

-- Recreate function with corrected disease filter + new parameter
CREATE OR REPLACE FUNCTION ops.nearby_places(
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_radius_meters INT DEFAULT 5000,
    p_exclude_place_id UUID DEFAULT NULL,
    p_limit INT DEFAULT 30,
    p_disease_lookback_months INT DEFAULT NULL  -- NEW: Optional time filter
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
        -- FIX: Use same filter as v_place_disease_summary
        -- confirmed_active = test-verified within decay window
        -- perpetual = staff permanently flagged
        -- EXCLUDES: suspected (AI-extracted, unverified)
        SELECT pds.place_id, TRUE as disease_risk
        FROM ops.place_disease_status pds
        WHERE pds.status IN ('confirmed_active', 'perpetual')
          -- Optional time-based filter
          AND (p_disease_lookback_months IS NULL
               OR pds.last_positive_date >= CURRENT_DATE - (p_disease_lookback_months * INTERVAL '1 month'))
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
      AND (COALESCE(cc.cat_count, 0) > 0
           OR COALESCE(ds.disease_risk, FALSE)
           OR COALESCE(p.watch_list, FALSE)
           OR COALESCE(rc.active_count, 0) > 0)
    ORDER BY
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
FIX (MIG_2454): Uses same disease filter as v_place_disease_summary.
Only confirmed_active + perpetual (NOT suspected).
Optional p_disease_lookback_months for time-based filtering.

Disease status meanings:
  - confirmed_active: Test-confirmed positive within decay window
  - perpetual: Staff permanently flagged (never decays)
  - suspected: AI-extracted/unverified (EXCLUDED from warnings)
  - historical: Beyond decay window (EXCLUDED)

This ensures request card map previews match Atlas Map visualization.';

-- Performance: Add GIST index for ST_DWithin queries
-- Note: location column is already geography type, cast not needed for GIST
CREATE INDEX IF NOT EXISTS idx_places_location_gist
    ON sot.places USING GIST(location)
    WHERE merged_into_place_id IS NULL AND location IS NOT NULL;

COMMIT;

-- Verification
\echo ''
\echo '=============================================='
\echo '  MIG_2454: Disease Filter Fix Verification'
\echo '=============================================='
\echo ''

\echo 'Disease status distribution:'
SELECT status, COUNT(*) as count
FROM ops.place_disease_status
WHERE status IN ('suspected', 'confirmed_active', 'perpetual', 'historical')
GROUP BY status
ORDER BY count DESC;

\echo ''
\echo 'Testing nearby_places function (sample location):'
SELECT pin_style, COUNT(*) as count
FROM ops.nearby_places(38.4051, -122.7147, 5000, NULL, 100, NULL)
GROUP BY pin_style
ORDER BY count DESC;

\echo ''
\echo 'Checking disease consistency with Atlas Map:'
\echo '(All disease pins in Atlas Map should also appear in nearby_places)'
SELECT
    COUNT(*) FILTER (WHERE map.disease_count > 0) as atlas_disease_pins,
    COUNT(*) FILTER (WHERE np.disease_risk) as nearby_disease_places
FROM ops.v_map_atlas_pins map
LEFT JOIN ops.nearby_places(38.4051, -122.7147, 10000, NULL, 200, NULL) np
    ON np.place_id = map.id
WHERE map.lat BETWEEN 38.3 AND 38.5
  AND map.lng BETWEEN -122.8 AND -122.6;

\echo ''
\echo '=============================================='
\echo '  MIG_2454 Complete!'
\echo '=============================================='
\echo ''
\echo 'Fixed:'
\echo '  - nearby_places() now uses same disease filter as Atlas Map'
\echo '  - Only confirmed_active + perpetual trigger disease warnings'
\echo '  - Added optional disease_lookback_months parameter'
\echo '  - Added GIST index for ST_DWithin performance'
\echo ''
