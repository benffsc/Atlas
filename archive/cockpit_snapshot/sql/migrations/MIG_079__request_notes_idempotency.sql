-- MIG_079__request_notes_idempotency.sql
-- Adds note_key and updated_at columns to request_notes for idempotent seeding
--
-- Purpose: Allow re-running Airtable ingest without duplicating notes
-- The note_key enables upsert: INSERT ... ON CONFLICT (note_key) DO UPDATE
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_079__request_notes_idempotency.sql

-- ============================================
-- ADD COLUMNS (if not exist)
-- ============================================
DO $$
BEGIN
    -- Add note_key column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'trapper'
                   AND table_name = 'request_notes'
                   AND column_name = 'note_key') THEN
        ALTER TABLE trapper.request_notes ADD COLUMN note_key text;
        RAISE NOTICE 'Added column: request_notes.note_key';
    ELSE
        RAISE NOTICE 'Column request_notes.note_key already exists';
    END IF;

    -- Add updated_at column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'trapper'
                   AND table_name = 'request_notes'
                   AND column_name = 'updated_at') THEN
        ALTER TABLE trapper.request_notes ADD COLUMN updated_at timestamptz;
        RAISE NOTICE 'Added column: request_notes.updated_at';
    ELSE
        RAISE NOTICE 'Column request_notes.updated_at already exists';
    END IF;
END $$;

-- ============================================
-- CREATE UNIQUE INDEX ON note_key (partial, where not null)
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                   WHERE schemaname = 'trapper'
                   AND tablename = 'request_notes'
                   AND indexname = 'uq_request_notes_note_key') THEN
        CREATE UNIQUE INDEX uq_request_notes_note_key
        ON trapper.request_notes(note_key)
        WHERE note_key IS NOT NULL;
        RAISE NOTICE 'Created unique index: uq_request_notes_note_key';
    ELSE
        RAISE NOTICE 'Index uq_request_notes_note_key already exists';
    END IF;
END $$;

-- ============================================
-- ADD COMMENT
-- ============================================
COMMENT ON COLUMN trapper.request_notes.note_key IS
'Deterministic key for idempotent upsert. Format: source::case_number::kind (e.g., airtable_trapping_requests::123::case_info)';

-- ============================================
-- VERIFICATION
-- ============================================
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'trapper'
  AND table_name = 'request_notes'
ORDER BY ordinal_position;
