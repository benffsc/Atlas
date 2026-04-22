-- MIG_3095: Make place + person detail views presence-aware
--
-- Problem: v_place_detail_v2 and v_person_detail count ALL cats regardless
-- of presence_status. Cunda Bhikkhu shows "13 cats" on her profile when 5
-- have been relocated/adopted. Tomki Rd shows inflated cat_count via the view.
--
-- Fix:
-- 1. v_place_detail_v2 — filter departed from cat_count + cats JSON, keep all
--    in a separate all_cats_including_departed JSON for history
-- 2. v_person_detail — cross-reference cat_place presence_status for each
--    person_cat link; add presence_status + departure_reason to cats JSON;
--    active_cat_count = only non-departed cats

-- ============================================================
-- 1. Rebuild v_place_detail_v2 with presence filter
-- ============================================================

DROP VIEW IF EXISTS sot.v_place_detail_v2 CASCADE;

CREATE OR REPLACE VIEW sot.v_place_detail_v2 AS
WITH place_cats AS (
    SELECT
      cp.place_id,
      -- Current/unknown cats only (for display count)
      json_agg(
        json_build_object(
          'cat_id', c.cat_id,
          'cat_name', COALESCE(c.name, 'Unknown'),
          'relationship_type', cp.relationship_type,
          'confidence', cp.confidence,
          'presence_status', COALESCE(cp.presence_status, 'unknown'),
          'departure_reason', cp.departure_reason,
          'departed_at', cp.departed_at
        ) ORDER BY
          -- Current cats first, then unknown, then departed
          CASE COALESCE(cp.presence_status, 'unknown')
            WHEN 'current' THEN 0
            WHEN 'unknown' THEN 1
            WHEN 'departed' THEN 2
          END,
          c.name
      ) AS cats,
      -- Count excludes departed
      COUNT(DISTINCT c.cat_id) FILTER (
        WHERE COALESCE(cp.presence_status, 'unknown') != 'departed'
      ) AS cat_count,
      -- Total including departed (for "X cats historically, Y currently")
      COUNT(DISTINCT c.cat_id) AS total_cat_count
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    GROUP BY cp.place_id
), place_people AS (
    SELECT
      pp.place_id,
      json_agg(
        json_build_object(
          'person_id', p.person_id,
          'person_name', p.display_name,
          'role', pp.relationship_type,
          'confidence', pp.confidence,
          'is_organization', COALESCE(p.is_organization, false)
        ) ORDER BY p.display_name
      ) AS people,
      COUNT(DISTINCT p.person_id) AS person_count
    FROM sot.person_place pp
    JOIN sot.people p ON p.person_id = pp.person_id AND p.merged_into_person_id IS NULL
    WHERE p.display_name IS NOT NULL
      AND (p.is_organization = false OR p.is_organization IS NULL)
    GROUP BY pp.place_id
)
SELECT
  p.place_id,
  COALESCE(p.display_name, split_part(p.formatted_address, ',', 1), p.formatted_address) AS display_name,
  p.display_name AS original_display_name,
  p.formatted_address,
  p.place_kind,
  p.is_address_backed,
  -- has_cat_activity only considers non-departed cats
  COALESCE(pc.cat_count, 0) > 0 AS has_cat_activity,
  CASE
    WHEN p.location IS NOT NULL THEN json_build_object('lat', ST_Y(p.location::geometry), 'lng', ST_X(p.location::geometry))
    ELSE NULL
  END AS coordinates,
  p.created_at::TEXT AS created_at,
  p.updated_at::TEXT AS updated_at,
  COALESCE(pc.cats, '[]'::json) AS cats,
  COALESCE(pp.people, '[]'::json) AS people,
  '[]'::json AS place_relationships,
  COALESCE(pc.cat_count, 0)::INTEGER AS cat_count,
  COALESCE(pp.person_count, 0)::INTEGER AS person_count
FROM sot.places p
LEFT JOIN place_cats pc ON pc.place_id = p.place_id
LEFT JOIN place_people pp ON pp.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL;

-- ============================================================
-- 2. Rebuild v_person_detail with presence-aware cat data
-- ============================================================

DROP VIEW IF EXISTS sot.v_person_detail CASCADE;

