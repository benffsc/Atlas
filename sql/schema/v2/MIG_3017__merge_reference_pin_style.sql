-- MIG_3017: Merge has_history + minimal → reference pin_style
-- Date: 2026-03-30
--
-- Part of FFS-1017 (Map Pin Redesign). Reduces 6 pin_style values to 5 by
-- collapsing the two lowest tiers into a single 'reference' value.
--
-- Before: disease | watch_list | active | active_requests | has_history | minimal
-- After:  disease | watch_list | active | active_requests | reference
--
-- The has_history/minimal distinction was confusing for users — both render
-- as small gray circles and require legend lookup. Merging them simplifies
-- the visual hierarchy and downstream code.

\echo ''
\echo '=============================================='
\echo '  MIG_3017: Merge reference pin_style'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. RECREATE ops.v_map_atlas_pins with merged reference style
-- ============================================================================

\echo '1. Updating ops.v_map_atlas_pins view...'

CREATE OR REPLACE VIEW ops.v_map_atlas_pins AS
SELECT p.place_id AS id,
   COALESCE(a.display_address, p.formatted_address, p.display_name) AS address,
   p.display_name,
   a.latitude AS lat,
   a.longitude AS lng,
   p.service_zone,
   p.parent_place_id,
   p.place_kind,
   p.unit_identifier,
   COALESCE(cc.cat_count, 0::bigint) AS cat_count,
   COALESCE(ppl.people, '[]'::jsonb) AS people,
   COALESCE(ppl.person_count, 0::bigint) AS person_count,
   COALESCE(ds.has_any_disease, false) AS disease_risk,
   p.disease_risk_notes,
   COALESCE(ds.disease_badges, '[]'::jsonb) AS disease_badges,
   COALESCE(ds.active_disease_count, 0::bigint) AS disease_count,
   COALESCE(p.watch_list, false) AS watch_list,
   p.watch_list_reason,
   COALESCE(gme.entry_count, 0::bigint) AS google_entry_count,
   COALESCE(gme.ai_summaries, '[]'::jsonb) AS google_summaries,
   COALESCE(req.request_count, 0::bigint) AS request_count,
   COALESCE(req.active_request_count, 0::bigint) AS active_request_count,
   COALESCE(intake.intake_count, 0::bigint) AS intake_count,
   COALESCE(tnr.total_cats_altered, 0::bigint) AS total_altered,
   tnr.latest_request_date AS last_alteration_at,
   -- pin_style: merged has_history + minimal → reference
   CASE
       WHEN COALESCE(ds.active_disease_count, 0::bigint) > 0 THEN 'disease'::text
       WHEN COALESCE(p.watch_list, false) THEN 'watch_list'::text
       WHEN COALESCE(cc.cat_count, 0::bigint) > 0 THEN 'active'::text
       WHEN COALESCE(req.active_request_count, 0::bigint) > 0 OR COALESCE(intake.intake_count, 0::bigint) > 0 THEN 'active_requests'::text
       ELSE 'reference'::text
   END AS pin_style,
   CASE
       WHEN COALESCE(ds.active_disease_count, 0::bigint) > 0 THEN 'active'::text
       WHEN COALESCE(p.watch_list, false) THEN 'active'::text
       WHEN COALESCE(cc.cat_count, 0::bigint) > 0 THEN 'active'::text
       WHEN COALESCE(req.active_request_count, 0::bigint) > 0 OR COALESCE(intake.intake_count, 0::bigint) > 0 THEN 'active'::text
       WHEN active_roles.place_id IS NOT NULL THEN 'active'::text
       ELSE 'reference'::text
   END AS pin_tier,
   p.created_at,
   p.last_activity_at,
   COALESCE(req.needs_trapper_count, 0::bigint) AS needs_trapper_count
 FROM sot.places p
   LEFT JOIN sot.addresses a ON a.address_id = COALESCE(p.sot_address_id, p.address_id)
   LEFT JOIN ( SELECT cpr.place_id,
          count(DISTINCT cpr.cat_id) AS cat_count
         FROM sot.cat_place cpr
           JOIN sot.cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL
        GROUP BY cpr.place_id) cc ON cc.place_id = p.place_id
   LEFT JOIN ( SELECT ppr.place_id,
          count(DISTINCT per.person_id) AS person_count,
          jsonb_agg(DISTINCT jsonb_build_object('name', per.display_name, 'roles', COALESCE(( SELECT array_agg(DISTINCT pr.role) AS array_agg
                 FROM ops.person_roles pr
                WHERE pr.person_id = per.person_id AND pr.role_status = 'active'::text), ARRAY[]::text[]), 'is_staff', false)) FILTER (WHERE per.display_name IS NOT NULL) AS people
         FROM sot.person_place ppr
           JOIN sot.people per ON per.person_id = ppr.person_id
        WHERE per.merged_into_person_id IS NULL AND NOT sot.is_organization_name(per.display_name)
        GROUP BY ppr.place_id) ppl ON ppl.place_id = p.place_id
   LEFT JOIN ops.v_place_disease_summary ds ON ds.place_id = p.place_id
   LEFT JOIN ( SELECT COALESCE(google_map_entries.place_id, google_map_entries.linked_place_id) AS place_id,
          count(*) AS entry_count,
          jsonb_agg(jsonb_build_object('summary', COALESCE(google_map_entries.ai_summary, SUBSTRING(google_map_entries.original_content FROM 1 FOR 200)), 'meaning', google_map_entries.ai_meaning, 'date', google_map_entries.parsed_date::text) ORDER BY google_map_entries.imported_at DESC) FILTER (WHERE google_map_entries.ai_summary IS NOT NULL OR google_map_entries.original_content IS NOT NULL) AS ai_summaries
         FROM ops.google_map_entries
        WHERE google_map_entries.place_id IS NOT NULL OR google_map_entries.linked_place_id IS NOT NULL
        GROUP BY (COALESCE(google_map_entries.place_id, google_map_entries.linked_place_id))) gme ON gme.place_id = p.place_id
   LEFT JOIN ( SELECT requests.place_id,
          count(*) AS request_count,
          count(*) FILTER (WHERE requests.status = ANY (ARRAY['new'::text, 'triaged'::text, 'scheduled'::text, 'in_progress'::text])) AS active_request_count,
          count(*) FILTER (WHERE (requests.status = ANY (ARRAY['new'::text, 'triaged'::text, 'scheduled'::text, 'in_progress'::text])) AND (requests.assignment_status = 'pending'::text OR requests.assignment_status IS NULL)) AS needs_trapper_count
         FROM ops.requests
        WHERE requests.place_id IS NOT NULL
        GROUP BY requests.place_id) req ON req.place_id = p.place_id
   LEFT JOIN ( SELECT intake_submissions.place_id,
          count(DISTINCT intake_submissions.submission_id) AS intake_count
         FROM ops.intake_submissions
        WHERE intake_submissions.place_id IS NOT NULL
        GROUP BY intake_submissions.place_id) intake ON intake.place_id = p.place_id
   LEFT JOIN ( SELECT DISTINCT ppr.place_id
         FROM sot.person_place ppr
           JOIN ops.person_roles pr ON pr.person_id = ppr.person_id
        WHERE pr.role_status = 'active'::text AND (pr.role = ANY (ARRAY['volunteer'::text, 'trapper'::text, 'coordinator'::text, 'head_trapper'::text, 'ffsc_trapper'::text, 'community_trapper'::text, 'foster'::text]))) active_roles ON active_roles.place_id = p.place_id
   LEFT JOIN sot.v_place_alteration_history tnr ON tnr.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL AND a.latitude IS NOT NULL AND a.longitude IS NOT NULL AND (COALESCE(p.quality_tier, 'good'::text) <> ALL (ARRAY['garbage'::text, 'needs_review'::text]));

