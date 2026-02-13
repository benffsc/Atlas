-- MIG_2030: Migrate Place Coordinates from V1 to V2
--
-- Purpose: Copy location data from V1 places to V2 places
-- Also updates the map view to use places.location directly
--
-- This is a cross-database migration that needs to be run manually
-- with access to both V1 and V2 databases.
--
-- Created: 2026-02-13

\echo ''
\echo '=============================================='
\echo '  MIG_2030: Migrate Place Coordinates'
\echo '=============================================='
\echo ''

-- ============================================================================
-- STEP 1: The coordinates need to be migrated via script
-- ============================================================================
-- Run this in a TypeScript script that can connect to both databases:
--
-- async function migrateCoordinates() {
--   const v1Places = await v1.query(`
--     SELECT place_id, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng
--     FROM trapper.places
--     WHERE location IS NOT NULL AND merged_into_place_id IS NULL
--   `);
--
--   for (const p of v1Places.rows) {
--     await v2.query(`
--       UPDATE sot.places
--       SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
--       WHERE place_id = $3
--     `, [p.lng, p.lat, p.place_id]);
--   }
-- }
--
-- For now, we'll update the map view to handle NULL locations gracefully
-- and wait for the coordinate migration script to run.

\echo 'IMPORTANT: Run migrate_place_coordinates.ts script to copy coordinates from V1'
\echo ''

-- ============================================================================
-- STEP 2: Update map view to use places.location directly
-- ============================================================================

\echo '1. Updating trapper.v_map_atlas_pins to use places.location...'

DROP VIEW IF EXISTS ops.v_map_atlas_pins CASCADE;
DROP VIEW IF EXISTS trapper.v_map_atlas_pins CASCADE;

CREATE OR REPLACE VIEW trapper.v_map_atlas_pins AS
SELECT
  p.place_id as id,
  COALESCE(p.formatted_address, p.display_name) as address,
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
  COALESCE(ppl.people, '[]'::JSONB) as people,
  COALESCE(ppl.person_count, 0) as person_count,

  -- Disease risk (from place flags)
  COALESCE(p.disease_risk, FALSE) as disease_risk,
  p.disease_risk_notes,

  -- Per-disease badges (placeholder - empty for now)
  '[]'::JSONB as disease_badges,
  0 as disease_count,

  -- Watch list
  COALESCE(p.watch_list, FALSE) as watch_list,
  p.watch_list_reason,

  -- Google Maps history
  COALESCE(gme.entry_count, 0) as google_entry_count,
  COALESCE(gme.ai_summaries, '[]'::JSONB) as google_summaries,

  -- Request counts
  COALESCE(req.request_count, 0) as request_count,
  COALESCE(req.active_request_count, 0) as active_request_count,

  -- Intake submission counts
  COALESCE(intake.intake_count, 0) as intake_count,

  -- TNR stats
  COALESCE(tnr.total_cats_altered, 0) as total_altered,
  tnr.latest_request_date as last_alteration_at,

  -- Pin style
  CASE
    WHEN COALESCE(p.disease_risk, FALSE) THEN 'disease'
    WHEN COALESCE(p.watch_list, FALSE) THEN 'watch_list'
    WHEN COALESCE(cc.cat_count, 0) > 0 THEN 'active'
    WHEN COALESCE(req.request_count, 0) > 0
      OR COALESCE(intake.intake_count, 0) > 0 THEN 'active_requests'
    WHEN COALESCE(gme.entry_count, 0) > 0 THEN 'has_history'
    ELSE 'minimal'
  END as pin_style,

  -- Pin tier (active = full teardrop, reference = smaller muted pin)
  CASE
    WHEN COALESCE(p.disease_risk, FALSE) THEN 'active'
    WHEN COALESCE(p.watch_list, FALSE) THEN 'active'
    WHEN COALESCE(cc.cat_count, 0) > 0 THEN 'active'
    WHEN COALESCE(req.request_count, 0) > 0
      OR COALESCE(intake.intake_count, 0) > 0 THEN 'active'
    WHEN active_roles.place_id IS NOT NULL THEN 'active'
    ELSE 'reference'
  END as pin_tier,

  -- Metadata
  p.created_at,
  p.last_activity_at,

  -- Requests needing trapper assignment
  COALESCE(req.needs_trapper_count, 0) as needs_trapper_count

