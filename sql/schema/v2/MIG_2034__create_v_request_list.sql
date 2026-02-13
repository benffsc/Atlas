-- MIG_2034: Create ops.v_request_list view for Requests page
-- Date: 2026-02-13
-- Issue: Requests page showed "No requests found" - view didn't exist

CREATE OR REPLACE VIEW ops.v_request_list AS
SELECT
  r.request_id,
  r.status::text,
  r.priority::text,
  r.summary,
  r.estimated_cat_count,
  FALSE AS has_kittens,
  NULL::timestamptz AS scheduled_date,
  NULL::text AS assigned_to,
  r.created_at,
  r.updated_at,
  r.source_created_at,
  r.place_id,
  p.display_name AS place_name,
  p.formatted_address AS place_address,
  a.city AS place_city,
  r.requester_person_id,
  COALESCE(per.display_name, per.first_name || ' ' || per.last_name) AS requester_name,
  (SELECT pi.id_value_norm FROM sot.person_identifiers pi WHERE pi.person_id = per.person_id AND pi.id_type = 'email' AND pi.confidence >= 0.5 ORDER BY pi.confidence DESC LIMIT 1) AS requester_email,
  (SELECT pi.id_value_norm FROM sot.person_identifiers pi WHERE pi.person_id = per.person_id AND pi.id_type = 'phone' AND pi.confidence >= 0.5 ORDER BY pi.confidence DESC LIMIT 1) AS requester_phone,
  ST_Y(p.location::geometry) AS latitude,
  ST_X(p.location::geometry) AS longitude,
  0::int AS linked_cat_count,
  r.source_system = 'airtable' AS is_legacy_request,
  COALESCE((SELECT COUNT(*) FROM ops.request_trapper_assignments rta WHERE rta.request_id = r.request_id AND rta.status = 'active'), 0)::int AS active_trapper_count,
  p.location IS NOT NULL AS place_has_location,
  ARRAY[]::text[] AS data_quality_flags,
  r.no_trapper_reason,
  (SELECT COALESCE(per2.display_name, per2.first_name || ' ' || per2.last_name)
   FROM ops.request_trapper_assignments rta
   JOIN sot.people per2 ON per2.person_id = rta.trapper_person_id
   WHERE rta.request_id = r.request_id AND rta.status = 'active'
   ORDER BY rta.assigned_at DESC LIMIT 1) AS primary_trapper_name,
  COALESCE(r.assignment_status::text,
    CASE
      WHEN r.no_trapper_reason = 'client_trapping' THEN 'client_trapping'
      WHEN EXISTS(SELECT 1 FROM ops.request_trapper_assignments rta WHERE rta.request_id = r.request_id AND rta.status = 'active') THEN 'assigned'
      ELSE 'pending'
    END
  ) AS assignment_status
FROM ops.requests r
LEFT JOIN sot.places p ON p.place_id = r.place_id AND p.merged_into_place_id IS NULL
LEFT JOIN sot.addresses a ON a.address_id = p.sot_address_id
LEFT JOIN sot.people per ON per.person_id = r.requester_person_id AND per.merged_into_person_id IS NULL;
