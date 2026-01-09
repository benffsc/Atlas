-- MIG_074__create_attachments.sql
-- Creates attachments and attachment_links tables for media/document linking
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_074__create_attachments.sql

-- ============================================
-- ATTACHMENTS TABLE (the actual files/URLs)
-- ============================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'trapper' AND table_name = 'attachments') THEN
        RAISE NOTICE 'Table trapper.attachments already exists, skipping creation';
    ELSE
        CREATE TABLE trapper.attachments (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            source_system text,                    -- 'supabase_storage', 's3', 'google_drive', etc.
            source_url text NOT NULL,              -- Full URL to the file
            filename text,                         -- Original filename
            content_type text,                     -- MIME type (image/jpeg, application/pdf, etc.)
            bytes bigint,                          -- File size in bytes
            sha256 text,                           -- Hash for deduplication
            meta jsonb DEFAULT '{}'::jsonb,        -- Additional metadata (dimensions, duration, etc.)
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        -- Index for deduplication by hash
        CREATE INDEX idx_attachments_sha256 ON trapper.attachments(sha256) WHERE sha256 IS NOT NULL;

        -- Index for filtering by content type
        CREATE INDEX idx_attachments_content_type ON trapper.attachments(content_type);

        -- Updated_at trigger
        CREATE TRIGGER trg_attachments_updated_at
        BEFORE UPDATE ON trapper.attachments
        FOR EACH ROW EXECUTE FUNCTION trapper.set_updated_at();

        COMMENT ON TABLE trapper.attachments IS
        'Storage-agnostic attachment records. URLs point to Supabase Storage, S3, or external sources.';

        RAISE NOTICE 'Created table trapper.attachments with indexes';
    END IF;
END $$;

-- ============================================
-- ATTACHMENT_LINKS TABLE (polymorphic linking)
-- ============================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'trapper' AND table_name = 'attachment_links') THEN
        RAISE NOTICE 'Table trapper.attachment_links already exists, skipping creation';
    ELSE
        CREATE TABLE trapper.attachment_links (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            attachment_id uuid NOT NULL REFERENCES trapper.attachments(id) ON DELETE CASCADE,
            entity_type text NOT NULL,             -- 'request', 'place', 'person', 'address', etc.
            entity_id uuid NOT NULL,               -- ID of the linked entity
            role text DEFAULT 'general',           -- 'photo', 'document', 'signature', 'map', etc.
            notes text,                            -- Optional description
            created_at timestamptz NOT NULL DEFAULT now()
        );

        -- Constraint for valid entity types
        ALTER TABLE trapper.attachment_links
        ADD CONSTRAINT chk_attachment_links_entity_type
        CHECK (entity_type IN ('request', 'place', 'person', 'address', 'appointment_request',
                               'clinic_visit', 'clinichq_appt', 'event'));

        -- Index for finding attachments by entity
        CREATE INDEX idx_attachment_links_entity
        ON trapper.attachment_links(entity_type, entity_id);

        -- Index for finding links by attachment
        CREATE INDEX idx_attachment_links_attachment
        ON trapper.attachment_links(attachment_id);

        -- Unique constraint to prevent duplicate links
        CREATE UNIQUE INDEX uq_attachment_links_entity_attachment
        ON trapper.attachment_links(attachment_id, entity_type, entity_id, role);

        COMMENT ON TABLE trapper.attachment_links IS
        'Polymorphic linking table connecting attachments to any entity type.';

        RAISE NOTICE 'Created table trapper.attachment_links with indexes';
    END IF;
END $$;

-- Verification query
SELECT 'attachments' AS table_name,
       (SELECT COUNT(*) FROM trapper.attachments) AS rows
UNION ALL
SELECT 'attachment_links',
       (SELECT COUNT(*) FROM trapper.attachment_links);
