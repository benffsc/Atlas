-- MIG_2013: Auth Infrastructure for V2
--
-- Purpose: Create staff auth tables and functions needed for login
-- These existed in trapper schema on East DB, need them on West DB
--
-- Created: 2026-02-12

\echo ''
\echo '=============================================='
\echo '  MIG_2013: Auth Infrastructure'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE TRAPPER SCHEMA (if needed for auth compatibility)
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS trapper;

-- ============================================================================
-- 2. STAFF TABLE
-- ============================================================================

\echo '1. Creating staff table...'

CREATE TABLE IF NOT EXISTS trapper.staff (
  staff_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  auth_role TEXT NOT NULL DEFAULT 'staff' CHECK (auth_role IN ('admin', 'staff', 'volunteer')),
  person_id UUID REFERENCES sot.people(person_id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  password_change_required BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_email ON trapper.staff(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_staff_person ON trapper.staff(person_id) WHERE person_id IS NOT NULL;

-- ============================================================================
-- 3. STAFF SESSIONS TABLE
-- ============================================================================

\echo '2. Creating staff_sessions table...'

CREATE TABLE IF NOT EXISTS trapper.staff_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES trapper.staff(staff_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  invalidated_at TIMESTAMPTZ,
  invalidation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_sessions_token ON trapper.staff_sessions(token_hash) WHERE invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_staff_sessions_staff ON trapper.staff_sessions(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_expires ON trapper.staff_sessions(expires_at) WHERE invalidated_at IS NULL;

-- ============================================================================
-- 4. SESSION FUNCTIONS
-- ============================================================================

\echo '3. Creating session functions...'

-- Create session
CREATE OR REPLACE FUNCTION trapper.create_staff_session(
  p_staff_id UUID,
  p_token_hash TEXT,
  p_expiry_hours INTEGER DEFAULT 24,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_session_id UUID;
BEGIN
  INSERT INTO trapper.staff_sessions (staff_id, token_hash, expires_at, ip_address, user_agent)
  VALUES (p_staff_id, p_token_hash, NOW() + (p_expiry_hours || ' hours')::INTERVAL, p_ip_address, p_user_agent)
  RETURNING session_id INTO v_session_id;

  RETURN v_session_id;
END;
$$ LANGUAGE plpgsql;

-- Validate session
CREATE OR REPLACE FUNCTION trapper.validate_staff_session(p_token_hash TEXT)
RETURNS TABLE(
  staff_id UUID,
  display_name TEXT,
  email TEXT,
  auth_role TEXT,
  person_id UUID,
  session_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.staff_id,
    s.display_name,
    s.email,
    s.auth_role,
    s.person_id,
    ss.session_id
  FROM trapper.staff_sessions ss
  JOIN trapper.staff s ON s.staff_id = ss.staff_id
  WHERE ss.token_hash = p_token_hash
    AND ss.expires_at > NOW()
    AND ss.invalidated_at IS NULL
    AND s.is_active = TRUE;
END;
$$ LANGUAGE plpgsql;

-- Invalidate session
CREATE OR REPLACE FUNCTION trapper.invalidate_staff_session(
  p_token_hash TEXT,
  p_reason TEXT DEFAULT 'logout'
) RETURNS BOOLEAN AS $$
DECLARE
  v_updated BOOLEAN;
BEGIN
  UPDATE trapper.staff_sessions
  SET invalidated_at = NOW(),
      invalidation_reason = p_reason
  WHERE token_hash = p_token_hash
    AND invalidated_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$ LANGUAGE plpgsql;

-- Record failed login
CREATE OR REPLACE FUNCTION trapper.record_failed_login(p_email TEXT) RETURNS VOID AS $$
BEGIN
  UPDATE trapper.staff
  SET login_attempts = login_attempts + 1,
      locked_until = CASE
        WHEN login_attempts >= 4 THEN NOW() + INTERVAL '15 minutes'
        ELSE locked_until
      END
  WHERE LOWER(email) = LOWER(p_email);
END;
$$ LANGUAGE plpgsql;

-- Staff permission check (simplified - admin can do everything)
CREATE OR REPLACE FUNCTION trapper.staff_can_access(
  p_staff_id UUID,
  p_resource TEXT,
  p_action TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT auth_role INTO v_role
  FROM trapper.staff
  WHERE staff_id = p_staff_id AND is_active = TRUE;

  IF v_role IS NULL THEN RETURN FALSE; END IF;
  IF v_role = 'admin' THEN RETURN TRUE; END IF;

  -- Staff can read most things
  IF v_role = 'staff' AND p_action IN ('read', 'list', 'view') THEN
    RETURN TRUE;
  END IF;

  -- Staff can write to operational resources
  IF v_role = 'staff' AND p_action IN ('create', 'update', 'write') THEN
    IF p_resource IN ('requests', 'intakes', 'journals', 'appointments') THEN
      RETURN TRUE;
    END IF;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. CREATE ADMIN USER (Ben)
-- ============================================================================

\echo '4. Creating admin user...'

-- Password hash for 'atlas2026!' (pre-computed bcrypt)
-- You can change this password after first login
INSERT INTO trapper.staff (display_name, email, password_hash, auth_role, is_active)
VALUES (
  'Ben Mis',
  'ben@forgottenfelines.com',
  '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4mPvQ6xrJEj1kQG6',  -- atlas2026!
  'admin',
  TRUE
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  auth_role = EXCLUDED.auth_role,
  is_active = TRUE;

-- Link to sot.people if exists
UPDATE trapper.staff s
SET person_id = p.person_id
FROM sot.people p
WHERE LOWER(s.email) = LOWER(p.primary_email)
  AND s.person_id IS NULL;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Staff users:'
SELECT display_name, email, auth_role, is_active FROM trapper.staff;

\echo ''
\echo '=============================================='
\echo '  MIG_2013 Complete!'
\echo '=============================================='
\echo ''
\echo 'Admin user created: ben@forgottenfelines.com'
\echo 'Temporary password: atlas2026!'
\echo 'Please change password after login.'
\echo ''
