-- MIG_286: Create Site Aggregate Stats View
--
-- Creates v_site_aggregate_stats to de-duplicate cats across linked places.
-- For multi-parcel sites like Tresch Dairy (1054 + 1170 Walker Rd), cats may
-- appear at both addresses but should only be counted once for the site.
--
-- This view:
-- 1. Uses recursive CTE to find all places in a linked cluster
-- 2. Aggregates unique cats across all linked places
-- 3. Calculates site-level alteration stats
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_286__site_aggregate_stats_view.sql

\echo ''
\echo 'MIG_286: Create Site Aggregate Stats View'
\echo '=========================================='
\echo ''

-- Drop existing views if exists
DROP VIEW IF EXISTS trapper.v_site_aggregate_stats;
DROP VIEW IF EXISTS trapper.v_place_site_cluster;

\echo 'Creating v_place_site_cluster view (recursive cluster detection)...'

-- First, create a view to find all places in a cluster
CREATE VIEW trapper.v_place_site_cluster AS
WITH RECURSIVE site_clusters AS (
  -- Base: all places that are linked to other places
  SELECT
    place_id_a as place_id,
    place_id_a as cluster_root,
    ARRAY[place_id_a, place_id_b] as cluster_places,
    1 as depth
  FROM trapper.place_place_edges
  WHERE relationship_type_id IN (
    SELECT id FROM trapper.relationship_types WHERE code = 'same_colony_site'
  )

  UNION

  -- Recursive: follow the edges
  SELECT
    CASE WHEN e.place_id_a = sc.place_id THEN e.place_id_b ELSE e.place_id_a END,
    sc.cluster_root,
    sc.cluster_places || CASE WHEN e.place_id_a = sc.place_id THEN e.place_id_b ELSE e.place_id_a END,
    sc.depth + 1
  FROM site_clusters sc
  JOIN trapper.place_place_edges e ON (
    (e.place_id_a = sc.place_id OR e.place_id_b = sc.place_id)
    AND NOT (CASE WHEN e.place_id_a = sc.place_id THEN e.place_id_b ELSE e.place_id_a END = ANY(sc.cluster_places))
  )
  JOIN trapper.relationship_types rt ON rt.id = e.relationship_type_id
  WHERE rt.code = 'same_colony_site'
    AND sc.depth < 10  -- Prevent infinite loops
),

-- Get the first place_id (sorted) as canonical cluster identifier
cluster_members AS (
  SELECT
    unnest(cluster_places) as place_id,
    (SELECT p FROM unnest(cluster_places) p ORDER BY p LIMIT 1) as cluster_id
  FROM site_clusters
  GROUP BY cluster_places
)

SELECT DISTINCT
  place_id,
  cluster_id
FROM cluster_members;

COMMENT ON VIEW trapper.v_place_site_cluster IS
'Maps each place to its site cluster ID for multi-parcel operations.
Places not in any cluster will not appear in this view.
The cluster_id is the minimum place_id in the cluster (deterministic).';

\echo 'Creating v_site_aggregate_stats view...'

CREATE VIEW trapper.v_site_aggregate_stats AS
WITH cluster_places AS (
  -- Get all places in each cluster
  SELECT
    cluster_id,
    array_agg(place_id) as place_ids,
    COUNT(*) as place_count
  FROM trapper.v_place_site_cluster
  GROUP BY cluster_id
),

cluster_cats AS (
  -- Get unique cats across all places in cluster
  SELECT
    cp.cluster_id,
    COUNT(DISTINCT cpr.cat_id) as unique_cat_count,
    COUNT(DISTINCT CASE WHEN c.altered_status = 'altered' THEN cpr.cat_id END) as altered_cat_count,
    array_agg(DISTINCT cpr.cat_id) as cat_ids
  FROM cluster_places cp
  JOIN trapper.cat_place_relationships cpr ON cpr.place_id = ANY(cp.place_ids)
  JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
  WHERE c.merged_into_cat_id IS NULL
  GROUP BY cp.cluster_id
),

cluster_requests AS (
  -- Get requests across all places in cluster
  SELECT
    cp.cluster_id,
    COUNT(DISTINCT r.request_id) as request_count,
    COUNT(DISTINCT CASE WHEN r.status = 'completed' THEN r.request_id END) as completed_request_count,
    MIN(r.created_at) as first_request_at,
    MAX(r.created_at) as last_request_at
  FROM cluster_places cp
  JOIN trapper.sot_requests r ON r.place_id = ANY(cp.place_ids)
  GROUP BY cp.cluster_id
),

cluster_estimates AS (
  -- Get the best colony estimate for the cluster
  SELECT DISTINCT ON (cp.cluster_id)
    cp.cluster_id,
    pce.total_cats as latest_total_estimate,
    pce.altered_count as latest_altered_estimate,
    pce.unaltered_count as latest_unaltered_estimate,
    pce.source_type as estimate_source,
    pce.observation_date as estimate_date
  FROM cluster_places cp
  JOIN trapper.place_colony_estimates pce ON pce.place_id = ANY(cp.place_ids)
  ORDER BY cp.cluster_id, pce.observation_date DESC NULLS LAST, pce.created_at DESC
),

