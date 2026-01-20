-- MIG_510: Default read_write AI access for all staff
-- Changes default AI access from read_only to read_write
-- This allows all staff to use Tippy features like:
--   - send_staff_message (Tell X that...)
--   - create_reminder (Remind me to...)
--   - save_lookup (Save this to my lookups)
--   - log_field_event / log_site_observation
--
-- These are all non-destructive operations (INSERT only, no DELETE/UPDATE of core data)

\echo '=== MIG_510: Default read_write AI access ==='

-- Update existing read_only users to read_write
UPDATE trapper.staff
SET ai_access_level = 'read_write'
WHERE ai_access_level = 'read_only';

-- Change the default for new staff members
ALTER TABLE trapper.staff
ALTER COLUMN ai_access_level SET DEFAULT 'read_write';

\echo 'Updated all read_only users to read_write'
\echo 'Changed default AI access level to read_write'
\echo 'MIG_510 complete'
