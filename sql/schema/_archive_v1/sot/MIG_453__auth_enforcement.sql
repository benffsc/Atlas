\echo '=== MIG_453: Auth Enforcement Fields ==='
\echo 'Password change requirements and reset token support'

-- Add password management columns to staff table
DO $$
BEGIN
  -- Add password_change_required if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'staff'
    AND column_name = 'password_change_required'
  ) THEN
    ALTER TABLE trapper.staff
    ADD COLUMN password_change_required BOOLEAN DEFAULT FALSE;
  END IF;

  -- Add password_set_at if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'staff'
    AND column_name = 'password_set_at'
  ) THEN
    ALTER TABLE trapper.staff
    ADD COLUMN password_set_at TIMESTAMPTZ;
  END IF;

  -- Add password_reset_token_hash if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'staff'
    AND column_name = 'password_reset_token_hash'
  ) THEN
    ALTER TABLE trapper.staff
    ADD COLUMN password_reset_token_hash TEXT;
  END IF;

  -- Add password_reset_expires_at if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'staff'
    AND column_name = 'password_reset_expires_at'
  ) THEN
    ALTER TABLE trapper.staff
    ADD COLUMN password_reset_expires_at TIMESTAMPTZ;
  END IF;
END $$;

-- Index for finding staff with pending password resets
CREATE INDEX IF NOT EXISTS idx_staff_password_reset
  ON trapper.staff(password_reset_expires_at)
  WHERE password_reset_token_hash IS NOT NULL;

-- Index for staff needing password change
CREATE INDEX IF NOT EXISTS idx_staff_password_change_required
  ON trapper.staff(password_change_required)
  WHERE password_change_required = TRUE;

-- Function to set default passwords for all staff without passwords
-- Note: This uses pgcrypto for bcrypt hashing
CREATE OR REPLACE FUNCTION trapper.set_default_passwords(default_pwd TEXT)
RETURNS TABLE(
  staff_count INT,
  staff_emails TEXT[]
) AS $$
DECLARE
  v_count INT := 0;
  v_emails TEXT[];
BEGIN
  -- Ensure pgcrypto is available
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  -- Get list of staff that will be updated
  SELECT ARRAY_AGG(email), COUNT(*)
  INTO v_emails, v_count
  FROM trapper.staff
  WHERE (password_hash IS NULL OR password_hash = '')
    AND is_active = TRUE;

  -- Set default password with bcrypt hash
  UPDATE trapper.staff
  SET password_hash = crypt(default_pwd, gen_salt('bf', 12)),
      password_change_required = TRUE,
      password_set_at = NOW()
  WHERE (password_hash IS NULL OR password_hash = '')
    AND is_active = TRUE;

  RETURN QUERY SELECT v_count, v_emails;
END;
$$ LANGUAGE plpgsql;

-- Function to clear expired reset tokens
CREATE OR REPLACE FUNCTION trapper.clear_expired_reset_tokens()
RETURNS INT AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE trapper.staff
  SET password_reset_token_hash = NULL,
      password_reset_expires_at = NULL
  WHERE password_reset_expires_at IS NOT NULL
    AND password_reset_expires_at < NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Function to verify password (for API use)
CREATE OR REPLACE FUNCTION trapper.verify_password(
  p_email TEXT,
  p_password TEXT
)
RETURNS TABLE(
  staff_id UUID,
  display_name TEXT,
  auth_role TEXT,
  password_change_required BOOLEAN,
  is_valid BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.staff_id,
    s.display_name,
    s.auth_role,
    s.password_change_required,
    (s.password_hash = crypt(p_password, s.password_hash)) as is_valid
  FROM trapper.staff s
  WHERE s.email = p_email
    AND s.is_active = TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to change password
CREATE OR REPLACE FUNCTION trapper.change_password(
  p_staff_id UUID,
  p_new_password TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE trapper.staff
  SET password_hash = crypt(p_new_password, gen_salt('bf', 12)),
      password_change_required = FALSE,
      password_set_at = NOW(),
      password_reset_token_hash = NULL,
      password_reset_expires_at = NULL
  WHERE staff_id = p_staff_id
    AND is_active = TRUE;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to create password reset token
CREATE OR REPLACE FUNCTION trapper.create_password_reset_token(
  p_email TEXT,
  p_token_hash TEXT,
  p_expires_in_hours INT DEFAULT 24
)
RETURNS UUID AS $$
DECLARE
  v_staff_id UUID;
BEGIN
  UPDATE trapper.staff
  SET password_reset_token_hash = p_token_hash,
      password_reset_expires_at = NOW() + (p_expires_in_hours || ' hours')::INTERVAL
  WHERE email = p_email
    AND is_active = TRUE
  RETURNING staff_id INTO v_staff_id;

  RETURN v_staff_id;
END;
$$ LANGUAGE plpgsql;

-- Function to verify reset token and change password
CREATE OR REPLACE FUNCTION trapper.reset_password_with_token(
  p_token_hash TEXT,
  p_new_password TEXT
)
RETURNS TABLE(
  success BOOLEAN,
  staff_id UUID,
  message TEXT
) AS $$
DECLARE
  v_staff_id UUID;
  v_expires_at TIMESTAMPTZ;
BEGIN
  -- Find staff with this token
  SELECT s.staff_id, s.password_reset_expires_at
  INTO v_staff_id, v_expires_at
  FROM trapper.staff s
  WHERE s.password_reset_token_hash = p_token_hash
    AND s.is_active = TRUE;

  IF v_staff_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Invalid or expired reset token'::TEXT;
    RETURN;
  END IF;

  IF v_expires_at < NOW() THEN
    -- Clear expired token
    UPDATE trapper.staff
    SET password_reset_token_hash = NULL,
        password_reset_expires_at = NULL
    WHERE staff_id = v_staff_id;

    RETURN QUERY SELECT FALSE, NULL::UUID, 'Reset token has expired'::TEXT;
    RETURN;
  END IF;

  -- Change password
  UPDATE trapper.staff
  SET password_hash = crypt(p_new_password, gen_salt('bf', 12)),
      password_change_required = FALSE,
      password_set_at = NOW(),
      password_reset_token_hash = NULL,
      password_reset_expires_at = NULL
  WHERE staff_id = v_staff_id;

  RETURN QUERY SELECT TRUE, v_staff_id, 'Password reset successfully'::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN trapper.staff.password_change_required IS 'If TRUE, staff must change password on next login';
COMMENT ON COLUMN trapper.staff.password_set_at IS 'When the password was last set/changed';
COMMENT ON COLUMN trapper.staff.password_reset_token_hash IS 'SHA-256 hash of password reset token';
COMMENT ON COLUMN trapper.staff.password_reset_expires_at IS 'When the reset token expires';

COMMENT ON FUNCTION trapper.set_default_passwords IS 'Set a default password for all staff without passwords, requiring change on first login';
COMMENT ON FUNCTION trapper.verify_password IS 'Verify staff credentials and return auth info';
COMMENT ON FUNCTION trapper.change_password IS 'Change a staff members password and clear change requirement';
COMMENT ON FUNCTION trapper.create_password_reset_token IS 'Create a password reset token for email-based reset';
COMMENT ON FUNCTION trapper.reset_password_with_token IS 'Reset password using a valid reset token';

\echo 'MIG_453 complete: Auth enforcement fields and functions created'
