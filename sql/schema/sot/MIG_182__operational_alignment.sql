-- MIG_182: Operational Alignment
-- Aligns Atlas with real-world workflows based on Ben's questionnaire and reality contract
--
-- Changes:
-- 1. Add new request status values (needs_review, active, partial)
-- 2. Add hold_reason enum and column
-- 3. Add safety_notes to places
-- 4. Add last_activity_at for staleness tracking
-- 5. Add trapper assignment fields
-- 6. Create staleness detection view
-- 7. Create hotspot detection view

BEGIN;

-- ============================================================================
-- 1. EXTEND REQUEST STATUS ENUM
-- ============================================================================
-- Current: new, triaged, scheduled, in_progress, completed, cancelled, on_hold
-- Adding: needs_review, active, partial
--
-- Status meanings (from reality contract):
--   new          = Request received, not yet reviewed
--   needs_review = Flagged for coordinator attention (data issue, duplicate suspect)
--   triaged      = Coordinator has reviewed, priority assigned
--   scheduled    = Appointment scheduled in ClinicHQ
--   in_progress  = Coordinator acknowledged, case understood
--   active       = Trapper actively engaged, resources deployed
--   on_hold      = Temporarily paused (with reason)
--   completed    = Done, all cats handled
--   partial      = Done but partial success (got 4/5 cats, remaining impossible)
--   cancelled    = Request cancelled, not proceeding

ALTER TYPE trapper.request_status ADD VALUE IF NOT EXISTS 'needs_review' AFTER 'new';
ALTER TYPE trapper.request_status ADD VALUE IF NOT EXISTS 'active' AFTER 'in_progress';
ALTER TYPE trapper.request_status ADD VALUE IF NOT EXISTS 'partial' AFTER 'completed';

-- ============================================================================
-- 2. HOLD REASON ENUM
-- ============================================================================
-- Track WHY a request is on hold (from questionnaire Q3)

