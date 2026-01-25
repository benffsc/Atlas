-- MIG_564__cluster_colony_estimates.sql
-- Add cluster-level colony estimate aggregation
--
-- Purpose:
--   Aggregate colony estimates at the cluster/site level for better
--   population modeling when colonies span multiple places.
--
-- Key Concepts:
--   - A "cluster" is a group of nearby places (DBSCAN, 200m radius)
--   - Cats may be seen at multiple places in a cluster (shared cats)
--   - Cluster-level estimates account for this overlap
--   - Parent-child place relationships (apartment → units) are also handled
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_564__cluster_colony_estimates.sql

\echo ''
\echo '=============================================='
\echo 'MIG_564: Cluster Colony Estimates'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. View for cluster-level colony estimates
-- ============================================================

\echo 'Creating v_cluster_colony_estimates view...'

CREATE OR REPLACE VIEW trapper.v_cluster_colony_estimates AS
WITH cluster_places AS (
    -- Get cluster assignments for each place
    SELECT
        c.cluster_id,
        unnest(c.place_ids) AS place_id
    FROM trapper.mv_beacon_clusters c
),

-- Aggregate verified cats at cluster level (deduplicated by cat_id)
cluster_verified AS (
    SELECT
        cp.cluster_id,
        COUNT(DISTINCT cpr.cat_id) AS unique_verified_cats,
        COUNT(DISTINCT cpr.cat_id) FILTER (
            WHERE EXISTS (
                SELECT 1 FROM trapper.cat_procedures proc
                WHERE proc.cat_id = cpr.cat_id
                  AND (proc.is_spay OR proc.is_neuter)
            )
        ) AS unique_altered_cats,
        -- Cats seen at multiple places in cluster (shared)
        COUNT(DISTINCT cpr.cat_id) FILTER (
            WHERE (
                SELECT COUNT(DISTINCT cpr2.place_id)
                FROM trapper.cat_place_relationships cpr2
                JOIN cluster_places cp2 ON cp2.place_id = cpr2.place_id
                WHERE cp2.cluster_id = cp.cluster_id
                  AND cpr2.cat_id = cpr.cat_id
            ) > 1
        ) AS shared_cats_count
    FROM cluster_places cp
    JOIN trapper.cat_place_relationships cpr ON cpr.place_id = cp.place_id
    JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL
    GROUP BY cp.cluster_id
),

-- Aggregate colony estimates at cluster level
cluster_estimates AS (
    SELECT
        cp.cluster_id,
        -- Sum of place estimates (may overcount due to overlap)
        SUM(pcs.colony_size_estimate) AS sum_place_estimates,
        -- Best estimate considering overlap (use max single place + partial others)
        MAX(pcs.colony_size_estimate) +
            COALESCE(SUM(pcs.colony_size_estimate) FILTER (
                WHERE pcs.colony_size_estimate < MAX(pcs.colony_size_estimate) OVER (PARTITION BY cp.cluster_id)
            ), 0) * 0.5 AS adjusted_cluster_estimate,
        -- Work remaining
        SUM(pcs.estimated_work_remaining) AS sum_work_remaining,
        -- Override info
        bool_or(pcs.has_override) AS has_any_override,
        -- Estimation methods used
        array_agg(DISTINCT pcs.estimation_method) AS estimation_methods
    FROM cluster_places cp
    JOIN trapper.v_place_colony_status pcs ON pcs.place_id = cp.place_id
    GROUP BY cp.cluster_id
),

-- Mark-resight data aggregated at cluster level
cluster_mark_resight AS (
    SELECT
        cp.cluster_id,
        -- Most recent observations across cluster
        SUM(pce.total_cats_observed) AS total_cats_observed,
        SUM(pce.eartip_count_observed) AS total_eartips_observed,
        COUNT(*) AS observation_count,
        MAX(pce.observation_date) AS latest_observation
    FROM cluster_places cp
    JOIN trapper.place_colony_estimates pce ON pce.place_id = cp.place_id
    WHERE pce.total_cats_observed IS NOT NULL
      AND pce.observation_date >= CURRENT_DATE - INTERVAL '90 days'
    GROUP BY cp.cluster_id
)

