\echo '=== MIG_729: Map Consolidation - Explicit Linking Only ==='
\echo 'Only consolidate explicitly linked entries, not proximity-based'
\echo ''

-- ============================================================================
-- PROBLEM:
-- MIG_728 consolidated entries within 100m of places, but this caused
-- entries at neighboring addresses to be incorrectly merged.
--
-- SOLUTION:
-- Only consolidate entries that are EXPLICITLY linked via place_id or
-- linked_place_id. Unlinked entries (even if nearby) show as separate dots.
-- ============================================================================

-- ============================================================================
-- PART 1: Update v_map_atlas_pins - only explicit links
-- ============================================================================

\echo 'Updating v_map_atlas_pins to use explicit linking only...'

CREATE OR REPLACE VIEW trapper.v_map_atlas_pins AS
SELECT
  p.place_id as id,
  p.formatted_address as address,
  p.display_name,
  ST_Y(p.location::geometry) as lat,
  ST_X(p.location::geometry) as lng,
  p.service_zone,

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
        'summary', COALESCE(ai_summary, original_content),
        'meaning', ai_meaning,
        'date', parsed_date,
        'name', kml_name
      )
      ORDER BY COALESCE(parsed_date, imported_at) DESC
    ) FILTER (WHERE COALESCE(ai_summary, original_content) IS NOT NULL) as ai_summaries,
    BOOL_OR(ai_meaning IN ('disease_risk', 'felv_colony', 'fiv_colony')) as has_disease_risk,
    BOOL_OR(ai_meaning = 'watch_list') as has_watch_list
  FROM trapper.google_map_entries
  WHERE place_id IS NOT NULL OR linked_place_id IS NOT NULL  -- Explicit links only
  GROUP BY COALESCE(place_id, linked_place_id)
) gme ON gme.place_id = p.place_id

-- Request counts
LEFT JOIN (
  SELECT
    place_id,
    COUNT(*) as request_count,
    COUNT(*) FILTER (WHERE status NOT IN ('completed', 'cancelled')) as active_request_count
  FROM trapper.sot_requests
  WHERE place_id IS NOT NULL
  GROUP BY place_id
) req ON req.place_id = p.place_id

-- TNR stats from pre-aggregated view
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
'Consolidated view for Beacon map Atlas pins - combines places with people, cats, requests, and EXPLICITLY linked Google Maps history only';

-- ============================================================================
-- PART 2: Update v_map_historical_pins - show all unlinked entries
-- ============================================================================

\echo 'Updating v_map_historical_pins to show all unlinked entries...'

CREATE OR REPLACE VIEW trapper.v_map_historical_pins AS
SELECT
  entry_id as id,
  kml_name as name,
  lat,
  lng,
  original_content as notes,
  ai_summary,
  ai_meaning,
  ai_classification,
  parsed_date,
  -- Disease risk from AI classification
  ai_meaning IN ('disease_risk', 'felv_colony', 'fiv_colony') as disease_risk,
  -- Watch list from AI classification
  ai_meaning = 'watch_list' as watch_list,
  icon_type,
  icon_color,
  imported_at,
  -- Include distance to nearest place for context
  nearest_place_id,
  nearest_place_distance_m
FROM trapper.google_map_entries
WHERE
  -- Not explicitly linked (show as separate historical context)
  place_id IS NULL
  AND linked_place_id IS NULL
  -- Has valid coordinates
  AND lat IS NOT NULL
  AND lng IS NOT NULL;

COMMENT ON VIEW trapper.v_map_historical_pins IS
'Unlinked Google Maps entries for historical context layer - shows ALL entries not explicitly linked to a place';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=== MIG_729 Summary ==='
\echo 'Reverted to explicit linking only:'
\echo '  - Atlas pins only include entries with place_id or linked_place_id set'
\echo '  - Historical dots show ALL unlinked entries (safe, conservative approach)'
\echo ''
\echo 'To consolidate a historical dot with a place, explicitly link it:'
\echo '  UPDATE google_map_entries SET linked_place_id = <place_id> WHERE entry_id = <entry_id>'
\echo ''
\echo '=== MIG_729 Complete ==='