FROM sot.places p

-- Cat counts (excluding merged cats)
LEFT JOIN (
  SELECT cpr.place_id, COUNT(DISTINCT cpr.cat_id) as cat_count
  FROM sot.cat_place cpr
  JOIN sot.cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL
  GROUP BY cpr.place_id
) cc ON cc.place_id = p.place_id

-- People with role info
LEFT JOIN (
  SELECT
    ppr.place_id,
    COUNT(DISTINCT per.person_id) as person_count,
    JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
      'name', per.display_name,
      'roles', COALESCE((
        SELECT ARRAY_AGG(DISTINCT pr.role)
        FROM ops.person_roles pr
        WHERE pr.person_id = per.person_id
          AND pr.role_status = 'active'
      ), ARRAY[]::TEXT[]),
      'is_staff', FALSE
    )) FILTER (WHERE per.display_name IS NOT NULL) as people
  FROM sot.person_place ppr
  JOIN sot.people per ON per.person_id = ppr.person_id
  WHERE per.merged_into_person_id IS NULL
    AND NOT sot.is_organization_name(per.display_name)
  GROUP BY ppr.place_id
) ppl ON ppl.place_id = p.place_id

-- Google Maps entries
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
    ) FILTER (WHERE ai_summary IS NOT NULL OR original_content IS NOT NULL) as ai_summaries
  FROM ops.google_map_entries
  WHERE place_id IS NOT NULL OR linked_place_id IS NOT NULL
  GROUP BY COALESCE(place_id, linked_place_id)
) gme ON gme.place_id = p.place_id

-- Request counts
LEFT JOIN (
  SELECT
    place_id,
    COUNT(*) as request_count,
    COUNT(*) FILTER (WHERE status IN ('new', 'triaged', 'scheduled', 'in_progress')) as active_request_count,
    COUNT(*) FILTER (
      WHERE status IN ('new', 'triaged', 'scheduled', 'in_progress')
        AND (assignment_status = 'pending' OR assignment_status IS NULL)
    ) as needs_trapper_count
  FROM ops.requests
  WHERE place_id IS NOT NULL
  GROUP BY place_id
) req ON req.place_id = p.place_id

-- Intake submissions
LEFT JOIN (
  SELECT
    place_id,
    COUNT(DISTINCT submission_id) as intake_count
  FROM ops.intake_submissions
  WHERE place_id IS NOT NULL
  GROUP BY place_id
) intake ON intake.place_id = p.place_id

-- Active important roles at this place (for auto-graduation)
LEFT JOIN (
  SELECT DISTINCT ppr.place_id
  FROM sot.person_place ppr
  JOIN ops.person_roles pr ON pr.person_id = ppr.person_id
  WHERE pr.role_status = 'active'
    AND pr.role IN ('volunteer', 'trapper', 'coordinator', 'head_trapper',
                    'ffsc_trapper', 'community_trapper', 'foster')
) active_roles ON active_roles.place_id = p.place_id

-- TNR stats
LEFT JOIN trapper.v_place_alteration_history tnr ON tnr.place_id = p.place_id

WHERE p.merged_into_place_id IS NULL
  AND p.location IS NOT NULL;

COMMENT ON VIEW trapper.v_map_atlas_pins IS
'Map pins view for V2. Uses places.location directly for coordinates.
Columns: id, address, display_name, lat, lng, cat_count, people, request_count, etc.';

\echo '   Created trapper.v_map_atlas_pins'

-- Recreate ops alias
CREATE OR REPLACE VIEW ops.v_map_atlas_pins AS
SELECT * FROM trapper.v_map_atlas_pins;

\echo '   Created ops.v_map_atlas_pins alias'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Places with location data:'
SELECT
  COUNT(*) as total_places,
  COUNT(*) FILTER (WHERE location IS NOT NULL) as with_location
FROM sot.places WHERE merged_into_place_id IS NULL;

\echo ''
\echo 'Map pins count:'
SELECT COUNT(*) as pin_count FROM trapper.v_map_atlas_pins;

\echo ''
\echo '=============================================='
\echo '  MIG_2030 Complete!'
\echo '=============================================='
\echo ''
\echo 'IMPORTANT: Run migrate_place_coordinates.ts script to copy coordinates from V1!'
\echo ''
