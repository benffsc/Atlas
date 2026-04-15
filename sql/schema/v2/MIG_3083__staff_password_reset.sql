-- MIG_3083: Staff Password Reset Infrastructure
--
-- Adds missing columns for password reset (already referenced in code),
-- flags staff who have never logged in as needing password change,
-- and seeds the password reset email template.

-- ============================================================================
-- 1. Add missing columns (already referenced in change-password + reset-staff routes)
-- ============================================================================

ALTER TABLE ops.staff
  ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;

-- Index for token lookup during reset validation
CREATE INDEX IF NOT EXISTS idx_staff_reset_token
  ON ops.staff(password_reset_token_hash)
  WHERE password_reset_token_hash IS NOT NULL;

-- ============================================================================
-- 2. Flag staff who have a password but never logged in → default password
-- ============================================================================

UPDATE ops.staff
SET password_change_required = TRUE
WHERE is_active = TRUE
  AND password_hash IS NOT NULL
  AND staff_id NOT IN (SELECT DISTINCT staff_id FROM ops.staff_sessions)
  AND password_change_required IS DISTINCT FROM TRUE;

-- ============================================================================
-- 3. Seed password reset email template
-- ============================================================================

INSERT INTO ops.email_templates (template_key, name, subject, body_html, body_text, placeholders, is_active)
VALUES (
  'password_reset_code',
  'Password Reset Code',
  'Your {{org_name_short}} password reset code',
  E'<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">\n<h2>Password Reset</h2>\n<p>Hi {{staff_name}},</p>\n<p>Your password reset code is:</p>\n<div style="font-size: 2rem; font-weight: 700; letter-spacing: 0.3em; text-align: center; padding: 1rem; background: #f3f4f6; border-radius: 8px; margin: 1rem 0;">{{reset_code}}</div>\n<p>This code expires in {{expiry_minutes}} minutes.</p>\n<p>If you didn''t request this, you can ignore this email.</p>\n<p style="color: #6b7280; font-size: 0.85rem; margin-top: 2rem;">\u2014 {{org_name_short}}</p>\n</div>',
  E'Hi {{staff_name}},\n\nYour password reset code is: {{reset_code}}\n\nThis code expires in {{expiry_minutes}} minutes.\n\nIf you didn''t request this, ignore this email.\n\n\u2014 {{org_name_short}}',
  ARRAY['reset_code', 'staff_name', 'expiry_minutes', 'org_name_short'],
  TRUE
) ON CONFLICT (template_key) DO NOTHING;
