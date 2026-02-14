-- MIG_207: Request Trapper Assignments (Many-to-Many)
--
-- Tracks all trappers assigned to a request, not just the primary.
-- Supports tracking when trappers join/leave assignments.
--
-- The existing assigned_trapper_id on sot_requests remains as the "primary" trapper.
-- This table provides the full picture of all trappers involved.

\echo ''
\echo '=============================================='
\echo 'MIG_207: Request Trapper Assignments'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Many-to-many table for request-trapper assignments
-- ============================================================

\echo 'Creating request_trapper_assignments table...'

CREATE TABLE IF NOT EXISTS trapper.request_trapper_assignments (
    assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    request_id UUID NOT NULL REFERENCES trapper.sot_requests(request_id) ON DELETE CASCADE,
    trapper_person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),

    -- Is this the primary/lead trapper?
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,

    -- Assignment timeline
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unassigned_at TIMESTAMPTZ,  -- NULL if still assigned

    -- Why assigned/unassigned
    assignment_reason TEXT,  -- 'initial', 'joined_later', 'reassigned_from_other'
    unassignment_reason TEXT,  -- 'completed', 'reassigned', 'unavailable'

    -- Source tracking
    source_system TEXT,  -- 'airtable', 'web_app', 'manual'
    source_record_id TEXT,  -- Airtable record ID if applicable

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL DEFAULT 'system',

    -- A trapper can only be actively assigned once per request
    UNIQUE (request_id, trapper_person_id, unassigned_at)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_rta_request ON trapper.request_trapper_assignments(request_id);
CREATE INDEX IF NOT EXISTS idx_rta_trapper ON trapper.request_trapper_assignments(trapper_person_id);
CREATE INDEX IF NOT EXISTS idx_rta_active ON trapper.request_trapper_assignments(request_id, trapper_person_id)
    WHERE unassigned_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rta_primary ON trapper.request_trapper_assignments(request_id)
    WHERE is_primary = TRUE AND unassigned_at IS NULL;

COMMENT ON TABLE trapper.request_trapper_assignments IS
'Tracks all trappers assigned to a request (many-to-many).
Supports multiple trappers per request and tracks assignment history.
The is_primary flag indicates the lead trapper.
unassigned_at = NULL means currently assigned.';

-- ============================================================
-- 2. View for current trapper assignments
-- ============================================================

\echo 'Creating v_request_current_trappers view...'

CREATE OR REPLACE VIEW trapper.v_request_current_trappers AS
SELECT
    rta.request_id,
    rta.trapper_person_id,
    p.display_name AS trapper_name,
    pr.trapper_type,
    pr.trapper_type IN ('coordinator', 'head_trapper', 'ffsc_trapper') AS is_ffsc_trapper,
    rta.is_primary,
    rta.assigned_at,
    rta.assignment_reason,
    -- Request info
    r.summary AS request_summary,
    r.status AS request_status,
    pl.display_name AS place_name
FROM trapper.request_trapper_assignments rta
JOIN trapper.sot_people p ON p.person_id = rta.trapper_person_id
JOIN trapper.person_roles pr ON pr.person_id = rta.trapper_person_id AND pr.role = 'trapper'
JOIN trapper.sot_requests r ON r.request_id = rta.request_id
LEFT JOIN trapper.places pl ON pl.place_id = r.place_id
WHERE rta.unassigned_at IS NULL
ORDER BY rta.request_id, rta.is_primary DESC, rta.assigned_at;

-- ============================================================
-- 3. View for trapper assignment history
-- ============================================================

\echo 'Creating v_request_trapper_history view...'

CREATE OR REPLACE VIEW trapper.v_request_trapper_history AS
SELECT
    rta.request_id,
    r.summary AS request_summary,
    rta.trapper_person_id,
    p.display_name AS trapper_name,
    rta.is_primary,
    rta.assigned_at,
    rta.unassigned_at,
    rta.assignment_reason,
    rta.unassignment_reason,
    CASE
        WHEN rta.unassigned_at IS NULL THEN 'active'
        ELSE 'inactive'
    END AS status
