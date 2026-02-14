\echo '=== MIG_400: Staff Authentication ==='
\echo 'Adds authentication columns to staff table and creates session management'
\echo ''

-- ============================================================================
-- PURPOSE
-- Enable staff login with email/password and session-based authentication.
-- Links authenticated users to journal entries and audit trails.
-- Supports role-based access control (admin, staff, volunteer).
-- ============================================================================

\echo 'Step 1: Adding authentication columns to staff table...'

-- Add authentication columns (safe with IF NOT EXISTS pattern)
DO $$
BEGIN
    -- Password hash column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'staff' AND column_name = 'password_hash'
    ) THEN
        ALTER TABLE trapper.staff ADD COLUMN password_hash TEXT;
    END IF;

    -- Last login tracking
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'staff' AND column_name = 'last_login_at'
    ) THEN
        ALTER TABLE trapper.staff ADD COLUMN last_login_at TIMESTAMPTZ;
    END IF;

    -- Failed login tracking (for lockout)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'staff' AND column_name = 'login_attempts'
    ) THEN
        ALTER TABLE trapper.staff ADD COLUMN login_attempts INT DEFAULT 0;
    END IF;

    -- Account lockout
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'staff' AND column_name = 'locked_until'
    ) THEN
        ALTER TABLE trapper.staff ADD COLUMN locked_until TIMESTAMPTZ;
    END IF;

    -- Auth role (admin, staff, volunteer) - separate from job role
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'staff' AND column_name = 'auth_role'
    ) THEN
        ALTER TABLE trapper.staff ADD COLUMN auth_role TEXT DEFAULT 'staff'
            CHECK (auth_role IN ('admin', 'staff', 'volunteer'));
    END IF;
END $$;

COMMENT ON COLUMN trapper.staff.password_hash IS 'bcrypt hash of password';
COMMENT ON COLUMN trapper.staff.last_login_at IS 'Timestamp of last successful login';
COMMENT ON COLUMN trapper.staff.login_attempts IS 'Failed login attempts since last success (resets on success)';
COMMENT ON COLUMN trapper.staff.locked_until IS 'Account locked until this time (NULL = not locked)';
COMMENT ON COLUMN trapper.staff.auth_role IS 'Authorization role: admin (full access), staff (workflow access), volunteer (limited read-only)';

\echo 'Added authentication columns to staff table'

-- ============================================================================
-- Step 2: Session management table
-- ============================================================================

\echo ''
\echo 'Step 2: Creating staff_sessions table...'

