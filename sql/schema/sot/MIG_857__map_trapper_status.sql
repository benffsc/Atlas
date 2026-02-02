\echo '=== MIG_857: Map Trapper Status Indicator ==='
\echo 'Adds needs_trapper_count to v_map_atlas_pins for map-level trapper assignment visibility'
\echo ''

-- ============================================================================
-- Adds needs_trapper_count to the request counts CTE in v_map_atlas_pins.
-- This counts active requests at each place where:
--   - status is active (new/triaged/scheduled/in_progress)
--   - assignment_status is 'pending' (no trappers assigned)
--   - no_trapper_reason IS NULL (not marked as client trapping / not needed)
--
-- The AtlasMap uses this to show an orange "needs trapper" dot on pins
-- and to filter the map to only locations needing trapper assignment.
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_map_atlas_pins AS
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

  -- People linked
  COALESCE(ppl.people, '[]'::JSONB) as people,
  COALESCE(ppl.person_count, 0) as person_count,

  -- Disease risk (backward compat boolean)
  (COALESCE(p.disease_risk, FALSE)
   OR COALESCE(gme.has_disease_risk, FALSE)
   OR COALESCE(ds.has_any_disease, FALSE)) as disease_risk,
  p.disease_risk_notes,

  -- Per-disease badges
  COALESCE(ds.disease_badges, '[]'::JSONB) as disease_badges,
  COALESCE(ds.active_disease_count, 0) as disease_count,

  -- Watch list
  (COALESCE(p.watch_list, FALSE) OR COALESCE(gme.has_watch_list, FALSE)) as watch_list,
  p.watch_list_reason,

  -- Google Maps history
  COALESCE(gme.entry_count, 0) as google_entry_count,
  COALESCE(gme.ai_summaries, '[]'::JSONB) as google_summaries,

  -- Request counts
  COALESCE(req.request_count, 0) as request_count,
  COALESCE(req.active_request_count, 0) as active_request_count,
  -- MIG_857: Requests needing trapper assignment
  COALESCE(req.needs_trapper_count, 0) as needs_trapper_count,

  -- Intake submission counts
  COALESCE(intake.intake_count, 0) as intake_count,

  -- TNR stats
  COALESCE(tnr.total_altered, 0) as total_altered,
  tnr.last_alteration_at,

  -- Pin style
  CASE
    WHEN (COALESCE(p.disease_risk, FALSE)
          OR COALESCE(gme.has_disease_risk, FALSE)
          OR COALESCE(ds.has_any_disease, FALSE)) THEN 'disease'
    WHEN (COALESCE(p.watch_list, FALSE) OR COALESCE(gme.has_watch_list, FALSE)) THEN 'watch_list'
    WHEN COALESCE(cc.cat_count, 0) > 0 THEN 'active'
    WHEN COALESCE(req.request_count, 0) > 0
      OR COALESCE(intake.intake_count, 0) > 0 THEN 'active_requests'
    WHEN COALESCE(gme.entry_count, 0) > 0 THEN 'has_history'
    ELSE 'minimal'
  END as pin_style,

  -- Pin tier (active = full teardrop, reference = smaller muted pin)
  CASE
    WHEN (COALESCE(p.disease_risk, FALSE)
          OR COALESCE(gme.has_disease_risk, FALSE)
          OR COALESCE(ds.has_any_disease, FALSE)) THEN 'active'
    WHEN (COALESCE(p.watch_list, FALSE) OR COALESCE(gme.has_watch_list, FALSE)) THEN 'active'
    WHEN COALESCE(cc.cat_count, 0) > 0 THEN 'active'
    WHEN COALESCE(req.request_count, 0) > 0
      OR COALESCE(intake.intake_count, 0) > 0 THEN 'active'
    WHEN active_roles.place_id IS NOT NULL THEN 'active'
    ELSE 'reference'
  END as pin_tier,

  -- Metadata
  p.created_at,
  p.last_activity_at

FROM trapper.places p

-- Cat counts
LEFT JOIN (
  SELECT place_id, COUNT(DISTINCT cat_id) as cat_count
  FROM trapper.cat_place_relationships
  GROUP BY place_id
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
        FROM trapper.person_roles pr
        WHERE pr.person_id = per.person_id
          AND pr.role_status = 'active'
      ), ARRAY[]::TEXT[]),
      'is_staff', COALESCE(per.is_system_account, FALSE)
    )) FILTER (WHERE per.display_name IS NOT NULL) as people
  FROM trapper.person_place_relationships ppr
  JOIN trapper.sot_people per ON per.person_id = ppr.person_id
  WHERE per.merged_into_person_id IS NULL
    AND NOT trapper.is_organization_name(per.display_name)
    AND (
      COALESCE(per.is_system_account, FALSE) = FALSE
      OR ppr.source_system = 'volunteerhub'
    )
  GROUP BY ppr.place_id
) ppl ON ppl.place_id = p.place_id

