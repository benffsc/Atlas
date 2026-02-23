-- MIG_2457: Enhance nearby_places() with Disease Details
--
-- PURPOSE: Add disease_summary JSONB column to nearby_places() output
-- so the API can return per-disease breakdown (FeLV, FIV, Ringworm, etc.)
-- instead of just a boolean disease_risk.
--
-- PROBLEM SOLVED:
--   Current display: "⚠ 11 disease · 37 nearby"
--   Users confused: Is that 11 cats? 11 places? What diseases?
--
-- NEW OUTPUT:
--   disease_summary JSONB: { "felv": { "positive_cats": 3, "last_positive": "2025-11-15" }, ... }
--
-- This enables UI to show: "⚠ FeLV/FIV nearby" instead of confusing counts.

BEGIN;

-- Drop existing function signatures to avoid conflicts
DROP FUNCTION IF EXISTS ops.nearby_places(DOUBLE PRECISION, DOUBLE PRECISION, INT, UUID, INT);
DROP FUNCTION IF EXISTS ops.nearby_places(DOUBLE PRECISION, DOUBLE PRECISION, INT, UUID, INT, INT);

-- Recreate function with disease_summary JSONB column
CREATE OR REPLACE FUNCTION ops.nearby_places(
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_radius_meters INT DEFAULT 5000,
    p_exclude_place_id UUID DEFAULT NULL,
    p_limit INT DEFAULT 30,
    p_disease_lookback_months INT DEFAULT NULL
)
RETURNS TABLE (
    place_id UUID,
    display_name TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    distance_meters DOUBLE PRECISION,
    cat_count INT,
    disease_risk BOOLEAN,
    disease_summary JSONB,  -- NEW: Per-disease breakdown
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
        COALESCE(ds.disease_summary, '{}'::JSONB) as disease_summary,  -- NEW
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
        -- Enhanced: Return per-disease breakdown
        SELECT
            pds.place_id,
            TRUE as disease_risk,
            JSONB_OBJECT_AGG(
                pds.disease_type_key,
                JSONB_BUILD_OBJECT(
                    'positive_cats', COALESCE(pds.positive_cat_count, 0),
                    'last_positive', pds.last_positive_date
                )
            ) as disease_summary
        FROM ops.place_disease_status pds
        WHERE pds.status IN ('confirmed_active', 'perpetual')
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

MIG_2457 Enhancement: Added disease_summary JSONB column with per-disease breakdown:
  { "felv": { "positive_cats": 3, "last_positive": "2025-11-15" }, ... }

This enables the UI to show meaningful disease types ("FeLV nearby")
instead of confusing place counts ("11 disease").

Disease status meanings:
  - confirmed_active: Test-confirmed positive within decay window
  - perpetual: Staff permanently flagged (never decays)
  - suspected: AI-extracted/unverified (EXCLUDED from warnings)
  - historical: Beyond decay window (EXCLUDED)';

COMMIT;

-- Verification
\echo ''
\echo '=============================================='
\echo '  MIG_2457: Disease Details Verification'
\echo '=============================================='
\echo ''

\echo 'Testing nearby_places with disease_summary (sample location):'
SELECT
    place_id,
    display_name,
    disease_risk,
    disease_summary,
    distance_meters::INT as distance_m
FROM ops.nearby_places(38.4051, -122.7147, 5000, NULL, 10, NULL)
WHERE disease_risk = TRUE
ORDER BY distance_meters
LIMIT 5;

\echo ''
\echo 'Aggregated disease breakdown across all nearby places:'
WITH disease_places AS (
    SELECT disease_summary
    FROM ops.nearby_places(38.4051, -122.7147, 5000, NULL, 100, NULL)
    WHERE disease_risk = TRUE
)
SELECT
    key as disease_type,
    COUNT(*) as places,
    SUM((value->>'positive_cats')::INT) as total_cats
FROM disease_places, JSONB_EACH(disease_summary)
GROUP BY key
ORDER BY total_cats DESC;

\echo ''
\echo '=============================================='
\echo '  MIG_2457 Complete!'
\echo '=============================================='
\echo ''
\echo 'Enhanced:'
\echo '  - nearby_places() now returns disease_summary JSONB'
\echo '  - Contains per-disease breakdown (felv, fiv, ringworm, etc.)'
\echo '  - Each disease has positive_cats count and last_positive date'
\echo ''
\echo 'API can now aggregate and return:'
\echo '  { "felv": { "places": 5, "cats": 12 }, "fiv": { "places": 3, "cats": 4 } }'
\echo ''
