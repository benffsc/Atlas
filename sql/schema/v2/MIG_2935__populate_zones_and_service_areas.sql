-- MIG_2935: Populate observation zones, service areas, and refresh estimates
-- FFS-538: Beacon MVP needs geographic grouping for zone rollups and map
--
-- This migration:
-- 1. Sets service_zone on all places by extracting city from address
-- 2. Creates observation zones via DBSCAN clustering of cat-active places
-- 3. Assigns places to their nearest zone
-- 4. Refreshes Chapman population estimates
--
-- Sonoma County cities identified: Santa Rosa, Petaluma, Sebastopol, Windsor,
-- Cotati, Rohnert Park, Healdsburg, Cloverdale, Guerneville, Forestville,
-- Penngrove, Sonoma, Monte Rio, Bodega Bay, Glen Ellen, Occidental, Graton, Kenwood

BEGIN;

\echo 'MIG_2935: Populating zones and service areas for Beacon'

-- ============================================================================
-- 1. Set service_zone on places by city extraction
-- ============================================================================

\echo '1. Setting service_zone from address city extraction...'

-- Create a reusable function for city extraction
CREATE OR REPLACE FUNCTION sot.extract_service_zone(p_address TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    -- Order matters: more specific patterns first
    WHEN p_address ~* '\mRohnert\s+Park\M' THEN 'Rohnert Park'
    WHEN p_address ~* '\mSanta\s+Rosa\M' THEN 'Santa Rosa'
    WHEN p_address ~* '\mBodega\s+Bay\M' THEN 'Bodega Bay'
    WHEN p_address ~* '\mGlen\s+Ellen\M' THEN 'Glen Ellen'
    WHEN p_address ~* '\mMonte\s+Rio\M' THEN 'Monte Rio'
    WHEN p_address ~* '\mPetaluma\M' THEN 'Petaluma'
    WHEN p_address ~* '\mSebastopol\M' THEN 'Sebastopol'
    WHEN p_address ~* '\mWindsor\M' THEN 'Windsor'
    WHEN p_address ~* '\mCotati\M' THEN 'Cotati'
    WHEN p_address ~* '\mHealdsburg\M' THEN 'Healdsburg'
    WHEN p_address ~* '\mCloverdale\M' THEN 'Cloverdale'
    WHEN p_address ~* '\mGuerneville\M' THEN 'Guerneville'
    WHEN p_address ~* '\mForestville\M' THEN 'Forestville'
    WHEN p_address ~* '\mPenngrove\M' THEN 'Penngrove'
    WHEN p_address ~* '\mSonoma\M' THEN 'Sonoma'
    WHEN p_address ~* '\mOccidental\M' THEN 'Occidental'
    WHEN p_address ~* '\mGraton\M' THEN 'Graton'
    WHEN p_address ~* '\mKenwood\M' THEN 'Kenwood'
    WHEN p_address ~* '\mCamp\s+Meeker\M' THEN 'Camp Meeker'
    WHEN p_address ~* '\mCazadero\M' THEN 'Cazadero'
    WHEN p_address ~* '\mGeyserville\M' THEN 'Geyserville'
    WHEN p_address ~* '\mJenner\M' THEN 'Jenner'
    WHEN p_address ~* '\mFulton\M' THEN 'Fulton'
    WHEN p_address ~* '\mLarkfield\M' THEN 'Larkfield'
    WHEN p_address ~* '\mEl\s+Verano\M' THEN 'El Verano'
    WHEN p_address ~* '\mBoyes\s+Hot\s+Springs\M' THEN 'Boyes Hot Springs'
    WHEN p_address ~* '\mValley\s+Ford\M' THEN 'Valley Ford'
    WHEN p_address ~* '\mTimber\s+Cove\M' THEN 'Timber Cove'
    WHEN p_address ~* '\mSea\s+Ranch\M' THEN 'Sea Ranch'
    ELSE NULL
  END;
$$;

-- Apply to all places
UPDATE sot.places
SET service_zone = sot.extract_service_zone(formatted_address)
WHERE merged_into_place_id IS NULL
  AND formatted_address IS NOT NULL
  AND service_zone IS NULL;

\echo '   Service zones assigned'

-- Report
SELECT service_zone, COUNT(*) AS places
FROM sot.places
WHERE service_zone IS NOT NULL AND merged_into_place_id IS NULL
GROUP BY service_zone
ORDER BY COUNT(*) DESC;

-- ============================================================================
-- 2. Create observation zones via DBSCAN clustering
-- ============================================================================
-- Uses DBSCAN with 500m epsilon and min 3 places per cluster.
-- Only clusters places that have cat activity (at least 1 cat linked).

\echo '2. Creating observation zones via DBSCAN clustering...'

-- Run DBSCAN clustering on cat-active places
WITH cat_active_places AS (
  SELECT
    p.place_id,
    p.location,
    p.service_zone,
    cc.cat_count
  FROM sot.places p
  JOIN (
    SELECT place_id, COUNT(DISTINCT cat_id) AS cat_count
    FROM sot.cat_place
    GROUP BY place_id
    HAVING COUNT(DISTINCT cat_id) >= 1
  ) cc ON cc.place_id = p.place_id
  WHERE p.merged_into_place_id IS NULL
    AND p.location IS NOT NULL
),
clustered AS (
  SELECT
    place_id,
    location,
    service_zone,
    cat_count,
    ST_ClusterDBSCAN(location::geometry, eps := 0.005, minpoints := 3) OVER () AS cluster_id
    -- 0.005 degrees ≈ 500m at this latitude
  FROM cat_active_places
),
cluster_stats AS (
  SELECT
    cluster_id,
    COUNT(*) AS place_count,
    SUM(cat_count)::INT AS total_cats,
    ST_Centroid(ST_Collect(location::geometry)) AS centroid,
    -- ConvexHull can return Point/Line for collinear places; buffer to ensure Polygon
    CASE
      WHEN GeometryType(ST_ConvexHull(ST_Collect(location::geometry))) = 'POLYGON'
        THEN ST_ConvexHull(ST_Collect(location::geometry))
      ELSE ST_Buffer(ST_ConvexHull(ST_Collect(location::geometry))::geography, 50)::geometry
    END AS boundary,
    CASE
      WHEN GeometryType(ST_ConvexHull(ST_Collect(location::geometry))) = 'POLYGON'
        THEN ST_Area(ST_ConvexHull(ST_Collect(location::geometry))::geography) / 1000000.0
      ELSE ST_Area(ST_Buffer(ST_ConvexHull(ST_Collect(location::geometry))::geography, 50)) / 1000000.0
    END AS area_sq_km,
    MODE() WITHIN GROUP (ORDER BY service_zone) AS primary_zone,
    -- Pick the place with most cats as anchor
    (ARRAY_AGG(place_id ORDER BY cat_count DESC))[1] AS anchor_place_id
  FROM clustered
  WHERE cluster_id IS NOT NULL
  GROUP BY cluster_id
  HAVING COUNT(*) >= 3  -- At least 3 places per zone
)
INSERT INTO sot.observation_zones (
  zone_code,
  zone_name,
  service_zone,
  boundary_geom,
  centroid,
  area_sq_km,
  creation_method,
  creation_parameters,
  methodology_notes,
  anchor_place_id,
  anchor_selection_reason,
  status,
  created_by
)
SELECT
  -- Zone code: service_zone abbreviation + sequential number
  COALESCE(
    UPPER(LEFT(REPLACE(primary_zone, ' ', ''), 4)),
    'UNKN'
  ) || '-' || ROW_NUMBER() OVER (PARTITION BY primary_zone ORDER BY total_cats DESC)::TEXT AS zone_code,
  COALESCE(primary_zone, 'Unknown') || ' Zone ' ||
    ROW_NUMBER() OVER (PARTITION BY primary_zone ORDER BY total_cats DESC)::TEXT AS zone_name,
  primary_zone AS service_zone,
  boundary AS boundary_geom,
  centroid::geography AS centroid,
  ROUND(area_sq_km::NUMERIC, 3) AS area_sq_km,
  'cluster_based' AS creation_method,
  jsonb_build_object(
    'epsilon_degrees', 0.005,
    'epsilon_meters_approx', 500,
    'min_points', 3,
    'place_count', place_count,
    'total_cats', total_cats
  ) AS creation_parameters,
  'Auto-generated by MIG_2935 using DBSCAN clustering (eps=500m, minPts=3) on cat-active places' AS methodology_notes,
  anchor_place_id,
  'Place with highest cat count in cluster' AS anchor_selection_reason,
  'active' AS status,
  'MIG_2935' AS created_by
FROM cluster_stats
ORDER BY total_cats DESC;

\echo '   Observation zones created'

SELECT COUNT(*) AS zones_created FROM sot.observation_zones WHERE created_by = 'MIG_2935';

-- ============================================================================
-- 3. Assign places to zones
-- ============================================================================

\echo '3. Assigning places to nearest zones...'

-- Assign each cat-active place to its nearest zone
INSERT INTO sot.place_observation_zone (place_id, zone_id, assignment_method, distance_to_anchor_m, assigned_by)
SELECT DISTINCT ON (p.place_id)
  p.place_id,
  oz.zone_id,
  'automatic_proximity',
  ST_Distance(p.location::geography, oz.centroid) AS distance_m,
  'MIG_2935'
FROM sot.places p
JOIN (
  SELECT place_id FROM sot.cat_place GROUP BY place_id
) cc ON cc.place_id = p.place_id
CROSS JOIN LATERAL (
  SELECT zone_id, centroid
  FROM sot.observation_zones
  WHERE status = 'active'
  ORDER BY p.location::geometry <-> centroid::geometry
  LIMIT 1
) oz
WHERE p.merged_into_place_id IS NULL
  AND p.location IS NOT NULL
ON CONFLICT DO NOTHING;

\echo '   Places assigned to zones'

SELECT COUNT(*) AS places_assigned FROM sot.place_observation_zone WHERE assigned_by = 'MIG_2935';

-- ============================================================================
-- 4. Refresh Chapman population estimates
-- ============================================================================

\echo '4. Refreshing Chapman population estimates...'

-- Batch refresh: estimate population for all places with >= 3 distinct cats
-- in the last 365 days of appointments. Uses beacon.estimate_colony_population().
DO $$
DECLARE
  v_place_id UUID;
  v_estimate RECORD;
  v_count INT := 0;
BEGIN
  FOR v_place_id IN
    SELECT DISTINCT COALESCE(a.place_id, a.inferred_place_id) AS pid
    FROM ops.appointments a
    WHERE a.appointment_date >= CURRENT_DATE - INTERVAL '365 days'
      AND (a.is_spay = true OR a.is_neuter = true)
      AND a.cat_id IS NOT NULL
      AND COALESCE(a.place_id, a.inferred_place_id) IS NOT NULL
    GROUP BY COALESCE(a.place_id, a.inferred_place_id)
    HAVING COUNT(DISTINCT a.cat_id) >= 3
  LOOP
    BEGIN
      SELECT * INTO v_estimate
      FROM beacon.estimate_colony_population(v_place_id, 365);

      IF v_estimate IS NOT NULL AND v_estimate.place_id IS NOT NULL THEN
        INSERT INTO beacon.place_chapman_estimates (
          place_id, estimated_population, ci_lower, ci_upper,
          marked_count, capture_count, recapture_count,
          sample_adequate, confidence_level,
          observation_start, observation_end, last_calculated_at
        ) VALUES (
          v_estimate.place_id, v_estimate.estimated_population,
          v_estimate.ci_lower, v_estimate.ci_upper,
          v_estimate.marked_count, v_estimate.capture_count, v_estimate.recapture_count,
          v_estimate.sample_adequate, v_estimate.confidence_level,
          v_estimate.observation_start, v_estimate.observation_end, NOW()
        )
        ON CONFLICT (place_id) DO UPDATE SET
          estimated_population = EXCLUDED.estimated_population,
          ci_lower = EXCLUDED.ci_lower,
          ci_upper = EXCLUDED.ci_upper,
          marked_count = EXCLUDED.marked_count,
          capture_count = EXCLUDED.capture_count,
          recapture_count = EXCLUDED.recapture_count,
          sample_adequate = EXCLUDED.sample_adequate,
          confidence_level = EXCLUDED.confidence_level,
          observation_start = EXCLUDED.observation_start,
          observation_end = EXCLUDED.observation_end,
          last_calculated_at = NOW();

        v_count := v_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Skip places that error (e.g., missing data)
      NULL;
    END;
  END LOOP;

  RAISE NOTICE 'Chapman estimates refreshed for % places', v_count;
END $$;

\echo '   Chapman estimates refreshed'

SELECT
  confidence_level,
  COUNT(*) AS cnt,
  COUNT(*) FILTER (WHERE sample_adequate) AS adequate,
  AVG(estimated_population)::INT AS avg_pop,
  MIN(estimated_population) AS min_pop,
  MAX(estimated_population) AS max_pop
FROM beacon.place_chapman_estimates
GROUP BY confidence_level
ORDER BY confidence_level;

-- ============================================================================
-- 5. Verify zone rollup now has data
-- ============================================================================

\echo ''
\echo '5. Zone rollup verification:'

SELECT
  zone_code,
  zone_name,
  place_count,
  total_cats,
  altered_cats,
  alteration_rate_pct,
  zone_status
FROM beacon.v_zone_alteration_rollup
ORDER BY total_cats DESC
LIMIT 10;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo 'MIG_2935 Summary:'

SELECT
  (SELECT COUNT(*) FROM sot.places WHERE service_zone IS NOT NULL AND merged_into_place_id IS NULL) AS places_with_service_zone,
  (SELECT COUNT(*) FROM sot.observation_zones WHERE status = 'active') AS active_zones,
  (SELECT COUNT(*) FROM sot.place_observation_zone) AS place_zone_assignments,
  (SELECT COUNT(*) FROM beacon.place_chapman_estimates) AS chapman_estimates;

COMMIT;
