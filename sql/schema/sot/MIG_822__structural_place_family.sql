\echo '=== MIG_822: Structural Place Family System ==='
\echo 'Creates get_place_family() for structural note/data aggregation'
\echo 'Replaces 15m ST_DWithin proximity bandaid with parent/child/sibling + 1m co-located'
\echo 'Updates v_map_atlas_pins to hide empty overlapping pins'
\echo ''

-- ============================================================================
-- Part A: get_place_family() function
--
-- Returns all structurally related place IDs for a given place.
-- Used by API endpoints to aggregate Google Maps notes, people, etc.
-- across related places (same building, units, co-located records).
--
-- Relationship types (in priority order):
--   1. Self
--   2. Parent (if this is a unit via parent_place_id)
--   3. Children (if this is a building, via parent_place_id)
--   4. Siblings (other units under same parent)
--   5. Co-located (same coordinates within 1m, for unclassified groups)
--
-- The co-located check (5) handles the ~809 groups of places at identical
-- coordinates that predate the apartment hierarchy system (MIG_190/246).
-- As these get classified via backfill, the co-located fallback becomes
-- redundant — the parent/child/sibling relationships take over.
--
-- 1m threshold = same geocoded point (GPS precision is ~3m).
-- This is NOT arbitrary like the 15m proximity it replaces.
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.get_place_family(p_place_id UUID)
RETURNS UUID[] AS $$
DECLARE
  v_parent_id UUID;
  v_location geography;
  v_family UUID[];
BEGIN
  -- Get this place's parent and location
  SELECT parent_place_id, location
  INTO v_parent_id, v_location
  FROM trapper.places
  WHERE place_id = p_place_id
    AND merged_into_place_id IS NULL;

  -- Start with self
  v_family := ARRAY[p_place_id];

  -- Add parent (if this place is a unit)
  IF v_parent_id IS NOT NULL THEN
    v_family := v_family || v_parent_id;

    -- Add siblings (other children of same parent)
    v_family := v_family || ARRAY(
      SELECT place_id FROM trapper.places
      WHERE parent_place_id = v_parent_id
        AND place_id != p_place_id
        AND merged_into_place_id IS NULL
    );
  END IF;

  -- Add children (if this place is a building/parent)
  v_family := v_family || ARRAY(
    SELECT place_id FROM trapper.places
    WHERE parent_place_id = p_place_id
      AND merged_into_place_id IS NULL
  );

  -- Add co-located places (same geocoded point, within 1m)
  -- This catches unclassified multi-unit buildings and overlapping records
  -- that predate the apartment hierarchy system.
  IF v_location IS NOT NULL THEN
    v_family := v_family || ARRAY(
      SELECT place_id FROM trapper.places
      WHERE place_id != p_place_id
        AND merged_into_place_id IS NULL
        AND location IS NOT NULL
        AND ST_DWithin(location, v_location, 1)
    );
  END IF;

  -- Return deduplicated
  RETURN ARRAY(SELECT DISTINCT unnest(v_family));
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.get_place_family(UUID) IS
  'Returns all structurally related place IDs: parent, children, siblings (via parent_place_id), '
  'and co-located places (within 1m, same geocoded point). Used for aggregating GM notes, people, etc.';

\echo 'Created get_place_family() function'

-- ============================================================================
-- Part B: Apartment hierarchy backfill (SKIPPED)
--
-- backfill_apartment_hierarchy() has false positives in extract_unit_from_address():
-- the `ste` pattern matches street names (Gravenstein, Westminster, Steele).
-- The co-located detection in get_place_family() handles unclassified groups
-- correctly without needing parent_place_id classification.
--
-- To run manually with fixes: SELECT * FROM trapper.backfill_apartment_hierarchy(TRUE);
-- ============================================================================

\echo ''
\echo 'Apartment hierarchy backfill skipped (co-located detection handles unclassified groups)'

-- ============================================================================
-- Part C: Update v_map_atlas_pins to eliminate overlapping empty pins
--
-- Adds a filter: if a place has zero data (no cats, people, requests,
-- GM entries, or intakes) AND shares exact coordinates (1m) with another
-- place, hide it from the map. The data-rich place still shows.
--
-- This is structural because:
-- - 1m = same physical geocoded point (not an arbitrary radius)
-- - If both co-located places are empty, both are hidden (correct: nothing to show)
-- - GM notes are still accessible via get_place_family() from the visible place
-- - Classified apartment units are excluded from this filter (they have parent_place_id)
-- ============================================================================

\echo ''
\echo 'Updating v_map_atlas_pins view...'

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
  -- If a place has zero data AND shares exact coordinates (1m) with another
  -- place, it's a duplicate shell causing overlapping pins.
  -- GM notes from hidden places are still accessible via get_place_family()
  -- from the visible co-located place.
  -- Classified apartment units (with parent_place_id) are NOT affected.
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
  'MIG_822: Unified map pins with structural co-located filtering. '
  'Filters: empty apartment_building shells (MIG_820) + empty unclassified co-located places (MIG_822). '
  'Pin tier: active (disease, cats, requests, volunteers) vs reference (history only, minimal). '
  'Use get_place_family() for cross-place data aggregation in detail views.';

\echo 'Updated v_map_atlas_pins view'

-- ============================================================================
-- Part D: Verification
-- ============================================================================

\echo ''
\echo '=== Verification ==='

\echo 'Apartment hierarchy stats:'
SELECT
  COUNT(*) FILTER (WHERE parent_place_id IS NOT NULL) AS units_with_parent,
  COUNT(*) FILTER (WHERE place_kind = 'apartment_building') AS buildings,
  COUNT(*) FILTER (WHERE place_kind = 'apartment_unit') AS units
FROM trapper.places
WHERE merged_into_place_id IS NULL;

\echo ''
\echo 'Co-located groups (places sharing exact coordinates):'
SELECT
  group_size,
  COUNT(*) AS group_count
FROM (
  SELECT
    ROUND(ST_Y(location::geometry)::numeric, 6) AS lat,
    ROUND(ST_X(location::geometry)::numeric, 6) AS lng,
    COUNT(*) AS group_size
  FROM trapper.places
  WHERE merged_into_place_id IS NULL AND location IS NOT NULL
  GROUP BY 1, 2
  HAVING COUNT(*) > 1
) groups
GROUP BY group_size
ORDER BY group_size;

\echo ''
\echo 'Map pin count comparison:'
SELECT
  'total_active_places' AS metric,
  COUNT(*) AS count
FROM trapper.places
WHERE merged_into_place_id IS NULL AND location IS NOT NULL
UNION ALL
SELECT
  'visible_map_pins',
  COUNT(*)
FROM trapper.v_map_atlas_pins;

\echo ''
\echo 'Sample get_place_family() for a co-located group:'
SELECT
  p.place_id,
  p.formatted_address,
  p.place_kind,
  p.parent_place_id IS NOT NULL AS has_parent,
  array_length(trapper.get_place_family(p.place_id), 1) AS family_size
FROM trapper.places p
WHERE p.merged_into_place_id IS NULL
  AND p.location IS NOT NULL
  AND p.formatted_address LIKE '%Jennings%'
LIMIT 10;

\echo ''
\echo '=== MIG_822 Complete ==='
