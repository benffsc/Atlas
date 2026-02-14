-- MIG_204: Trapper Assignment Tracking System
-- Tracks trapper assignments to requests with full history and logging
--
-- This creates a comprehensive assignment system that:
-- 1. Tracks when trappers are assigned/unassigned to requests
-- 2. Logs all changes for audit trail
-- 3. Supports assignment status transitions
-- 4. Records notes and reasons for each change

\echo '=============================================='
\echo 'MIG_204: Trapper Assignment Tracking'
\echo '=============================================='

-- ============================================
-- PART 1: Assignment History Table
-- ============================================

\echo 'Creating trapper_assignment_history table...'

CREATE TABLE IF NOT EXISTS trapper.trapper_assignment_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core references
  request_id UUID NOT NULL REFERENCES trapper.sot_requests(request_id),
  trapper_person_id UUID REFERENCES trapper.sot_people(person_id),

  -- Assignment action
  action TEXT NOT NULL CHECK (action IN (
    'assigned',           -- Trapper assigned to request
    'unassigned',         -- Trapper removed from request
    'reassigned',         -- Different trapper assigned (old one removed)
    'status_change',      -- Status changed (e.g., scheduled → completed)
    'client_trapping',    -- Marked as client doing their own trapping
    'needs_trapper',      -- Marked as needing a trapper (pending assignment)
    'trapping_complete',  -- Trapping work finished
    'visit_logged'        -- Site visit logged
  )),

  -- Previous state (for audit)
  previous_trapper_id UUID REFERENCES trapper.sot_people(person_id),
  previous_status TEXT,

  -- New state
  new_status TEXT,

  -- Assignment details
  assigned_by TEXT,                    -- Who made the assignment (user, system, script)
  assignment_source TEXT,              -- Where it came from (web_ui, airtable_sync, api, etc.)
  scheduled_date DATE,                 -- When trapping is scheduled
  visit_date DATE,                     -- When a site visit occurred

  -- Notes
  notes TEXT,
  internal_notes TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Indexes for common queries
  CONSTRAINT valid_trapper_or_reason CHECK (
    trapper_person_id IS NOT NULL OR
    action IN ('client_trapping', 'needs_trapper', 'unassigned')
  )
);

CREATE INDEX IF NOT EXISTS idx_assignment_history_request
  ON trapper.trapper_assignment_history(request_id);
CREATE INDEX IF NOT EXISTS idx_assignment_history_trapper
  ON trapper.trapper_assignment_history(trapper_person_id);
CREATE INDEX IF NOT EXISTS idx_assignment_history_created
  ON trapper.trapper_assignment_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignment_history_action
  ON trapper.trapper_assignment_history(action);

-- ============================================
-- PART 2: Site Visit Logging Table
-- ============================================

\echo 'Creating trapper_site_visits table...'

CREATE TABLE IF NOT EXISTS trapper.trapper_site_visits (
  visit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core references
  request_id UUID NOT NULL REFERENCES trapper.sot_requests(request_id),
  place_id UUID REFERENCES trapper.places(place_id),
  trapper_person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),

  -- Visit details
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  visit_type TEXT NOT NULL CHECK (visit_type IN (
    'assessment',       -- Initial site assessment
    'trap_setup',       -- Setting up traps
    'trap_check',       -- Checking traps
    'trap_pickup',      -- Picking up traps
    'return_visit',     -- Follow-up visit
    'wellness_check',   -- Checking on colony
    'feeding',          -- Feeding visit
    'other'             -- Other visit type
  )),

  -- Results
  cats_trapped INT DEFAULT 0,
  cats_seen INT,
  traps_set INT,
  traps_retrieved INT,

  -- Notes
  notes TEXT,
  weather_conditions TEXT,
  access_issues TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_site_visits_request
  ON trapper.trapper_site_visits(request_id);
CREATE INDEX IF NOT EXISTS idx_site_visits_trapper
  ON trapper.trapper_site_visits(trapper_person_id);
