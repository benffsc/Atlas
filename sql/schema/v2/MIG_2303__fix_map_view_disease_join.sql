-- MIG_2303: Fix ops.v_map_atlas_pins Disease Badge Join
-- Date: 2026-02-14
--
-- Problem: MIG_2300 recreated ops.v_map_atlas_pins with hardcoded placeholder values:
--   '[]'::JSONB as disease_badges,
--   0 as disease_count,
--
-- Fix: Add LEFT JOIN to ops.v_place_disease_summary (created in MIG_2110)
--      and use actual disease data instead of placeholders.
--
-- Data exists:
--   - ops.place_disease_status: 13 records (1 confirmed_active FeLV, 12 historical)
--   - ops.cat_test_results: 1,981 test records
--   - ops.v_place_disease_summary: Aggregates disease badges per place

\echo ''
\echo '=============================================='
\echo '  MIG_2303: Fix Map View Disease Badge Join'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. VERIFY PREREQUISITE: ops.v_place_disease_summary exists
-- ============================================================================

\echo '1. Verifying ops.v_place_disease_summary exists...'

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_schema = 'ops' AND table_name = 'v_place_disease_summary'
    ) THEN
        RAISE EXCEPTION 'ops.v_place_disease_summary does not exist. Run MIG_2110 first.';
    END IF;
    RAISE NOTICE 'ops.v_place_disease_summary exists';
END $$;

-- ============================================================================
-- 2. RECREATE ops.v_map_atlas_pins WITH DISEASE JOIN
-- ============================================================================

\echo ''
\echo '2. Recreating ops.v_map_atlas_pins with disease summary join...'

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

  -- FIX: Disease badges from ops.v_place_disease_summary (was hardcoded '[]')
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

  -- Pin style (FIX: now checks computed disease status, not just manual flag)
  CASE
    WHEN COALESCE(p.disease_risk, FALSE) OR COALESCE(ds.active_disease_count, 0) > 0 THEN 'disease'
    WHEN COALESCE(p.watch_list, FALSE) THEN 'watch_list'
    WHEN COALESCE(cc.cat_count, 0) > 0 THEN 'active'
    WHEN COALESCE(req.request_count, 0) > 0
      OR COALESCE(intake.intake_count, 0) > 0 THEN 'active_requests'
    WHEN COALESCE(gme.entry_count, 0) > 0 THEN 'has_history'
    ELSE 'minimal'
  END as pin_style,

  -- Pin tier (FIX: now checks computed disease status)
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

-- FIX: Disease summary join (was missing in MIG_2300)
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
  AND (a.latitude IS NOT NULL AND a.longitude IS NOT NULL);

COMMENT ON VIEW ops.v_map_atlas_pins IS
'Map pins view for Beacon/Atlas map.
FIX (MIG_2303): Now joins ops.v_place_disease_summary for disease_badges.
Columns: id, address, disease_badges, disease_count, pin_style, etc.';

\echo '   Recreated ops.v_map_atlas_pins with disease join'

-- ============================================================================
-- 3. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Disease data in source tables:'
SELECT
    'ops.place_disease_status' as table_name,
    COUNT(*) as total_records,
    COUNT(*) FILTER (WHERE status = 'confirmed_active') as confirmed_active,
    COUNT(*) FILTER (WHERE status = 'historical') as historical
FROM ops.place_disease_status;

\echo ''
\echo 'Pins with disease data:'
SELECT
    COUNT(*) as total_pins,
    COUNT(*) FILTER (WHERE disease_count > 0) as pins_with_disease,
    COUNT(*) FILTER (WHERE pin_style = 'disease') as disease_style_pins
FROM ops.v_map_atlas_pins;

\echo ''
\echo 'Sample disease pins:'
SELECT
    id,
    LEFT(address, 50) as address,
    disease_badges,
    disease_count,
    pin_style
FROM ops.v_map_atlas_pins
WHERE disease_count > 0
LIMIT 5;

\echo ''
\echo '=============================================='
\echo '  MIG_2303 Complete!'
\echo '=============================================='
\echo ''
\echo 'Fixed:'
\echo '  - ops.v_map_atlas_pins now joins ops.v_place_disease_summary'
\echo '  - disease_badges populated from actual data (was hardcoded [])'
\echo '  - disease_count shows actual count (was hardcoded 0)'
\echo '  - pin_style checks computed disease status (was only checking manual flag)'
\echo ''
