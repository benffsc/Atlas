-- MIG_3125: Place Corridors — structured multi-place TNR operations
--
-- Problem: Cat populations span multiple addresses. Montecito Ave (5 addresses,
-- 5055-5212) and Dutton Ave (4 addresses, 1152-1160) are managed as single
-- operations but the DB has no structured way to represent this.
--
-- Solution:
-- 1. shared_colony relationship type in sot.relationship_types
-- 2. ops.request_scope_places join table (request → multiple places)
-- 3. sot.get_corridor_places() recursive function
-- 4. Backfill known corridors

-- ============================================================================
-- 1. Relationship type
-- ============================================================================

INSERT INTO sot.relationship_types (type_key, type_label, applies_to, is_symmetric, description)
VALUES ('shared_colony', 'Shared Colony', 'place_place', true,
        'Places sharing a cat population — cats move freely between these addresses. Used for street corridors and multi-parcel TNR operations.')
ON CONFLICT (type_key) DO NOTHING;

-- ============================================================================
-- 2. Request scope places
-- ============================================================================

CREATE TABLE IF NOT EXISTS ops.request_scope_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES ops.requests(request_id) ON DELETE CASCADE,
  place_id UUID NOT NULL REFERENCES sot.places(place_id),
  role TEXT NOT NULL DEFAULT 'scope' CHECK (role IN ('anchor', 'scope', 'adjacent')),
  notes TEXT,
  added_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_id, place_id)
);

CREATE INDEX IF NOT EXISTS idx_rsp_request ON ops.request_scope_places(request_id);
CREATE INDEX IF NOT EXISTS idx_rsp_place ON ops.request_scope_places(place_id);

COMMENT ON TABLE ops.request_scope_places IS 'Links a request to all places in its operational scope. anchor = primary place, scope = actively working, adjacent = aware but not active.';

-- ============================================================================
-- 3. Corridor query function
-- ============================================================================

CREATE OR REPLACE FUNCTION sot.get_corridor_places(p_place_id UUID)
RETURNS TABLE(place_id UUID, display_name TEXT, formatted_address TEXT, relationship TEXT)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE corridor AS (
    SELECT p_place_id AS place_id, 0 AS depth
    UNION
    SELECT
      CASE WHEN e.place_id_from = c.place_id THEN e.place_id_to ELSE e.place_id_from END,
      c.depth + 1
    FROM corridor c
    JOIN sot.place_place_edges e
      ON (e.place_id_from = c.place_id OR e.place_id_to = c.place_id)
    WHERE e.relationship_type = 'shared_colony'
      AND c.depth < 5
  )
  SELECT DISTINCT p.place_id, p.display_name, p.formatted_address,
    CASE WHEN p.place_id = p_place_id THEN 'self' ELSE 'corridor' END AS relationship
  FROM corridor c
  JOIN sot.places p ON p.place_id = c.place_id
    AND p.merged_into_place_id IS NULL;
$$;

COMMENT ON FUNCTION sot.get_corridor_places IS 'Returns all places in a shared_colony corridor via recursive edge traversal. Max depth 5.';