CREATE INDEX IF NOT EXISTS idx_site_visits_date
  ON trapper.trapper_site_visits(visit_date DESC);

-- ============================================
-- PART 3: Assignment Status on Requests
-- ============================================

\echo 'Adding assignment tracking columns to sot_requests...'

-- Add assignment status column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper'
    AND table_name = 'sot_requests'
    AND column_name = 'assignment_status'
  ) THEN
    ALTER TABLE trapper.sot_requests ADD COLUMN assignment_status TEXT
      CHECK (assignment_status IN (
        'pending',          -- Needs assignment review
        'assigned',         -- Trapper assigned
        'scheduled',        -- Trapping date scheduled
        'in_progress',      -- Trapping underway
        'client_trapping',  -- Client handling own trapping
        'completed',        -- Trapping finished
        'cancelled'         -- Request cancelled
      )) DEFAULT 'pending';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper'
    AND table_name = 'sot_requests'
    AND column_name = 'trapping_scheduled_date'
  ) THEN
    ALTER TABLE trapper.sot_requests ADD COLUMN trapping_scheduled_date DATE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper'
    AND table_name = 'sot_requests'
    AND column_name = 'trapping_completed_date'
  ) THEN
    ALTER TABLE trapper.sot_requests ADD COLUMN trapping_completed_date DATE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper'
    AND table_name = 'sot_requests'
    AND column_name = 'total_cats_trapped'
  ) THEN
    ALTER TABLE trapper.sot_requests ADD COLUMN total_cats_trapped INT DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper'
    AND table_name = 'sot_requests'
    AND column_name = 'total_site_visits'
  ) THEN
    ALTER TABLE trapper.sot_requests ADD COLUMN total_site_visits INT DEFAULT 0;
  END IF;
END $$;

-- ============================================
-- PART 4: Functions for Assignment Management
-- ============================================

\echo 'Creating assignment management functions...'

-- Function to assign a trapper to a request
CREATE OR REPLACE FUNCTION trapper.assign_trapper(
  p_request_id UUID,
  p_trapper_person_id UUID,
  p_scheduled_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_assigned_by TEXT DEFAULT 'system',
  p_assignment_source TEXT DEFAULT 'api'
)
RETURNS UUID AS $$
DECLARE
  v_history_id UUID;
  v_previous_trapper_id UUID;
  v_previous_status TEXT;
BEGIN
  -- Get current state
  SELECT assigned_trapper_id, assignment_status
  INTO v_previous_trapper_id, v_previous_status
  FROM trapper.sot_requests WHERE request_id = p_request_id;

  -- Determine action type
  DECLARE
    v_action TEXT;
  BEGIN
    IF v_previous_trapper_id IS NULL THEN
      v_action := 'assigned';
    ELSIF v_previous_trapper_id != p_trapper_person_id THEN
      v_action := 'reassigned';
    ELSE
      v_action := 'status_change';
    END IF;

    -- Create history record
    INSERT INTO trapper.trapper_assignment_history (
      request_id, trapper_person_id, action,
      previous_trapper_id, previous_status, new_status,
      scheduled_date, notes, assigned_by, assignment_source
    ) VALUES (
      p_request_id, p_trapper_person_id, v_action,
      v_previous_trapper_id, v_previous_status,
      CASE WHEN p_scheduled_date IS NOT NULL THEN 'scheduled' ELSE 'assigned' END,
      p_scheduled_date, p_notes, p_assigned_by, p_assignment_source
    ) RETURNING history_id INTO v_history_id;
  END;

  -- Update request
  UPDATE trapper.sot_requests SET
    assigned_trapper_id = p_trapper_person_id,
    no_trapper_reason = NULL,
    assignment_status = CASE WHEN p_scheduled_date IS NOT NULL THEN 'scheduled' ELSE 'assigned' END,
    trapping_scheduled_date = p_scheduled_date,
    updated_at = NOW()
  WHERE request_id = p_request_id;

  -- Log the change
  INSERT INTO trapper.data_changes (
    entity_type, entity_key, field_name, old_value, new_value, change_source
  ) VALUES (
    'request', p_request_id::text, 'assigned_trapper_id',
    v_previous_trapper_id::text, p_trapper_person_id::text,
    'assign_trapper_function'
  );

  RETURN v_history_id;
