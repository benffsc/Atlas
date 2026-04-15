-- MIG_3083: Staff Password Reset Infrastructure
--
-- Adds missing columns for password reset (already referenced in code),
-- flags staff who have never logged in as needing password change,
-- and seeds email templates for welcome + reset links.

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
-- 3. Seed email templates
-- ============================================================================

-- Welcome email — sent to new staff with a one-time "set your password" link
INSERT INTO ops.email_templates (template_key, name, description, subject, body_html, body_text, placeholders, is_active)
VALUES (
  'staff_welcome_login',
  'Staff Welcome — Set Password',
  'Sent to new staff. Contains a one-time link to set their password.',
  'Welcome to {{org_name_short}} Beacon — set your password',
  E'<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">\n<img src="{{org_logo_url}}" alt="{{org_name_short}}" style="width: 140px; margin-bottom: 1.5rem;" />\n<h2 style="margin: 0 0 1rem;">Hi {{staff_first_name}},</h2>\n<p>Your Beacon account is set up and ready to go. Click the button below to set your password and log in:</p>\n<div style="text-align: center; margin: 2rem 0;">\n<a href="{{reset_url}}" style="display: inline-block; padding: 0.85rem 2rem; background: #4291df; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 1.05rem;">Set your password</a>\n</div>\n<p style="color: #6b7280; font-size: 0.85rem;">This link expires in {{expiry_minutes}} minutes. If it expires, go to <a href="{{login_url}}" style="color: #4291df;">{{login_url}}</a> and click <strong>Forgot password?</strong> to get a new one.</p>\n<p style="color: #6b7280; font-size: 0.85rem; margin-top: 1.5rem;">Questions? Reply to this email or reach out to your supervisor.</p>\n<p style="color: #6b7280; font-size: 0.85rem;">\u2014 {{brand_full_name}}</p>\n</div>',
  E'Hi {{staff_first_name}},\n\nYour Beacon account is set up. Click the link below to set your password:\n\n{{reset_url}}\n\nThis link expires in {{expiry_minutes}} minutes.\n\nIf it expires, go to {{login_url}} and click "Forgot password?" to get a new one.\n\nQuestions? Reply to this email.\n\n\u2014 {{brand_full_name}}',
  ARRAY['staff_first_name', 'reset_url', 'login_url', 'expiry_minutes', 'org_name_short', 'org_logo_url', 'brand_full_name'],
  TRUE
) ON CONFLICT (template_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  subject = EXCLUDED.subject,
  body_html = EXCLUDED.body_html,
  body_text = EXCLUDED.body_text,
  placeholders = EXCLUDED.placeholders,
  updated_at = NOW();

-- Password reset link — sent when staff use "Forgot Password" or admin triggers reset
INSERT INTO ops.email_templates (template_key, name, description, subject, body_html, body_text, placeholders, is_active)
VALUES (
  'password_reset_link',
  'Password Reset Link',
  'Sent when staff use Forgot Password or admin triggers a reset. Contains a one-time link valid for 60 minutes.',
  'Reset your {{org_name_short}} password',
  E'<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">\n<h2>Password Reset</h2>\n<p>Hi {{staff_name}},</p>\n<p>Click the button below to reset your password:</p>\n<div style="text-align: center; margin: 2rem 0;">\n<a href="{{reset_url}}" style="display: inline-block; padding: 0.85rem 2rem; background: #4291df; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 1.05rem;">Reset your password</a>\n</div>\n<p style="color: #6b7280; font-size: 0.85rem;">This link expires in {{expiry_minutes}} minutes.</p>\n<p style="color: #6b7280; font-size: 0.85rem;">If you didn''t request this, you can ignore this email.</p>\n<p style="color: #6b7280; font-size: 0.85rem; margin-top: 2rem;">\u2014 {{org_name_short}}</p>\n</div>',
  E'Hi {{staff_name}},\n\nReset your password:\n\n{{reset_url}}\n\nThis link expires in {{expiry_minutes}} minutes.\n\nIf you didn''t request this, ignore this email.\n\n\u2014 {{org_name_short}}',
  ARRAY['reset_url', 'staff_name', 'expiry_minutes', 'org_name_short'],
  TRUE
) ON CONFLICT (template_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  subject = EXCLUDED.subject,
  body_html = EXCLUDED.body_html,
  body_text = EXCLUDED.body_text,
  placeholders = EXCLUDED.placeholders,
  updated_at = NOW();
