\echo '=== MIG_727: Map Layer Redesign ==='
\echo 'Adding disease_risk columns to places and creating consolidated map view'
\echo ''

-- ============================================================================
-- PART 1: Add disease_risk columns to places table
-- ============================================================================

\echo 'Adding disease_risk columns to places...'

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS disease_risk BOOLEAN DEFAULT FALSE;

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS disease_risk_notes TEXT;

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS disease_risk_set_at TIMESTAMPTZ;

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS disease_risk_set_by TEXT;

COMMENT ON COLUMN trapper.places.disease_risk IS
'Manual flag for disease risk at this location. Overrides display color to orange on map.';

COMMENT ON COLUMN trapper.places.disease_risk_notes IS
'Notes explaining the disease risk (e.g., "FeLV positive cats confirmed 2024")';

COMMENT ON COLUMN trapper.places.disease_risk_set_at IS
'When the disease risk flag was last set';

COMMENT ON COLUMN trapper.places.disease_risk_set_by IS
'Who set the disease risk flag';

-- ============================================================================
-- PART 2: Create consolidated map view for Atlas pins
-- ============================================================================

\echo 'Creating v_map_atlas_pins view...'

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

  -- Disease risk (manual flag takes precedence, then check linked Google entries)
  COALESCE(
    p.disease_risk,
    gme.has_disease_risk,
    FALSE
  ) as disease_risk,
  p.disease_risk_notes,

  -- Watch list status from linked Google entries
  COALESCE(gme.has_watch_list, FALSE) as watch_list,

  -- Google Maps history linked
  COALESCE(gme.entry_count, 0) as google_entry_count,
  COALESCE(gme.ai_summaries, '[]'::JSONB) as google_summaries,

  -- Request counts
  COALESCE(req.request_count, 0) as request_count,
  COALESCE(req.active_request_count, 0) as active_request_count,

  -- TNR stats
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

-- Google Maps entries linked to this place
LEFT JOIN (
  SELECT
    COALESCE(place_id, linked_place_id) as place_id,
    COUNT(*) as entry_count,
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'summary', COALESCE(ai_summary, original_content),
        'meaning', ai_meaning,
        'date', parsed_date
      )
      ORDER BY COALESCE(parsed_date, imported_at) DESC
    ) FILTER (WHERE COALESCE(ai_summary, original_content) IS NOT NULL) as ai_summaries,
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
'Consolidated view for Beacon map Atlas pins - combines places with people, cats, requests, and Google Maps history';

-- ============================================================================
-- PART 3: Create view for unlinked historical Google Maps entries
-- ============================================================================

\echo 'Creating v_map_historical_pins view...'

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
WHERE (place_id IS NULL AND linked_place_id IS NULL)  -- Unlinked only
  AND lat IS NOT NULL
  AND lng IS NOT NULL;

COMMENT ON VIEW trapper.v_map_historical_pins IS
'Unlinked Google Maps entries for historical context layer on Beacon map';

-- ============================================================================
-- PART 4: Create function to toggle disease risk on a place
-- ============================================================================

\echo 'Creating set_place_disease_risk function...'

CREATE OR REPLACE FUNCTION trapper.set_place_disease_risk(
  p_place_id UUID,
  p_disease_risk BOOLEAN,
  p_notes TEXT DEFAULT NULL,
  p_set_by TEXT DEFAULT 'system'
)
RETURNS trapper.places
LANGUAGE plpgsql
AS $$
DECLARE
  v_place trapper.places;
BEGIN
  UPDATE trapper.places
  SET
    disease_risk = p_disease_risk,
    disease_risk_notes = CASE
      WHEN p_disease_risk THEN COALESCE(p_notes, disease_risk_notes)
      ELSE NULL  -- Clear notes when removing flag
    END,
    disease_risk_set_at = CASE WHEN p_disease_risk THEN NOW() ELSE NULL END,
    disease_risk_set_by = CASE WHEN p_disease_risk THEN p_set_by ELSE NULL END,
    updated_at = NOW()
  WHERE place_id = p_place_id
  RETURNING * INTO v_place;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Place not found: %', p_place_id;
  END IF;

  RETURN v_place;
END;
$$;

COMMENT ON FUNCTION trapper.set_place_disease_risk IS
'Toggle disease risk flag on a place with notes and audit trail';

-- ============================================================================
-- PART 5: Create index for efficient map queries
-- ============================================================================

\echo 'Creating indexes for map queries...'

-- Index for disease_risk filtering
CREATE INDEX IF NOT EXISTS idx_places_disease_risk
ON trapper.places (disease_risk)
WHERE disease_risk = TRUE;

-- Index for efficient map boundary queries (if not already exists)
CREATE INDEX IF NOT EXISTS idx_places_location_gist
ON trapper.places USING GIST (location);

-- Index on google_map_entries for unlinked filtering
CREATE INDEX IF NOT EXISTS idx_google_map_entries_unlinked
ON trapper.google_map_entries (lat, lng)
WHERE place_id IS NULL AND linked_place_id IS NULL;

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=== MIG_727 Summary ==='
\echo 'Added columns to places table:'
\echo '  - disease_risk (BOOLEAN)'
\echo '  - disease_risk_notes (TEXT)'
\echo '  - disease_risk_set_at (TIMESTAMPTZ)'
\echo '  - disease_risk_set_by (TEXT)'
\echo ''
\echo 'Created views:'
\echo '  - v_map_atlas_pins: Consolidated Atlas data for map pins'
\echo '  - v_map_historical_pins: Unlinked Google Maps entries'
\echo ''
\echo 'Created function:'
\echo '  - set_place_disease_risk(place_id, disease_risk, notes, set_by)'
\echo ''
\echo 'Created indexes for map performance'
\echo '=== MIG_727 Complete ==='