-- Corridor cat stats (aggregate across all corridor places)
CREATE OR REPLACE FUNCTION sot.get_corridor_cat_stats(p_place_id UUID)
RETURNS TABLE(total_cats BIGINT, altered_cats BIGINT, intact_cats BIGINT, corridor_size INT)
LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(DISTINCT cat.cat_id) AS total_cats,
    COUNT(DISTINCT cat.cat_id) FILTER (WHERE cat.altered_status IN ('spayed','neutered','altered')) AS altered_cats,
    COUNT(DISTINCT cat.cat_id) FILTER (WHERE cat.altered_status IN ('intact')) AS intact_cats,
    (SELECT COUNT(*)::INT FROM sot.get_corridor_places(p_place_id)) AS corridor_size
  FROM sot.get_corridor_places(p_place_id) cp
  JOIN sot.cat_place cpl ON cpl.place_id = cp.place_id
    AND COALESCE(cpl.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
  JOIN sot.cats cat ON cat.cat_id = cpl.cat_id AND cat.merged_into_cat_id IS NULL;
$$;

-- ============================================================================
-- 4. Backfill known corridors
-- ============================================================================

DO $$
DECLARE
  -- Montecito Ave corridor
  v_5055 UUID; v_5100 UUID; v_5123 UUID; v_5209 UUID; v_5212 UUID;
  v_montecito_request UUID;
  -- Dutton Ave lot
  v_1152 UUID; v_1156 UUID; v_1158 UUID; v_1160 UUID;
  v_dutton_request UUID;
BEGIN
  -- === Montecito Ave ===
  SELECT place_id INTO v_5055 FROM sot.places WHERE formatted_address ILIKE '%5055 Montecito Ave%' AND merged_into_place_id IS NULL LIMIT 1;
  SELECT place_id INTO v_5100 FROM sot.places WHERE formatted_address ILIKE '%5100 Montecito Ave%' AND merged_into_place_id IS NULL LIMIT 1;
  SELECT place_id INTO v_5123 FROM sot.places WHERE formatted_address ILIKE '%5123 Montecito Ave%' AND merged_into_place_id IS NULL LIMIT 1;
  SELECT place_id INTO v_5209 FROM sot.places WHERE formatted_address ILIKE '%5209 Montecito Ave%' AND merged_into_place_id IS NULL LIMIT 1;
  SELECT place_id INTO v_5212 FROM sot.places WHERE formatted_address ILIKE '%5212 Montecito Ave%' AND merged_into_place_id IS NULL LIMIT 1;

  IF v_5123 IS NOT NULL THEN
    -- shared_colony edges (hub from 5123)
    IF v_5055 IS NOT NULL THEN INSERT INTO sot.place_place_edges (place_id_from, place_id_to, relationship_type, evidence_type, confidence) VALUES (v_5123, v_5055, 'shared_colony', 'staff_observation', 1.0) ON CONFLICT DO NOTHING; END IF;
    IF v_5100 IS NOT NULL THEN INSERT INTO sot.place_place_edges (place_id_from, place_id_to, relationship_type, evidence_type, confidence) VALUES (v_5123, v_5100, 'shared_colony', 'staff_observation', 1.0) ON CONFLICT DO NOTHING; END IF;
    IF v_5209 IS NOT NULL THEN INSERT INTO sot.place_place_edges (place_id_from, place_id_to, relationship_type, evidence_type, confidence) VALUES (v_5123, v_5209, 'shared_colony', 'staff_observation', 1.0) ON CONFLICT DO NOTHING; END IF;
    IF v_5212 IS NOT NULL THEN INSERT INTO sot.place_place_edges (place_id_from, place_id_to, relationship_type, evidence_type, confidence) VALUES (v_5123, v_5212, 'shared_colony', 'staff_observation', 1.0) ON CONFLICT DO NOTHING; END IF;

    -- Request scope (find the working request at 5123)
    SELECT request_id INTO v_montecito_request FROM ops.requests WHERE place_id = v_5123 AND merged_into_request_id IS NULL AND status NOT IN ('completed','cancelled') ORDER BY created_at DESC LIMIT 1;
    IF v_montecito_request IS NOT NULL THEN
      INSERT INTO ops.request_scope_places (request_id, place_id, role, notes, added_by) VALUES (v_montecito_request, v_5123, 'anchor', 'Patrick Geary property, 33 cats, anchor site', 'MIG_3125') ON CONFLICT DO NOTHING;
      IF v_5055 IS NOT NULL THEN INSERT INTO ops.request_scope_places (request_id, place_id, role, notes, added_by) VALUES (v_montecito_request, v_5055, 'scope', 'Tanya Setterberg, completed prior request', 'MIG_3125') ON CONFLICT DO NOTHING; END IF;
      IF v_5100 IS NOT NULL THEN INSERT INTO ops.request_scope_places (request_id, place_id, role, notes, added_by) VALUES (v_montecito_request, v_5100, 'scope', 'Ian Alexander, suspected kittens under shed', 'MIG_3125') ON CONFLICT DO NOTHING; END IF;
      IF v_5209 IS NOT NULL THEN INSERT INTO ops.request_scope_places (request_id, place_id, role, notes, added_by) VALUES (v_montecito_request, v_5209, 'scope', 'Nadalie Cordova, feeding station, kittens reported', 'MIG_3125') ON CONFLICT DO NOTHING; END IF;
      IF v_5212 IS NOT NULL THEN INSERT INTO ops.request_scope_places (request_id, place_id, role, notes, added_by) VALUES (v_montecito_request, v_5212, 'scope', 'Pedroncelli property, mama + 5 kittens, Diane Fairclough trapping', 'MIG_3125') ON CONFLICT DO NOTHING; END IF;
    END IF;

    RAISE NOTICE 'MIG_3125: Montecito corridor created (5 places, request %)' , v_montecito_request;
  END IF;

  -- === Dutton Ave lot ===
  SELECT place_id INTO v_1152 FROM sot.places WHERE formatted_address ILIKE '%1152 Dutton%' AND merged_into_place_id IS NULL LIMIT 1;
  SELECT place_id INTO v_1156 FROM sot.places WHERE formatted_address ILIKE '%1156 Dutton%' AND merged_into_place_id IS NULL LIMIT 1;
  SELECT place_id INTO v_1158 FROM sot.places WHERE formatted_address ILIKE '%1158 Dutton%' AND merged_into_place_id IS NULL LIMIT 1;
  SELECT place_id INTO v_1160 FROM sot.places WHERE formatted_address ILIKE '%1160 Dutton%' AND merged_into_place_id IS NULL LIMIT 1;

  IF v_1152 IS NOT NULL THEN
    IF v_1156 IS NOT NULL THEN INSERT INTO sot.place_place_edges (place_id_from, place_id_to, relationship_type, evidence_type, confidence) VALUES (v_1152, v_1156, 'shared_colony', 'staff_observation', 1.0) ON CONFLICT DO NOTHING; END IF;
    IF v_1158 IS NOT NULL THEN INSERT INTO sot.place_place_edges (place_id_from, place_id_to, relationship_type, evidence_type, confidence) VALUES (v_1152, v_1158, 'shared_colony', 'staff_observation', 1.0) ON CONFLICT DO NOTHING; END IF;
    IF v_1160 IS NOT NULL THEN INSERT INTO sot.place_place_edges (place_id_from, place_id_to, relationship_type, evidence_type, confidence) VALUES (v_1152, v_1160, 'shared_colony', 'staff_observation', 1.0) ON CONFLICT DO NOTHING; END IF;

    SELECT request_id INTO v_dutton_request FROM ops.requests WHERE place_id = v_1152 AND merged_into_request_id IS NULL ORDER BY created_at DESC LIMIT 1;
    IF v_dutton_request IS NOT NULL THEN
      INSERT INTO ops.request_scope_places (request_id, place_id, role, notes, added_by) VALUES (v_dutton_request, v_1152, 'anchor', 'Tom Kendrick property (owner)', 'MIG_3125') ON CONFLICT DO NOTHING;
      IF v_1156 IS NOT NULL THEN INSERT INTO ops.request_scope_places (request_id, place_id, role, notes, added_by) VALUES (v_dutton_request, v_1156, 'scope', 'Ruben (tenant)', 'MIG_3125') ON CONFLICT DO NOTHING; END IF;
      IF v_1158 IS NOT NULL THEN INSERT INTO ops.request_scope_places (request_id, place_id, role, notes, added_by) VALUES (v_dutton_request, v_1158, 'scope', 'Yolanda Moran (reported cats)', 'MIG_3125') ON CONFLICT DO NOTHING; END IF;
      IF v_1160 IS NOT NULL THEN INSERT INTO ops.request_scope_places (request_id, place_id, role, notes, added_by) VALUES (v_dutton_request, v_1160, 'scope', 'Juan Renteria (property manager)', 'MIG_3125') ON CONFLICT DO NOTHING; END IF;
    END IF;

    RAISE NOTICE 'MIG_3125: Dutton lot created (4 places, request %)', v_dutton_request;
  END IF;
END $$;
