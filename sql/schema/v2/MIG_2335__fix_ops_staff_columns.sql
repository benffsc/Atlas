\echo '=== MIG_2335: Fix ops.staff missing columns ==='
\echo 'Adding profile columns that API expects but were missing in V2 schema'

-- ============================================================
-- Problem: ops.staff was created in MIG_2015 with only auth columns,
-- but the API (/api/staff) expects profile columns from V1 trapper.staff:
--   first_name, last_name, phone, work_extension, role, department,
--   hired_date, end_date, source_system, source_record_id, ai_access_level
-- ============================================================

-- Add missing columns to ops.staff
ALTER TABLE ops.staff
ADD COLUMN IF NOT EXISTS first_name TEXT,
ADD COLUMN IF NOT EXISTS last_name TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS work_extension TEXT,
ADD COLUMN IF NOT EXISTS role TEXT,
ADD COLUMN IF NOT EXISTS department TEXT,
ADD COLUMN IF NOT EXISTS hired_date DATE,
ADD COLUMN IF NOT EXISTS end_date DATE,
ADD COLUMN IF NOT EXISTS source_system TEXT,
ADD COLUMN IF NOT EXISTS source_record_id TEXT,
ADD COLUMN IF NOT EXISTS ai_access_level TEXT DEFAULT 'read_only';

\echo 'Added missing columns to ops.staff'

-- Backfill first_name from display_name where missing
UPDATE ops.staff
SET first_name = SPLIT_PART(display_name, ' ', 1),
    last_name = NULLIF(TRIM(SUBSTRING(display_name FROM POSITION(' ' IN display_name))), '')
WHERE first_name IS NULL AND display_name IS NOT NULL;

\echo 'Backfilled first_name/last_name from display_name'

-- Set role from auth_role where role is null
UPDATE ops.staff
SET role = CASE
    WHEN auth_role = 'admin' THEN 'Administrator'
    WHEN auth_role = 'volunteer' THEN 'Volunteer'
    ELSE 'Staff'
END
WHERE role IS NULL;

\echo 'Set role from auth_role'

-- Make first_name NOT NULL now that we've backfilled
-- (only if all rows have a value)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM ops.staff WHERE first_name IS NULL) THEN
        ALTER TABLE ops.staff ALTER COLUMN first_name SET NOT NULL;
        RAISE NOTICE 'Set first_name to NOT NULL';
    ELSE
        RAISE NOTICE 'Cannot set first_name NOT NULL - some rows still have NULL values';
    END IF;
END;
$$;

-- Add unique constraint for source tracking (matches V1 behavior)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'staff_source_unique' AND conrelid = 'ops.staff'::regclass
    ) THEN
        -- Only add constraint if there are no duplicates
        IF NOT EXISTS (
            SELECT source_system, source_record_id, COUNT(*)
            FROM ops.staff
            WHERE source_system IS NOT NULL AND source_record_id IS NOT NULL
            GROUP BY source_system, source_record_id
            HAVING COUNT(*) > 1
        ) THEN
            ALTER TABLE ops.staff
            ADD CONSTRAINT staff_source_unique UNIQUE (source_system, source_record_id);
            RAISE NOTICE 'Added staff_source_unique constraint';
        ELSE
            RAISE NOTICE 'Cannot add unique constraint - duplicate source records exist';
        END IF;
    END IF;
END;
$$;

-- Create index on role for filtering
CREATE INDEX IF NOT EXISTS idx_ops_staff_role ON ops.staff(role);
CREATE INDEX IF NOT EXISTS idx_ops_staff_department ON ops.staff(department) WHERE department IS NOT NULL;

-- Update the trigger function to handle new columns
CREATE OR REPLACE FUNCTION ops.staff_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    -- Keep display_name in sync with first/last name
    IF NEW.first_name IS NOT NULL THEN
        NEW.display_name = TRIM(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ops_staff_updated_at ON ops.staff;
CREATE TRIGGER trg_ops_staff_updated_at
    BEFORE UPDATE ON ops.staff
    FOR EACH ROW
    EXECUTE FUNCTION ops.staff_update_timestamp();

\echo ''
\echo '=== MIG_2335 complete ==='
\echo 'Added columns: first_name, last_name, phone, work_extension, role,'
\echo '               department, hired_date, end_date, source_system,'
\echo '               source_record_id, ai_access_level'
\echo ''
