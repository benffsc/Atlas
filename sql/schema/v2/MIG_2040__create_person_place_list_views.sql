-- MIG_2040: Create person and place list/detail views for UI pages
-- Date: 2026-02-13
-- Issue: People and Places pages need list and detail views

-- Person list view (v3 - with enriched data)
CREATE OR REPLACE VIEW sot.v_person_list_v3 AS
SELECT
  p.person_id,
  COALESCE(p.display_name, p.first_name || ' ' || p.last_name) AS display_name,
  p.first_name,
  p.last_name,
  p.primary_email,
  p.primary_phone,
  p.entity_type,
  p.is_organization,
  p.is_verified,
  p.data_quality,
  p.source_system,
  p.created_at,
  p.updated_at,
  -- Primary place info
  pl.place_id AS primary_place_id,
  pl.display_name AS primary_place_name,
  pl.formatted_address AS primary_place_address,
  -- Stats
  (SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.person_id = p.person_id)::int AS cat_count,
  (SELECT COUNT(*) FROM sot.person_place pp WHERE pp.person_id = p.person_id)::int AS place_count,
  (SELECT COUNT(*) FROM ops.requests r WHERE r.requester_person_id = p.person_id)::int AS request_count,
  -- Role info
  (SELECT pr.role FROM sot.person_roles pr WHERE pr.person_id = p.person_id ORDER BY pr.created_at DESC LIMIT 1) AS primary_role,
  (SELECT pr.trapper_type FROM sot.person_roles pr WHERE pr.person_id = p.person_id AND pr.trapper_type IS NOT NULL ORDER BY pr.created_at DESC LIMIT 1) AS trapper_type
FROM sot.people p
LEFT JOIN sot.places pl ON pl.place_id = p.primary_place_id AND pl.merged_into_place_id IS NULL
WHERE p.merged_into_person_id IS NULL;

-- Person detail view
CREATE OR REPLACE VIEW sot.v_person_detail AS
SELECT
  p.person_id,
  COALESCE(p.display_name, p.first_name || ' ' || p.last_name) AS display_name,
  p.first_name,
  p.last_name,
  p.primary_email,
  p.primary_phone,
  p.entity_type,
  p.is_organization,
  p.is_system_account,
  p.is_verified,
  p.data_quality,
  p.data_source,
  p.source_system,
  p.source_record_id,
  p.created_at,
  p.updated_at,
  p.source_created_at,
  -- Primary place info
  p.primary_place_id,
  p.primary_address_id,
  pl.display_name AS primary_place_name,
  pl.formatted_address AS primary_place_address,
  CASE WHEN pl.location IS NOT NULL THEN
    json_build_object('lat', ST_Y(pl.location::geometry), 'lng', ST_X(pl.location::geometry))
  ELSE NULL END AS primary_place_coordinates,
  -- Identifiers
  COALESCE((
    SELECT json_agg(json_build_object(
      'id_type', pi.id_type,
      'id_value', pi.id_value_norm,
      'confidence', pi.confidence,
      'source_system', pi.source_system
    ))
    FROM sot.person_identifiers pi
    WHERE pi.person_id = p.person_id AND pi.confidence >= 0.5
  ), '[]'::json) AS identifiers,
  -- Places
  COALESCE((
    SELECT json_agg(json_build_object(
      'place_id', pp_pl.place_id,
      'display_name', pp_pl.display_name,
      'formatted_address', pp_pl.formatted_address,
      'relationship_type', pp.relationship_type::text,
      'is_primary', pp_pl.place_id = p.primary_place_id
    ))
    FROM sot.person_place pp
    JOIN sot.places pp_pl ON pp_pl.place_id = pp.place_id AND pp_pl.merged_into_place_id IS NULL
    WHERE pp.person_id = p.person_id
  ), '[]'::json) AS places,
  -- Cats
  COALESCE((
    SELECT json_agg(json_build_object(
      'cat_id', c.cat_id,
      'name', COALESCE(c.name, 'Unknown'),
      'microchip', c.microchip,
      'sex', c.sex,
      'relationship_type', pc.relationship_type::text
    ))
    FROM sot.person_cat pc
    JOIN sot.cats c ON c.cat_id = pc.cat_id AND c.merged_into_cat_id IS NULL
    WHERE pc.person_id = p.person_id
  ), '[]'::json) AS cats,
  -- Roles
  COALESCE((
    SELECT json_agg(json_build_object(
      'role', pr.role,
      'role_status', pr.role_status,
      'trapper_type', pr.trapper_type,
      'started_at', pr.started_at,
      'ended_at', pr.ended_at
    ))
    FROM sot.person_roles pr
    WHERE pr.person_id = p.person_id
  ), '[]'::json) AS roles,
  -- Stats
  (SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.person_id = p.person_id)::int AS cat_count,
  (SELECT COUNT(*) FROM sot.person_place pp WHERE pp.person_id = p.person_id)::int AS place_count,
  (SELECT COUNT(*) FROM ops.requests r WHERE r.requester_person_id = p.person_id)::int AS request_count,
  (SELECT COUNT(*) FROM ops.appointments a WHERE a.person_id = p.person_id OR a.resolved_person_id = p.person_id)::int AS appointment_count
FROM sot.people p
LEFT JOIN sot.places pl ON pl.place_id = p.primary_place_id AND pl.merged_into_place_id IS NULL
WHERE p.merged_into_person_id IS NULL;

-- Place list view
CREATE OR REPLACE VIEW sot.v_place_list AS
SELECT
  p.place_id,
  p.display_name,
  p.formatted_address,
  p.place_kind::text,
  p.is_address_backed,
  p.has_cat_activity,
  p.source_system,
  p.created_at,
  p.updated_at,
  -- Location
  CASE WHEN p.location IS NOT NULL THEN ST_Y(p.location::geometry) ELSE NULL END AS latitude,
  CASE WHEN p.location IS NOT NULL THEN ST_X(p.location::geometry) ELSE NULL END AS longitude,
  -- Stats
  (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = p.place_id)::int AS cat_count,
  (SELECT COUNT(*) FROM sot.person_place pp WHERE pp.place_id = p.place_id)::int AS person_count,
  (SELECT COUNT(*) FROM ops.requests r WHERE r.place_id = p.place_id)::int AS request_count,
  (SELECT COUNT(*) FROM ops.appointments a WHERE a.place_id = p.place_id OR a.inferred_place_id = p.place_id)::int AS appointment_count,
  -- Colony estimate
  (SELECT pce.total_count_observed FROM sot.place_colony_estimates pce WHERE pce.place_id = p.place_id ORDER BY pce.observed_date DESC LIMIT 1) AS colony_estimate,
  -- Context summary
  (SELECT string_agg(DISTINCT pc.context_type::text, ', ') FROM sot.place_contexts pc WHERE pc.place_id = p.place_id) AS context_types
FROM sot.places p
WHERE p.merged_into_place_id IS NULL;