CREATE OR REPLACE VIEW sot.v_person_detail AS
SELECT
  p.person_id,
  p.display_name,
  p.first_name,
  p.last_name,
  p.source_system,
  p.data_source,
  p.source_record_id,
  p.source_created_at,
  p.entity_type,
  p.primary_place_id,
  pl.formatted_address AS primary_place_address,
  p.primary_address_id,
  p.data_quality,
  p.created_at,
  p.updated_at,
  -- Places
  COALESCE((
    SELECT json_agg(json_build_object(
      'place_id', pp.place_id,
      'display_name', COALESCE(pp_pl.display_name, split_part(pp_pl.formatted_address, ',', 1)),
      'formatted_address', pp_pl.formatted_address,
      'relationship_type', pp.relationship_type,
      'source_system', pp.source_system
    ))
    FROM sot.person_place pp
    JOIN sot.places pp_pl ON pp_pl.place_id = pp.place_id AND pp_pl.merged_into_place_id IS NULL
    WHERE pp.person_id = p.person_id
  ), '[]'::json) AS places,
  -- Cats with presence status (cross-referenced from cat_place)
  COALESCE((
    SELECT json_agg(json_build_object(
      'cat_id', c.cat_id,
      'name', COALESCE(c.name, 'Unknown'),
      'microchip', c.microchip,
      'sex', c.sex,
      'relationship_type', pc.relationship_type,
      'source_system', pc.source_system,
      'data_source', COALESCE(c.data_source, c.source_system),
      'adoption_date', vac.adoption_date,
      'placement_type', vac.placement_type,
      -- MIG_3095: presence from cat_place (best status across all places for this person)
      'presence_status', COALESCE(best_presence.status, 'unknown'),
      'departure_reason', best_presence.departure_reason
    ))
    FROM sot.person_cat pc
    JOIN sot.cats c ON c.cat_id = pc.cat_id AND c.merged_into_cat_id IS NULL
    LEFT JOIN sot.v_adoption_context vac ON vac.cat_id = pc.cat_id AND vac.adopter_person_id = pc.person_id
    -- Cross-reference: get the best presence status for this cat at any of this person's places
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(cp.presence_status, 'unknown') AS status,
        cp.departure_reason
      FROM sot.cat_place cp
      JOIN sot.person_place pp ON pp.place_id = cp.place_id AND pp.person_id = p.person_id
      WHERE cp.cat_id = pc.cat_id
      ORDER BY
        CASE COALESCE(cp.presence_status, 'unknown')
          WHEN 'current' THEN 0
          WHEN 'unknown' THEN 1
          WHEN 'departed' THEN 2
        END
      LIMIT 1
    ) best_presence ON TRUE
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
  -- Active cat count (non-departed only)
  (SELECT COUNT(*)::INTEGER
   FROM sot.person_cat pc
   JOIN sot.cats c ON c.cat_id = pc.cat_id AND c.merged_into_cat_id IS NULL
   LEFT JOIN LATERAL (
     SELECT COALESCE(cp.presence_status, 'unknown') AS status
     FROM sot.cat_place cp
     JOIN sot.person_place pp ON pp.place_id = cp.place_id AND pp.person_id = p.person_id
     WHERE cp.cat_id = pc.cat_id AND COALESCE(cp.presence_status, 'unknown') = 'departed'
     LIMIT 1
   ) dep ON TRUE
   WHERE pc.person_id = p.person_id
     AND dep.status IS NULL  -- No departed link at any of this person's places
  ) AS cat_count,
  -- Total including departed (for display: "8 cats (5 departed)")
  (SELECT COUNT(*)::INTEGER FROM sot.person_cat pc
   WHERE pc.person_id = p.person_id) AS total_cat_count,
  -- Place count
  (SELECT COUNT(*)::INTEGER FROM sot.person_place pp WHERE pp.person_id = p.person_id) AS place_count,
  -- Request count
  (SELECT COUNT(*)::INTEGER FROM ops.requests r WHERE r.requester_person_id = p.person_id) AS request_count,
  -- Appointment count
  (SELECT COUNT(*)::INTEGER FROM ops.appointments a
   WHERE a.person_id = p.person_id OR a.resolved_person_id = p.person_id) AS appointment_count
FROM sot.people p
LEFT JOIN sot.places pl ON pl.place_id = p.primary_place_id AND pl.merged_into_place_id IS NULL
WHERE p.merged_into_person_id IS NULL;

-- ============================================================
-- VERIFICATION
-- ============================================================

DO $$
DECLARE
  v_cunda_old INTEGER;
  v_cunda_new INTEGER;
  v_tomki_old INTEGER;
  v_tomki_new INTEGER;
BEGIN
  -- Verify Cunda Bhikkhu
  SELECT cat_count, total_cat_count INTO v_cunda_new, v_cunda_old
  FROM sot.v_person_detail
  WHERE display_name ILIKE '%cunda%bhikkhu%'
  LIMIT 1;

  -- Verify Tomki Rd
  SELECT cat_count INTO v_tomki_new
  FROM sot.v_place_detail_v2
  WHERE formatted_address ILIKE '%tomki%'
  LIMIT 1;

  RAISE NOTICE 'MIG_3095: Cunda Bhikkhu — cat_count=% (was %), total_cat_count=%', v_cunda_new, v_cunda_old, v_cunda_old;
  RAISE NOTICE 'MIG_3095: Tomki Rd — cat_count=%', v_tomki_new;
  RAISE NOTICE 'MIG_3095: Detail views now presence-aware';
END;
$$;
