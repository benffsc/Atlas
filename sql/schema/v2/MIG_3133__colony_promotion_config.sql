-- MIG_3131: Colony promotion — config keys + auto-link trigger
--
-- Adds app_config keys for colony feature and creates a trigger to
-- auto-populate request_scope_places when a request is created at a
-- corridor place.

-- ============================================================================
-- 1. Config keys
-- ============================================================================

INSERT INTO ops.app_config (key, value, description, category) VALUES
  ('colonies.nearby_radius_m', '300', 'Radius in meters for detecting nearby activity on request detail', 'operational'),
  ('colonies.auto_link_requests', 'true', 'Auto-link new requests to colonies when place is a colony member', 'operational')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 2. Auto-populate request_scope_places from corridor edges
-- ============================================================================
-- When a request is created at a place that has shared_colony edges,
-- automatically create request_scope_places entries so the request
-- knows about the full corridor.

CREATE OR REPLACE FUNCTION ops.auto_populate_request_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_corridor RECORD;
BEGIN
  -- Only fire if the request has a place_id
  IF NEW.place_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if this place is in a corridor (has shared_colony edges)
  -- Insert anchor + scope entries for all corridor places
  FOR v_corridor IN
    SELECT place_id, relationship
    FROM sot.get_corridor_places(NEW.place_id)
  LOOP
    INSERT INTO ops.request_scope_places (request_id, place_id, role, added_by)
    VALUES (
      NEW.request_id,
      v_corridor.place_id,
      CASE WHEN v_corridor.relationship = 'self' THEN 'anchor' ELSE 'scope' END,
      'auto_corridor'
    )
    ON CONFLICT (request_id, place_id) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Only create trigger if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_auto_request_scope'
  ) THEN
    CREATE TRIGGER trg_auto_request_scope
      AFTER INSERT ON ops.requests
      FOR EACH ROW
      EXECUTE FUNCTION ops.auto_populate_request_scope();
  END IF;
END $$;

COMMENT ON FUNCTION ops.auto_populate_request_scope IS
  'Auto-populates request_scope_places when a request is created at a place with shared_colony corridor edges.';
