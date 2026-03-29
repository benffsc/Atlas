-- MIG_3011: Fix map pin_style accuracy — two bugs
--
-- BUG 1: pin_style='disease' triggered by stale p.disease_risk boolean even when
--   no active disease records exist. 30+ places showed disease pins with zero actual disease.
--   FIX: Only use disease_risk from computed disease status, not the legacy boolean.
--
-- BUG 2: pin_style='active_requests' triggered by request_count > 0 (includes completed).
--   39 places showed active_requests style with only completed/closed requests.
--   FIX: Use active_request_count > 0 instead of request_count > 0.
--
-- Also: pin_style CASE for 'active_requests' fell through when cat_count = 0 but
--   intake_count > 0 and request_count > 0 (even completed). Changed to only trigger
--   on active_request_count > 0 OR intake_count > 0.
--
-- Impact: 30 false disease pins removed, 55 false active_request pins demoted to
--   'has_history' or 'minimal'.

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
   -- FIX 1: disease_risk now driven by computed disease data, not legacy boolean
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
   -- FIX 1+2: pin_style accuracy
   CASE
       -- Disease: only from computed disease status (not legacy boolean)
       WHEN COALESCE(ds.active_disease_count, 0::bigint) > 0 THEN 'disease'::text
       WHEN COALESCE(p.watch_list, false) THEN 'watch_list'::text
       WHEN COALESCE(cc.cat_count, 0::bigint) > 0 THEN 'active'::text
       -- FIX 2: use active_request_count, not total request_count
       WHEN COALESCE(req.active_request_count, 0::bigint) > 0 OR COALESCE(intake.intake_count, 0::bigint) > 0 THEN 'active_requests'::text
       WHEN COALESCE(req.request_count, 0::bigint) > 0 THEN 'has_history'::text
       WHEN COALESCE(gme.entry_count, 0::bigint) > 0 THEN 'has_history'::text
       ELSE 'minimal'::text
   END AS pin_style,
   CASE
       -- pin_tier: same fix — don't use legacy disease_risk
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

-- Also update the trapper schema alias if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'trapper' AND viewname = 'v_map_atlas_pins') THEN
    EXECUTE 'CREATE OR REPLACE VIEW trapper.v_map_atlas_pins AS SELECT * FROM ops.v_map_atlas_pins';
  END IF;
END $$;