END;
$$ LANGUAGE plpgsql;

-- Function to log a site visit
CREATE OR REPLACE FUNCTION trapper.log_site_visit(
  p_request_id UUID,
  p_trapper_person_id UUID,
  p_visit_type TEXT,
  p_visit_date DATE DEFAULT CURRENT_DATE,
  p_cats_trapped INT DEFAULT 0,
  p_cats_seen INT DEFAULT NULL,
  p_traps_set INT DEFAULT NULL,
  p_traps_retrieved INT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_created_by TEXT DEFAULT 'system'
)
RETURNS UUID AS $$
DECLARE
  v_visit_id UUID;
  v_place_id UUID;
BEGIN
  -- Get place_id from request
  SELECT place_id INTO v_place_id
  FROM trapper.sot_requests WHERE request_id = p_request_id;

  -- Create visit record
  INSERT INTO trapper.trapper_site_visits (
    request_id, place_id, trapper_person_id,
    visit_date, visit_type, cats_trapped, cats_seen,
    traps_set, traps_retrieved, notes, created_by
  ) VALUES (
    p_request_id, v_place_id, p_trapper_person_id,
    p_visit_date, p_visit_type, p_cats_trapped, p_cats_seen,
    p_traps_set, p_traps_retrieved, p_notes, p_created_by
  ) RETURNING visit_id INTO v_visit_id;

  -- Update request totals
  UPDATE trapper.sot_requests SET
    total_cats_trapped = COALESCE(total_cats_trapped, 0) + p_cats_trapped,
    total_site_visits = COALESCE(total_site_visits, 0) + 1,
    assignment_status = 'in_progress',
    updated_at = NOW()
  WHERE request_id = p_request_id;

  -- Log to assignment history
  INSERT INTO trapper.trapper_assignment_history (
    request_id, trapper_person_id, action,
    visit_date, notes, assignment_source
  ) VALUES (
    p_request_id, p_trapper_person_id, 'visit_logged',
    p_visit_date, p_notes, 'log_site_visit_function'
  );

  RETURN v_visit_id;
END;
$$ LANGUAGE plpgsql;

-- Function to mark trapping complete
CREATE OR REPLACE FUNCTION trapper.complete_trapping(
  p_request_id UUID,
  p_notes TEXT DEFAULT NULL,
  p_completed_by TEXT DEFAULT 'system'
)
RETURNS VOID AS $$
DECLARE
  v_trapper_id UUID;
