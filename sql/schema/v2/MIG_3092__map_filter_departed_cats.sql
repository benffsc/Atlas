-- MIG_3092: Filter departed cats from map pin counts (FFS-1280)
--
-- Rebuilds ops.v_map_atlas_pins to exclude departed cats from cat_count.
-- Without this, map pins show inflated colony sizes because adopted/transferred/
-- deceased cats still count toward the total.
--
-- Dependencies: MIG_3091 (presence_status populated via lifecycle backfill)
-- Depends on: MIG_3017 (current v_map_atlas_pins definition)

\echo ''
\echo '=============================================='
\echo '  MIG_3092: Filter departed cats from map'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. RECREATE ops.v_map_atlas_pins with presence filter on cat_count
-- ============================================================================

\echo '1. Updating ops.v_map_atlas_pins with departed cat filter...'

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
   -- MIG_3092: Filter departed cats from cat_count
   LEFT JOIN ( SELECT cpr.place_id,
          count(DISTINCT cpr.cat_id) AS cat_count
         FROM sot.cat_place cpr
           JOIN sot.cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL
         WHERE COALESCE(cpr.presence_status, 'unknown') != 'departed'
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
-- 2. Rebuild dependent views
-- ============================================================================

\echo '2. Rebuilding dependent views...'

-- v_map_atlas_pins_with_gm depends on v_map_atlas_pins
CREATE OR REPLACE VIEW ops.v_map_atlas_pins_with_gm AS
SELECT * FROM ops.v_map_atlas_pins
UNION ALL
SELECT * FROM ops.v_gm_reference_pins;

COMMENT ON VIEW ops.v_map_atlas_pins_with_gm IS
  'Combined view of atlas_pins (places) and unlinked GM entries (reference pins). '
  'MIG_3092: cat_count now excludes departed cats.';

-- Trapper schema alias
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'trapper' AND viewname = 'v_map_atlas_pins') THEN
    EXECUTE 'CREATE OR REPLACE VIEW trapper.v_map_atlas_pins AS SELECT * FROM ops.v_map_atlas_pins';
  END IF;
END $$;

-- ============================================================================
-- 3. Verification
-- ============================================================================

\echo ''
\echo '✓ MIG_3092 complete — map pins now exclude departed cats'
\echo ''
\echo '  Verify map inflation fix:'
\echo '    SELECT address, cat_count, pin_style FROM ops.v_map_atlas_pins'
\echo '    WHERE address LIKE ''%Roblar%'' OR address LIKE ''%Liberty%'';'
\echo ''
\echo '  Compare before/after for top colonies:'
\echo '    SELECT address, cat_count FROM ops.v_map_atlas_pins'
\echo '    WHERE cat_count > 0 ORDER BY cat_count DESC LIMIT 20;'
\echo ''