CREATE TABLE IF NOT EXISTS trapper.staff_sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES trapper.staff(staff_id) ON DELETE CASCADE,

    -- Token storage (we store hash, not the actual token)
    token_hash TEXT NOT NULL,

    -- Session metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),

    -- Security context
    ip_address TEXT,
    user_agent TEXT,

    -- Session state
    is_valid BOOLEAN DEFAULT TRUE,
    invalidated_at TIMESTAMPTZ,
    invalidated_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_staff_sessions_staff ON trapper.staff_sessions(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_token ON trapper.staff_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_valid ON trapper.staff_sessions(is_valid, expires_at)
    WHERE is_valid = TRUE;

COMMENT ON TABLE trapper.staff_sessions IS
'Session tokens for authenticated staff members.
Tokens are stored as SHA-256 hashes for security.
Sessions expire after configurable period (default 24 hours).
Invalid sessions are kept for audit purposes.';

\echo 'Created staff_sessions table'

-- ============================================================================
-- Step 3: Role permissions table
-- ============================================================================

\echo ''
\echo 'Step 3: Creating staff_permissions table...'

CREATE TABLE IF NOT EXISTS trapper.staff_permissions (
    permission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_role TEXT NOT NULL,  -- 'admin', 'staff', 'volunteer'
    resource TEXT NOT NULL,   -- 'requests', 'cats', 'people', 'admin/*', '*'
    action TEXT NOT NULL,     -- 'read', 'write', 'delete'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(auth_role, resource, action)
);

COMMENT ON TABLE trapper.staff_permissions IS
'Role-based access control permissions.
Defines what each auth_role can do with each resource.
Wildcards: "*" for resource means all resources.';

-- Insert default permissions
\echo 'Inserting default permissions...'

INSERT INTO trapper.staff_permissions (auth_role, resource, action) VALUES
    -- Admin: full access to everything
    ('admin', '*', 'read'),
    ('admin', '*', 'write'),
    ('admin', '*', 'delete'),

    -- Staff: workflow access (CRUD on main entities)
    ('staff', 'requests', 'read'),
    ('staff', 'requests', 'write'),
    ('staff', 'cats', 'read'),
    ('staff', 'cats', 'write'),
    ('staff', 'people', 'read'),
    ('staff', 'people', 'write'),
    ('staff', 'places', 'read'),
    ('staff', 'places', 'write'),
    ('staff', 'journal', 'read'),
    ('staff', 'journal', 'write'),
    ('staff', 'intake', 'read'),
    ('staff', 'intake', 'write'),
    ('staff', 'trappers', 'read'),
    ('staff', 'beacon', 'read'),

    -- Volunteer: limited read-only + field observations
    ('volunteer', 'requests', 'read'),
    ('volunteer', 'cats', 'read'),
    ('volunteer', 'places', 'read'),
    ('volunteer', 'observations', 'write'),
    ('volunteer', 'beacon', 'read')
ON CONFLICT (auth_role, resource, action) DO NOTHING;

\echo 'Created staff_permissions table with defaults'

-- ============================================================================
-- Step 4: Helper functions
-- ============================================================================

\echo ''
\echo 'Step 4: Creating authentication helper functions...'

-- Function to check if staff can perform action on resource
CREATE OR REPLACE FUNCTION trapper.staff_can_access(
    p_staff_id UUID,
    p_resource TEXT,
    p_action TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
    v_auth_role TEXT;
BEGIN
    -- Get staff auth_role
    SELECT auth_role INTO v_auth_role
    FROM trapper.staff
    WHERE staff_id = p_staff_id
      AND is_active = TRUE
      AND (locked_until IS NULL OR locked_until < NOW());

    IF v_auth_role IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Check for permission (including wildcard)
    RETURN EXISTS (
        SELECT 1 FROM trapper.staff_permissions
        WHERE auth_role = v_auth_role
          AND (resource = p_resource OR resource = '*')
          AND action = p_action
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.staff_can_access IS
'Check if a staff member can perform an action on a resource.
Returns FALSE if staff is inactive or locked.';

-- Function to create a session
CREATE OR REPLACE FUNCTION trapper.create_staff_session(
    p_staff_id UUID,
    p_token_hash TEXT,
    p_expires_hours INT DEFAULT 24,
    p_ip_address TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_session_id UUID;
BEGIN
    INSERT INTO trapper.staff_sessions (
        staff_id,
        token_hash,
        expires_at,
        ip_address,
        user_agent
    ) VALUES (
        p_staff_id,
        p_token_hash,
        NOW() + (p_expires_hours || ' hours')::INTERVAL,
        p_ip_address,
        p_user_agent
    )
    RETURNING session_id INTO v_session_id;

    -- Update last login
    UPDATE trapper.staff
    SET last_login_at = NOW(),
        login_attempts = 0
    WHERE staff_id = p_staff_id;

    RETURN v_session_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.create_staff_session IS
'Create a new session for a staff member after successful login.
Resets login_attempts and updates last_login_at.';

-- Function to validate a session
CREATE OR REPLACE FUNCTION trapper.validate_staff_session(
    p_token_hash TEXT
)
RETURNS TABLE (
    staff_id UUID,
    display_name TEXT,
    email TEXT,
    auth_role TEXT,
    session_id UUID
) AS $$
BEGIN
    -- Update last activity
    UPDATE trapper.staff_sessions ss
    SET last_activity_at = NOW()
    WHERE ss.token_hash = p_token_hash
      AND ss.is_valid = TRUE
      AND ss.expires_at > NOW();

    RETURN QUERY
    SELECT
        s.staff_id,
        s.display_name,
        s.email,
        s.auth_role,
        ss.session_id
    FROM trapper.staff_sessions ss
    JOIN trapper.staff s ON s.staff_id = ss.staff_id
    WHERE ss.token_hash = p_token_hash
      AND ss.is_valid = TRUE
      AND ss.expires_at > NOW()
      AND s.is_active = TRUE
      AND (s.locked_until IS NULL OR s.locked_until < NOW());
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.validate_staff_session IS
'Validate a session token and return staff info if valid.
Also updates last_activity_at for session timeout tracking.';

-- Function to invalidate a session (logout)
CREATE OR REPLACE FUNCTION trapper.invalidate_staff_session(
    p_token_hash TEXT,
    p_reason TEXT DEFAULT 'logout'
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE trapper.staff_sessions
    SET is_valid = FALSE,
        invalidated_at = NOW(),
        invalidated_reason = p_reason
    WHERE token_hash = p_token_hash
      AND is_valid = TRUE;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.invalidate_staff_session IS
'Invalidate a session (logout). Returns TRUE if session was found and invalidated.';

-- Function to record failed login
CREATE OR REPLACE FUNCTION trapper.record_failed_login(
    p_email TEXT
)
RETURNS VOID AS $$
DECLARE
    v_attempts INT;
BEGIN
    UPDATE trapper.staff
    SET login_attempts = login_attempts + 1,
        locked_until = CASE
            WHEN login_attempts >= 4 THEN NOW() + INTERVAL '15 minutes'
            ELSE locked_until
        END
    WHERE LOWER(email) = LOWER(p_email)
    RETURNING login_attempts INTO v_attempts;

    IF v_attempts >= 5 THEN
        RAISE NOTICE 'Account % locked due to too many failed attempts', p_email;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.record_failed_login IS
'Record a failed login attempt. Locks account after 5 failures for 15 minutes.';

\echo 'Created authentication helper functions'

-- ============================================================================
-- Step 5: View for active sessions
-- ============================================================================

\echo ''
\echo 'Step 5: Creating session monitoring views...'

CREATE OR REPLACE VIEW trapper.v_active_sessions AS
SELECT
    ss.session_id,
    s.staff_id,
    s.display_name,
    s.email,
    s.auth_role,
    ss.created_at as session_started,
    ss.last_activity_at,
    ss.expires_at,
    ss.ip_address,
    EXTRACT(EPOCH FROM (NOW() - ss.last_activity_at)) / 60 as minutes_idle,
    EXTRACT(EPOCH FROM (ss.expires_at - NOW())) / 60 as minutes_until_expiry
FROM trapper.staff_sessions ss
JOIN trapper.staff s ON s.staff_id = ss.staff_id
WHERE ss.is_valid = TRUE
  AND ss.expires_at > NOW()
ORDER BY ss.last_activity_at DESC;

COMMENT ON VIEW trapper.v_active_sessions IS
'Active staff sessions with idle time and expiry info.';

-- View for auth audit
CREATE OR REPLACE VIEW trapper.v_auth_audit AS
SELECT
    s.staff_id,
    s.display_name,
    s.email,
    s.auth_role,
    s.last_login_at,
    s.login_attempts,
    s.locked_until,
    (SELECT COUNT(*) FROM trapper.staff_sessions ss
     WHERE ss.staff_id = s.staff_id AND ss.is_valid = TRUE AND ss.expires_at > NOW()) as active_sessions,
    (SELECT MAX(ss.last_activity_at) FROM trapper.staff_sessions ss
     WHERE ss.staff_id = s.staff_id) as last_activity
FROM trapper.staff s
WHERE s.is_active = TRUE
ORDER BY s.last_login_at DESC NULLS LAST;

COMMENT ON VIEW trapper.v_auth_audit IS
'Staff authentication audit view showing login status and sessions.';

\echo 'Created session monitoring views'

-- ============================================================================
-- Step 6: Set default auth_role for existing staff
-- ============================================================================

\echo ''
\echo 'Step 6: Setting auth_role for existing staff...'

-- Coordinators get admin role
UPDATE trapper.staff
SET auth_role = 'admin'
WHERE role IN ('coordinator', 'admin', 'Coordinator', 'Admin')
  AND auth_role IS NULL;

-- Head trappers get staff role
UPDATE trapper.staff
SET auth_role = 'staff'
WHERE auth_role IS NULL
  AND is_active = TRUE;

\echo 'Set auth_role for existing staff'

-- ============================================================================
-- Step 7: Summary
-- ============================================================================

\echo ''
\echo '=== MIG_400 Complete ==='
\echo ''
\echo 'Staff authentication infrastructure created:'
\echo '  - Added auth columns to staff table (password_hash, login_attempts, locked_until, auth_role)'
\echo '  - Created staff_sessions table for session management'
\echo '  - Created staff_permissions table with default RBAC rules'
\echo '  - Created helper functions: create_session, validate_session, invalidate_session'
\echo '  - Created monitoring views: v_active_sessions, v_auth_audit'
\echo ''
\echo 'Auth roles:'
\echo '  - admin: Full access to all features'
\echo '  - staff: Workflow access (requests, cats, people, places, journal)'
\echo '  - volunteer: Limited read-only access'
\echo ''
\echo 'Next steps:'
\echo '  1. Set passwords for staff: UPDATE staff SET password_hash = crypt(pwd, gen_salt(''bf''))'
\echo '  2. Implement login endpoint that creates sessions'
\echo '  3. Add middleware to validate sessions on protected routes'
\echo ''

