-- MIG_222: Smart Place Names
--
-- Problem: Places are showing client names (like "Lee Anderson") instead of
-- addresses when the place display_name was set from the requester name.
--
-- Solution: Update views to use address when place name matches requester name

\echo ''
\echo '=============================================='
\echo 'MIG_222: Smart Place Names'
\echo '=============================================='
\echo ''

-- Update v_request_list view
DROP VIEW IF EXISTS trapper.v_request_list CASCADE;

CREATE VIEW trapper.v_request_list AS
SELECT
    r.request_id,
    r.status::TEXT,
    r.priority::TEXT,
    r.summary,
    r.estimated_cat_count,
    r.has_kittens,
    r.scheduled_date,
    r.assigned_to,
    r.assigned_trapper_type::TEXT,
    r.created_at,
    r.updated_at,
    r.source_created_at,
    r.last_activity_at,
    r.hold_reason::TEXT,
    -- Place info (use address if place name matches requester name)
    r.place_id,
    CASE
      WHEN p.display_name IS NOT NULL AND per.display_name IS NOT NULL
        AND LOWER(TRIM(p.display_name)) = LOWER(TRIM(per.display_name))
      THEN COALESCE(SPLIT_PART(p.formatted_address, ',', 1), p.formatted_address)
      ELSE COALESCE(p.display_name, SPLIT_PART(p.formatted_address, ',', 1))
    END AS place_name,
    p.formatted_address AS place_address,
    p.safety_notes AS place_safety_notes,
    sa.locality AS place_city,
    p.service_zone,
    ST_Y(p.location::geometry) AS latitude,
    ST_X(p.location::geometry) AS longitude,
    -- Requester info
    r.requester_person_id,
    per.display_name AS requester_name,
    -- Cat count
    (SELECT COUNT(*) FROM trapper.request_cats rc WHERE rc.request_id = r.request_id) AS linked_cat_count,
    -- Staleness
    EXTRACT(DAY FROM NOW() - COALESCE(r.last_activity_at, r.created_at))::INT AS days_since_activity,
    -- Is this a legacy Airtable request?
    r.source_system = 'airtable' AS is_legacy_request
FROM trapper.sot_requests r
LEFT JOIN trapper.places p ON p.place_id = r.place_id
LEFT JOIN trapper.sot_addresses sa ON sa.address_id = p.sot_address_id
LEFT JOIN trapper.sot_people per ON per.person_id = r.requester_person_id;

-- Update v_place_detail_v2 view with smart name logic
DROP VIEW IF EXISTS trapper.v_place_detail_v2 CASCADE;

CREATE OR REPLACE VIEW trapper.v_place_detail_v2 AS
WITH place_people AS (
  -- Get all people associated with each place
  SELECT
    ppr.place_id,
    array_agg(LOWER(TRIM(p.display_name))) AS person_names
  FROM trapper.person_place_relationships ppr
  JOIN trapper.sot_people p ON p.person_id = ppr.person_id
  WHERE p.merged_into_person_id IS NULL
  GROUP BY ppr.place_id
)
SELECT
    pl.place_id,
    -- Smart display name: use address if name matches any associated person
    CASE
      WHEN pp.person_names IS NOT NULL
        AND LOWER(TRIM(pl.display_name)) = ANY(pp.person_names)
      THEN COALESCE(SPLIT_PART(pl.formatted_address, ',', 1), pl.formatted_address, pl.display_name)
      ELSE COALESCE(pl.display_name, SPLIT_PART(pl.formatted_address, ',', 1))
    END AS display_name,
    -- Keep original name for reference
    pl.display_name AS original_display_name,
    pl.formatted_address,
    pl.place_kind,
    pl.is_address_backed,
    pl.has_cat_activity,
    sa.locality,
    sa.postal_code,
    sa.admin_area_1 AS state_province,
    CASE WHEN pl.location IS NOT NULL THEN
        jsonb_build_object(
            'lat', ST_Y(pl.location::geometry),
            'lng', ST_X(pl.location::geometry)
        )
    ELSE NULL END AS coordinates,
    pl.created_at,
    pl.updated_at,
    -- Cats at this place
    (SELECT jsonb_agg(jsonb_build_object(
        'cat_id', cpr.cat_id,
        'cat_name', c.display_name,
        'relationship_type', cpr.relationship_type,
        'confidence', cpr.confidence
    ) ORDER BY c.display_name)
     FROM trapper.cat_place_relationships cpr
     JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
     WHERE cpr.place_id = pl.place_id) AS cats,
    -- People at this place (FILTERED to valid names only)
    (SELECT jsonb_agg(jsonb_build_object(
        'person_id', ppr.person_id,
        'person_name', p.display_name,
        'role', ppr.role,
        'confidence', ppr.confidence
    ) ORDER BY p.display_name)
     FROM trapper.person_place_relationships ppr
     JOIN trapper.sot_people p ON p.person_id = ppr.person_id
     WHERE ppr.place_id = pl.place_id
       AND p.merged_into_person_id IS NULL
       AND trapper.is_valid_person_name(p.display_name) = TRUE) AS people,
    -- Place relationships (from edges)
    (SELECT jsonb_agg(jsonb_build_object(
        'place_id', CASE WHEN ppe.place_id_a = pl.place_id THEN ppe.place_id_b ELSE ppe.place_id_a END,
        'place_name', CASE WHEN ppe.place_id_a = pl.place_id THEN pl2.display_name ELSE pl1.display_name END,
        'relationship_type', rt.code,
        'relationship_label', rt.label
    ) ORDER BY rt.label)
     FROM trapper.place_place_edges ppe
     JOIN trapper.relationship_types rt ON rt.id = ppe.relationship_type_id
     LEFT JOIN trapper.places pl1 ON pl1.place_id = ppe.place_id_a
     LEFT JOIN trapper.places pl2 ON pl2.place_id = ppe.place_id_b
     WHERE ppe.place_id_a = pl.place_id OR ppe.place_id_b = pl.place_id) AS place_relationships,
    -- Stats (filtered)
    (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = pl.place_id) AS cat_count,
    (SELECT COUNT(*)
     FROM trapper.person_place_relationships ppr
     JOIN trapper.sot_people p ON p.person_id = ppr.person_id
     WHERE ppr.place_id = pl.place_id
       AND p.merged_into_person_id IS NULL
       AND trapper.is_valid_person_name(p.display_name) = TRUE) AS person_count
FROM trapper.places pl
LEFT JOIN trapper.sot_addresses sa ON sa.address_id = pl.sot_address_id
LEFT JOIN place_people pp ON pp.place_id = pl.place_id
WHERE pl.is_address_backed = true;

COMMENT ON VIEW trapper.v_place_detail_v2 IS
'Full place detail for API including cats, people, and place relationships.
display_name uses smart logic: shows address if name matches any associated person.
original_display_name contains the raw stored name for editing purposes.';

\echo ''
\echo 'MIG_222 complete!'
\echo ''
\echo 'Changes:'
\echo '  - v_request_list: place_name uses address when it matches requester name'
\echo '  - v_request_list: Added is_legacy_request flag and lat/lng'
\echo '  - v_place_detail_v2: display_name uses address when it matches any associated person'
\echo '  - v_place_detail_v2: Added original_display_name for reference'
\echo ''
