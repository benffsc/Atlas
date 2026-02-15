-- MIG_2310: Create V2 place detail view in sot schema
--
-- Purpose: Port v_place_detail_v2 from trapper schema to sot schema
-- This view aggregates place data with cats and people for the place detail API
--
-- V2 Architecture:
-- - Uses sot.places, sot.cats, sot.people (V2 tables)
-- - Uses sot.cat_place and sot.person_place (V2 relationship tables, no _relationships suffix)
-- - Respects merge chains (merged_into_*_id IS NULL)

-- Drop existing view if it exists (to allow column type changes)
DROP VIEW IF EXISTS sot.v_place_detail_v2;

CREATE VIEW sot.v_place_detail_v2 AS
WITH place_cats AS (
  SELECT
    cp.place_id,
    json_agg(
      json_build_object(
        'cat_id', c.cat_id,
        'cat_name', COALESCE(c.name, 'Unknown'),
        'relationship_type', cp.relationship_type,
        'confidence', cp.confidence
      ) ORDER BY c.name
    ) AS cats,
    COUNT(DISTINCT c.cat_id) AS cat_count
  FROM sot.cat_place cp
  JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
  GROUP BY cp.place_id
),
place_people AS (
  SELECT
    pp.place_id,
    json_agg(
      json_build_object(
        'person_id', p.person_id,
        'person_name', p.display_name,
        'role', pp.relationship_type,
        'confidence', pp.confidence
      ) ORDER BY p.display_name
    ) AS people,
    COUNT(DISTINCT p.person_id) AS person_count
  FROM sot.person_place pp
  JOIN sot.people p ON p.person_id = pp.person_id AND p.merged_into_person_id IS NULL
  WHERE p.display_name IS NOT NULL
  GROUP BY pp.place_id
)
SELECT
  p.place_id,
  COALESCE(p.display_name, split_part(p.formatted_address, ',', 1), p.formatted_address) AS display_name,
  p.display_name AS original_display_name,
  p.formatted_address,
  p.place_kind::text AS place_kind,
  p.is_address_backed,
  COALESCE(pc.cat_count, 0) > 0 AS has_cat_activity,
  CASE
    WHEN p.location IS NOT NULL THEN
      json_build_object('lat', ST_Y(p.location::geometry), 'lng', ST_X(p.location::geometry))
    ELSE NULL
  END AS coordinates,
  p.created_at::text AS created_at,
  p.updated_at::text AS updated_at,
  COALESCE(pc.cats, '[]'::json) AS cats,
  COALESCE(pp.people, '[]'::json) AS people,
  '[]'::json AS place_relationships,
  COALESCE(pc.cat_count, 0)::int AS cat_count,
  COALESCE(pp.person_count, 0)::int AS person_count
FROM sot.places p
LEFT JOIN place_cats pc ON pc.place_id = p.place_id
LEFT JOIN place_people pp ON pp.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL;

-- Verify the view works
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM sot.v_place_detail_v2 LIMIT 1;
  RAISE NOTICE 'MIG_2310: sot.v_place_detail_v2 created successfully';
END;
$$;
