\echo '=== MIG_806: Filter System Accounts & Org Names from Map View ==='
\echo 'Fixes MAP_007: Sandra Nicander / Food Maxx pollution on map pins.'
\echo ''

-- ============================================================================
-- Problem: v_map_atlas_pins shows ALL people linked to a place, including
-- system accounts (e.g., "Sandra Nicander" at 605 Rohnert Park Expwy) and
-- organization names that leaked through as person records. This confuses
-- staff by displaying irrelevant names on map popups.
--
-- Additionally, places linked to known organizations (via organization_place_mappings)
-- don't show the org name — they show nothing useful or show system account names.
--
-- This migration recreates v_map_atlas_pins with:
-- 1. People subquery filtered to exclude is_system_account and org names
-- 2. Organization display name fallback via organization_place_mappings
-- ============================================================================

\echo 'Recreating v_map_atlas_pins with filtered people and org name fallback...'

DROP VIEW IF EXISTS trapper.v_map_atlas_pins;

CREATE VIEW trapper.v_map_atlas_pins AS
SELECT
  p.place_id as id,
  p.formatted_address as address,
  COALESCE(org.org_display_name, p.display_name) as display_name,
  ST_Y(p.location::geometry) as lat,
  ST_X(p.location::geometry) as lng,
  p.service_zone,

  -- Parent place for clustering
  p.parent_place_id,
  p.place_kind,
  p.unit_identifier,

  -- Cat counts
  COALESCE(cc.cat_count, 0) as cat_count,

  -- People linked (FILTERED: no system accounts or org names)
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

  -- Intake submission counts
  COALESCE(intake.intake_count, 0) as intake_count,

  -- TNR stats from pre-aggregated view
  COALESCE(tnr.total_altered, 0) as total_altered,
  tnr.last_alteration_at,

  -- Pin style determination for frontend
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
-- FILTERED: Exclude system accounts and organization names (MAP_007)
LEFT JOIN (
  SELECT
    ppr.place_id,
    COUNT(DISTINCT per.person_id) as person_count,
    JSONB_AGG(DISTINCT per.display_name)
      FILTER (WHERE per.display_name IS NOT NULL) as person_names
  FROM trapper.person_place_relationships ppr
  JOIN trapper.sot_people per ON per.person_id = ppr.person_id
  WHERE per.merged_into_person_id IS NULL
    AND COALESCE(per.is_system_account, FALSE) = FALSE
    AND NOT trapper.is_organization_name(per.display_name)
  GROUP BY ppr.place_id
) ppl ON ppl.place_id = p.place_id

-- Organization display name fallback (MAP_007)
-- Shows the org name (e.g. "Food Maxx RP") instead of system account names
LEFT JOIN (
  SELECT DISTINCT ON (place_id) place_id, org_display_name
  FROM trapper.organization_place_mappings
  WHERE auto_link_enabled = TRUE AND org_display_name IS NOT NULL
  ORDER BY place_id, created_at DESC
) org ON org.place_id = p.place_id

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

-- Intake submissions
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
MIG_806: Filtered system accounts and org names from people subquery (MAP_007).
Added org_display_name fallback from organization_place_mappings.';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=================================================='
\echo 'MIG_806 Complete!'
\echo '=================================================='
\echo ''
\echo 'Changes to v_map_atlas_pins:'
\echo '  1. People subquery now excludes is_system_account = TRUE'
\echo '  2. People subquery now excludes is_organization_name() matches'
\echo '  3. display_name falls back to org_display_name from organization_place_mappings'
\echo ''
\echo 'Verification:'
\echo '  SELECT people, display_name FROM trapper.v_map_atlas_pins'
\echo '  WHERE address ILIKE ''%605 Rohnert%'';'
\echo '  -- Should NOT show Sandra Nicander, SHOULD show Food Maxx RP'
\echo ''
