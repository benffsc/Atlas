\echo '=== MIG_341: Beacon DBSCAN Colony Clustering ==='
\echo 'Creates density-based colony clustering using PostGIS DBSCAN'
\echo 'Scientific basis: DBSCAN algorithm for spatial clustering'
\echo ''

-- ============================================================================
-- SCIENTIFIC FOUNDATION
--
-- DBSCAN (Density-Based Spatial Clustering of Applications with Noise)
-- is ideal for colony grouping because:
--
-- 1. No pre-specified cluster count needed
-- 2. Detects arbitrary cluster shapes (matching real colony distributions)
-- 3. Identifies noise points (isolated locations)
-- 4. Parameters are intuitive (radius + minimum points)
--
-- PostGIS native: ST_ClusterDBSCAN(geometry, eps, minpoints)
-- Reference: Ester M, et al. "A density-based algorithm for discovering
--            clusters in large spatial databases with noise." KDD 1996.
-- Implementation: https://www.crunchydata.com/blog/postgis-clustering-with-dbscan
-- ============================================================================

\echo 'Step 1: Creating colony clustering function...'

CREATE OR REPLACE FUNCTION trapper.beacon_cluster_colonies(
    p_epsilon_meters FLOAT DEFAULT 200,  -- 200m radius = roughly 2 city blocks
    p_min_points INT DEFAULT 2           -- Minimum 2 places to form cluster
)
RETURNS TABLE (
    cluster_id INT,
    place_ids UUID[],
    place_count INT,
    centroid_lat FLOAT,
    centroid_lng FLOAT,
    total_verified_cats INT,
    total_altered_cats INT,
    avg_alteration_rate NUMERIC,
    cluster_status TEXT,
    bounding_box_geojson TEXT,
    cluster_audit JSONB
) AS $$
BEGIN
    RETURN QUERY
    WITH clustered AS (
        -- Apply DBSCAN clustering to places with cat activity
        SELECT
            ST_ClusterDBSCAN(
                p.location::geometry,
                eps := p_epsilon_meters,
                minpoints := p_min_points
            ) OVER() as cid,
            p.place_id,
            p.location
        FROM trapper.places p
        WHERE p.merged_into_place_id IS NULL
          AND p.location IS NOT NULL
          AND p.has_cat_activity = TRUE
    ),
    cluster_metrics AS (
        -- Aggregate metrics per cluster
        SELECT
            c.cid,
            array_agg(c.place_id ORDER BY bpm.verified_cat_count DESC) as place_ids,
            COUNT(*)::INT as place_count,
            ST_Y(ST_Centroid(ST_Collect(c.location::geometry))) as centroid_lat,
            ST_X(ST_Centroid(ST_Collect(c.location::geometry))) as centroid_lng,
            COALESCE(SUM(bpm.verified_cat_count), 0)::INT as total_verified_cats,
            COALESCE(SUM(bpm.verified_altered_count), 0)::INT as total_altered_cats,
            ST_AsGeoJSON(ST_Envelope(ST_Collect(c.location::geometry))) as bounding_box_geojson,
            -- For audit trail
            array_agg(DISTINCT bpm.colony_status) as status_distribution
        FROM clustered c
        JOIN trapper.v_beacon_place_metrics bpm ON bpm.place_id = c.place_id
        WHERE c.cid IS NOT NULL  -- Exclude noise points (not in any cluster)
        GROUP BY c.cid
    )
    SELECT
        cm.cid as cluster_id,
        cm.place_ids,
        cm.place_count,
        cm.centroid_lat,
        cm.centroid_lng,
        cm.total_verified_cats,
        cm.total_altered_cats,
        CASE
            WHEN cm.total_verified_cats > 0 THEN
                ROUND(100.0 * cm.total_altered_cats / cm.total_verified_cats, 1)
            ELSE NULL
        END as avg_alteration_rate,
        -- Cluster status based on overall alteration rate
        CASE
            WHEN cm.total_altered_cats = 0 AND cm.total_verified_cats = 0 THEN 'no_data'
            WHEN cm.total_altered_cats::FLOAT / NULLIF(cm.total_verified_cats, 0) >= 0.75 THEN 'managed'
            WHEN cm.total_altered_cats::FLOAT / NULLIF(cm.total_verified_cats, 0) >= 0.50 THEN 'in_progress'
            WHEN cm.total_altered_cats::FLOAT / NULLIF(cm.total_verified_cats, 0) >= 0.25 THEN 'needs_work'
            ELSE 'needs_attention'
        END as cluster_status,
        cm.bounding_box_geojson,
        -- Audit trail
        jsonb_build_object(
            'algorithm', 'DBSCAN',
            'epsilon_meters', p_epsilon_meters,
            'min_points', p_min_points,
            'place_status_distribution', cm.status_distribution,
            'scientific_reference', 'Ester et al. KDD 1996',
            'postgis_function', 'ST_ClusterDBSCAN',
            'calculated_at', NOW()
        ) as cluster_audit
    FROM cluster_metrics cm
    ORDER BY cm.total_verified_cats DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.beacon_cluster_colonies IS
