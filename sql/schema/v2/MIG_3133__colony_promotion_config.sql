-- MIG_3133: Colony promotion — missing tables, config keys, auto-link trigger
--
-- Creates colony_requests, colony_people, colony_observations tables that
-- were defined in v1 archive but never migrated to v2.
-- Adds app_config keys and request_scope auto-populate trigger.

-- ============================================================================
-- 1. Missing colony tables
-- ============================================================================

-- colony_requests — links colonies to related requests (M:N)
CREATE TABLE IF NOT EXISTS sot.colony_requests (
  colony_id UUID NOT NULL REFERENCES sot.colonies(colony_id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES ops.requests(request_id) ON DELETE CASCADE,
  added_by TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT,
  PRIMARY KEY (colony_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_colony_requests_request ON sot.colony_requests(request_id);
COMMENT ON TABLE sot.colony_requests IS 'Links colonies to requests. Soft-delete via deleted_at.';

-- colony_people — people involved with colonies (feeders, contacts, etc.)
CREATE TABLE IF NOT EXISTS sot.colony_people (
  colony_people_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colony_id UUID NOT NULL REFERENCES sot.colonies(colony_id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES sot.people(person_id),
  role_type TEXT NOT NULL DEFAULT 'contact' CHECK (role_type IN (
    'primary_feeder', 'feeder', 'reporter', 'contact', 'property_owner',
    'trapper_assigned', 'trapper_volunteer', 'coordinator', 'veterinary_contact', 'other'
  )),
  is_active BOOLEAN DEFAULT TRUE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  end_reason TEXT,
  notes TEXT,
  confidence NUMERIC(3,2) DEFAULT 0.85,
  assigned_by TEXT,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_colony_people_active
  ON sot.colony_people (colony_id, person_id, role_type) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_colony_people_colony ON sot.colony_people(colony_id);
CREATE INDEX IF NOT EXISTS idx_colony_people_person ON sot.colony_people(person_id);
COMMENT ON TABLE sot.colony_people IS 'People involved with a colony — feeders, contacts, coordinators, trappers. Unique active constraint per (colony, person, role).';

-- colony_observations — staff-entered population observations
CREATE TABLE IF NOT EXISTS sot.colony_observations (
  observation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colony_id UUID NOT NULL REFERENCES sot.colonies(colony_id) ON DELETE CASCADE,
  observation_date DATE NOT NULL,
  total_cats INT,
  total_cats_confidence TEXT CHECK (total_cats_confidence IN ('verified', 'high', 'medium', 'low')),
  fixed_cats INT,
  fixed_cats_confidence TEXT CHECK (fixed_cats_confidence IN ('verified', 'high', 'medium', 'low')),
  unfixed_cats INT,
  notes TEXT,
  observed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_colony_observations_colony ON sot.colony_observations(colony_id);
COMMENT ON TABLE sot.colony_observations IS 'Staff observations of colony population. Each field has independent confidence level.';

-- Idempotent assign function
CREATE OR REPLACE FUNCTION ops.assign_colony_person(
  p_colony_id UUID,
  p_person_id UUID,
  p_role_type TEXT,
  p_assigned_by TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO sot.colony_people (colony_id, person_id, role_type, assigned_by, notes)
  VALUES (p_colony_id, p_person_id, p_role_type, p_assigned_by, p_notes)
  ON CONFLICT (colony_id, person_id, role_type) WHERE is_active = TRUE
  DO UPDATE SET notes = COALESCE(EXCLUDED.notes, sot.colony_people.notes)
  RETURNING colony_people_id INTO v_id;
  RETURN v_id;
END;
$$;

-- Idempotent end function
CREATE OR REPLACE FUNCTION ops.end_colony_person(
  p_colony_id UUID,
  p_person_id UUID,
  p_role_type TEXT,
  p_end_reason TEXT DEFAULT NULL
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
  UPDATE sot.colony_people
  SET is_active = FALSE, ended_at = NOW(), end_reason = p_end_reason
  WHERE colony_id = p_colony_id AND person_id = p_person_id AND role_type = p_role_type AND is_active = TRUE;
  RETURN FOUND;
END;
$$;

-- ============================================================================
-- 2. Config keys
-- ============================================================================

INSERT INTO ops.app_config (key, value, description, category) VALUES
  ('colonies.nearby_radius_m', '300', 'Radius in meters for detecting nearby activity on request detail', 'operational'),
  ('colonies.auto_link_requests', 'true', 'Auto-link new requests to colonies when place is a colony member', 'operational')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 3. Auto-populate request_scope_places from corridor edges
-- ============================================================================

CREATE OR REPLACE FUNCTION ops.auto_populate_request_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_corridor RECORD;
BEGIN
  IF NEW.place_id IS NULL THEN
    RETURN NEW;
  END IF;

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
