-- MIG_458: AI Access Levels for Tippy
-- Adds ai_access_level column to control what operations users can perform via Tippy AI
--
-- Access levels:
-- - 'none': No AI access (Tippy disabled)
-- - 'read_only': Can query data but not write/log anything
-- - 'read_write': Can query and log events (colony observations, field events)
-- - 'full': Full access including administrative AI operations
--
\echo '=== MIG_458: AI Access Levels ==='

-- Create enum type for AI access levels
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_access_level') THEN
    CREATE TYPE trapper.ai_access_level AS ENUM (
      'none',
      'read_only',
      'read_write',
      'full'
    );
    RAISE NOTICE 'Created ai_access_level enum type';
  END IF;
END $$;

-- Add ai_access_level column to staff table
ALTER TABLE trapper.staff
ADD COLUMN IF NOT EXISTS ai_access_level trapper.ai_access_level DEFAULT 'read_only';

COMMENT ON COLUMN trapper.staff.ai_access_level IS
'Controls what operations this user can perform via Tippy AI:
- none: Tippy disabled for this user
- read_only: Can query data but not write (default)
- read_write: Can query and log events (observations, field reports)
- full: Full AI access including admin operations';

-- Set default access levels based on current auth_role
-- Admin users get full access, everyone else gets read_only
UPDATE trapper.staff
SET ai_access_level = 'full'
WHERE auth_role = 'admin'
  AND ai_access_level IS NULL;

UPDATE trapper.staff
SET ai_access_level = 'read_only'
WHERE auth_role != 'admin'
  AND ai_access_level IS NULL;

-- Create index for quick lookups
CREATE INDEX IF NOT EXISTS idx_staff_ai_access
ON trapper.staff(ai_access_level)
WHERE ai_access_level IS NOT NULL;

\echo 'MIG_458 complete: AI access levels added to staff table'
\echo 'Admins set to full access, others to read_only'
