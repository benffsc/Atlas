\echo '=== MIG_728: Map Consolidation by Spatial Proximity ==='
\echo 'Consolidate Google Maps entries near Atlas places into single pins'
\echo ''

-- ============================================================================
-- PROBLEM:
-- Google Maps entries that are physically near Atlas places show as separate
-- dots even though they should be consolidated into the Atlas pin.
--
-- SOLUTION:
-- Use nearest_place_id and nearest_place_distance_m to consolidate entries
-- within 100m of an Atlas place into that place's view, not as separate pins.
-- ============================================================================

-- ============================================================================
-- PART 1: Update v_map_atlas_pins to include nearby unlinked Google entries
-- ============================================================================

\echo 'Updating v_map_atlas_pins to include nearby Google Maps entries...'

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

  -- Disease risk (manual flag takes precedence, then check linked/nearby Google entries)
  COALESCE(
    p.disease_risk,
    gme.has_disease_risk,
    FALSE
  ) as disease_risk,
  p.disease_risk_notes,

  -- Watch list status from linked/nearby Google entries
  COALESCE(gme.has_watch_list, FALSE) as watch_list,

  -- Google Maps history linked OR nearby (within 100m)
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

-- Google Maps entries: linked OR nearby (within 100m threshold)
-- This consolidates entries that are physically at the same location
LEFT JOIN (
  SELECT
    the_place_id as place_id,
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
  FROM (
    -- Explicitly linked entries
    SELECT
      COALESCE(place_id, linked_place_id) as the_place_id,
      ai_summary, original_content, ai_meaning, parsed_date, imported_at, kml_name
    FROM trapper.google_map_entries
    WHERE place_id IS NOT NULL OR linked_place_id IS NOT NULL

    UNION ALL

    -- Unlinked entries that are within 100m of a place (use nearest_place_id)
    SELECT
      nearest_place_id as the_place_id,
      ai_summary, original_content, ai_meaning, parsed_date, imported_at, kml_name
    FROM trapper.google_map_entries
    WHERE place_id IS NULL
      AND linked_place_id IS NULL
      AND nearest_place_id IS NOT NULL
      AND nearest_place_distance_m <= 100  -- 100 meter threshold
  ) consolidated
  WHERE the_place_id IS NOT NULL
  GROUP BY the_place_id
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
'Consolidated view for Beacon map Atlas pins - combines places with people, cats, requests, and Google Maps history (linked OR within 100m)';

-- ============================================================================
-- PART 2: Update v_map_historical_pins to exclude entries near Atlas places
-- ============================================================================

\echo 'Updating v_map_historical_pins to exclude entries near Atlas places...'

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
  imported_at
FROM trapper.google_map_entries
WHERE
  -- Not explicitly linked
  place_id IS NULL
  AND linked_place_id IS NULL
  -- AND not near any Atlas place (beyond 100m threshold)
  AND (
    nearest_place_id IS NULL
    OR nearest_place_distance_m > 100
  )
  -- Has valid coordinates
  AND lat IS NOT NULL
  AND lng IS NOT NULL;

COMMENT ON VIEW trapper.v_map_historical_pins IS
'Unlinked Google Maps entries for historical context layer - only shows entries MORE than 100m from any Atlas place';

-- ============================================================================
-- PART 3: Create function to refresh nearest_place calculations
-- ============================================================================

\echo 'Creating function to refresh nearest place calculations...'

CREATE OR REPLACE FUNCTION trapper.refresh_google_entry_nearest_places(
  p_limit INT DEFAULT 1000
)
RETURNS TABLE(
  updated_count INT,
  already_set_count INT,
  no_nearby_count INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated INT := 0;
  v_already_set INT := 0;
  v_no_nearby INT := 0;
BEGIN
  -- Count already set
  SELECT COUNT(*) INTO v_already_set
  FROM trapper.google_map_entries
  WHERE nearest_place_id IS NOT NULL;

  -- Update entries that don't have nearest_place_id set
  WITH entries_to_update AS (
    SELECT entry_id, lat, lng
    FROM trapper.google_map_entries
    WHERE lat IS NOT NULL
      AND lng IS NOT NULL
      AND nearest_place_id IS NULL
    LIMIT p_limit
  ),
  nearest_places AS (
    SELECT DISTINCT ON (e.entry_id)
      e.entry_id,
      p.place_id as nearest_place_id,
      ST_Distance(
        ST_SetSRID(ST_MakePoint(e.lng, e.lat), 4326)::geography,
        p.location::geography
      ) as distance_m
    FROM entries_to_update e
    CROSS JOIN LATERAL (
      SELECT place_id, location
      FROM trapper.places
      WHERE merged_into_place_id IS NULL
        AND location IS NOT NULL
      ORDER BY location <-> ST_SetSRID(ST_MakePoint(e.lng, e.lat), 4326)
      LIMIT 1
    ) p
  )
  UPDATE trapper.google_map_entries g
  SET
    nearest_place_id = np.nearest_place_id,
    nearest_place_distance_m = np.distance_m
  FROM nearest_places np
  WHERE g.entry_id = np.entry_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Count entries with no nearby place
  SELECT COUNT(*) INTO v_no_nearby
  FROM trapper.google_map_entries
  WHERE lat IS NOT NULL
    AND lng IS NOT NULL
    AND nearest_place_id IS NULL;

  RETURN QUERY SELECT v_updated, v_already_set, v_no_nearby;
END;
$$;

COMMENT ON FUNCTION trapper.refresh_google_entry_nearest_places IS
'Refreshes nearest_place_id and distance for Google Map entries that do not have it set';

-- ============================================================================
-- PART 4: Run the refresh to ensure all entries have nearest_place calculated
-- ============================================================================

\echo 'Refreshing nearest place calculations for unset entries...'

-- Run multiple times to catch all entries
SELECT * FROM trapper.refresh_google_entry_nearest_places(2000);
SELECT * FROM trapper.refresh_google_entry_nearest_places(2000);
SELECT * FROM trapper.refresh_google_entry_nearest_places(2000);

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=== MIG_728 Summary ==='
\echo 'Updated v_map_atlas_pins to include Google Maps entries within 100m of places'
\echo 'Updated v_map_historical_pins to exclude entries within 100m of places'
\echo 'Created refresh_google_entry_nearest_places() for ongoing maintenance'
\echo ''
\echo 'Result: Entries at the same physical location now consolidate into one pin'
\echo '=== MIG_728 Complete ==='
