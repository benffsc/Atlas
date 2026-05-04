-- MIG_3120: Add supabase_user_id FK to ops.staff for unified identity tracking
-- FFS-1447: ops.staff.staff_id and auth.users.id are separate UUIDs with no FK.
-- This adds a nullable column linking them, backfilled by email match.

ALTER TABLE ops.staff
  ADD COLUMN IF NOT EXISTS supabase_user_id UUID REFERENCES auth.users(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_supabase_user_id
  ON ops.staff(supabase_user_id)
  WHERE supabase_user_id IS NOT NULL;

-- Backfill by email match
UPDATE ops.staff s
SET supabase_user_id = u.id
FROM auth.users u
WHERE LOWER(s.email) = LOWER(u.email)
  AND s.supabase_user_id IS NULL;

-- Verify
DO $$
DECLARE
  matched INT;
  total INT;
BEGIN
  SELECT COUNT(*) INTO total FROM ops.staff WHERE is_active = TRUE;
  SELECT COUNT(*) INTO matched FROM ops.staff WHERE supabase_user_id IS NOT NULL AND is_active = TRUE;
  RAISE NOTICE 'MIG_3120: % of % active staff linked to auth.users', matched, total;
END $$;