SELECT
    c.cluster_id,
    c.place_ids,
    c.place_count,
    c.centroid_lat,
    c.centroid_lng,
    c.cluster_status AS beacon_status,

    -- Verified ground truth (deduplicated across cluster)
    COALESCE(cv.unique_verified_cats, 0) AS cluster_verified_cats,
    COALESCE(cv.unique_altered_cats, 0) AS cluster_altered_cats,
    COALESCE(cv.shared_cats_count, 0) AS shared_cats_count,

    -- Estimates (with overlap adjustment)
    COALESCE(ce.sum_place_estimates, 0) AS sum_place_estimates,
    ROUND(COALESCE(ce.adjusted_cluster_estimate, 0))::INTEGER AS adjusted_cluster_estimate,

    -- Best cluster estimate: GREATEST of verified or adjusted estimate
    GREATEST(
        COALESCE(cv.unique_altered_cats, 0),
        ROUND(COALESCE(ce.adjusted_cluster_estimate, 0))::INTEGER
    ) AS cluster_colony_size,

    -- Work remaining at cluster level
    GREATEST(0,
        GREATEST(
            COALESCE(cv.unique_altered_cats, 0),
            ROUND(COALESCE(ce.adjusted_cluster_estimate, 0))::INTEGER
        ) - COALESCE(cv.unique_altered_cats, 0)
    ) AS cluster_work_remaining,

    -- Cluster alteration rate (capped at 100%)
    CASE
        WHEN GREATEST(COALESCE(cv.unique_altered_cats, 0), ROUND(COALESCE(ce.adjusted_cluster_estimate, 1))::INTEGER) > 0
        THEN LEAST(100.0, ROUND(
            100.0 * COALESCE(cv.unique_altered_cats, 0) /
            GREATEST(COALESCE(cv.unique_altered_cats, 0), ROUND(COALESCE(ce.adjusted_cluster_estimate, 1))::INTEGER),
            1
        ))
        ELSE NULL
    END AS cluster_alteration_rate,

    -- Chapman estimate at cluster level if mark-resight data available
    CASE
        WHEN cmr.total_eartips_observed > 0
         AND cmr.total_cats_observed > 0
         AND cv.unique_altered_cats > 0
        THEN ROUND(
            ((cv.unique_altered_cats + 1) * (cmr.total_cats_observed + 1)::NUMERIC /
             (cmr.total_eartips_observed + 1)) - 1
        )::INTEGER
        ELSE NULL
    END AS cluster_chapman_estimate,

    -- Mark-resight data
    cmr.total_cats_observed,
    cmr.total_eartips_observed,
    cmr.observation_count,
    cmr.latest_observation,

    -- Override and method info
    COALESCE(ce.has_any_override, FALSE) AS has_any_override,
    ce.estimation_methods,

    -- Audit
    jsonb_build_object(
        'place_count', c.place_count,
        'shared_cats', cv.shared_cats_count,
        'overlap_adjustment', 0.5,
        'formula', 'GREATEST(verified_altered, adjusted_estimate)',
        'calculated_at', NOW()
    ) AS cluster_audit

FROM trapper.mv_beacon_clusters c
LEFT JOIN cluster_verified cv ON cv.cluster_id = c.cluster_id
LEFT JOIN cluster_estimates ce ON ce.cluster_id = c.cluster_id
LEFT JOIN cluster_mark_resight cmr ON cmr.cluster_id = c.cluster_id;

COMMENT ON VIEW trapper.v_cluster_colony_estimates IS
'Cluster-level colony estimates aggregating data from multiple places.

