-- ============================================================================
-- MIG_738: Colony People Relationships & Google Maps Colony Linking
-- ============================================================================
-- Adds the missing pieces for staff-curated colony management:
-- 1. colony_people table - tracks people involved with colonies (feeders, trappers, etc.)
-- 2. colony_id FK on google_map_entries - links AI-derived context to colonies
-- 3. Functions for managing colony-people relationships
-- ============================================================================

\echo '============================================================'
\echo 'MIG_738: Colony People & Google Maps Colony Link'
\echo '============================================================'

-- ============================================================================
-- 1. Colony-People Relationships Table
-- ============================================================================
\echo 'Creating colony_people table...'

CREATE TABLE IF NOT EXISTS trapper.colony_people (
  colony_people_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colony_id UUID NOT NULL REFERENCES trapper.colonies(colony_id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id) ON DELETE CASCADE,

  -- Role in colony context
  role_type TEXT NOT NULL CHECK (role_type IN (
    'primary_feeder',       -- Main caretaker/feeder (usually 1 per colony)
    'feeder',               -- Regular feeder (can be multiple)
    'reporter',             -- Person who originally reported the colony
    'contact',              -- General contact for the colony
    'property_owner',       -- Owns property where colony is located
    'trapper_assigned',     -- FFSC-assigned trapper for this colony
    'trapper_volunteer',    -- Volunteer helping trap at this colony
    'coordinator',          -- FFSC coordinator managing this colony
    'veterinary_contact',   -- Vet contact for colony health issues
    'other'                 -- Other role with notes
  )),

  -- Status tracking
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  end_reason TEXT,

  -- Notes and context
  notes TEXT,

  -- Provenance
  confidence NUMERIC(3,2) DEFAULT 0.85,
  source_system TEXT DEFAULT 'atlas_ui',
  source_record_id TEXT,

  -- Audit
  assigned_by TEXT,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Partial unique index to prevent duplicate active roles
CREATE UNIQUE INDEX IF NOT EXISTS idx_colony_people_unique_active
  ON trapper.colony_people (colony_id, person_id, role_type)
  WHERE is_active = TRUE;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_colony_people_colony
  ON trapper.colony_people(colony_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_colony_people_person
  ON trapper.colony_people(person_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_colony_people_role
  ON trapper.colony_people(role_type) WHERE is_active = TRUE;

COMMENT ON TABLE trapper.colony_people IS
'Tracks people involved with colonies and their specific roles. Enables queries like "who feeds this colony?" or "what colonies is this person involved with?"';

COMMENT ON COLUMN trapper.colony_people.role_type IS
'The person''s role at this colony: primary_feeder (main caretaker), feeder (helps feed), reporter (originally reported), property_owner, trapper_assigned, etc.';

-- ============================================================================
-- 2. Add colony_id to google_map_entries
-- ============================================================================
\echo 'Adding colony_id to google_map_entries...'

ALTER TABLE trapper.google_map_entries
  ADD COLUMN IF NOT EXISTS colony_id UUID REFERENCES trapper.colonies(colony_id);

CREATE INDEX IF NOT EXISTS idx_gme_colony
  ON trapper.google_map_entries(colony_id) WHERE colony_id IS NOT NULL;

COMMENT ON COLUMN trapper.google_map_entries.colony_id IS
'Links this Google Maps entry to a staff-verified colony. Allows aggregating historical context at the colony level.';

-- ============================================================================
-- 3. Functions for Colony-People Management
-- ============================================================================
\echo 'Creating colony-people management functions...'

-- Add a person to a colony with a role
CREATE OR REPLACE FUNCTION trapper.assign_colony_person(
  p_colony_id UUID,
  p_person_id UUID,
  p_role_type TEXT,
  p_assigned_by TEXT DEFAULT 'atlas_ui',
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Check if already exists and active
  SELECT colony_people_id INTO v_id
  FROM trapper.colony_people
  WHERE colony_id = p_colony_id
    AND person_id = p_person_id
    AND role_type = p_role_type
    AND is_active = TRUE;

  IF v_id IS NOT NULL THEN
    -- Already exists, update notes if provided
    IF p_notes IS NOT NULL THEN
      UPDATE trapper.colony_people
      SET notes = p_notes, updated_at = NOW()
      WHERE colony_people_id = v_id;
    END IF;
    RETURN v_id;
  END IF;

  -- Insert new relationship
  INSERT INTO trapper.colony_people (
    colony_id, person_id, role_type, assigned_by, notes
  ) VALUES (
    p_colony_id, p_person_id, p_role_type, p_assigned_by, p_notes
  )
  RETURNING colony_people_id INTO v_id;

  RETURN v_id;
END;
$$;

-- Remove a person from a colony role
CREATE OR REPLACE FUNCTION trapper.end_colony_person(
  p_colony_id UUID,
  p_person_id UUID,
  p_role_type TEXT,
  p_end_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE trapper.colony_people
  SET
    is_active = FALSE,
    ended_at = NOW(),
    end_reason = p_end_reason,
    updated_at = NOW()
  WHERE colony_id = p_colony_id
    AND person_id = p_person_id
    AND role_type = p_role_type
    AND is_active = TRUE;

  RETURN FOUND;
END;
$$;

-- Link Google Maps entry to a colony
CREATE OR REPLACE FUNCTION trapper.link_google_entry_to_colony(
  p_entry_id UUID,
  p_colony_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE trapper.google_map_entries
  SET colony_id = p_colony_id
  WHERE entry_id = p_entry_id;

  RETURN FOUND;
END;
$$;

-- Auto-link Google entries to colony based on place membership
CREATE OR REPLACE FUNCTION trapper.link_colony_google_entries(
  p_colony_id UUID
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_linked INT := 0;
BEGIN
  -- Link Google entries that are associated with places in this colony
  WITH entries_to_link AS (
    UPDATE trapper.google_map_entries gme
    SET colony_id = p_colony_id
    FROM trapper.colony_places cp
    WHERE cp.colony_id = p_colony_id
      AND (gme.place_id = cp.place_id OR gme.linked_place_id = cp.place_id)
      AND gme.colony_id IS NULL
    RETURNING gme.entry_id
  )
  SELECT COUNT(*) INTO v_linked FROM entries_to_link;

  RETURN v_linked;
END;
$$;

-- ============================================================================
-- 4. Views for Colony-People Queries
-- ============================================================================
\echo 'Creating colony-people views...'

-- View: All active people for each colony
CREATE OR REPLACE VIEW trapper.v_colony_people AS
SELECT
  cp.colony_people_id,
  cp.colony_id,
  c.colony_name,
  c.status as colony_status,
  cp.person_id,
  p.display_name as person_name,
  p.primary_phone,
  p.primary_email,
  cp.role_type,
  CASE cp.role_type
    WHEN 'primary_feeder' THEN 'Primary Feeder'
    WHEN 'feeder' THEN 'Feeder'
    WHEN 'reporter' THEN 'Reporter'
    WHEN 'contact' THEN 'Contact'
    WHEN 'property_owner' THEN 'Property Owner'
    WHEN 'trapper_assigned' THEN 'Assigned Trapper'
    WHEN 'trapper_volunteer' THEN 'Volunteer Trapper'
    WHEN 'coordinator' THEN 'Coordinator'
    WHEN 'veterinary_contact' THEN 'Veterinary Contact'
    ELSE 'Other'
  END as role_label,
  cp.is_active,
  cp.started_at,
  cp.ended_at,
  cp.notes,
  cp.assigned_by,
  cp.assigned_at
FROM trapper.colony_people cp
JOIN trapper.colonies c ON c.colony_id = cp.colony_id
JOIN trapper.sot_people p ON p.person_id = cp.person_id
WHERE p.merged_into_person_id IS NULL;

-- View: Colonies a person is involved with
CREATE OR REPLACE VIEW trapper.v_person_colonies AS
SELECT
  cp.person_id,
  p.display_name as person_name,
  cp.colony_id,
  c.colony_name,
  c.status as colony_status,
  cp.role_type,
  cp.is_active,
  cp.started_at,
  -- Colony stats
  COALESCE(cs.place_count, 0) as place_count,
  COALESCE(cs.observed_total, 0) as observed_cats,
  COALESCE(cs.verified_cats, 0) as verified_cats
FROM trapper.colony_people cp
JOIN trapper.sot_people p ON p.person_id = cp.person_id
JOIN trapper.colonies c ON c.colony_id = cp.colony_id
LEFT JOIN trapper.v_colony_stats cs ON cs.colony_id = cp.colony_id
WHERE p.merged_into_person_id IS NULL
ORDER BY cp.is_active DESC, cp.started_at DESC;

-- View: Colony with all Google Maps context
CREATE OR REPLACE VIEW trapper.v_colony_google_context AS
SELECT
  c.colony_id,
  c.colony_name,
  c.status,
  COUNT(gme.entry_id) as google_entry_count,
  COUNT(DISTINCT gme.ai_meaning) FILTER (WHERE gme.ai_meaning IS NOT NULL) as distinct_classifications,
  ARRAY_AGG(DISTINCT gme.ai_meaning) FILTER (WHERE gme.ai_meaning IS NOT NULL) as classifications,
  BOOL_OR(gme.ai_meaning IN ('disease_risk', 'felv_colony', 'fiv_colony')) as has_disease_risk,
  BOOL_OR(gme.ai_meaning = 'watch_list') as has_watch_list,
  MAX(gme.parsed_date) as latest_google_date,
  MIN(gme.parsed_date) as earliest_google_date
FROM trapper.colonies c
LEFT JOIN trapper.google_map_entries gme ON gme.colony_id = c.colony_id
GROUP BY c.colony_id, c.colony_name, c.status;

-- ============================================================================
-- 5. Enhanced Colony Summary with People
-- ============================================================================
\echo 'Creating enhanced colony summary view...'

CREATE OR REPLACE VIEW trapper.v_colony_complete AS
SELECT
  c.colony_id,
  c.colony_name,
  c.colony_code,
  c.status,
  c.notes,
  c.created_at,
  c.updated_at,

  -- Places
  COALESCE(cp_count.place_count, 0) as place_count,

  -- People by role
  COALESCE(people.feeder_count, 0) as feeder_count,
  COALESCE(people.trapper_count, 0) as trapper_count,
  COALESCE(people.total_people, 0) as total_people,
  people.primary_feeder_name,
  people.assigned_trapper_name,

  -- Latest observation
  obs.observation_date as last_observation_date,
  obs.total_cats as observed_total,
  obs.total_cats_confidence,
  obs.fixed_cats as observed_fixed,
  obs.observed_by,

  -- Verified cats from clinic
  COALESCE(verified.verified_cat_count, 0) as verified_cats,
  COALESCE(verified.verified_altered_count, 0) as verified_altered,

  -- Google context
  COALESCE(gctx.google_entry_count, 0) as google_entry_count,
  gctx.has_disease_risk,
  gctx.has_watch_list,

  -- Requests
  COALESCE(req.request_count, 0) as request_count,
  COALESCE(req.active_request_count, 0) as active_request_count

FROM trapper.colonies c

-- Place count
LEFT JOIN (
  SELECT colony_id, COUNT(*) as place_count
  FROM trapper.colony_places
  GROUP BY colony_id
) cp_count ON cp_count.colony_id = c.colony_id

-- People aggregation
LEFT JOIN (
  SELECT
    colony_id,
    COUNT(*) FILTER (WHERE role_type IN ('primary_feeder', 'feeder')) as feeder_count,
    COUNT(*) FILTER (WHERE role_type IN ('trapper_assigned', 'trapper_volunteer')) as trapper_count,
    COUNT(DISTINCT person_id) as total_people,
    (SELECT p.display_name FROM trapper.sot_people p
     JOIN trapper.colony_people cp2 ON cp2.person_id = p.person_id
     WHERE cp2.colony_id = cp.colony_id AND cp2.role_type = 'primary_feeder' AND cp2.is_active
     LIMIT 1) as primary_feeder_name,
    (SELECT p.display_name FROM trapper.sot_people p
     JOIN trapper.colony_people cp2 ON cp2.person_id = p.person_id
     WHERE cp2.colony_id = cp.colony_id AND cp2.role_type = 'trapper_assigned' AND cp2.is_active
     LIMIT 1) as assigned_trapper_name
  FROM trapper.colony_people cp
  WHERE is_active = TRUE
  GROUP BY colony_id
) people ON people.colony_id = c.colony_id

-- Latest observation
LEFT JOIN LATERAL (
  SELECT observation_date, total_cats, total_cats_confidence, fixed_cats, observed_by
  FROM trapper.colony_observations
  WHERE colony_id = c.colony_id
  ORDER BY observation_date DESC
  LIMIT 1
) obs ON TRUE

-- Verified cats from places
LEFT JOIN (
  SELECT
    cp.colony_id,
    COUNT(DISTINCT cpr.cat_id) as verified_cat_count,
    COUNT(DISTINCT cpr.cat_id) FILTER (WHERE cat.altered_status = 'Yes') as verified_altered_count
  FROM trapper.colony_places cp
  JOIN trapper.cat_place_relationships cpr ON cpr.place_id = cp.place_id
  JOIN trapper.sot_cats cat ON cat.cat_id = cpr.cat_id
  GROUP BY cp.colony_id
) verified ON verified.colony_id = c.colony_id

-- Google context
LEFT JOIN trapper.v_colony_google_context gctx ON gctx.colony_id = c.colony_id

-- Requests
LEFT JOIN (
  SELECT
    colony_id,
    COUNT(*) as request_count,
    COUNT(*) FILTER (WHERE r.status IN ('new', 'triaged', 'scheduled', 'in_progress')) as active_request_count
  FROM trapper.colony_requests cr
  JOIN trapper.sot_requests r ON r.request_id = cr.request_id
  GROUP BY colony_id
) req ON req.colony_id = c.colony_id;

-- ============================================================================
-- 6. Grants
-- ============================================================================
\echo 'Granting permissions...'

GRANT SELECT, INSERT, UPDATE, DELETE ON trapper.colony_people TO atlas_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA trapper TO atlas_app;
GRANT SELECT ON trapper.v_colony_people TO atlas_app;
GRANT SELECT ON trapper.v_person_colonies TO atlas_app;
GRANT SELECT ON trapper.v_colony_google_context TO atlas_app;
GRANT SELECT ON trapper.v_colony_complete TO atlas_app;

-- ============================================================================
\echo '============================================================'
\echo 'MIG_738 Complete!'
\echo ''
\echo 'New tables:'
\echo '  - colony_people: Tracks people involved with colonies'
\echo ''
\echo 'New columns:'
\echo '  - google_map_entries.colony_id: Links AI context to colonies'
\echo ''
\echo 'New views:'
\echo '  - v_colony_people: People by colony with roles'
\echo '  - v_person_colonies: Colonies by person'
\echo '  - v_colony_google_context: AI classifications per colony'
\echo '  - v_colony_complete: Full colony profile with all data'
\echo ''
\echo 'New functions:'
\echo '  - assign_colony_person(colony_id, person_id, role_type, ...)'
\echo '  - end_colony_person(colony_id, person_id, role_type, ...)'
\echo '  - link_google_entry_to_colony(entry_id, colony_id)'
\echo '  - link_colony_google_entries(colony_id)'
\echo '============================================================'
