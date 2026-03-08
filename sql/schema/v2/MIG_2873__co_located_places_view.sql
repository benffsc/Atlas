-- MIG_2873: Co-located places analysis view
-- FFS-241: Identify groups of places at identical coordinates
-- Helps differentiate multi-unit addresses from true duplicates
--
-- Classifications:
--   multi_unit     — At least one place has requires_unit_selection = TRUE
--   exact_duplicate — All places share the same formatted_address
--   review_needed  — Different addresses at same coordinates

CREATE OR REPLACE VIEW sot.v_co_located_place_groups AS
SELECT
  ST_X(p.location::geometry) AS lng,
  ST_Y(p.location::geometry) AS lat,
  COUNT(*) AS place_count,
  array_agg(p.place_id ORDER BY p.created_at) AS place_ids,
  array_agg(p.formatted_address ORDER BY p.created_at) AS addresses,
  array_agg(p.display_name ORDER BY p.created_at) AS display_names,
  array_agg(p.place_kind ORDER BY p.created_at) AS place_kinds,
  bool_or(p.requires_unit_selection) AS has_multi_unit,
  CASE
    WHEN bool_or(p.requires_unit_selection) THEN 'multi_unit'
    WHEN COUNT(DISTINCT p.formatted_address) = 1 THEN 'exact_duplicate'
    ELSE 'review_needed'
  END AS group_classification
FROM sot.places p
WHERE p.merged_into_place_id IS NULL
  AND p.location IS NOT NULL
GROUP BY ST_X(p.location::geometry), ST_Y(p.location::geometry)
HAVING COUNT(*) > 1;

COMMENT ON VIEW sot.v_co_located_place_groups IS
  'Groups of places at identical coordinates for dedup/multi-unit analysis (MIG_2873, FFS-241)';
