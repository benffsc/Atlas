-- MIG_3083: Staff Password Reset Infrastructure
--
-- Adds missing columns for password reset (already referenced in code),
-- flags staff who have never logged in as needing password change,
-- and seeds email templates for welcome + reset links.
-- Email template styling matches the OOA template (MIG_3060).
-- Uses Beacon logo + VML bulletproof buttons for Outlook desktop.

-- ============================================================================
-- 1. Add missing columns
-- ============================================================================

ALTER TABLE ops.staff
  ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_staff_reset_token
  ON ops.staff(password_reset_token_hash)
  WHERE password_reset_token_hash IS NOT NULL;

-- ============================================================================
-- 2. Flag staff who have a password but never logged in
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
  'Welcome to {{brand_name}} Beacon — set your password',
  E'<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8"><title>Welcome to Beacon</title></head>\n<body style="font-family: Arial, Helvetica, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #333; line-height: 1.5;">\n\n  <div style="text-align: center; margin-bottom: 24px;">\n    <img src="https://atlas.forgottenfelines.com/beacon-logo.jpeg" alt="Beacon" style="max-width: 220px; height: auto;">\n  </div>\n\n  <p style="font-size: 16px;">Hi {{staff_first_name}},</p>\n\n  <p>Your Beacon account is set up and ready to go. Click the button below to set your password and log in for the first time:</p>\n\n  <div style="text-align: center; margin: 28px 0;">\n    <!--[if mso]>\n    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{{reset_url}}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="13%" strokecolor="#1a4480" fillcolor="#1a4480">\n      <w:anchorlock/>\n      <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">Set your password</center>\n    </v:roundrect>\n    <![endif]-->\n    <!--[if !mso]><!-->\n    <a href="{{reset_url}}" style="display: inline-block; padding: 14px 32px; background: #1a4480; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Set your password</a>\n    <!--<![endif]-->\n  </div>\n\n  <p style="font-size: 13px; color: #666;">This link expires in {{expiry_minutes}} minutes. If it expires, go to <a href="{{login_url}}" style="color: #1a4480;">{{login_url}}</a> and click <strong>Forgot password?</strong> to get a new one.</p>\n\n  <p style="font-size: 13px; color: #666;">Questions? Reply to this email or reach out to your supervisor.</p>\n\n  <hr style="margin: 32px 0; border: none; border-top: 1px solid #eee;">\n\n  <div style="font-size: 12px; color: #888; text-align: center;">\n    <strong>{{brand_full_name}}</strong><br>\n    {{org_address}}<br>\n    {{org_phone}} &middot; <a href="https://{{org_website}}" style="color: #1a4480;">{{org_website}}</a>\n  </div>\n\n</body>\n</html>',
  E'Hi {{staff_first_name}},\n\nYour Beacon account is set up. Click the link below to set your password:\n\n{{reset_url}}\n\nThis link expires in {{expiry_minutes}} minutes.\n\nIf it expires, go to {{login_url}} and click "Forgot password?" to get a new one.\n\nQuestions? Reply to this email.\n\n---\n{{brand_full_name}}\n{{org_address}}\n{{org_phone}} - {{org_website}}',
  ARRAY['staff_first_name', 'reset_url', 'login_url', 'expiry_minutes', 'brand_name', 'brand_full_name', 'org_address', 'org_phone', 'org_website'],
  TRUE
) ON CONFLICT (template_key) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, subject = EXCLUDED.subject,
  body_html = EXCLUDED.body_html, body_text = EXCLUDED.body_text,
  placeholders = EXCLUDED.placeholders, updated_at = NOW();

-- Password reset link — sent when staff use "Forgot Password" or admin triggers reset
INSERT INTO ops.email_templates (template_key, name, description, subject, body_html, body_text, placeholders, is_active)
VALUES (
  'password_reset_link',
  'Password Reset Link',
  'Sent when staff use Forgot Password or admin triggers a reset. Contains a one-time link valid for 60 minutes.',
  'Reset your {{brand_name}} password',
  E'<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8"><title>Password Reset</title></head>\n<body style="font-family: Arial, Helvetica, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #333; line-height: 1.5;">\n\n  <div style="text-align: center; margin-bottom: 24px;">\n    <img src="https://atlas.forgottenfelines.com/beacon-logo.jpeg" alt="Beacon" style="max-width: 220px; height: auto;">\n  </div>\n\n  <p style="font-size: 16px;">Hi {{staff_name}},</p>\n\n  <p>We received a request to reset your password. Click the button below to choose a new one:</p>\n\n  <div style="text-align: center; margin: 28px 0;">\n    <!--[if mso]>\n    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{{reset_url}}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="13%" strokecolor="#1a4480" fillcolor="#1a4480">\n      <w:anchorlock/>\n      <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">Reset your password</center>\n    </v:roundrect>\n    <![endif]-->\n    <!--[if !mso]><!-->\n    <a href="{{reset_url}}" style="display: inline-block; padding: 14px 32px; background: #1a4480; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Reset your password</a>\n    <!--<![endif]-->\n  </div>\n\n  <p style="font-size: 13px; color: #666;">This link expires in {{expiry_minutes}} minutes. If it expires, go to the login page and click <strong>Forgot password?</strong> to get a new one.</p>\n\n  <p style="font-size: 13px; color: #666;">If you didn''t request this, you can safely ignore this email \u2014 your password won''t change.</p>\n\n  <hr style="margin: 32px 0; border: none; border-top: 1px solid #eee;">\n\n  <div style="font-size: 12px; color: #888; text-align: center;">\n    <strong>{{brand_full_name}}</strong><br>\n    {{org_address}}<br>\n    {{org_phone}} &middot; <a href="https://{{org_website}}" style="color: #1a4480;">{{org_website}}</a>\n  </div>\n\n</body>\n</html>',
  E'Hi {{staff_name}},\n\nWe received a request to reset your password. Click the link below:\n\n{{reset_url}}\n\nThis link expires in {{expiry_minutes}} minutes.\n\nIf you didn''t request this, ignore this email.\n\n---\n{{brand_full_name}}\n{{org_address}}\n{{org_phone}} - {{org_website}}',
  ARRAY['reset_url', 'staff_name', 'expiry_minutes', 'brand_name', 'brand_full_name', 'org_address', 'org_phone', 'org_website'],
  TRUE
) ON CONFLICT (template_key) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, subject = EXCLUDED.subject,
  body_html = EXCLUDED.body_html, body_text = EXCLUDED.body_text,
  placeholders = EXCLUDED.placeholders, updated_at = NOW();
