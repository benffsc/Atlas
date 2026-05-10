-- MIG_3131: Upgrade staff AI permissions — all staff get write access
--
-- Problem: 24/26 staff have ai_access_level='read_only'. They can't add notes,
-- create reminders, log field contacts, or link corridors. Tippy is effectively
-- a read-only lookup tool for everyone except Pip.
--
-- New model:
--   read_only  = Volunteers, external users (lookup only)
--   standard   = All staff (read + additive writes: notes, reminders, contacts, tickets)
--   full       = Admins/engineers (standard + run_sql + destructive operations)
--
-- "standard" replaces "read_write" as the default for all active staff.
-- The routing code treats 'standard' and 'read_write' identically.

-- Upgrade all active staff from read_only to standard
UPDATE ops.staff
SET ai_access_level = 'standard'
WHERE is_active = TRUE
  AND ai_access_level = 'read_only';

-- Keep admins at full
UPDATE ops.staff
SET ai_access_level = 'full'
WHERE auth_role = 'admin'
  AND ai_access_level != 'full';