-- ============================================================================
-- 2. UPDATE v_gm_reference_pins to use 'reference' instead of 'has_history'
-- ============================================================================

\echo '2. Updating ops.v_gm_reference_pins view...'

-- Must drop dependent view first
DROP VIEW IF EXISTS ops.v_map_atlas_pins_with_gm;
DROP VIEW IF EXISTS ops.v_gm_reference_pins;

CREATE VIEW ops.v_gm_reference_pins AS
SELECT
  gme.entry_id AS id,
  gme.kml_name AS address,
  gme.kml_name AS display_name,
  gme.lat,
  gme.lng,
  NULL::TEXT AS service_zone,
  NULL::UUID AS parent_place_id,
  'google_maps_historical'::TEXT AS place_kind,
  NULL::TEXT AS unit_identifier,
  COALESCE(gme.parsed_cat_count, 0)::BIGINT AS cat_count,
  '[]'::JSONB AS people,
  0::BIGINT AS person_count,
  CASE
    WHEN gme.ai_meaning IN ('disease_risk', 'felv_colony', 'fiv_colony') THEN TRUE
    ELSE FALSE
  END AS disease_risk,
  CASE
    WHEN gme.ai_meaning = 'felv_colony' THEN 'FeLV detected in AI summary'
    WHEN gme.ai_meaning = 'fiv_colony' THEN 'FIV detected in AI summary'
    WHEN gme.ai_meaning = 'disease_risk' THEN 'Disease risk noted in AI summary'
    ELSE NULL
  END AS disease_risk_notes,
  '[]'::JSONB AS disease_badges,
  0::BIGINT AS disease_count,
  CASE WHEN gme.ai_meaning = 'watch_list' THEN TRUE ELSE FALSE END AS watch_list,
  NULL::TEXT AS watch_list_reason,
  1::BIGINT AS google_entry_count,
  jsonb_build_array(jsonb_build_object(
    'summary', COALESCE(gme.ai_summary, LEFT(gme.original_content, 200)),
    'meaning', gme.ai_meaning,
    'date', gme.parsed_date::TEXT
  )) AS google_summaries,
  0::BIGINT AS request_count,
  0::BIGINT AS active_request_count,
  0::BIGINT AS intake_count,
  0::BIGINT AS total_altered,
  NULL::DATE AS last_alteration_at,
  -- pin_style: disease/watch_list/active stay, everything else → reference
  CASE
    WHEN gme.ai_meaning IN ('disease_risk', 'felv_colony', 'fiv_colony') THEN 'disease'
    WHEN gme.ai_meaning = 'watch_list' THEN 'watch_list'
    WHEN gme.ai_meaning = 'active_colony' THEN 'active'
    ELSE 'reference'
  END AS pin_style,
  'reference'::TEXT AS pin_tier,
  gme.imported_at AS created_at,
  gme.imported_at AS last_activity_at,
  0::BIGINT AS needs_trapper_count