DO $$ BEGIN
    CREATE TYPE trapper.hold_reason AS ENUM (
        'weather',              -- Weather hold (unsafe to trap)
        'callback_pending',     -- Waiting for callback from client
        'access_issue',         -- Property access problem (gate code, permission)
        'resource_constraint',  -- Moving resources to higher priority
        'client_unavailable',   -- Client not responding
        'scheduling_conflict',  -- Can't find time that works
        'trap_shy',             -- Cats are trap-shy, need time
        'other'                 -- Other reason (see notes)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add hold_reason column to sot_requests
ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS hold_reason trapper.hold_reason,
ADD COLUMN IF NOT EXISTS hold_reason_notes TEXT,
ADD COLUMN IF NOT EXISTS hold_started_at TIMESTAMPTZ;

-- ============================================================================
-- 3. SAFETY NOTES FOR PLACES
-- ============================================================================
-- Critical for trapper safety: dogs, hostile neighbors, previous incidents

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS safety_notes TEXT,
ADD COLUMN IF NOT EXISTS safety_concerns TEXT[],  -- Array: 'aggressive_dog', 'hostile_neighbor', 'difficult_access', etc.
ADD COLUMN IF NOT EXISTS last_visited_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS visit_count INTEGER DEFAULT 0;

COMMENT ON COLUMN trapper.places.safety_notes IS 'Free text safety notes for trappers: dogs, hazards, hostile neighbors, etc.';
COMMENT ON COLUMN trapper.places.safety_concerns IS 'Structured safety flags: aggressive_dog, hostile_neighbor, difficult_access, biohazard, etc.';

-- ============================================================================
-- 4. STALENESS TRACKING
-- ============================================================================
-- Track when a request last had meaningful activity

ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS last_activity_type TEXT;  -- 'created', 'status_change', 'note_added', 'appointment_scheduled'

-- Function to update last_activity_at on changes
CREATE OR REPLACE FUNCTION trapper.update_request_activity()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_activity_at := NOW();
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        NEW.last_activity_type := 'status_change';
    ELSIF OLD.notes IS DISTINCT FROM NEW.notes THEN
        NEW.last_activity_type := 'note_added';
    ELSIF OLD.scheduled_date IS DISTINCT FROM NEW.scheduled_date THEN
        NEW.last_activity_type := 'appointment_scheduled';
    ELSE
        NEW.last_activity_type := 'updated';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger if not exists
DROP TRIGGER IF EXISTS trg_request_activity ON trapper.sot_requests;
CREATE TRIGGER trg_request_activity
    BEFORE UPDATE ON trapper.sot_requests
    FOR EACH ROW
    EXECUTE FUNCTION trapper.update_request_activity();

-- ============================================================================
-- 5. ENHANCED TRAPPER ASSIGNMENT
-- ============================================================================
-- From questionnaire: Ben = coordinator, Crystal = head trapper, volunteers help

DO $$ BEGIN
    CREATE TYPE trapper.trapper_type AS ENUM (
        'coordinator',       -- Ben - reviews, assigns, tracks
        'head_trapper',      -- Crystal - primary paid trapper
        'ffsc_trapper',      -- FFSC volunteers (completed orientation + contract)
        'community_trapper', -- Informal helpers, varying experience
        'volunteer'          -- General volunteer
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS assigned_trapper_type trapper.trapper_type,
ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS assignment_notes TEXT;

-- ============================================================================
-- 6. GEOGRAPHIC CLUSTERING
-- ============================================================================
-- Ben mentioned Rohnert Park/Petaluma = quick action area

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS service_zone TEXT;  -- 'priority', 'standard', 'extended'

COMMENT ON COLUMN trapper.places.service_zone IS 'Service zone for prioritization: priority (Rohnert Park/Petaluma), standard, extended';

-- ============================================================================
-- 7. REQUEST HISTORY TRACKING
-- ============================================================================
-- Track status changes for audit trail (priority #5 from Ben's ranking)

CREATE TABLE IF NOT EXISTS trapper.request_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES trapper.sot_requests(request_id) ON DELETE CASCADE,
    old_status TEXT,
    new_status TEXT NOT NULL,
    changed_by TEXT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_request_status_history_request ON trapper.request_status_history(request_id);
CREATE INDEX IF NOT EXISTS idx_request_status_history_changed_at ON trapper.request_status_history(changed_at);

-- Trigger to log status changes
CREATE OR REPLACE FUNCTION trapper.log_request_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO trapper.request_status_history (request_id, old_status, new_status, changed_by)
        VALUES (NEW.request_id, OLD.status::TEXT, NEW.status::TEXT, NEW.created_by);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_request_status ON trapper.sot_requests;
CREATE TRIGGER trg_log_request_status
    AFTER UPDATE ON trapper.sot_requests
    FOR EACH ROW
    EXECUTE FUNCTION trapper.log_request_status_change();

-- ============================================================================
-- 8. STALENESS DETECTION VIEW
-- ============================================================================
-- Find requests that haven't had activity in X days

CREATE OR REPLACE VIEW trapper.v_stale_requests AS
SELECT
    r.request_id,
    r.status::TEXT,
    r.priority::TEXT,
    r.summary,
    r.place_id,
    p.display_name AS place_name,
    p.formatted_address,
    r.requester_person_id,
    per.display_name AS requester_name,
    r.estimated_cat_count,
    r.last_activity_at,
    r.last_activity_type,
    NOW() - COALESCE(r.last_activity_at, r.created_at) AS time_since_activity,
    EXTRACT(DAY FROM NOW() - COALESCE(r.last_activity_at, r.created_at))::INT AS days_stale,
    CASE
        WHEN EXTRACT(DAY FROM NOW() - COALESCE(r.last_activity_at, r.created_at)) > 30 THEN 'critical'
        WHEN EXTRACT(DAY FROM NOW() - COALESCE(r.last_activity_at, r.created_at)) > 14 THEN 'warning'
        WHEN EXTRACT(DAY FROM NOW() - COALESCE(r.last_activity_at, r.created_at)) > 7 THEN 'attention'
        ELSE 'ok'
    END AS staleness_level
FROM trapper.sot_requests r
LEFT JOIN trapper.places p ON p.place_id = r.place_id
LEFT JOIN trapper.sot_people per ON per.person_id = r.requester_person_id
WHERE r.status NOT IN ('completed', 'cancelled', 'partial')
ORDER BY
    CASE r.priority
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'normal' THEN 3
        WHEN 'low' THEN 4
    END,
    COALESCE(r.last_activity_at, r.created_at) ASC;

-- ============================================================================
-- 9. HOTSPOT DETECTION VIEW
-- ============================================================================
-- Find addresses/areas with multiple requests

CREATE OR REPLACE VIEW trapper.v_place_hotspots AS
SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    p.safety_notes,
    p.safety_concerns,
    p.service_zone,
    p.visit_count,
    p.last_visited_at,
    COUNT(r.request_id) AS total_requests,
    COUNT(r.request_id) FILTER (WHERE r.status NOT IN ('completed', 'cancelled', 'partial')) AS active_requests,
    COUNT(r.request_id) FILTER (WHERE r.status IN ('completed', 'partial')) AS completed_requests,
    SUM(r.estimated_cat_count) FILTER (WHERE r.status NOT IN ('completed', 'cancelled', 'partial')) AS estimated_cats_pending,
    SUM(COALESCE(r.cats_trapped, 0)) AS total_cats_trapped,
    MIN(r.created_at) AS first_request_at,
    MAX(r.created_at) AS latest_request_at,
    CASE
        WHEN COUNT(r.request_id) FILTER (WHERE r.status NOT IN ('completed', 'cancelled', 'partial')) >= 3 THEN 'hotspot'
        WHEN COUNT(r.request_id) FILTER (WHERE r.status NOT IN ('completed', 'cancelled', 'partial')) >= 2 THEN 'active'
        WHEN COUNT(r.request_id) >= 3 THEN 'recurring'
        ELSE 'normal'
    END AS hotspot_level
FROM trapper.places p
JOIN trapper.sot_requests r ON r.place_id = p.place_id
GROUP BY p.place_id, p.display_name, p.formatted_address, p.safety_notes, p.safety_concerns, p.service_zone, p.visit_count, p.last_visited_at
HAVING COUNT(r.request_id) >= 2
ORDER BY
    COUNT(r.request_id) FILTER (WHERE r.status NOT IN ('completed', 'cancelled', 'partial')) DESC,
    COUNT(r.request_id) DESC;

-- ============================================================================
-- 10. COORDINATOR DASHBOARD VIEW
-- ============================================================================
-- What Ben wants to see first (from questionnaire Q13)

CREATE OR REPLACE VIEW trapper.v_coordinator_dashboard AS
SELECT
    r.request_id,
    r.status::TEXT,
    r.priority::TEXT,
    r.summary,
    r.estimated_cat_count,
    r.has_kittens,
    -- Enhanced intake fields
    r.permission_status::TEXT,
    r.colony_duration::TEXT,
    r.urgency_reasons,
    r.urgency_deadline,
    -- Place info
    r.place_id,
    p.display_name AS place_name,
    p.formatted_address,
    p.safety_notes,
    p.safety_concerns,
    p.service_zone,
    -- Requester info
    r.requester_person_id,
    per.display_name AS requester_name,
    -- Assignment
    r.assigned_to,
    r.assigned_trapper_type::TEXT,
    r.assigned_at,
    -- Activity
    r.last_activity_at,
    r.last_activity_type,
    EXTRACT(DAY FROM NOW() - COALESCE(r.last_activity_at, r.created_at))::INT AS days_since_activity,
    -- Hold info
    r.hold_reason::TEXT,
    r.hold_reason_notes,
    r.hold_started_at,
    -- Computed scores (from MIG_181)
    trapper.compute_request_readiness(r) AS readiness_score,
    trapper.compute_request_urgency(r) AS urgency_score,
    -- Combined dashboard priority (urgency weighted by readiness)
    ROUND(
        trapper.compute_request_urgency(r) *
        GREATEST(0.5, trapper.compute_request_readiness(r)::NUMERIC / 100)
    )::INT AS dashboard_priority,
    -- Dates
    r.source_created_at,
    r.created_at,
    r.updated_at
FROM trapper.sot_requests r
LEFT JOIN trapper.places p ON p.place_id = r.place_id
LEFT JOIN trapper.sot_people per ON per.person_id = r.requester_person_id
WHERE r.status NOT IN ('completed', 'cancelled', 'partial')
ORDER BY
    -- Urgent first
    CASE r.priority
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'normal' THEN 3
        WHEN 'low' THEN 4
    END,
    -- Then by computed priority score
    trapper.compute_request_urgency(r) DESC,
    -- Then by staleness (older = higher)
    COALESCE(r.last_activity_at, r.created_at) ASC;

-- ============================================================================
-- 11. UPDATE EXISTING VIEWS
-- ============================================================================
-- Update v_request_list to include new fields

DROP VIEW IF EXISTS trapper.v_request_list CASCADE;
CREATE VIEW trapper.v_request_list AS
SELECT
    r.request_id,
    r.status::TEXT,
    r.priority::TEXT,
    r.summary,
    r.estimated_cat_count,
    r.has_kittens,
    r.scheduled_date,
    r.assigned_to,
    r.assigned_trapper_type::TEXT,
    r.created_at,
    r.updated_at,
    r.source_created_at,
    r.last_activity_at,
    r.hold_reason::TEXT,
    -- Place info
    r.place_id,
    p.display_name AS place_name,
    p.formatted_address AS place_address,
    p.safety_notes AS place_safety_notes,
    sa.locality AS place_city,
    p.service_zone,
    -- Requester info
    r.requester_person_id,
    per.display_name AS requester_name,
    -- Cat count
    (SELECT COUNT(*) FROM trapper.request_cats rc WHERE rc.request_id = r.request_id) AS linked_cat_count,
    -- Staleness
    EXTRACT(DAY FROM NOW() - COALESCE(r.last_activity_at, r.created_at))::INT AS days_since_activity
FROM trapper.sot_requests r
LEFT JOIN trapper.places p ON p.place_id = r.place_id
LEFT JOIN trapper.sot_addresses sa ON sa.address_id = p.sot_address_id
LEFT JOIN trapper.sot_people per ON per.person_id = r.requester_person_id;

-- ============================================================================
-- 12. INDEXES FOR PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_requests_last_activity ON trapper.sot_requests(last_activity_at);
CREATE INDEX IF NOT EXISTS idx_requests_hold_reason ON trapper.sot_requests(hold_reason) WHERE hold_reason IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_places_safety ON trapper.places(safety_concerns) WHERE safety_concerns IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_places_service_zone ON trapper.places(service_zone) WHERE service_zone IS NOT NULL;

-- ============================================================================
-- 13. INITIALIZE LAST_ACTIVITY_AT FOR EXISTING RECORDS
-- ============================================================================

UPDATE trapper.sot_requests
SET last_activity_at = COALESCE(updated_at, created_at),
    last_activity_type = 'migrated'
WHERE last_activity_at IS NULL;

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Show new enum values
SELECT 'request_status values:' AS info;
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'trapper.request_status'::regtype ORDER BY enumsortorder;

SELECT 'hold_reason values:' AS info;
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'trapper.hold_reason'::regtype ORDER BY enumsortorder;

SELECT 'New columns added to sot_requests:' AS info;
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'sot_requests'
AND column_name IN ('hold_reason', 'hold_reason_notes', 'hold_started_at', 'last_activity_at', 'last_activity_type', 'assigned_trapper_type', 'assigned_at', 'assignment_notes');

SELECT 'New columns added to places:' AS info;
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'places'
AND column_name IN ('safety_notes', 'safety_concerns', 'last_visited_at', 'visit_count', 'service_zone');
