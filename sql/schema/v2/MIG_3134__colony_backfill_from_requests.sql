-- MIG_3134: Colony backfill — auto-create colonies from historical patterns
--
-- Creates colonies for:
-- 1. Places with 2+ non-archived requests (repeat sites)
-- 2. Existing shared_colony edges that don't have a colony yet

-- ============================================================================
-- 1. Repeat-request sites -> colonies
-- ============================================================================

DO $$
DECLARE
  v_place RECORD;
  v_colony_id UUID;
  v_colony_name TEXT;
  v_count INT := 0;
BEGIN
  FOR v_place IN
    SELECT
      p.place_id,
      p.display_name,
      p.formatted_address,
      COUNT(*) AS request_count
    FROM ops.requests r
    JOIN sot.places p ON p.place_id = r.place_id AND p.merged_into_place_id IS NULL
    WHERE r.merged_into_request_id IS NULL
      AND r.is_archived = FALSE
    GROUP BY p.place_id, p.display_name, p.formatted_address
    HAVING COUNT(*) >= 2
    -- Skip places already in a colony
    AND NOT EXISTS (
      SELECT 1 FROM sot.colony_places cp
      JOIN sot.colonies c ON c.colony_id = cp.colony_id AND c.deleted_at IS NULL
      WHERE cp.place_id = p.place_id AND cp.is_active = TRUE
    )
  LOOP
    v_colony_name := COALESCE(
      v_place.display_name,
      split_part(v_place.formatted_address, ',', 1),
      'Colony ' || v_place.place_id::TEXT
    );

    INSERT INTO sot.colonies (name, colony_status, description)
    VALUES (v_colony_name, 'active', 'Auto-created from ' || v_place.request_count || ' requests at this address')
    RETURNING colony_id INTO v_colony_id;

    INSERT INTO sot.colony_places (colony_id, place_id, is_primary, place_role)
    VALUES (v_colony_id, v_place.place_id, TRUE, 'core_site')
    ON CONFLICT (colony_id, place_id) DO NOTHING;

    INSERT INTO sot.colony_requests (colony_id, request_id, added_by)
    SELECT v_colony_id, r.request_id, 'MIG_3134'
    FROM ops.requests r
    WHERE r.place_id = v_place.place_id
      AND r.merged_into_request_id IS NULL
    ON CONFLICT (colony_id, request_id) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'MIG_3134: Created % colonies from repeat-request sites', v_count;
END $$;

-- ============================================================================
-- 2. Corridor edges -> ensure colony exists for connected groups
-- ============================================================================

DO $$
DECLARE
  v_edge RECORD;
  v_corridor_places UUID[];
  v_colony_id UUID;
  v_colony_name TEXT;
  v_pid UUID;
  v_count INT := 0;
BEGIN
  FOR v_edge IN
    SELECT DISTINCT e.place_id_from
    FROM sot.place_place_edges e
    WHERE e.relationship_type = 'shared_colony'
    AND NOT EXISTS (
      SELECT 1 FROM sot.colony_places cp
      JOIN sot.colonies c ON c.colony_id = cp.colony_id AND c.deleted_at IS NULL
      WHERE cp.place_id = e.place_id_from AND cp.is_active = TRUE
    )
    AND NOT EXISTS (
      SELECT 1 FROM sot.colony_places cp
      JOIN sot.colonies c ON c.colony_id = cp.colony_id AND c.deleted_at IS NULL
      WHERE cp.place_id = e.place_id_to AND cp.is_active = TRUE
    )
  LOOP
    SELECT ARRAY_AGG(place_id) INTO v_corridor_places
    FROM sot.get_corridor_places(v_edge.place_id_from);

    IF EXISTS (
      SELECT 1 FROM sot.colony_places cp
      JOIN sot.colonies c ON c.colony_id = cp.colony_id AND c.deleted_at IS NULL
      WHERE cp.place_id = ANY(v_corridor_places) AND cp.is_active = TRUE
    ) THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(p.display_name, split_part(p.formatted_address, ',', 1))
    INTO v_colony_name
    FROM sot.places p
    WHERE p.place_id = v_edge.place_id_from;

    v_colony_name := COALESCE(v_colony_name, 'Corridor Colony') || ' Corridor';

    INSERT INTO sot.colonies (name, colony_status, description)
    VALUES (v_colony_name, 'active', 'Auto-created from shared_colony corridor (' || ARRAY_LENGTH(v_corridor_places, 1) || ' addresses)')
    RETURNING colony_id INTO v_colony_id;

    FOREACH v_pid IN ARRAY v_corridor_places
    LOOP
      INSERT INTO sot.colony_places (colony_id, place_id, is_primary, place_role)
      VALUES (v_colony_id, v_pid, v_pid = v_edge.place_id_from, 'core_site')
      ON CONFLICT (colony_id, place_id) DO NOTHING;

      INSERT INTO sot.colony_requests (colony_id, request_id, added_by)
      SELECT v_colony_id, r.request_id, 'MIG_3134'
      FROM ops.requests r
      WHERE r.place_id = v_pid
        AND r.merged_into_request_id IS NULL
      ON CONFLICT (colony_id, request_id) DO NOTHING;
    END LOOP;

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'MIG_3134: Created % colonies from corridor edges', v_count;
END $$;