Key Features:
- Deduplicates cats seen at multiple places in a cluster
- Adjusts estimates for overlap (places sharing cats)
- Computes Chapman estimate at cluster level when mark-resight data available
- Uses GREATEST pattern to prevent >100% alteration rates

Columns:
- cluster_colony_size: Best estimate for entire cluster
- cluster_work_remaining: Cats still needing alteration in cluster
- cluster_alteration_rate: Percentage altered (capped at 100%)
- shared_cats_count: Cats documented at multiple places in cluster
- cluster_chapman_estimate: Mark-resight estimate if data available';

-- ============================================================
-- 2. View for parent-child place hierarchies
-- ============================================================

\echo ''
\echo 'Creating v_place_hierarchy_estimates view...'

CREATE OR REPLACE VIEW trapper.v_place_hierarchy_estimates AS
WITH place_hierarchy AS (
    -- Get parent-child relationships
    SELECT
        parent.place_id AS parent_place_id,
        parent.display_name AS parent_name,
        parent.formatted_address AS parent_address,
        child.place_id AS child_place_id,
        child.display_name AS child_name
    FROM trapper.places parent
    JOIN trapper.places child ON child.parent_place_id = parent.place_id
    WHERE parent.merged_into_place_id IS NULL
      AND child.merged_into_place_id IS NULL
),

-- Aggregate child place data
parent_aggregates AS (
    SELECT
        ph.parent_place_id,
        COUNT(DISTINCT ph.child_place_id) AS child_count,
        array_agg(ph.child_place_id) AS child_place_ids,
        -- Sum of child estimates
        SUM(pcs.colony_size_estimate) AS sum_child_estimates,
        SUM(pcs.verified_altered_count) AS sum_child_altered,
        SUM(pcs.estimated_work_remaining) AS sum_child_work_remaining
    FROM place_hierarchy ph
    LEFT JOIN trapper.v_place_colony_status pcs ON pcs.place_id = ph.child_place_id
    GROUP BY ph.parent_place_id
),

-- Cats at parent (deduplicated)
parent_cats AS (
    SELECT
        cpr.place_id AS parent_place_id,
        COUNT(DISTINCT cpr.cat_id) AS parent_verified_cats,
        COUNT(DISTINCT cpr.cat_id) FILTER (
            WHERE EXISTS (
                SELECT 1 FROM trapper.cat_procedures proc
                WHERE proc.cat_id = cpr.cat_id
                  AND (proc.is_spay OR proc.is_neuter)
            )
        ) AS parent_altered_cats
    FROM trapper.cat_place_relationships cpr
    JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL
    WHERE EXISTS (
        SELECT 1 FROM trapper.places child
        WHERE child.parent_place_id = cpr.place_id
    )
    GROUP BY cpr.place_id
)

SELECT
    p.place_id,
    p.display_name AS place_name,
    p.formatted_address,
    'parent' AS hierarchy_type,

    -- Child stats
    COALESCE(pa.child_count, 0) AS child_count,
    pa.child_place_ids,

    -- Combined estimates
    GREATEST(
        COALESCE(pc.parent_altered_cats, 0) + COALESCE(pa.sum_child_altered, 0),
        COALESCE(pcs.colony_size_estimate, 0) + COALESCE(pa.sum_child_estimates, 0)
    ) AS total_colony_size,

    COALESCE(pc.parent_altered_cats, 0) + COALESCE(pa.sum_child_altered, 0) AS total_altered,

    GREATEST(0,
        GREATEST(
            COALESCE(pc.parent_altered_cats, 0) + COALESCE(pa.sum_child_altered, 0),
            COALESCE(pcs.colony_size_estimate, 0) + COALESCE(pa.sum_child_estimates, 0)
        ) - (COALESCE(pc.parent_altered_cats, 0) + COALESCE(pa.sum_child_altered, 0))
    ) AS total_work_remaining,

    -- Parent's own stats
    pcs.colony_size_estimate AS parent_estimate,
    COALESCE(pc.parent_verified_cats, 0) AS parent_verified_cats,
    COALESCE(pc.parent_altered_cats, 0) AS parent_altered_cats,

    -- Children's aggregate stats
    COALESCE(pa.sum_child_estimates, 0) AS sum_child_estimates,
    COALESCE(pa.sum_child_altered, 0) AS sum_child_altered,
    COALESCE(pa.sum_child_work_remaining, 0) AS sum_child_work_remaining

