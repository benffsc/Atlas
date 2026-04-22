-- MIG_3107: Seed equipment SMS reminder template + org contact info into app_config
-- FFS-1339: Pre-filled SMS templates stored in app_config
--
-- Placeholders supported: {name}, {first_name}, {barcodes}, {trap_count},
--   {due_date}, {org_phone}, {org_address}

INSERT INTO ops.app_config (key, value, category, description)
VALUES
  (
    'equipment.sms_reminder_template',
    '"Hi {first_name}, this is Forgotten Felines checking on trap {barcodes} you borrowed. Please return to {org_address} or call {org_phone}. Thank you!"'::jsonb,
    'equipment',
    'SMS body template for overdue equipment reminders. Placeholders: {name}, {first_name}, {barcodes}, {trap_count}, {due_date}, {org_phone}, {org_address}'
  ),
  (
    'equipment.org_phone',
    '"(707) 576-7999"'::jsonb,
    'equipment',
    'Organization phone number used in SMS templates'
  ),
  (
    'equipment.org_address',
    '"1814 Empire Industrial Ct, Suite F, Santa Rosa"'::jsonb,
    'equipment',
    'Organization address used in SMS templates'
  )
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  updated_at = now();