BEGIN
  SELECT assigned_trapper_id INTO v_trapper_id
  FROM trapper.sot_requests WHERE request_id = p_request_id;

  -- Update request
  UPDATE trapper.sot_requests SET
    assignment_status = 'completed',
    trapping_completed_date = CURRENT_DATE,
    updated_at = NOW()
  WHERE request_id = p_request_id;

  -- Log to history
  INSERT INTO trapper.trapper_assignment_history (
    request_id, trapper_person_id, action,
    new_status, notes, assigned_by
  ) VALUES (
    p_request_id, v_trapper_id, 'trapping_complete',
    'completed', p_notes, p_completed_by
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 5: Views for Reporting
-- ============================================

\echo 'Creating assignment views...'

-- View: Trapper workload summary
CREATE OR REPLACE VIEW trapper.v_trapper_workload AS
SELECT
  p.person_id,
  p.display_name,
  pr.trapper_type,
  COUNT(r.request_id) FILTER (WHERE r.assignment_status IN ('assigned', 'scheduled', 'in_progress')) as active_assignments,
  COUNT(r.request_id) FILTER (WHERE r.assignment_status = 'completed') as completed_assignments,
  SUM(COALESCE(r.total_cats_trapped, 0)) as total_cats_trapped,
  SUM(COALESCE(r.total_site_visits, 0)) as total_site_visits,
  MAX(r.updated_at) as last_activity
FROM trapper.sot_people p
JOIN trapper.person_roles pr ON pr.person_id = p.person_id AND pr.role = 'trapper'
LEFT JOIN trapper.sot_requests r ON r.assigned_trapper_id = p.person_id
WHERE pr.role_status = 'active'
GROUP BY p.person_id, p.display_name, pr.trapper_type;

-- View: Assignment history with details
CREATE OR REPLACE VIEW trapper.v_assignment_history AS
SELECT
  h.history_id,
  h.request_id,
  r.summary as request_summary,
  pl.display_name as location,
  h.action,
  h.trapper_person_id,
  tp.display_name as trapper_name,
  h.previous_trapper_id,
  prev_tp.display_name as previous_trapper_name,
  h.previous_status,
  h.new_status,
  h.scheduled_date,
  h.visit_date,
  h.notes,
  h.assigned_by,
  h.assignment_source,
  h.created_at
FROM trapper.trapper_assignment_history h
JOIN trapper.sot_requests r ON r.request_id = h.request_id
LEFT JOIN trapper.places pl ON pl.place_id = r.place_id
LEFT JOIN trapper.sot_people tp ON tp.person_id = h.trapper_person_id
LEFT JOIN trapper.sot_people prev_tp ON prev_tp.person_id = h.previous_trapper_id
ORDER BY h.created_at DESC;

-- View: Pending assignments (requests needing trappers)
CREATE OR REPLACE VIEW trapper.v_pending_assignments AS
SELECT
  r.request_id,
  r.summary,
  r.status,
  r.priority,
  r.cat_count,
  r.kitten_count,
  pl.display_name as location,
  pl.formatted_address,
  r.latitude,
  r.longitude,
  r.no_trapper_reason,
  r.created_at,
  r.updated_at,
  (SELECT COUNT(*) FROM trapper.nearby_requests(r.latitude, r.longitude, 0.07, r.request_id)) as nearby_count
FROM trapper.sot_requests r
LEFT JOIN trapper.places pl ON pl.place_id = r.place_id
WHERE r.assigned_trapper_id IS NULL
  AND r.no_trapper_reason IS NULL OR r.no_trapper_reason = 'pending_assignment'
  AND r.status NOT IN ('completed', 'cancelled')
ORDER BY
  CASE r.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
  r.created_at;

-- ============================================
-- PART 6: Initialize existing assignments
-- ============================================

\echo 'Initializing assignment status for existing requests...'

-- Set assignment_status based on current data
UPDATE trapper.sot_requests SET
  assignment_status = CASE
    WHEN status IN ('completed', 'cancelled') THEN status
    WHEN no_trapper_reason = 'client_trapping' THEN 'client_trapping'
    WHEN assigned_trapper_id IS NOT NULL THEN 'assigned'
    ELSE 'pending'
  END
WHERE assignment_status IS NULL;

\echo ''
\echo 'MIG_204 complete!'
\echo ''
\echo 'New tables:'
\echo '  - trapper.trapper_assignment_history (tracks all assignment changes)'
\echo '  - trapper.trapper_site_visits (logs site visits by trappers)'
\echo ''
\echo 'New columns on sot_requests:'
\echo '  - assignment_status (pending/assigned/scheduled/in_progress/completed)'
\echo '  - trapping_scheduled_date'
\echo '  - trapping_completed_date'
\echo '  - total_cats_trapped'
\echo '  - total_site_visits'
\echo ''
\echo 'New functions:'
\echo '  - trapper.assign_trapper(request_id, trapper_id, ...)'
\echo '  - trapper.log_site_visit(request_id, trapper_id, visit_type, ...)'
\echo '  - trapper.complete_trapping(request_id, ...)'
\echo ''
\echo 'New views:'
\echo '  - trapper.v_trapper_workload'
\echo '  - trapper.v_assignment_history'
\echo '  - trapper.v_pending_assignments'
\echo ''
