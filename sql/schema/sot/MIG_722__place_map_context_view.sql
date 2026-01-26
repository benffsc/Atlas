\echo '=== MIG_722: Place Map Context View ==='

-- View for place-centric map display with attached Google Maps context
-- Supports the layered map visualization where Google Maps pins can be
-- "absorbed" into nearby SOT places while preserving original data

-- First, link Google Maps entries to nearest places within 100m
-- This populates linked_place_id for entries that should be attached
CREATE OR REPLACE FUNCTION trapper.link_google_maps_to_places(
  p_max_distance_m NUMERIC DEFAULT 100
)
RETURNS TABLE(linked INTEGER, already_linked INTEGER, too_far INTEGER) AS $$
DECLARE
  v_linked INTEGER := 0;
  v_already INTEGER := 0;
  v_too_far INTEGER := 0;
BEGIN
  -- Update entries that don't have a linked_place_id yet
  WITH nearest AS (
    SELECT
      g.entry_id,
      p.place_id,
      ST_Distance(
        ST_SetSRID(ST_MakePoint(g.lng, g.lat), 4326)::geography,
        p.location
      ) as distance_m
    FROM trapper.google_map_entries g
    CROSS JOIN LATERAL (
      SELECT place_id, location
      FROM trapper.places
      WHERE location IS NOT NULL
        AND merged_into_place_id IS NULL
      ORDER BY location <-> ST_SetSRID(ST_MakePoint(g.lng, g.lat), 4326)::geography
      LIMIT 1
    ) p
    WHERE g.linked_place_id IS NULL
      AND g.lat IS NOT NULL
      AND g.lng IS NOT NULL
  )
  UPDATE trapper.google_map_entries g
  SET
    linked_place_id = n.place_id,
    link_distance_m = n.distance_m,
    link_method = 'proximity_' || p_max_distance_m || 'm'
  FROM nearest n
  WHERE g.entry_id = n.entry_id
    AND n.distance_m <= p_max_distance_m;

  GET DIAGNOSTICS v_linked = ROW_COUNT;

  -- Count already linked
  SELECT COUNT(*) INTO v_already
  FROM trapper.google_map_entries
  WHERE linked_place_id IS NOT NULL;

  -- Count too far (unlinked with coordinates)
  SELECT COUNT(*) INTO v_too_far
  FROM trapper.google_map_entries
  WHERE linked_place_id IS NULL
    AND lat IS NOT NULL;

  RETURN QUERY SELECT v_linked, v_already - v_linked, v_too_far;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_google_maps_to_places IS
'Links Google Maps entries to nearest SOT place within specified distance.
Run periodically or after new imports. Default 100m radius.';


-- Add link_distance_m column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper'
    AND table_name = 'google_map_entries'
    AND column_name = 'link_distance_m'
  ) THEN
    ALTER TABLE trapper.google_map_entries ADD COLUMN link_distance_m NUMERIC;
  END IF;
END $$;


-- Main view: Place with all attached Google Maps context
CREATE OR REPLACE VIEW trapper.v_place_map_context AS
SELECT
  p.place_id,
  p.display_name,
  p.formatted_address,
  ST_Y(p.location::geometry) as lat,
  ST_X(p.location::geometry) as lng,

  -- SOT data summary
  COALESCE(pce.total_cats, 0) as colony_size,
  COALESCE(pce.altered_count, 0) as altered_count,

  -- Active request info
  r.request_id as active_request_id,
  r.status as request_status,

  -- Attached Google Maps entries (as JSON array)
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'entry_id', g.entry_id,
          'classification', g.ai_classification->>'primary_meaning',
          'confidence', g.ai_classification->>'confidence',
          'original_text', LEFT(g.original_content, 500),
          'kml_name', g.kml_name,
          'original_lat', g.lat,
          'original_lng', g.lng,
          'distance_m', ROUND(g.link_distance_m::numeric, 1),
          'parsed_date', g.parsed_date,
          'icon_type', g.icon_type,
          'icon_color', g.icon_color
        ) ORDER BY g.parsed_date DESC NULLS LAST
      )
      FROM trapper.google_map_entries g
      WHERE g.linked_place_id = p.place_id
    ),
    '[]'::jsonb
  ) as attached_context,

  -- Count of attached entries by type
  (
    SELECT COUNT(*)
    FROM trapper.google_map_entries g
    WHERE g.linked_place_id = p.place_id
  ) as attached_count,

  -- AI-extracted attributes for this place
  COALESCE(
    (
      SELECT jsonb_object_agg(attribute_key, attribute_value)
      FROM trapper.entity_attributes ea
      WHERE ea.entity_type = 'place'
        AND ea.entity_id = p.place_id
        AND ea.superseded_at IS NULL
    ),
    '{}'::jsonb
  ) as ai_attributes