cluster_details AS (
  -- Get display info for the cluster
  SELECT
    cp.cluster_id,
    array_agg(p.display_name) as place_names,
    array_agg(p.formatted_address) as place_addresses
  FROM cluster_places cp
  JOIN trapper.places p ON p.place_id = ANY(cp.place_ids)
  GROUP BY cp.cluster_id
)

SELECT
  cp.cluster_id,
  cp.place_count,
  cp.place_ids,
  cd.place_names,
  cd.place_addresses,
  COALESCE(cc.unique_cat_count, 0) as unique_cat_count,
  COALESCE(cc.altered_cat_count, 0) as altered_cat_count,
  COALESCE(cc.unique_cat_count, 0) - COALESCE(cc.altered_cat_count, 0) as unaltered_cat_count,
  CASE
    WHEN COALESCE(cc.unique_cat_count, 0) > 0
    THEN ROUND((cc.altered_cat_count::numeric / cc.unique_cat_count) * 100, 1)
    ELSE NULL
  END as alteration_rate_pct,
  COALESCE(cr.request_count, 0) as request_count,
  COALESCE(cr.completed_request_count, 0) as completed_request_count,
  cr.first_request_at,
  cr.last_request_at,
  ce.latest_total_estimate,
  ce.latest_altered_estimate,
  ce.latest_unaltered_estimate,
  ce.estimate_source,
  ce.estimate_date,
  -- Site status assessment
  CASE
    WHEN COALESCE(cc.unique_cat_count, 0) = 0 THEN 'no_cats'
    WHEN cc.altered_cat_count >= cc.unique_cat_count THEN 'complete'
    WHEN cc.altered_cat_count::numeric / NULLIF(cc.unique_cat_count, 0) >= 0.9 THEN 'nearly_complete'
    WHEN cc.altered_cat_count::numeric / NULLIF(cc.unique_cat_count, 0) >= 0.5 THEN 'in_progress'
    ELSE 'early_stage'
  END as site_status
FROM cluster_places cp
LEFT JOIN cluster_cats cc ON cc.cluster_id = cp.cluster_id
LEFT JOIN cluster_requests cr ON cr.cluster_id = cp.cluster_id
LEFT JOIN cluster_estimates ce ON ce.cluster_id = cp.cluster_id
LEFT JOIN cluster_details cd ON cd.cluster_id = cp.cluster_id;

COMMENT ON VIEW trapper.v_site_aggregate_stats IS
'Aggregates stats across linked places (multi-parcel sites).
De-duplicates cats that appear at multiple places in the same site cluster.
Use this for accurate site-level reporting instead of summing individual places.

Example: Tresch Dairy spans 1054 + 1170 Walker Rd. Without this view,
82 unique cats would be counted as 154 (double-counted across both places).';

-- Add a function to get site stats for a specific place
\echo 'Creating get_site_stats_for_place function...'

CREATE OR REPLACE FUNCTION trapper.get_site_stats_for_place(p_place_id uuid)
RETURNS TABLE (
  is_part_of_site boolean,
  cluster_id uuid,
  place_count int,
  place_names text[],
  unique_cat_count int,
  altered_cat_count int,
  alteration_rate_pct numeric,
  site_status text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    TRUE as is_part_of_site,
    s.cluster_id,
    s.place_count::int,
    s.place_names,
    s.unique_cat_count::int,
    s.altered_cat_count::int,
    s.alteration_rate_pct,
    s.site_status
  FROM trapper.v_place_site_cluster c
  JOIN trapper.v_site_aggregate_stats s ON s.cluster_id = c.cluster_id
  WHERE c.place_id = p_place_id

  UNION ALL

  -- Return place-level stats if not part of a site
  SELECT
    FALSE as is_part_of_site,
    p_place_id as cluster_id,
    1 as place_count,
    ARRAY[p.display_name] as place_names,
    COALESCE((SELECT COUNT(DISTINCT cat_id) FROM trapper.cat_place_relationships WHERE place_id = p_place_id), 0)::int as unique_cat_count,
    COALESCE((SELECT COUNT(DISTINCT cpr.cat_id) FROM trapper.cat_place_relationships cpr JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id WHERE cpr.place_id = p_place_id AND c.altered_status = 'altered'), 0)::int as altered_cat_count,
    NULL as alteration_rate_pct,
    'single_place' as site_status
  FROM trapper.places p
  WHERE p.place_id = p_place_id
    AND NOT EXISTS (SELECT 1 FROM trapper.v_place_site_cluster WHERE place_id = p_place_id)
  LIMIT 1;
$$;

COMMENT ON FUNCTION trapper.get_site_stats_for_place IS
'Returns site-level aggregate stats for a place, or place-level stats if not part of a site cluster.
Use in API/UI to show de-duplicated cat counts for multi-parcel sites.';

-- Show sample results
\echo ''
\echo 'Sample site clusters:'
SELECT
  cluster_id,
  place_count,
  place_names[1:2] as first_two_places,
  unique_cat_count,
  altered_cat_count,
  alteration_rate_pct,
  site_status
FROM trapper.v_site_aggregate_stats
ORDER BY unique_cat_count DESC NULLS LAST
LIMIT 10;

\echo ''
\echo 'MIG_286 Complete!'
\echo '================='
\echo ''
