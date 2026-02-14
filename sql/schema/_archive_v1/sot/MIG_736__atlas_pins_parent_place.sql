\echo '=== MIG_736: Add Parent Place Info to Atlas Pins View ==='
\echo 'Adds parent_place_id and place_kind for multi-unit clustering on map'
\echo ''

-- ============================================================================
-- This migration adds parent_place_id and place_kind to v_map_atlas_pins
-- to enable:
-- 1. Clustering apartment units into parent building when zoomed out
-- 2. Place type-aware display and filtering
-- ============================================================================

\echo 'Updating v_map_atlas_pins view...'

CREATE OR REPLACE VIEW trapper.v_map_atlas_pins AS
SELECT
  p.place_id as id,
  p.formatted_address as address,
  p.display_name,
  ST_Y(p.location::geometry) as lat,
  ST_X(p.location::geometry) as lng,
  p.service_zone,

  -- NEW: Parent place for clustering
  p.parent_place_id,
  p.place_kind,
  p.unit_identifier,

  -- Cat counts
  COALESCE(cc.cat_count, 0) as cat_count,

  -- People linked
  COALESCE(ppl.person_names, '[]'::JSONB) as people,
  COALESCE(ppl.person_count, 0) as person_count,

  -- Disease risk (manual flag takes precedence, then check explicitly linked Google entries)
  COALESCE(
    p.disease_risk,
    gme.has_disease_risk,
    FALSE
  ) as disease_risk,
  p.disease_risk_notes,

  -- Watch list status from explicitly linked Google entries
  COALESCE(gme.has_watch_list, FALSE) as watch_list,

  -- Google Maps history - ONLY explicitly linked entries
  COALESCE(gme.entry_count, 0) as google_entry_count,
  COALESCE(gme.ai_summaries, '[]'::JSONB) as google_summaries,

  -- Request counts
  COALESCE(req.request_count, 0) as request_count,
  COALESCE(req.active_request_count, 0) as active_request_count,

  -- TNR stats from pre-aggregated view
  COALESCE(tnr.total_altered, 0) as total_altered,
  tnr.last_alteration_at,

  -- Pin style determination for frontend
  CASE
    WHEN COALESCE(p.disease_risk, gme.has_disease_risk, FALSE) THEN 'disease'
    WHEN COALESCE(gme.has_watch_list, FALSE) THEN 'watch_list'
    WHEN COALESCE(cc.cat_count, 0) > 0 OR COALESCE(req.request_count, 0) > 0 THEN 'active'
    WHEN COALESCE(gme.entry_count, 0) > 0 THEN 'has_history'
    ELSE 'minimal'
  END as pin_style,

  -- Metadata
  p.created_at,
  p.last_activity_at

FROM trapper.places p

-- Cat counts from cat_place_relationships
LEFT JOIN (
  SELECT place_id, COUNT(DISTINCT cat_id) as cat_count
  FROM trapper.cat_place_relationships
  GROUP BY place_id
) cc ON cc.place_id = p.place_id

-- People linked via person_place_relationships
LEFT JOIN (
  SELECT
    ppr.place_id,
    COUNT(DISTINCT per.person_id) as person_count,
    JSONB_AGG(DISTINCT per.display_name) FILTER (WHERE per.display_name IS NOT NULL) as person_names
  FROM trapper.person_place_relationships ppr
  JOIN trapper.sot_people per ON per.person_id = ppr.person_id
  WHERE per.merged_into_person_id IS NULL
  GROUP BY ppr.place_id
) ppl ON ppl.place_id = p.place_id

-- Google Maps entries: ONLY explicitly linked (place_id or linked_place_id set)
LEFT JOIN (
  SELECT
    COALESCE(place_id, linked_place_id) as place_id,
    COUNT(*) as entry_count,
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'summary', COALESCE(ai_summary, SUBSTRING(original_content FROM 1 FOR 200)),
        'meaning', ai_meaning,
        'date', parsed_date::text
      )
      ORDER BY imported_at DESC
    ) FILTER (WHERE ai_summary IS NOT NULL OR original_content IS NOT NULL) as ai_summaries,
    BOOL_OR(ai_meaning IN ('disease_risk', 'felv_colony', 'fiv_colony')) as has_disease_risk,
    BOOL_OR(ai_meaning = 'watch_list') as has_watch_list
  FROM trapper.google_map_entries
  WHERE place_id IS NOT NULL OR linked_place_id IS NOT NULL
  GROUP BY COALESCE(place_id, linked_place_id)
) gme ON gme.place_id = p.place_id

-- Request counts
LEFT JOIN (
  SELECT
    place_id,
    COUNT(*) as request_count,
    COUNT(*) FILTER (WHERE status IN ('new', 'triaged', 'scheduled', 'in_progress')) as active_request_count
  FROM trapper.sot_requests
  WHERE place_id IS NOT NULL
  GROUP BY place_id
) req ON req.place_id = p.place_id

-- TNR stats from place alteration history
LEFT JOIN (
  SELECT
    place_id,
    total_cats_altered as total_altered,
    latest_request_date as last_alteration_at
  FROM trapper.v_place_alteration_history
) tnr ON tnr.place_id = p.place_id

WHERE p.merged_into_place_id IS NULL
  AND p.location IS NOT NULL;

COMMENT ON VIEW trapper.v_map_atlas_pins IS
'Consolidated Atlas pins for map display. Includes:
- Place info (address, coordinates, service zone)
- Parent place info for clustering (parent_place_id, place_kind, unit_identifier)
- Cat counts from cat_place_relationships
- People from person_place_relationships
- Disease/watch list status from places and linked Google entries
- Google Maps history (explicitly linked only)
- Request counts
- TNR statistics

Use parent_place_id and place_kind for zoom-based clustering of multi-unit places.';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=================================================='
\echo 'MIG_736 Complete!'
\echo '=================================================='
\echo ''
\echo 'Added to v_map_atlas_pins:'
\echo '  - parent_place_id (for clustering units into parent building)'
\echo '  - place_kind (for place type filtering)'
\echo '  - unit_identifier (for unit display)'
\echo ''
\echo 'Frontend can now:'
\echo '  - Group places by parent_place_id when zoomed out'
\echo '  - Filter by place_kind (apartment_building, single_family, etc.)'
\echo ''