FROM trapper.places p

-- Latest colony estimate
LEFT JOIN LATERAL (
  SELECT total_cats, altered_count
  FROM trapper.place_colony_estimates
  WHERE place_id = p.place_id
  ORDER BY observation_date DESC
  LIMIT 1
) pce ON true

-- Active request
LEFT JOIN LATERAL (
  SELECT request_id, status
  FROM trapper.sot_requests
  WHERE place_id = p.place_id
    AND status NOT IN ('completed', 'cancelled')
  ORDER BY created_at DESC
  LIMIT 1
) r ON true

WHERE p.merged_into_place_id IS NULL
  AND p.location IS NOT NULL;

COMMENT ON VIEW trapper.v_place_map_context IS
'Place-centric view for map display. Includes attached Google Maps context,
colony estimates, active requests, and AI-extracted attributes.
Use for the main Beacon/Atlas map layer.';


-- View for unattached Google Maps entries (separate layer)
CREATE OR REPLACE VIEW trapper.v_google_maps_unattached AS
SELECT
  g.entry_id,
  g.kml_name,
  g.lat,
  g.lng,
  g.ai_classification->>'primary_meaning' as classification,
  g.ai_classification->>'confidence' as confidence,
  LEFT(g.original_content, 300) as content_preview,
  g.parsed_date,
  g.icon_type,
  g.icon_color,
  g.nearest_place_id,
  g.nearest_place_distance_m
FROM trapper.google_map_entries g
WHERE g.linked_place_id IS NULL
  AND g.lat IS NOT NULL
  AND g.lng IS NOT NULL;

COMMENT ON VIEW trapper.v_google_maps_unattached IS
'Google Maps entries not attached to any SOT place.
Display as separate layer on map with option to show/hide.';


-- Summary stats for map layer controls
CREATE OR REPLACE VIEW trapper.v_map_layer_stats AS
SELECT
  'places' as layer,
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM trapper.sot_requests r
    WHERE r.place_id = p.place_id
    AND r.status NOT IN ('completed', 'cancelled')
  )) as with_active_requests
FROM trapper.places p
WHERE p.merged_into_place_id IS NULL AND p.location IS NOT NULL

UNION ALL

SELECT
  'google_maps_' || COALESCE(ai_classification->>'primary_meaning', 'unclassified'),
  COUNT(*),
  0
FROM trapper.google_map_entries
WHERE lat IS NOT NULL
GROUP BY ai_classification->>'primary_meaning'

UNION ALL

SELECT
  'google_maps_attached',
  COUNT(*),
  0
FROM trapper.google_map_entries
WHERE linked_place_id IS NOT NULL

UNION ALL

SELECT
  'google_maps_unattached',
  COUNT(*),
  0
FROM trapper.google_map_entries
WHERE linked_place_id IS NULL AND lat IS NOT NULL;

COMMENT ON VIEW trapper.v_map_layer_stats IS
'Statistics for map layer controls. Shows counts by layer type.';


\echo 'Created v_place_map_context, v_google_maps_unattached, v_map_layer_stats'
\echo 'Run: SELECT * FROM trapper.link_google_maps_to_places(100) to link entries'