-- Organization display name fallback
LEFT JOIN (
  SELECT DISTINCT ON (place_id) place_id, org_display_name
  FROM trapper.organization_place_mappings
  WHERE auto_link_enabled = TRUE AND org_display_name IS NOT NULL
  ORDER BY place_id, created_at DESC
) org ON org.place_id = p.place_id

-- Disease summary
LEFT JOIN trapper.v_place_disease_summary ds ON ds.place_id = p.place_id

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
    ) FILTER (WHERE ai_summary IS NOT NULL OR original_content IS NOT NULL) as ai_summaries,
    BOOL_OR(ai_meaning IN ('disease_risk', 'felv_colony', 'fiv_colony')) as has_disease_risk,
    BOOL_OR(ai_meaning = 'watch_list') as has_watch_list
  FROM trapper.google_map_entries
  WHERE place_id IS NOT NULL OR linked_place_id IS NOT NULL
  GROUP BY COALESCE(place_id, linked_place_id)
) gme ON gme.place_id = p.place_id

-- Request counts (MIG_857: added needs_trapper_count)
LEFT JOIN (
  SELECT
    place_id,
    COUNT(*) as request_count,
    COUNT(*) FILTER (WHERE status IN ('new', 'triaged', 'scheduled', 'in_progress')) as active_request_count,
    COUNT(*) FILTER (
      WHERE status IN ('new', 'triaged', 'scheduled', 'in_progress')
        AND assignment_status = 'pending'
        AND no_trapper_reason IS NULL
    ) as needs_trapper_count
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

-- Active important roles at this place (for auto-graduation)
LEFT JOIN (
  SELECT DISTINCT ppr.place_id
  FROM trapper.person_place_relationships ppr
  JOIN trapper.person_roles pr ON pr.person_id = ppr.person_id
  WHERE pr.role_status = 'active'
    AND pr.role IN ('volunteer', 'trapper', 'coordinator', 'head_trapper',
                    'ffsc_trapper', 'community_trapper', 'foster')
) active_roles ON active_roles.place_id = p.place_id

-- TNR stats
LEFT JOIN (
  SELECT
    place_id,
    total_cats_altered as total_altered,
    latest_request_date as last_alteration_at
  FROM trapper.v_place_alteration_history
) tnr ON tnr.place_id = p.place_id

WHERE p.merged_into_place_id IS NULL
  AND p.location IS NOT NULL
  -- MIG_820: Exclude empty apartment_building shell records
  AND NOT (
    p.place_kind = 'apartment_building'
    AND COALESCE(cc.cat_count, 0) = 0
    AND COALESCE(ppl.person_count, 0) = 0
    AND COALESCE(req.request_count, 0) = 0
    AND COALESCE(gme.entry_count, 0) = 0
    AND COALESCE(intake.intake_count, 0) = 0
  )
  -- MIG_822: Exclude empty unclassified co-located places
  AND NOT (
    p.parent_place_id IS NULL
    AND p.place_kind NOT IN ('apartment_building', 'apartment_unit')
    AND COALESCE(cc.cat_count, 0) = 0
    AND COALESCE(ppl.person_count, 0) = 0
    AND COALESCE(req.request_count, 0) = 0
    AND COALESCE(gme.entry_count, 0) = 0
    AND COALESCE(intake.intake_count, 0) = 0
    AND EXISTS (
      SELECT 1 FROM trapper.places p2
      WHERE p2.place_id != p.place_id
        AND p2.merged_into_place_id IS NULL
        AND p2.location IS NOT NULL
        AND ST_DWithin(p2.location, p.location, 1)
    )
  );

COMMENT ON VIEW trapper.v_map_atlas_pins IS
  'MIG_857: Added needs_trapper_count for map trapper status indicators. '
  'Counts active requests where assignment_status=pending and no_trapper_reason IS NULL. '
  'Pin tier: active (disease, cats, requests, volunteers) vs reference (history only, minimal). '
  'Use get_place_family() for cross-place data aggregation in detail views.';

\echo ''
\echo '=== Verification ==='
\echo 'Pins with needs_trapper_count > 0:'
SELECT COUNT(*) as pins_needing_trappers
FROM trapper.v_map_atlas_pins
WHERE needs_trapper_count > 0;

\echo ''
\echo '=== MIG_857 Complete ==='