FROM source.google_map_entries gme
WHERE gme.linked_place_id IS NULL
  AND gme.lat IS NOT NULL
  AND gme.lng IS NOT NULL;

COMMENT ON VIEW ops.v_gm_reference_pins IS
  'Unlinked Google Maps entries formatted as reference pins for the atlas map.
Pin style based on AI classification. All entries are reference tier.
MIG_3017: has_history merged into reference.';

-- ============================================================================
-- 3. RECREATE combined view
-- ============================================================================

\echo '3. Recreating ops.v_map_atlas_pins_with_gm...'

CREATE OR REPLACE VIEW ops.v_map_atlas_pins_with_gm AS
SELECT * FROM ops.v_map_atlas_pins
UNION ALL
SELECT * FROM ops.v_gm_reference_pins;

COMMENT ON VIEW ops.v_map_atlas_pins_with_gm IS
  'Combined view of atlas_pins (places) and unlinked GM entries (reference pins).
MIG_3017: pin_style values now: disease, watch_list, active, active_requests, reference.';

-- ============================================================================
-- 4. UPDATE trapper schema alias if it exists
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'trapper' AND viewname = 'v_map_atlas_pins') THEN
    EXECUTE 'CREATE OR REPLACE VIEW trapper.v_map_atlas_pins AS SELECT * FROM ops.v_map_atlas_pins';
  END IF;
END $$;

\echo ''
\echo '✓ MIG_3017 complete — pin_style reduced from 6 to 5 values'
\echo '  Verify: SELECT DISTINCT pin_style FROM ops.v_map_atlas_pins ORDER BY 1;'
\echo '  Expected: active, active_requests, disease, reference, watch_list'
\echo ''