'Clusters places with cat activity using DBSCAN algorithm.
Supports zoom-out view in Beacon visualization.

Parameters:
- p_epsilon_meters: Cluster radius in meters (default 200m = ~2 city blocks)
- p_min_points: Minimum places to form cluster (default 2)

Returns clusters with:
- Aggregated cat counts and alteration rates
- Geographic centroid and bounding box
- Status classification (managed, in_progress, needs_attention)
- Full audit trail for transparency

Scientific basis: DBSCAN for density-based spatial clustering
Reference: Ester M, et al. "A density-based algorithm for discovering
           clusters in large spatial databases with noise." KDD 1996.
PostGIS docs: https://postgis.net/docs/ST_ClusterDBSCAN.html';

\echo 'Created beacon_cluster_colonies function'

-- ============================================================================
-- Step 2: View for noise points (isolated places not in any cluster)
-- ============================================================================

\echo ''
\echo 'Step 2: Creating view for isolated places (noise points)...'

CREATE OR REPLACE VIEW trapper.v_beacon_isolated_places AS
WITH clustered AS (
    SELECT
        ST_ClusterDBSCAN(p.location::geometry, eps := 200, minpoints := 2)
            OVER() as cluster_id,
        p.place_id
    FROM trapper.places p
    WHERE p.merged_into_place_id IS NULL
      AND p.location IS NOT NULL
      AND p.has_cat_activity = TRUE
)
SELECT
    bpm.*,
    'isolated' as cluster_type,
    jsonb_build_object(
        'reason', 'Not within 200m of another place with cat activity',
        'algorithm', 'DBSCAN noise point detection'
    ) as isolation_audit
FROM trapper.v_beacon_place_metrics bpm
JOIN clustered c ON c.place_id = bpm.place_id
WHERE c.cluster_id IS NULL  -- Noise points have NULL cluster_id
  AND bpm.verified_cat_count > 0;

COMMENT ON VIEW trapper.v_beacon_isolated_places IS
'Places with cat activity that are isolated (not part of any cluster).
These are DBSCAN "noise points" - locations more than 200m from other cat activity.
Useful for identifying colonies that may need focused attention.';

\echo 'Created v_beacon_isolated_places view'

-- ============================================================================
-- Step 3: Materialized view for performance (optional caching)
-- ============================================================================

\echo ''
\echo 'Step 3: Creating materialized cluster view for performance...'

CREATE MATERIALIZED VIEW IF NOT EXISTS trapper.mv_beacon_clusters AS
SELECT * FROM trapper.beacon_cluster_colonies(200, 2);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_beacon_clusters_id
ON trapper.mv_beacon_clusters(cluster_id);

-- Function to refresh the materialized view
CREATE OR REPLACE FUNCTION trapper.refresh_beacon_clusters()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY trapper.mv_beacon_clusters;
    RAISE NOTICE 'Beacon clusters refreshed at %', NOW();
END;
$$ LANGUAGE plpgsql;

COMMENT ON MATERIALIZED VIEW trapper.mv_beacon_clusters IS
'Cached DBSCAN clusters for fast Beacon API responses.
Refresh with: SELECT trapper.refresh_beacon_clusters();
Recommended: Refresh after significant data changes or daily via cron.';

