-- MIG_2306: Add quality_tier Filter to Map View (V2 INV-13)
-- Date: 2026-02-14
--
-- V2 INVARIANT #13: "Display Surfaces Must Filter data quality"
-- CLAUDE.md: Display surfaces must exclude low-quality data
--
-- NOTE: V2 schema uses different column names:
--   - sot.cats, sot.people: data_quality
--   - sot.places: quality_tier
--
-- Problem: MIG_2303 recreated ops.v_map_atlas_pins but did NOT include the
-- quality_tier filter for places.
--
-- Fix: Add filter to exclude garbage/needs_review places from map display.
-- (Currently quality_tier is NULL for all places, so no immediate effect)

\echo ''
\echo '=============================================='
\echo '  MIG_2306: Add data_quality Filter (INV-13)'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CHECK CURRENT STATE
-- ============================================================================

\echo '1. Checking places with garbage/needs_review quality_tier...'
SELECT
    COALESCE(quality_tier, 'NULL') as quality_tier,
    COUNT(*) as places
FROM sot.places
WHERE merged_into_place_id IS NULL
GROUP BY quality_tier
ORDER BY places DESC;

-- ============================================================================
-- 2. RECREATE VIEW WITH data_quality FILTER
-- ============================================================================

\echo ''
\echo '2. Recreating ops.v_map_atlas_pins with data_quality filter...'

CREATE OR REPLACE VIEW ops.v_map_atlas_pins AS
SELECT
  p.place_id as id,
  COALESCE(a.display_address, p.formatted_address, p.display_name) as address,
  p.display_name,
  a.latitude as lat,
  a.longitude as lng,
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

  -- Disease risk (combines manual flag AND computed disease status)
  COALESCE(p.disease_risk, FALSE) OR COALESCE(ds.has_any_disease, FALSE) as disease_risk,
  p.disease_risk_notes,

  -- Disease badges from ops.v_place_disease_summary
  COALESCE(ds.disease_badges, '[]'::JSONB) as disease_badges,
  COALESCE(ds.active_disease_count, 0) as disease_count,

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
    WHEN COALESCE(p.disease_risk, FALSE) OR COALESCE(ds.active_disease_count, 0) > 0 THEN 'disease'
    WHEN COALESCE(p.watch_list, FALSE) THEN 'watch_list'
    WHEN COALESCE(cc.cat_count, 0) > 0 THEN 'active'
    WHEN COALESCE(req.request_count, 0) > 0
      OR COALESCE(intake.intake_count, 0) > 0 THEN 'active_requests'
    WHEN COALESCE(gme.entry_count, 0) > 0 THEN 'has_history'
    ELSE 'minimal'
  END as pin_style,

  -- Pin tier
  CASE
    WHEN COALESCE(p.disease_risk, FALSE) OR COALESCE(ds.active_disease_count, 0) > 0 THEN 'active'
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
LEFT JOIN sot.addresses a ON a.address_id = COALESCE(p.sot_address_id, p.address_id)

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

-- Disease summary join
LEFT JOIN ops.v_place_disease_summary ds ON ds.place_id = p.place_id

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
LEFT JOIN sot.v_place_alteration_history tnr ON tnr.place_id = p.place_id

WHERE p.merged_into_place_id IS NULL
  AND (a.latitude IS NOT NULL AND a.longitude IS NOT NULL)
  -- V2 INV-13: Filter out garbage/needs_review data from display surfaces
  -- NOTE: sot.places uses quality_tier column (not data_quality)
  AND COALESCE(p.quality_tier, 'good') NOT IN ('garbage', 'needs_review');

COMMENT ON VIEW ops.v_map_atlas_pins IS
'Map pins view for Beacon/Atlas map.
V2 Compliant (MIG_2306):
- Joins ops.v_place_disease_summary for disease_badges (MIG_2303)
- Filters quality_tier != garbage/needs_review (INV-13)
- Filters merged_into_place_id IS NULL (merge-aware)
Columns: id, address, disease_badges, disease_count, pin_style, etc.';

\echo '   Recreated ops.v_map_atlas_pins with data_quality filter'

-- ============================================================================
-- 3. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Places filtered out by quality_tier:'
SELECT
    COUNT(*) as places_filtered_out
FROM sot.places p
LEFT JOIN sot.addresses a ON a.address_id = COALESCE(p.sot_address_id, p.address_id)
WHERE p.merged_into_place_id IS NULL
  AND (a.latitude IS NOT NULL AND a.longitude IS NOT NULL)
  AND COALESCE(p.quality_tier, 'good') IN ('garbage', 'needs_review');

\echo ''
\echo 'Verify no garbage in map view:'
SELECT
    COUNT(*) as garbage_in_map
FROM ops.v_map_atlas_pins map
JOIN sot.places p ON p.place_id = map.id
WHERE p.quality_tier IN ('garbage', 'needs_review');

\echo ''
\echo 'Total pins in map view:'
SELECT COUNT(*) as total_pins FROM ops.v_map_atlas_pins;

\echo ''
\echo '=============================================='
\echo '  MIG_2306 Complete!'
\echo '=============================================='
\echo ''
\echo 'Fixed:'
\echo '  - ops.v_map_atlas_pins now filters quality_tier (INV-13)'
\echo '  - Garbage/needs_review places will be excluded from display'
\echo '  - V2 display surface compliance achieved'
\echo '  - Note: Currently all quality_tier values are NULL (no effect yet)'
\echo ''
