\echo '=== MIG_798: Show All Interacted Places on the Map ==='
\echo 'Adds intake submissions to v_map_atlas_pins view and fixes stale activity flags'
\echo ''

-- ============================================================================
-- Problem: The map view only shows places with cats, requests, or Google
-- history. Places with only intake submissions (497 places) get pin_style
-- 'minimal' even though they represent real FFSC interactions.
--
-- Additionally, activity flags on the places table are stale — many places
-- have cat_place_relationships but has_cat_activity = FALSE.
--
-- This migration:
-- 1. Updates v_map_atlas_pins to include intake submission counts
-- 2. Adds intake_count > 0 as a condition for pin_style = 'active'
-- 3. Fixes stale has_cat_activity and has_appointment_activity flags
-- ============================================================================

-- ============================================================================
-- STEP 1: Update the map view to include intake submissions
-- ============================================================================

\echo 'Updating v_map_atlas_pins to include intake submissions...'

-- Must DROP first because we're adding the intake_count column (new column position)
DROP VIEW IF EXISTS trapper.v_map_atlas_pins;

CREATE VIEW trapper.v_map_atlas_pins AS
SELECT
  p.place_id as id,
  p.formatted_address as address,
  p.display_name,
  ST_Y(p.location::geometry) as lat,
  ST_X(p.location::geometry) as lng,
  p.service_zone,

  -- Parent place for clustering
  p.parent_place_id,
  p.place_kind,
  p.unit_identifier,

  -- Cat counts
  COALESCE(cc.cat_count, 0) as cat_count,

  -- People linked
  COALESCE(ppl.person_names, '[]'::JSONB) as people,
  COALESCE(ppl.person_count, 0) as person_count,

  -- Disease risk (manual flag OR AI-detected from Google entries)
  (COALESCE(p.disease_risk, FALSE) OR COALESCE(gme.has_disease_risk, FALSE)) as disease_risk,
  p.disease_risk_notes,

  -- Watch list (manual flag OR AI-detected from Google entries)
  (COALESCE(p.watch_list, FALSE) OR COALESCE(gme.has_watch_list, FALSE)) as watch_list,
  p.watch_list_reason,

  -- Google Maps history - ONLY explicitly linked entries
  COALESCE(gme.entry_count, 0) as google_entry_count,
  COALESCE(gme.ai_summaries, '[]'::JSONB) as google_summaries,

  -- Request counts
  COALESCE(req.request_count, 0) as request_count,
  COALESCE(req.active_request_count, 0) as active_request_count,

  -- Intake submission counts (NEW)
  COALESCE(intake.intake_count, 0) as intake_count,

  -- TNR stats from pre-aggregated view
  COALESCE(tnr.total_altered, 0) as total_altered,
  tnr.last_alteration_at,

  -- Pin style determination for frontend
  -- Now includes intake submissions as a signal for 'active'
  CASE
    WHEN (COALESCE(p.disease_risk, FALSE) OR COALESCE(gme.has_disease_risk, FALSE)) THEN 'disease'
    WHEN (COALESCE(p.watch_list, FALSE) OR COALESCE(gme.has_watch_list, FALSE)) THEN 'watch_list'
    WHEN COALESCE(cc.cat_count, 0) > 0
      OR COALESCE(req.request_count, 0) > 0
      OR COALESCE(intake.intake_count, 0) > 0 THEN 'active'
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

-- Intake submissions (NEW)
LEFT JOIN (
  SELECT
    place_id,
    COUNT(DISTINCT submission_id) as intake_count
  FROM trapper.web_intake_submissions
  WHERE place_id IS NOT NULL
  GROUP BY place_id
) intake ON intake.place_id = p.place_id

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
'Consolidated Atlas pins for map display. Includes all places with geocoordinates.
MIG_798: Added intake_count from web_intake_submissions so places with only
intake submissions appear as active pins on the map.';

-- ============================================================================
-- STEP 2: Fix stale activity flags
-- ============================================================================

\echo 'Fixing stale has_cat_activity flags...'

UPDATE trapper.places p
SET has_cat_activity = TRUE
WHERE has_cat_activity = FALSE
  AND EXISTS (
    SELECT 1 FROM trapper.cat_place_relationships cpr
    WHERE cpr.place_id = p.place_id
  );

\echo 'Fixing stale has_appointment_activity flags...'

UPDATE trapper.places p
SET has_appointment_activity = TRUE
WHERE has_appointment_activity = FALSE
  AND EXISTS (
    SELECT 1 FROM trapper.sot_appointments a
    WHERE a.place_id = p.place_id OR a.inferred_place_id = p.place_id
  );

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=================================================='
\echo 'MIG_798 Complete!'
\echo '=================================================='
\echo ''
\echo 'Changes:'
\echo '  1. v_map_atlas_pins now includes intake_count from web_intake_submissions'
\echo '  2. pin_style = active when intake_count > 0 (was only cats/requests)'
\echo '  3. Fixed stale has_cat_activity flags on places table'
\echo '  4. Fixed stale has_appointment_activity flags on places table'
\echo ''
\echo 'Combined with API LIMIT increase (3000 -> 12000), all interacted places'
\echo 'now appear on the map.'
\echo ''