FROM trapper.request_trapper_assignments rta
JOIN trapper.sot_people p ON p.person_id = rta.trapper_person_id
JOIN trapper.sot_requests r ON r.request_id = rta.request_id
ORDER BY rta.request_id, rta.assigned_at;

-- ============================================================
-- 4. Function to assign a trapper to a request
-- ============================================================

\echo 'Creating assign_trapper_to_request function...'

CREATE OR REPLACE FUNCTION trapper.assign_trapper_to_request(
    p_request_id UUID,
    p_trapper_person_id UUID,
    p_is_primary BOOLEAN DEFAULT FALSE,
    p_assignment_reason TEXT DEFAULT 'manual',
    p_source_system TEXT DEFAULT 'web_app',
    p_created_by TEXT DEFAULT 'web_user'
)
RETURNS UUID AS $$
DECLARE
    v_assignment_id UUID;
BEGIN
    -- If setting as primary, unset any existing primary
    IF p_is_primary THEN
        UPDATE trapper.request_trapper_assignments
        SET is_primary = FALSE, updated_at = NOW()
        WHERE request_id = p_request_id
          AND is_primary = TRUE
          AND unassigned_at IS NULL;

        -- Also update the sot_requests.assigned_trapper_id
        UPDATE trapper.sot_requests
        SET assigned_trapper_id = p_trapper_person_id, updated_at = NOW()
        WHERE request_id = p_request_id;
    END IF;

    -- Insert new assignment (or reactivate if previously unassigned)
    INSERT INTO trapper.request_trapper_assignments (
        request_id, trapper_person_id, is_primary,
        assignment_reason, source_system, created_by
    ) VALUES (
        p_request_id, p_trapper_person_id, p_is_primary,
        p_assignment_reason, p_source_system, p_created_by
    )
    ON CONFLICT (request_id, trapper_person_id, unassigned_at)
    DO UPDATE SET
        is_primary = EXCLUDED.is_primary,
        updated_at = NOW()
    RETURNING assignment_id INTO v_assignment_id;

    RETURN v_assignment_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. Function to unassign a trapper from a request
-- ============================================================

\echo 'Creating unassign_trapper_from_request function...'

CREATE OR REPLACE FUNCTION trapper.unassign_trapper_from_request(
    p_request_id UUID,
    p_trapper_person_id UUID,
    p_reason TEXT DEFAULT 'unassigned'
)
RETURNS BOOLEAN AS $$
DECLARE
    v_was_primary BOOLEAN;
BEGIN
    -- Check if they were primary
    SELECT is_primary INTO v_was_primary
    FROM trapper.request_trapper_assignments
    WHERE request_id = p_request_id
      AND trapper_person_id = p_trapper_person_id
      AND unassigned_at IS NULL;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Mark as unassigned
    UPDATE trapper.request_trapper_assignments
    SET unassigned_at = NOW(),
        unassignment_reason = p_reason,
        updated_at = NOW()
    WHERE request_id = p_request_id
      AND trapper_person_id = p_trapper_person_id
      AND unassigned_at IS NULL;

    -- If they were primary, clear the sot_requests.assigned_trapper_id
    IF v_was_primary THEN
        UPDATE trapper.sot_requests
        SET assigned_trapper_id = NULL, updated_at = NOW()
        WHERE request_id = p_request_id;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

\echo ''
\echo 'MIG_207 complete!'
\echo ''
\echo 'Created:'
\echo '  - request_trapper_assignments table (many-to-many with history)'
\echo '  - v_request_current_trappers view (active assignments)'
\echo '  - v_request_trapper_history view (full history)'
\echo '  - assign_trapper_to_request() function'
\echo '  - unassign_trapper_from_request() function'
\echo ''
