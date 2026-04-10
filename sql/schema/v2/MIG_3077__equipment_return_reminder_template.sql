-- MIG_3077: Equipment return reminder email template
--
-- FFS-1210 (Equipment Overhaul epic FFS-1201).
--
-- Creates the email template for equipment return reminders. The cron
-- at /api/cron/equipment-return-reminders sends this when a borrower's
-- due date is approaching or past.
--
-- Placeholders:
--   {{borrower_name}} — who has the equipment
--   {{equipment_name}} — what they have (e.g., "Large Trap (Backdoor) — 0106")
--   {{due_date}} — when it's due back
--   {{days_status}} — e.g., "due tomorrow", "due today", "1 day overdue"
--   {{org_name}} — org full name
--   {{org_phone}} — org phone
--
-- Run with:
--   psql $DATABASE_URL -f sql/schema/v2/MIG_3077__equipment_return_reminder_template.sql

INSERT INTO ops.email_templates (
  template_key,
  name,
  description,
  subject,
  body_html,
  body_text,
  is_active,
  created_at,
  updated_at
) VALUES (
  'equipment_return_reminder',
  'Equipment Return Reminder',
  'Sent when a borrower''s equipment due date is approaching or past. Triggered by /api/cron/equipment-return-reminders.',

  '{{org_name}} — Equipment Return Reminder',

  '<!DOCTYPE html>
<html>
<body style="font-family: Arial, Helvetica, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #333; line-height: 1.6;">
  <div style="border-bottom: 3px solid #1a7f3a; padding-bottom: 12px; margin-bottom: 20px;">
    <h1 style="margin: 0; font-size: 20px; color: #000;">Equipment Return Reminder</h1>
    <p style="margin: 4px 0 0; font-size: 14px; color: #666;">{{org_name}}</p>
  </div>

  <p>Hi {{borrower_name}},</p>

  <p>This is a friendly reminder about the equipment you borrowed from us:</p>

  <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 16px 0;">
    <p style="margin: 0 0 8px; font-weight: 700; font-size: 16px;">{{equipment_name}}</p>
    <p style="margin: 0; color: #555;">Return date: <strong>{{due_date}}</strong> ({{days_status}})</p>
  </div>

  <p>If you''ve already returned the equipment, thank you! Please disregard this message.</p>

  <p>If you need more time — that''s OK! Cat trapping can be unpredictable. Just give us a call at <strong>{{org_phone}}</strong> and we''ll extend your loan.</p>

  <p>If you''re having trouble with the trap or need advice, we''re happy to help. Our staff can troubleshoot trapping challenges over the phone.</p>

  <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 13px; color: #888;">
    <p style="margin: 0;">{{org_name}}<br>{{org_phone}}</p>
    <p style="margin: 8px 0 0; font-style: italic;">This is an automated reminder. If you have questions, call or reply to this email.</p>
  </div>
</body>
</html>',

  'Equipment Return Reminder — {{org_name}}

Hi {{borrower_name}},

This is a friendly reminder about the equipment you borrowed from us:

  {{equipment_name}}
  Return date: {{due_date}} ({{days_status}})

If you''ve already returned the equipment, thank you!

If you need more time, call us at {{org_phone}} and we''ll extend your loan. Cat trapping can be unpredictable — we understand.

If you need trapping advice, we''re happy to help over the phone.

{{org_name}}
{{org_phone}}

This is an automated reminder.',

  true,
  NOW(),
  NOW()
)
ON CONFLICT (template_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  subject = EXCLUDED.subject,
  body_html = EXCLUDED.body_html,
  body_text = EXCLUDED.body_text,
  updated_at = NOW();

\echo 'MIG_3077 applied: equipment_return_reminder email template'
