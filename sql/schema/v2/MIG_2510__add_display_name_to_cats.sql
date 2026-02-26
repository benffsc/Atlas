\echo '=== MIG_2510: Add display_name column to sot.cats ==='
\echo 'Industry best practice: consistent schema with sot.people and sot.places'

-- ============================================================
-- Problem: sot.cats has "name" column but 24+ API files reference
-- "c.display_name" which doesn't exist. Views alias it correctly
-- but direct table queries fail.
--
-- Solution: Add display_name column with sync trigger to keep it
-- in sync with name by default, while allowing explicit override.
-- ============================================================

-- 1. Add display_name column
ALTER TABLE sot.cats
ADD COLUMN IF NOT EXISTS display_name TEXT;

\echo 'Added display_name column'

-- 2. Backfill from name column
UPDATE sot.cats
SET display_name = name
WHERE display_name IS NULL AND name IS NOT NULL;

\echo 'Backfilled display_name from name'

-- 3. Create sync trigger
-- Keeps display_name = name by default unless explicitly set differently
CREATE OR REPLACE FUNCTION sot.sync_cat_display_name()
RETURNS TRIGGER AS $$
BEGIN
    -- On INSERT: if display_name not provided, use name
    IF TG_OP = 'INSERT' THEN
        IF NEW.display_name IS NULL THEN
            NEW.display_name = NEW.name;
        END IF;
    -- On UPDATE: if name changed and display_name was synced to old name, update it
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.display_name IS NULL THEN
            NEW.display_name = NEW.name;
        ELSIF OLD.name IS NOT NULL AND NEW.display_name = OLD.name AND NEW.name != OLD.name THEN
            NEW.display_name = NEW.name;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_cat_display_name ON sot.cats;
CREATE TRIGGER trg_sync_cat_display_name
    BEFORE INSERT OR UPDATE ON sot.cats
    FOR EACH ROW
    EXECUTE FUNCTION sot.sync_cat_display_name();

\echo 'Created sync trigger for display_name'

-- 4. Add index for display_name lookups
CREATE INDEX IF NOT EXISTS idx_sot_cats_display_name ON sot.cats(display_name);

\echo 'Created index on display_name'

-- 5. Verify
DO $$
DECLARE
    col_exists BOOLEAN;
    null_count INTEGER;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'sot' AND table_name = 'cats' AND column_name = 'display_name'
    ) INTO col_exists;

    IF NOT col_exists THEN
        RAISE EXCEPTION 'display_name column was not created';
    END IF;

    SELECT COUNT(*) INTO null_count
    FROM sot.cats
    WHERE display_name IS NULL AND name IS NOT NULL;

    IF null_count > 0 THEN
        RAISE WARNING 'There are still % cats with name but no display_name', null_count;
    ELSE
        RAISE NOTICE 'All cats with names have display_name populated';
    END IF;
END;
$$;

\echo ''
\echo '=== MIG_2510 complete ==='
\echo 'sot.cats now has display_name column synced with name'
\echo 'All 24+ API files referencing c.display_name will now work'
