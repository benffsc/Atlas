\echo '=== MIG_2337: Fix journal_entries schema for API compatibility ==='
\echo 'Adding columns the journal API expects but are missing'

-- ============================================================
-- Problem: The journal API expects a different schema than V2 has:
--   API expects: id, body, entry_kind, title, primary_*, is_archived, is_pinned, tags, etc.
--   V2 has: entry_id, content, entry_type, place_id (NOT NULL), etc.
-- ============================================================

-- Add id as an alias column (generated from entry_id)
-- Actually, we can't do generated columns for UUID. Instead, add 'id' and backfill.
ALTER TABLE ops.journal_entries
ADD COLUMN IF NOT EXISTS id UUID;

-- Backfill id from entry_id
UPDATE ops.journal_entries SET id = entry_id WHERE id IS NULL;

-- Add body column and backfill from content
ALTER TABLE ops.journal_entries
ADD COLUMN IF NOT EXISTS body TEXT;

UPDATE ops.journal_entries SET body = content WHERE body IS NULL;

-- Add entry_kind column and backfill from entry_type
ALTER TABLE ops.journal_entries
ADD COLUMN IF NOT EXISTS entry_kind TEXT;

UPDATE ops.journal_entries SET entry_kind = entry_type WHERE entry_kind IS NULL;

-- Add title column
ALTER TABLE ops.journal_entries
ADD COLUMN IF NOT EXISTS title TEXT;

-- Add primary_* columns for entity linking
ALTER TABLE ops.journal_entries
ADD COLUMN IF NOT EXISTS primary_cat_id UUID,
ADD COLUMN IF NOT EXISTS primary_person_id UUID,
ADD COLUMN IF NOT EXISTS primary_place_id UUID,
ADD COLUMN IF NOT EXISTS primary_request_id UUID,
ADD COLUMN IF NOT EXISTS primary_submission_id UUID,
ADD COLUMN IF NOT EXISTS primary_annotation_id UUID;

-- Backfill primary_place_id from place_id
UPDATE ops.journal_entries
SET primary_place_id = place_id
WHERE primary_place_id IS NULL AND place_id IS NOT NULL;

-- Backfill primary_request_id from request_id
UPDATE ops.journal_entries
SET primary_request_id = request_id
WHERE primary_request_id IS NULL AND request_id IS NOT NULL;

-- Backfill primary_submission_id from submission_id
UPDATE ops.journal_entries
SET primary_submission_id = submission_id
WHERE primary_submission_id IS NULL AND submission_id IS NOT NULL;

-- Backfill primary_person_id from person_id
UPDATE ops.journal_entries
SET primary_person_id = person_id
WHERE primary_person_id IS NULL AND person_id IS NOT NULL;

-- Add occurred_at column
ALTER TABLE ops.journal_entries
ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;

-- Add is_archived and is_pinned columns with defaults
ALTER TABLE ops.journal_entries
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;

-- Backfill is_archived and is_pinned for existing entries
UPDATE ops.journal_entries SET is_archived = FALSE WHERE is_archived IS NULL;
UPDATE ops.journal_entries SET is_pinned = FALSE WHERE is_pinned IS NULL;

-- Add edit tracking columns
ALTER TABLE ops.journal_entries
ADD COLUMN IF NOT EXISTS edit_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS updated_by TEXT,
ADD COLUMN IF NOT EXISTS updated_by_staff_id UUID;

-- Add tags column (array of text)
ALTER TABLE ops.journal_entries
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

\echo 'Added all missing columns'

-- Create indexes for the primary_* columns
CREATE INDEX IF NOT EXISTS idx_journal_primary_cat ON ops.journal_entries(primary_cat_id) WHERE primary_cat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journal_primary_person ON ops.journal_entries(primary_person_id) WHERE primary_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journal_primary_place ON ops.journal_entries(primary_place_id) WHERE primary_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journal_primary_request ON ops.journal_entries(primary_request_id) WHERE primary_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journal_primary_submission ON ops.journal_entries(primary_submission_id) WHERE primary_submission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journal_primary_annotation ON ops.journal_entries(primary_annotation_id) WHERE primary_annotation_id IS NOT NULL;

