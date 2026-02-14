-- MIG_2035: Create sot.v_place_detail_v2 view for Place details page
-- Date: 2026-02-13
-- Issue: Place details showed "Failed to load place details" - view didn't exist

CREATE OR REPLACE VIEW sot.v_place_detail_v2 AS
SELECT
  p.place_id,
  p.display_name,
  p.display_name AS original_display_name,
  p.formatted_address,
  p.place_kind::text,
  p.is_address_backed,
  p.has_cat_activity,
  CASE WHEN p.location IS NOT NULL THEN
    json_build_object('lat', ST_Y(p.location::geometry), 'lng', ST_X(p.location::geometry))
  ELSE NULL END AS coordinates,
  p.created_at::text,
  p.updated_at::text,
  COALESCE((
    SELECT json_agg(json_build_object(
      'cat_id', c.cat_id,
      'cat_name', COALESCE(c.name, 'Unknown'),
      'sex', c.sex,
      'microchip', c.microchip,
      'source_system', c.source_system
    ))
    FROM sot.cat_place cpr
    JOIN sot.cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL
    WHERE cpr.place_id = p.place_id
  ), '[]'::json) AS cats,
  COALESCE((
    SELECT json_agg(json_build_object(
      'person_id', per.person_id,
      'display_name', COALESCE(per.display_name, per.first_name || ' ' || per.last_name),
      'role', ppr.role::text
    ))
    FROM sot.person_place ppr
    JOIN sot.people per ON per.person_id = ppr.person_id AND per.merged_into_person_id IS NULL
    WHERE ppr.place_id = p.place_id
  ), '[]'::json) AS people,
  '[]'::json AS place_relationships,
  COALESCE((SELECT COUNT(DISTINCT cpr.cat_id) FROM sot.cat_place cpr WHERE cpr.place_id = p.place_id), 0)::int AS cat_count,
  COALESCE((SELECT COUNT(DISTINCT ppr.person_id) FROM sot.person_place ppr JOIN sot.people per ON per.person_id = ppr.person_id WHERE ppr.place_id = p.place_id AND per.merged_into_person_id IS NULL), 0)::int AS person_count
FROM sot.places p
WHERE p.merged_into_place_id IS NULL;
