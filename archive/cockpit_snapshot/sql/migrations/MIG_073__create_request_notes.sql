-- MIG_073__create_request_notes.sql
-- Creates request_notes table for narrative history/journal
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_073__create_request_notes.sql

-- Check if table already exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'trapper' AND table_name = 'request_notes') THEN
        RAISE NOTICE 'Table trapper.request_notes already exists, skipping creation';
    ELSE
        -- Create the table
        CREATE TABLE trapper.request_notes (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            request_id uuid NOT NULL REFERENCES trapper.requests(id) ON DELETE CASCADE,
            note_kind text NOT NULL DEFAULT 'internal',
            note_body text NOT NULL,
            source_system text,
            source_record_id text,
            created_at timestamptz NOT NULL DEFAULT now(),
            created_by text  -- future: link to users table
        );

        -- Add constraint for valid note_kind values
        ALTER TABLE trapper.request_notes
        ADD CONSTRAINT chk_request_notes_kind
        CHECK (note_kind IN ('internal', 'case_info', 'status', 'contact', 'medical', 'other'));

        -- Index for efficient lookup by request
        CREATE INDEX idx_request_notes_request_time
        ON trapper.request_notes(request_id, created_at DESC);

        -- Index for filtering by note kind
        CREATE INDEX idx_request_notes_kind
        ON trapper.request_notes(note_kind);

        -- Comment
        COMMENT ON TABLE trapper.request_notes IS
        'Narrative notes/journal entries for requests. Supports internal notes, status changes, contact logs.';

        RAISE NOTICE 'Created table trapper.request_notes with indexes';
    END IF;
END $$;

-- Verification query
SELECT 'request_notes' AS table_name,
       COUNT(*) AS rows,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_schema='trapper' AND table_name='request_notes') AS columns;
