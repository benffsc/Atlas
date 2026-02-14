-- MIG_285: Create Suggested Site Links View
--
-- Creates v_suggested_place_links view to help staff identify places that should be linked.
--
-- Heuristics for suggesting links:
-- 1. Same requester at multiple nearby addresses
-- 2. Same street name + close house numbers + both have cat activity
-- 3. Places that share cats (same cat linked to both places)
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_285__suggested_place_links_view.sql

\echo ''
\echo 'MIG_285: Create Suggested Site Links View'
\echo '=========================================='
\echo ''

-- Drop existing view if exists
DROP VIEW IF EXISTS trapper.v_suggested_place_links;

\echo 'Creating v_suggested_place_links view...'

CREATE VIEW trapper.v_suggested_place_links AS
WITH
-- 1. Places sharing the same requester
same_requester_places AS (
  SELECT
    r1.place_id as place_a,
    r2.place_id as place_b,
    r1.requester_person_id as shared_requester_id,
    p.display_name as requester_name,
    'same_requester' as match_type,
    0.8 as confidence_score
  FROM trapper.sot_requests r1
  JOIN trapper.sot_requests r2
    ON r1.requester_person_id = r2.requester_person_id
    AND r1.place_id < r2.place_id  -- Avoid duplicates, ensure unique pairs
    AND r1.place_id IS NOT NULL
    AND r2.place_id IS NOT NULL
  JOIN trapper.sot_people p ON p.person_id = r1.requester_person_id
  WHERE r1.requester_person_id IS NOT NULL
),

-- 2. Places sharing cats (same cat linked to both)
shared_cats_places AS (
  SELECT
    c1.place_id as place_a,
    c2.place_id as place_b,
    COUNT(DISTINCT c1.cat_id) as shared_cat_count,
    'shared_cats' as match_type,
    LEAST(0.95, 0.7 + (COUNT(DISTINCT c1.cat_id) * 0.05)) as confidence_score
  FROM trapper.cat_place_relationships c1
  JOIN trapper.cat_place_relationships c2
    ON c1.cat_id = c2.cat_id
    AND c1.place_id < c2.place_id  -- Unique pairs
  GROUP BY c1.place_id, c2.place_id
  HAVING COUNT(DISTINCT c1.cat_id) >= 2  -- At least 2 shared cats
),

-- 3. Places with close coordinates (within ~150 meters)
coordinate_proximity AS (
  SELECT
    p1.place_id as place_a,
    p2.place_id as place_b,
    ST_Distance(
      p1.location::geography,
      p2.location::geography
    ) as distance_meters,
    'coordinate_proximity' as match_type,
    CASE
      WHEN ST_Distance(p1.location::geography, p2.location::geography) <= 50 THEN 0.9
      WHEN ST_Distance(p1.location::geography, p2.location::geography) <= 100 THEN 0.75
      ELSE 0.6
    END as confidence_score
  FROM trapper.places p1
  JOIN trapper.places p2
    ON p1.place_id < p2.place_id
    AND ST_DWithin(p1.location::geography, p2.location::geography, 150)
    AND p1.location IS NOT NULL
    AND p2.location IS NOT NULL
  WHERE p1.merged_into_place_id IS NULL
    AND p2.merged_into_place_id IS NULL
    AND p1.formatted_address != p2.formatted_address  -- Different addresses
    AND (p1.has_cat_activity OR p2.has_cat_activity)  -- At least one has cat activity
),

-- Combine all suggestions
all_suggestions AS (
  SELECT place_a, place_b, match_type, confidence_score::numeric FROM same_requester_places
  UNION ALL
  SELECT place_a, place_b, match_type, confidence_score FROM shared_cats_places
  UNION ALL
  SELECT place_a, place_b, match_type, confidence_score FROM coordinate_proximity
),

-- Aggregate by place pair, combining match types and scores
aggregated AS (
  SELECT
    place_a,
    place_b,
    array_agg(DISTINCT match_type) as match_types,
    MAX(confidence_score) as best_confidence,
    COUNT(DISTINCT match_type) as match_type_count
  FROM all_suggestions
  GROUP BY place_a, place_b
)

SELECT
  a.place_a,
  a.place_b,
  pa.display_name as place_a_name,
  pa.formatted_address as place_a_address,
  pb.display_name as place_b_name,
  pb.formatted_address as place_b_address,
  a.match_types,
  a.match_type_count,
  -- Boost confidence when multiple match types agree
  LEAST(0.99, a.best_confidence + (a.match_type_count - 1) * 0.1) as combined_confidence,
  CASE
    WHEN LEAST(0.99, a.best_confidence + (a.match_type_count - 1) * 0.1) >= 0.8 THEN 'high'
    WHEN LEAST(0.99, a.best_confidence + (a.match_type_count - 1) * 0.1) >= 0.6 THEN 'medium'
    ELSE 'low'
  END as confidence_level,
  CASE
    WHEN 'shared_cats' = ANY(a.match_types) THEN 'same_colony_site'
    WHEN 'same_requester' = ANY(a.match_types) AND 'coordinate_proximity' = ANY(a.match_types) THEN 'same_colony_site'
    WHEN 'coordinate_proximity' = ANY(a.match_types) THEN 'adjacent_to'
    ELSE 'nearby_cluster'
  END as suggested_relationship
FROM aggregated a
JOIN trapper.places pa ON pa.place_id = a.place_a
JOIN trapper.places pb ON pb.place_id = a.place_b
WHERE pa.merged_into_place_id IS NULL
  AND pb.merged_into_place_id IS NULL
  -- Exclude already linked places
  AND NOT EXISTS (
    SELECT 1 FROM trapper.place_place_edges ppe
    WHERE (ppe.place_id_a = a.place_a AND ppe.place_id_b = a.place_b)
       OR (ppe.place_id_a = a.place_b AND ppe.place_id_b = a.place_a)
  )
ORDER BY combined_confidence DESC, match_type_count DESC;

COMMENT ON VIEW trapper.v_suggested_place_links IS
'Suggests place pairs that may be related based on:
- Same requester at multiple addresses
- Shared cats between places
- Coordinate proximity (within 150m)

Use this view to identify multi-parcel sites like dairies, ranches, or apartment complexes
that should be linked with same_colony_site or adjacent_to relationships.';

-- Show sample results
\echo ''
\echo 'Sample suggested links (top 20 by confidence):'
SELECT
  place_a_name,
  place_b_name,
  match_types,
  confidence_level,
  suggested_relationship
FROM trapper.v_suggested_place_links
LIMIT 20;

-- Summary stats
\echo ''
\echo 'Summary statistics:'
SELECT
  confidence_level,
  suggested_relationship,
  COUNT(*) as suggestion_count
FROM trapper.v_suggested_place_links
GROUP BY confidence_level, suggested_relationship
ORDER BY confidence_level, suggested_relationship;

\echo ''
\echo 'MIG_285 Complete!'
\echo '================='
\echo ''