FROM trapper.places p
LEFT JOIN trapper.v_place_colony_status pcs ON pcs.place_id = p.place_id
LEFT JOIN parent_aggregates pa ON pa.parent_place_id = p.place_id
LEFT JOIN parent_cats pc ON pc.parent_place_id = p.place_id
WHERE p.merged_into_place_id IS NULL
  AND EXISTS (
      SELECT 1 FROM trapper.places child
      WHERE child.parent_place_id = p.place_id
  );

COMMENT ON VIEW trapper.v_place_hierarchy_estimates IS
'Aggregates colony estimates for parent places that have child units.
Used for apartment complexes, mobile home parks, etc. where the
parent place represents the overall site.';

-- ============================================================
-- 3. Function to get best estimate for a location
-- ============================================================

\echo ''
\echo 'Creating get_location_colony_estimate function...'

CREATE OR REPLACE FUNCTION trapper.get_location_colony_estimate(
    p_place_id UUID
) RETURNS TABLE (
    estimate_type TEXT,
    colony_size INTEGER,
    altered_count INTEGER,
    work_remaining INTEGER,
    alteration_rate NUMERIC,
    estimation_source TEXT,
    details JSONB
) AS $$
BEGIN
    -- Check if place is part of a cluster
    IF EXISTS (
        SELECT 1 FROM trapper.mv_beacon_clusters c
        WHERE p_place_id = ANY(c.place_ids)
    ) THEN
        RETURN QUERY
        SELECT
            'cluster'::TEXT,
            cce.cluster_colony_size,
            cce.cluster_altered_cats,
            cce.cluster_work_remaining,
            cce.cluster_alteration_rate,
            'Cluster-level estimate (DBSCAN)'::TEXT,
            cce.cluster_audit
        FROM trapper.v_cluster_colony_estimates cce
        WHERE p_place_id = ANY(cce.place_ids)
        LIMIT 1;
        RETURN;
    END IF;

    -- Check if place is a parent with children
    IF EXISTS (
        SELECT 1 FROM trapper.v_place_hierarchy_estimates
        WHERE place_id = p_place_id
    ) THEN
        RETURN QUERY
        SELECT
            'hierarchy'::TEXT,
            phe.total_colony_size::INTEGER,
            phe.total_altered::INTEGER,
            phe.total_work_remaining::INTEGER,
            CASE WHEN phe.total_colony_size > 0
                THEN ROUND(100.0 * phe.total_altered / phe.total_colony_size, 1)
                ELSE NULL
            END,
            'Parent + children aggregate'::TEXT,
            jsonb_build_object(
                'child_count', phe.child_count,
                'parent_estimate', phe.parent_estimate,
                'sum_child_estimates', phe.sum_child_estimates
            )
        FROM trapper.v_place_hierarchy_estimates phe
        WHERE phe.place_id = p_place_id;
        RETURN;
    END IF;

    -- Fall back to place-level estimate
    RETURN QUERY
    SELECT
        'place'::TEXT,
        pcs.colony_size_estimate::INTEGER,
        pcs.verified_altered_count::INTEGER,
        pcs.estimated_work_remaining::INTEGER,
        pcs.alteration_rate_pct,
        pcs.estimation_method::TEXT,
        jsonb_build_object(
            'has_override', pcs.has_override,
            'estimate_count', pcs.estimate_count,
            'primary_source', pcs.primary_source
        )
    FROM trapper.v_place_colony_status pcs
    WHERE pcs.place_id = p_place_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.get_location_colony_estimate IS