-- Index for common query patterns
CREATE INDEX IF NOT EXISTS idx_journal_archived ON ops.journal_entries(is_archived);
CREATE INDEX IF NOT EXISTS idx_journal_pinned ON ops.journal_entries(is_pinned) WHERE is_pinned = TRUE;
CREATE INDEX IF NOT EXISTS idx_journal_entry_kind ON ops.journal_entries(entry_kind);

\echo 'Created indexes'

-- Set id as NOT NULL now that it's backfilled (or add default)
-- Actually, let's add a default so new rows get an id automatically
DO $$
BEGIN
    -- Check if id has a default
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'ops' AND table_name = 'journal_entries'
        AND column_name = 'id' AND column_default IS NOT NULL
    ) THEN
        ALTER TABLE ops.journal_entries ALTER COLUMN id SET DEFAULT gen_random_uuid();
        RAISE NOTICE 'Set default for id column';
    END IF;
END;
$$;

-- Create trigger to keep id and entry_id in sync for backwards compatibility
CREATE OR REPLACE FUNCTION ops.journal_sync_ids()
RETURNS TRIGGER AS $$
BEGIN
    -- If id is set but entry_id is not, copy id to entry_id
    IF NEW.id IS NOT NULL AND NEW.entry_id IS NULL THEN
        NEW.entry_id = NEW.id;
    -- If entry_id is set but id is not, copy entry_id to id
    ELSIF NEW.entry_id IS NOT NULL AND NEW.id IS NULL THEN
        NEW.id = NEW.entry_id;
    -- If both are NULL, generate new UUID for both
    ELSIF NEW.id IS NULL AND NEW.entry_id IS NULL THEN
        NEW.id = gen_random_uuid();
        NEW.entry_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_sync_ids ON ops.journal_entries;
CREATE TRIGGER trg_journal_sync_ids
    BEFORE INSERT ON ops.journal_entries
    FOR EACH ROW
    EXECUTE FUNCTION ops.journal_sync_ids();

\echo 'Created id/entry_id sync trigger'

-- Verify the columns exist
DO $$
DECLARE
    missing_cols TEXT[];
BEGIN
    SELECT array_agg(col) INTO missing_cols
    FROM unnest(ARRAY['id', 'body', 'entry_kind', 'title', 'primary_cat_id', 'primary_person_id',
                       'primary_place_id', 'primary_request_id', 'primary_submission_id',
                       'is_archived', 'is_pinned', 'tags', 'occurred_at']) AS col
    WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'ops' AND table_name = 'journal_entries' AND column_name = col
    );

    IF missing_cols IS NOT NULL AND array_length(missing_cols, 1) > 0 THEN
        RAISE WARNING 'Still missing columns: %', array_to_string(missing_cols, ', ');
    ELSE
        RAISE NOTICE 'All required columns present';
    END IF;
END;
$$;

-- Make entry_type nullable since we now use entry_kind
ALTER TABLE ops.journal_entries ALTER COLUMN entry_type DROP NOT NULL;

\echo 'Made entry_type nullable'

-- Create trigger to sync entry_kind/entry_type and body/content
CREATE OR REPLACE FUNCTION ops.journal_sync_entry_type()
RETURNS TRIGGER AS $$
BEGIN
    -- Sync entry_kind to entry_type
    IF NEW.entry_kind IS NOT NULL AND NEW.entry_type IS NULL THEN
        NEW.entry_type = NEW.entry_kind;
    ELSIF NEW.entry_type IS NOT NULL AND NEW.entry_kind IS NULL THEN
        NEW.entry_kind = NEW.entry_type;
    END IF;

    -- Sync body to content
    IF NEW.body IS NOT NULL AND NEW.content IS NULL THEN
        NEW.content = NEW.body;
    ELSIF NEW.content IS NOT NULL AND NEW.body IS NULL THEN
        NEW.body = NEW.content;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_sync_fields ON ops.journal_entries;
CREATE TRIGGER trg_journal_sync_fields
    BEFORE INSERT OR UPDATE ON ops.journal_entries
    FOR EACH ROW
    EXECUTE FUNCTION ops.journal_sync_entry_type();

\echo 'Created field sync trigger for entry_kind/entry_type and body/content'

\echo ''
\echo '=== MIG_2337 complete ==='
\echo 'Journal entries table now has:'
\echo '  - id (synced with entry_id)'
\echo '  - body (synced with content)'
\echo '  - entry_kind (synced with entry_type)'
\echo '  - title, primary_*, is_archived, is_pinned, tags, occurred_at'
\echo ''
