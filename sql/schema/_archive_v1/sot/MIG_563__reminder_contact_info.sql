-- MIG_562: Add Contact Info to Staff Reminders
-- Allows reminders to capture structured contact details (name, phone, email, address)
-- so staff can see all info at a glance without going back to the original message.
--
\echo '=== MIG_562: Reminder Contact Info ==='

-- Add contact_info JSONB column
ALTER TABLE trapper.staff_reminders
ADD COLUMN IF NOT EXISTS contact_info JSONB;

COMMENT ON COLUMN trapper.staff_reminders.contact_info IS
'Structured contact information captured with the reminder. Schema:
{
  "name": "Full name of person to contact",
  "phone": "Phone number",
  "email": "Email address",
  "address": "Street address",
  "city": "City",
  "zip": "ZIP code",
  "relationship": "Optional - who referred them, translator info, etc."
}';

-- Index for searching reminders by contact info
CREATE INDEX IF NOT EXISTS idx_staff_reminders_contact_info
  ON trapper.staff_reminders USING GIN (contact_info)
  WHERE contact_info IS NOT NULL;

\echo 'MIG_562 complete: Added contact_info column to staff_reminders'
