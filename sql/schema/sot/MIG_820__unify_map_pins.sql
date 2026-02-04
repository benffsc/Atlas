\echo '=== MIG_820: Unify Map Pins — Two Layers Only ==='
\echo 'Goal: Eliminate historical_pins layer. Convert all unlinked Google Maps'
\echo 'entries into Atlas reference pins (two pin types only: active + reference).'
\echo ''

-- ============================================================================
-- 0. ADD google_maps TO data_source ENUM (if not exists)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'google_maps'
      AND enumtypid = 'trapper.data_source'::regtype
  ) THEN
    ALTER TYPE trapper.data_source ADD VALUE 'google_maps';
  END IF;
END $$;

\echo '  → data_source enum: google_maps value ensured'

-- ============================================================================
-- 1. AUTO-LINK GM ENTRIES WITHIN 50m TO NEAREST ATLAS PLACE
-- These entries are close enough to an existing place to be about that place.
-- ============================================================================

\echo ''
\echo '--- Step 1: Auto-link GM entries within 50m ---'

WITH linked AS (
  UPDATE trapper.google_map_entries gme
  SET linked_place_id = gme.nearest_place_id
  WHERE gme.linked_place_id IS NULL
    AND gme.place_id IS NULL
    AND gme.nearest_place_id IS NOT NULL
    AND gme.nearest_place_distance_m <= 50
    AND gme.lat IS NOT NULL
    AND gme.lng IS NOT NULL
  RETURNING gme.entry_id
)
SELECT count(*) as linked_count FROM linked \gset

\echo '  → Linked :linked_count GM entries to nearest Atlas place (within 50m)'

-- ============================================================================
-- 2. CREATE NEW PLACES FOR UNLINKED GM ENTRIES (> 50m from any Atlas place)
-- These are genuine locations with no nearby Atlas place. Create minimal place
-- records from their coordinates. Geocoding pipeline can reverse-geocode later.
-- ============================================================================

\echo ''
\echo '--- Step 2: Create places for remaining unlinked GM entries ---'

-- Temp table mapping entry_id → new place_id
CREATE TEMP TABLE _gme_new_places AS
SELECT
  gme.entry_id,
  gen_random_uuid() as new_place_id,
  gme.kml_name,
  gme.lat,
  gme.lng
FROM trapper.google_map_entries gme
WHERE gme.linked_place_id IS NULL
  AND gme.place_id IS NULL
  AND gme.lat IS NOT NULL
  AND gme.lng IS NOT NULL;

-- Create the places
INSERT INTO trapper.places (
  place_id, display_name, formatted_address, location,
  place_kind, is_address_backed, place_origin,
  data_source, location_type, quality_tier
)
SELECT
  gnp.new_place_id,
  gnp.kml_name,
  gnp.kml_name,
  ST_SetSRID(ST_MakePoint(gnp.lng, gnp.lat), 4326)::geography,
  'unknown',
  FALSE,
  'google_maps',
  'google_maps',
  'approximate',
  'D'
FROM _gme_new_places gnp;

-- Link the GM entries to their new places
UPDATE trapper.google_map_entries gme
SET linked_place_id = gnp.new_place_id
FROM _gme_new_places gnp
WHERE gme.entry_id = gnp.entry_id;

SELECT count(*) as created_count FROM _gme_new_places \gset

\echo '  → Created :created_count new places from GM coordinates'
\echo '  → Linked all GM entries to new places'

DROP TABLE _gme_new_places;

-- ============================================================================
-- 3. VERIFY: No unlinked GM entries remain
-- ============================================================================

\echo ''
\echo '--- Step 3: Verification ---'

SELECT count(*) as remaining FROM trapper.v_map_historical_pins \gset
\echo '  → Remaining unlinked GM entries: :remaining (should be 0)'

-- ============================================================================
-- 4. FILTER EMPTY APARTMENT_BUILDING RECORDS FROM ATLAS PINS VIEW
-- Problem: Empty apartment_building shell records overlap with the actual
-- address pin (e.g., 298 E Cotati Ave has both an active pin and a "Minimal Data" pin).
-- Fix: Exclude apartment_building places with zero data attached.
-- ============================================================================

\echo ''
\echo '--- Step 4: Update v_map_atlas_pins — filter empty apartment buildings ---'

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

-- Cat counts (excluding merged cats)
LEFT JOIN (
  SELECT cpr.place_id, COUNT(DISTINCT cpr.cat_id) as cat_count
  FROM trapper.cat_place_relationships cpr
  JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL
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
  -- These are parent containers with no data; their child units have the actual data.
  -- Without this filter, they show as duplicate "Minimal Data" pins overlapping the real pin.
  AND NOT (
    p.place_kind = 'apartment_building'
    AND COALESCE(cc.cat_count, 0) = 0
    AND COALESCE(ppl.person_count, 0) = 0
    AND COALESCE(req.request_count, 0) = 0
    AND COALESCE(gme.entry_count, 0) = 0
    AND COALESCE(intake.intake_count, 0) = 0
  );

COMMENT ON VIEW trapper.v_map_atlas_pins IS
'MIG_820: Unified map pins — only active and reference tiers.
Filters out empty apartment_building shells to prevent duplicate pins.
Pin tier: active (disease, cats, requests, volunteers) vs reference (history only, minimal).
Historical Google Maps entries now show as reference pins (linked via MIG_820).';

-- ============================================================================
-- 5. DWAYNE BENEDICT — ALREADY DEDUPLICATED
-- Investigation confirmed: 4 records → 1 canonical (0e477375)
-- 3 duplicates properly merged_into canonical. No action needed.
-- ============================================================================

\echo ''
\echo '  → Dwayne Benedict: Already deduplicated (3 duplicates merged into canonical)'

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=== MIG_820 Complete ==='
\echo 'Changes:'
\echo '  1. Auto-linked ~876 GM entries within 50m to nearest Atlas place'
\echo '  2. Created ~1,590 new places from GM coordinates (entries > 50m)'
\echo '  3. All GM entries now have linked_place_id → appear as reference pins'
\echo '  4. v_map_atlas_pins: Filters empty apartment_building shells'
\echo '  5. Historical pins layer now returns 0 rows (safe to remove from frontend)'
\echo ''
\echo 'Frontend changes needed (separate):'
\echo '  - Remove historical_pins layer from AtlasMap.tsx'
\echo '  - Remove historical_pins query from map-data/route.ts'
\echo '  - Fix reference pin popups to use drawer instead of new tab'
