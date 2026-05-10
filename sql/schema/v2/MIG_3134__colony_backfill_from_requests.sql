-- MIG_3132: Colony backfill — auto-create colonies from historical patterns
--
-- Creates colonies for:
-- 1. Places with 2+ non-archived requests (repeat sites)
-- 2. Existing shared_colony edges that don't have a colony yet
--
-- Staff can review and rename/merge via the colony detail page.
-- Does NOT create colonies for every place — only repeat/corridor sites.

-- ============================================================================
-- 1. Repeat-request sites → colonies
-- ============================================================================
-- Find places with 2+ non-archived requests and create a colony for each.
-- Colony name = display_name or street from formatted_address.

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
    -- Generate colony name from address
    v_colony_name := COALESCE(
      v_place.display_name,
      -- Extract street from "1234 Main St, Santa Rosa, CA 95404"
      split_part(v_place.formatted_address, ',', 1),
      'Colony ' || v_place.place_id::TEXT
    );

    -- Create colony
    INSERT INTO sot.colonies (name, colony_status, description, created_by_staff_id)
    VALUES (v_colony_name, 'active', 'Auto-created from ' || v_place.request_count || ' requests at this address', NULL)
    RETURNING colony_id INTO v_colony_id;

    -- Link the place
    INSERT INTO sot.colony_places (colony_id, place_id, is_primary, relationship_type, added_by)
    VALUES (v_colony_id, v_place.place_id, TRUE, 'colony_site', 'MIG_3132')
    ON CONFLICT (colony_id, place_id) DO NOTHING;

    -- Link all requests at this place
    INSERT INTO sot.colony_requests (colony_id, request_id, added_by)
    SELECT v_colony_id, r.request_id, 'MIG_3132'
    FROM ops.requests r
    WHERE r.place_id = v_place.place_id
      AND r.merged_into_request_id IS NULL
    ON CONFLICT (colony_id, request_id) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'MIG_3132: Created % colonies from repeat-request sites', v_count;
END $$;

-- ============================================================================
-- 2. Corridor edges → ensure colony exists for connected groups
-- ============================================================================
-- For each connected component of shared_colony edges, if no colony exists,
-- create one and link all places + their requests.

DO $$
DECLARE
  v_edge RECORD;
  v_corridor_places UUID[];
  v_colony_id UUID;
  v_colony_name TEXT;
  v_pid UUID;
  v_count INT := 0;
BEGIN
  -- Find all shared_colony edges where NEITHER place is in a colony
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
    -- Get all corridor places for this seed
    SELECT ARRAY_AGG(place_id) INTO v_corridor_places
    FROM sot.get_corridor_places(v_edge.place_id_from);

    -- Skip if any of these places already got a colony in this loop
    IF EXISTS (
      SELECT 1 FROM sot.colony_places cp
      JOIN sot.colonies c ON c.colony_id = cp.colony_id AND c.deleted_at IS NULL
      WHERE cp.place_id = ANY(v_corridor_places) AND cp.is_active = TRUE
    ) THEN
      CONTINUE;
    END IF;

    -- Name from the first place's address
    SELECT COALESCE(p.display_name, split_part(p.formatted_address, ',', 1))
    INTO v_colony_name
    FROM sot.places p
    WHERE p.place_id = v_edge.place_id_from;

    v_colony_name := COALESCE(v_colony_name, 'Corridor Colony') || ' Corridor';

    -- Create colony
    INSERT INTO sot.colonies (name, colony_status, description, created_by_staff_id)
    VALUES (v_colony_name, 'active', 'Auto-created from shared_colony corridor (' || ARRAY_LENGTH(v_corridor_places, 1) || ' addresses)', NULL)
    RETURNING colony_id INTO v_colony_id;

    -- Link all corridor places
    FOREACH v_pid IN ARRAY v_corridor_places
    LOOP
      INSERT INTO sot.colony_places (colony_id, place_id, is_primary, relationship_type, added_by)
      VALUES (v_colony_id, v_pid, v_pid = v_edge.place_id_from, 'colony_site', 'MIG_3132')
      ON CONFLICT (colony_id, place_id) DO NOTHING;

      -- Link all requests at this place
      INSERT INTO sot.colony_requests (colony_id, request_id, added_by)
      SELECT v_colony_id, r.request_id, 'MIG_3132'
      FROM ops.requests r
      WHERE r.place_id = v_pid
        AND r.merged_into_request_id IS NULL
      ON CONFLICT (colony_id, request_id) DO NOTHING;
    END LOOP;

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'MIG_3132: Created % colonies from corridor edges', v_count;
END $$;
