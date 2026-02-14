-- MIG_202: Trapper Roles System
-- Tags people as trappers with type (FFSC staff, FFSC volunteer, community)
-- Enables proper trapper assignment on requests
--
-- Data flow:
--   JotForm (community signup) → Airtable → raw.airtable_trappers → sot_people + person_roles
--   VolunteerHub → raw.volunteerhub_volunteers → sot_people + person_roles (future)
--   Manual entry → sot_people + person_roles

\echo '=============================================='
\echo 'MIG_202: Trapper Roles System'
\echo '=============================================='

-- ============================================
-- PART 1: Create person_roles table
-- ============================================

\echo 'Creating person_roles table...'

CREATE TABLE IF NOT EXISTS trapper.person_roles (
  role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id) ON DELETE CASCADE,

  -- Role type
  role TEXT NOT NULL CHECK (role IN (
    'trapper',
    'foster',
    'volunteer',
    'staff',
    'board_member',
    'donor'
  )),

  -- For trappers: what kind?
  trapper_type TEXT CHECK (trapper_type IS NULL OR trapper_type IN (
    'coordinator',      -- FFSC trapping coordinator (staff)
    'head_trapper',     -- FFSC head trapper
    'ffsc_trapper',     -- FFSC trained trapper (volunteer)
    'community_trapper' -- Community trapper (signed up via JotForm)
  )),

  -- Status
  role_status TEXT NOT NULL DEFAULT 'active' CHECK (role_status IN (
    'active',
    'inactive',
    'pending',    -- Applied but not yet approved
    'on_leave'
  )),

  -- Tracking
  source_system TEXT,  -- 'airtable', 'volunteerhub', 'jotform', 'manual'
  source_record_id TEXT,

  -- Dates
  started_at DATE,
  ended_at DATE,

  -- Notes
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A person can only have one of each role type
  UNIQUE (person_id, role)
);

-- Index for finding trappers
CREATE INDEX IF NOT EXISTS idx_person_roles_trappers
  ON trapper.person_roles(role, trapper_type, role_status)
  WHERE role = 'trapper';

CREATE INDEX IF NOT EXISTS idx_person_roles_person
  ON trapper.person_roles(person_id);

-- ============================================
-- PART 2: Update requests for proper trapper assignment
-- ============================================

\echo 'Updating sot_requests for trapper assignment...'

ALTER TABLE trapper.sot_requests
  -- Link to actual person instead of just text
  ADD COLUMN IF NOT EXISTS assigned_trapper_id UUID REFERENCES trapper.sot_people(person_id),
  -- Why no trapper assigned (if applicable)
  ADD COLUMN IF NOT EXISTS no_trapper_reason TEXT CHECK (no_trapper_reason IS NULL OR no_trapper_reason IN (
    'client_trapping',      -- Client will trap themselves
    'has_community_help',   -- Client already has community trapper
    'not_needed',           -- No trapping needed (wellness, already fixed)
    'pending_assignment',   -- Needs trapper but not yet assigned
    'no_capacity'           -- No trappers available currently
  ));

-- Index for finding requests by trapper
CREATE INDEX IF NOT EXISTS idx_requests_trapper
  ON trapper.sot_requests(assigned_trapper_id)
  WHERE assigned_trapper_id IS NOT NULL;

-- ============================================
-- PART 3: View for active trappers
-- ============================================

\echo 'Creating active trappers view...'

CREATE OR REPLACE VIEW trapper.v_active_trappers AS
SELECT
  p.person_id,
  p.display_name,
  p.primary_email,
  p.primary_phone,
  pr.trapper_type,
  pr.role_status,
  pr.started_at,
  pr.source_system,
  pr.notes,
  -- Is this an FFSC trapper (vs community)?
  CASE
    WHEN pr.trapper_type IN ('coordinator', 'head_trapper', 'ffsc_trapper') THEN TRUE
    ELSE FALSE
  END AS is_ffsc_trapper,
  -- Count of active assignments
  (SELECT COUNT(*)
   FROM trapper.sot_requests r
   WHERE r.assigned_trapper_id = p.person_id
     AND r.status NOT IN ('completed', 'cancelled')
  ) AS active_assignments
FROM trapper.sot_people p
JOIN trapper.person_roles pr ON pr.person_id = p.person_id
WHERE pr.role = 'trapper'
  AND pr.role_status = 'active'
ORDER BY
  -- FFSC trappers first
  CASE WHEN pr.trapper_type IN ('coordinator', 'head_trapper', 'ffsc_trapper') THEN 0 ELSE 1 END,
  -- Then by type
  CASE pr.trapper_type
    WHEN 'coordinator' THEN 1
    WHEN 'head_trapper' THEN 2
    WHEN 'ffsc_trapper' THEN 3
    WHEN 'community_trapper' THEN 4
  END,
  p.display_name;

-- ============================================
-- PART 4: View for request assignments
-- ============================================

\echo 'Creating request assignment view...'

CREATE OR REPLACE VIEW trapper.v_request_assignments AS
SELECT
  r.request_id,
  r.status,
  r.priority,
  r.summary,
  r.scheduled_date,
  -- Trapper info
  r.assigned_trapper_id,
  t.display_name AS trapper_name,
  t.primary_phone AS trapper_phone,
  pr.trapper_type,
  -- Is FFSC assigned?
  CASE
    WHEN r.assigned_trapper_id IS NOT NULL
         AND pr.trapper_type IN ('coordinator', 'head_trapper', 'ffsc_trapper')
    THEN TRUE
    ELSE FALSE
  END AS ffsc_assigned,
  -- Assignment status
  CASE
    WHEN r.assigned_trapper_id IS NOT NULL THEN 'assigned'
    WHEN r.no_trapper_reason IS NOT NULL THEN r.no_trapper_reason
    ELSE 'pending_assignment'
  END AS assignment_status,
  r.no_trapper_reason,
  -- Place info
  pl.display_name AS place_name,
  pl.formatted_address AS place_address
FROM trapper.sot_requests r
LEFT JOIN trapper.sot_people t ON t.person_id = r.assigned_trapper_id
LEFT JOIN trapper.person_roles pr ON pr.person_id = t.person_id AND pr.role = 'trapper'
LEFT JOIN trapper.places pl ON pl.place_id = r.place_id
WHERE r.status NOT IN ('completed', 'cancelled')
ORDER BY
  r.scheduled_date ASC NULLS LAST,
  r.priority = 'urgent' DESC,
  r.priority = 'high' DESC;

\echo ''
\echo 'MIG_202 complete!'
\echo ''
\echo 'Created:'
\echo '  - person_roles table (tag people as trappers, fosters, etc.)'
\echo '  - assigned_trapper_id on requests (links to real person)'
\echo '  - no_trapper_reason on requests (why not assigned)'
\echo '  - v_active_trappers view (list all active trappers)'
\echo '  - v_request_assignments view (requests with assignment status)'
\echo ''
\echo 'Trapper types:'
\echo '  - coordinator: FFSC trapping coordinator (staff)'
\echo '  - head_trapper: FFSC head trapper'
\echo '  - ffsc_trapper: FFSC trained volunteer trapper'
\echo '  - community_trapper: Community trapper (JotForm signup)'
\echo ''
\echo 'Next steps:'
\echo '  1. Import trappers from Airtable into person_roles'
\echo '  2. Set up VolunteerHub sync (optional)'
\echo '  3. Update request UI for trapper assignment'
\echo ''