\echo 'Created mv_beacon_clusters materialized view'

-- ============================================================================
-- Step 4: Cluster statistics summary
-- ============================================================================

\echo ''
\echo 'Step 4: Creating cluster statistics view...'

CREATE OR REPLACE VIEW trapper.v_beacon_cluster_summary AS
SELECT
    -- Total clusters
    (SELECT COUNT(DISTINCT cluster_id) FROM trapper.mv_beacon_clusters) as total_clusters,

    -- Places covered
    (SELECT SUM(place_count) FROM trapper.mv_beacon_clusters) as places_in_clusters,
    (SELECT COUNT(*) FROM trapper.v_beacon_isolated_places) as isolated_places,

    -- Cat totals
    (SELECT SUM(total_verified_cats) FROM trapper.mv_beacon_clusters) as cats_in_clusters,
    (SELECT SUM(total_altered_cats) FROM trapper.mv_beacon_clusters) as altered_in_clusters,

    -- Cluster status breakdown
    (SELECT COUNT(*) FROM trapper.mv_beacon_clusters WHERE cluster_status = 'managed') as clusters_managed,
    (SELECT COUNT(*) FROM trapper.mv_beacon_clusters WHERE cluster_status = 'in_progress') as clusters_in_progress,
    (SELECT COUNT(*) FROM trapper.mv_beacon_clusters WHERE cluster_status = 'needs_work') as clusters_needs_work,
    (SELECT COUNT(*) FROM trapper.mv_beacon_clusters WHERE cluster_status = 'needs_attention') as clusters_needs_attention,

    -- Average cluster size
    (SELECT ROUND(AVG(place_count), 1) FROM trapper.mv_beacon_clusters) as avg_places_per_cluster,
    (SELECT ROUND(AVG(total_verified_cats), 1) FROM trapper.mv_beacon_clusters) as avg_cats_per_cluster,

    -- Overall alteration rate across clusters
    ROUND(100.0 *
        (SELECT SUM(total_altered_cats) FROM trapper.mv_beacon_clusters) /
        NULLIF((SELECT SUM(total_verified_cats) FROM trapper.mv_beacon_clusters), 0), 1
    ) as overall_cluster_alteration_rate,

    -- Timestamp
    NOW() as calculated_at;

COMMENT ON VIEW trapper.v_beacon_cluster_summary IS
'Dashboard KPIs for Beacon cluster overview.
Shows aggregated TNR progress across all colony clusters.';

\echo 'Created v_beacon_cluster_summary view'

-- ============================================================================
-- Step 5: Test the clustering
-- ============================================================================

\echo ''
\echo '=== Testing Clustering ==='

\echo 'Cluster summary:'
SELECT * FROM trapper.v_beacon_cluster_summary;

\echo ''
\echo 'Top 10 clusters by cat count:'
SELECT
    cluster_id,
    place_count,
    total_verified_cats,
    total_altered_cats,
    avg_alteration_rate,
    cluster_status,
    ROUND(centroid_lat::numeric, 4) as lat,
    ROUND(centroid_lng::numeric, 4) as lng
FROM trapper.mv_beacon_clusters
ORDER BY total_verified_cats DESC
LIMIT 10;

\echo ''
\echo 'Isolated places (top 10):'
SELECT
    place_id,
    formatted_address,
    verified_cat_count,
    verified_altered_count,
    colony_status
FROM trapper.v_beacon_isolated_places
ORDER BY verified_cat_count DESC
LIMIT 10;

\echo ''
\echo '=== MIG_341 Complete ==='
\echo 'DBSCAN colony clustering created with scientific audit trails.'
\echo ''
\echo 'Query examples:'
\echo '  SELECT * FROM trapper.v_beacon_cluster_summary;'
\echo '  SELECT * FROM trapper.beacon_cluster_colonies(300, 3);  -- Larger radius'
\echo '  SELECT * FROM trapper.mv_beacon_clusters WHERE cluster_status = ''needs_attention'';'
\echo '  SELECT trapper.refresh_beacon_clusters();  -- Refresh cache'
\echo ''

