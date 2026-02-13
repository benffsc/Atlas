-- MIG_2017: Map Compatibility Views
--
-- Purpose: Create essential views for map functionality
-- - v_map_atlas_pins: Main map pins view
-- - Supporting functions and views
--
-- Note: This is a simplified version. Disease tracking and org mappings
-- will be added in future migrations as needed.
--
-- Created: 2026-02-12

\echo ''
\echo '=============================================='
\echo '  MIG_2017: Map Compatibility Views'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. HELPER FUNCTION: is_organization_name()
-- ============================================================================

\echo '1. Creating sot.is_organization_name()...'

CREATE OR REPLACE FUNCTION sot.is_organization_name(p_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  IF p_name IS NULL THEN RETURN FALSE; END IF;

  -- Common organization indicators
  RETURN p_name ~* '\y(inc|llc|corp|ltd|foundation|society|rescue|shelter|humane|clinic|hospital|vet|animal|pet|center|centre|services?|county|city|state|dept|department|office|agency|organization|org|assoc|association|company|co)\y'
    OR p_name ~* '^(the|a)\s'
    OR p_name ~* '\s(of|for)\s'
    -- Common org name patterns
    OR p_name ILIKE '%forgotten felines%'
    OR p_name ILIKE '%marin humane%'
    OR p_name ILIKE '%animal services%'
    OR p_name ILIKE '%spay%neuter%'
    OR p_name ILIKE '%veterinary%'
    OR p_name ILIKE '%ferals%'
    OR p_name ILIKE '%rescue%'
    -- Site name patterns
    OR p_name ~* '^\d+\s'  -- Starts with address number
    OR p_name ~* '\sroad$|\srd$|\sstreet$|\sst$|\save$|\savenue$|\sdrive$|\sdr$|\sln$|\slane$|\sblvd$|\sboulevard$|\sway$|\scourt$|\sct$'
    -- Check for all caps (often org abbreviations)
    OR (LENGTH(p_name) <= 6 AND p_name = UPPER(p_name) AND p_name !~ '[a-z]');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Compatibility wrapper
CREATE OR REPLACE FUNCTION trapper.is_organization_name(p_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN sot.is_organization_name(p_name);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

\echo '   Created sot.is_organization_name()'

-- ============================================================================
-- 2. SIMPLE V_PLACE_ALTERATION_HISTORY VIEW
-- ============================================================================

\echo ''
\echo '2. Creating trapper.v_place_alteration_history...'

CREATE OR REPLACE VIEW trapper.v_place_alteration_history AS
SELECT
  cpr.place_id,
  COUNT(DISTINCT cpr.cat_id) as total_cats_altered,
  MAX(a.appointment_date) as latest_request_date
FROM sot.cat_place cpr
JOIN sot.cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL
LEFT JOIN ops.appointments a ON a.cat_id = cpr.cat_id
WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
GROUP BY cpr.place_id;

COMMENT ON VIEW trapper.v_place_alteration_history IS 'Simplified alteration history per place. Counts altered cats linked to each place.';

\echo '   Created trapper.v_place_alteration_history'

-- ============================================================================
-- 3. MAIN MAP PINS VIEW: v_map_atlas_pins
-- ============================================================================

\echo ''
\echo '3. Creating trapper.v_map_atlas_pins...'

-- Drop if exists
DROP VIEW IF EXISTS trapper.v_map_atlas_pins CASCADE;

CREATE OR REPLACE VIEW trapper.v_map_atlas_pins AS
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

  -- Disease risk (simplified - from place flags)
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
  AND (a.latitude IS NOT NULL AND a.longitude IS NOT NULL);

COMMENT ON VIEW trapper.v_map_atlas_pins IS
'Map pins view for V2. Simplified version without disease tracking.
Columns: id, address, display_name, lat, lng, cat_count, people, request_count, etc.
Uses V2 tables: sot.places, sot.addresses, sot.cat_place, sot.people, ops.requests.';

\echo '   Created trapper.v_map_atlas_pins'

-- ============================================================================
-- 4. V_GOOGLE_MAP_ENTRIES_CLASSIFIED VIEW
-- ============================================================================

\echo ''
\echo '4. Creating trapper.v_google_map_entries_classified...'

CREATE OR REPLACE VIEW trapper.v_google_map_entries_classified AS
SELECT
  gme.entry_id,
  gme.place_id,
  gme.linked_place_id,
  gme.kml_name,
  gme.original_content,
  gme.ai_summary,
  gme.ai_meaning,
  gme.parsed_date,
  gme.lat,
  gme.lng,
  gme.imported_at,
  gme.created_at,
  -- Classification based on AI meaning
  CASE
    WHEN gme.ai_meaning IN ('disease_risk', 'felv_colony', 'fiv_colony') THEN 'disease'
    WHEN gme.ai_meaning = 'watch_list' THEN 'watch_list'
    WHEN gme.ai_meaning = 'active_colony' THEN 'active'
    WHEN gme.ai_meaning = 'historical' THEN 'historical'
    WHEN gme.ai_meaning = 'tnr_complete' THEN 'resolved'
    ELSE 'unclassified'
  END as classification,
  -- Linked place info
  p.display_name as linked_place_name,
  a.display_address as linked_address
FROM ops.google_map_entries gme
LEFT JOIN sot.places p ON p.place_id = COALESCE(gme.place_id, gme.linked_place_id)
LEFT JOIN sot.addresses a ON a.address_id = COALESCE(p.sot_address_id, p.address_id);

COMMENT ON VIEW trapper.v_google_map_entries_classified IS 'Google Maps entries with classification based on AI meaning.';

\echo '   Created trapper.v_google_map_entries_classified'

-- ============================================================================
-- 5. V_OBSERVATION_ZONE_SUMMARY VIEW
-- ============================================================================

\echo ''
\echo '5. Creating trapper.v_observation_zone_summary...'

CREATE OR REPLACE VIEW trapper.v_observation_zone_summary AS
SELECT
  oz.zone_id,
  oz.zone_code,
  oz.zone_name,
  oz.service_zone,
  ST_Y(oz.centroid::geometry) as center_lat,
  ST_X(oz.centroid::geometry) as center_lng,
  oz.area_sq_km,
  oz.status,
  COUNT(DISTINCT poz.place_id) as place_count,
  COALESCE(SUM(cc.cat_count), 0) as total_cats,
  COALESCE(SUM(req.request_count), 0) as total_requests,
  oz.created_at
FROM sot.observation_zones oz
LEFT JOIN sot.place_observation_zone poz ON poz.zone_id = oz.zone_id
LEFT JOIN (
  SELECT place_id, COUNT(*) as cat_count
  FROM sot.cat_place GROUP BY place_id
) cc ON cc.place_id = poz.place_id
LEFT JOIN (
  SELECT place_id, COUNT(*) as request_count
  FROM ops.requests GROUP BY place_id
) req ON req.place_id = poz.place_id
WHERE oz.merged_into_zone_id IS NULL
GROUP BY oz.zone_id, oz.zone_code, oz.zone_name, oz.service_zone, oz.centroid, oz.area_sq_km, oz.status, oz.created_at;

COMMENT ON VIEW trapper.v_observation_zone_summary IS 'Summary statistics per observation zone.';

\echo '   Created trapper.v_observation_zone_summary'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Map views created:'
SELECT schemaname, viewname
FROM pg_views
WHERE viewname IN ('v_map_atlas_pins', 'v_google_map_entries_classified', 'v_observation_zone_summary', 'v_place_alteration_history')
ORDER BY viewname;

\echo ''
\echo 'Functions created:'
SELECT n.nspname as schema, p.proname as function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'is_organization_name'
ORDER BY n.nspname;

-- Test the view
\echo ''
\echo 'Testing v_map_atlas_pins (sample output):'
SELECT id, address, cat_count, request_count, pin_style, pin_tier
FROM trapper.v_map_atlas_pins
LIMIT 5;

\echo ''
\echo '=============================================='
\echo '  MIG_2017 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created map views:'
\echo '  - trapper.v_map_atlas_pins (main map view)'
\echo '  - trapper.v_place_alteration_history (TNR stats)'
\echo '  - trapper.v_google_map_entries_classified'
\echo '  - trapper.v_observation_zone_summary'
\echo ''
\echo 'Created functions:'
\echo '  - sot.is_organization_name() + trapper wrapper'
\echo ''
\echo 'Note: Disease tracking views will be added in future migrations.'
\echo ''