'Returns the best colony estimate for a location, checking:
1. Cluster membership (aggregates with nearby places)
2. Parent-child hierarchy (aggregates with child units)
3. Falls back to place-level estimate

Use this function to get a single authoritative estimate for any place.';

-- ============================================================
-- 4. Update beacon API view to include cluster estimates
-- ============================================================

\echo ''
\echo 'Creating v_beacon_clusters_with_estimates view...'

CREATE OR REPLACE VIEW trapper.v_beacon_clusters_with_estimates AS
SELECT
    c.cluster_id,
    c.place_ids,
    c.place_count,
    c.centroid_lat,
    c.centroid_lng,
    c.bounding_box_geojson,
    c.cluster_audit AS beacon_audit,

    -- From cluster estimates
    cce.cluster_colony_size,
    cce.cluster_altered_cats,
    cce.cluster_work_remaining,
    cce.cluster_alteration_rate,
    cce.cluster_chapman_estimate,
    cce.shared_cats_count,

    -- Status classification
    CASE
        WHEN cce.cluster_alteration_rate >= 90 THEN 'completed'
        WHEN cce.cluster_alteration_rate >= 75 THEN 'managed'
        WHEN cce.cluster_alteration_rate >= 50 THEN 'in_progress'
        WHEN cce.cluster_alteration_rate >= 25 THEN 'needs_work'
        ELSE 'needs_attention'
    END AS colony_status,

    -- Priority score (higher = more urgent)
    CASE
        WHEN cce.cluster_work_remaining > 20 THEN 5
        WHEN cce.cluster_work_remaining > 10 THEN 4
        WHEN cce.cluster_work_remaining > 5 THEN 3
        WHEN cce.cluster_work_remaining > 0 THEN 2
        ELSE 1
    END AS priority_score,

    cce.cluster_audit AS estimate_audit

FROM trapper.mv_beacon_clusters c
LEFT JOIN trapper.v_cluster_colony_estimates cce ON cce.cluster_id = c.cluster_id;

COMMENT ON VIEW trapper.v_beacon_clusters_with_estimates IS
'Beacon cluster data enriched with colony estimates.
Use for Beacon map visualization with accurate population data.';

-- ============================================================
-- 5. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Cluster colony estimates (top 10 by colony size):'
SELECT
    cluster_id,
    place_count,
    cluster_verified_cats,
    cluster_altered_cats,
    shared_cats_count,
    cluster_colony_size,
    cluster_work_remaining,
    cluster_alteration_rate,
    cluster_chapman_estimate
FROM trapper.v_cluster_colony_estimates
ORDER BY cluster_colony_size DESC NULLS LAST
LIMIT 10;

\echo ''
\echo 'Parent places with hierarchy estimates:'
SELECT
    place_name,
    child_count,
    total_colony_size,
    total_altered,
    total_work_remaining,
    parent_estimate,
    sum_child_estimates
FROM trapper.v_place_hierarchy_estimates
ORDER BY total_colony_size DESC NULLS LAST
LIMIT 10;

\echo ''
\echo 'MIG_564 Complete!'
\echo ''
\echo 'New capabilities:'
\echo '  - v_cluster_colony_estimates: Aggregated estimates at cluster level'
\echo '  - v_place_hierarchy_estimates: Parent-child place aggregation'
\echo '  - get_location_colony_estimate(place_id): Best estimate for any location'
\echo '  - v_beacon_clusters_with_estimates: Beacon API enriched data'
\echo ''
\echo 'Key features:'
\echo '  - Deduplicates cats seen at multiple places in a cluster'
\echo '  - Adjusts estimates for spatial overlap (50% discount for non-primary places)'
\echo '  - Chapman mark-resight at cluster level'
\echo '  - Parent-child place hierarchy support'
\echo ''
