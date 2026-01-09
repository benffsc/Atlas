-- MIG_267__media_assets_foundation.sql
-- UI_245: Foundation schema for media/photo storage
--
-- This migration creates the base tables for storing media references.
-- No data is populated - this is schema only.
--
-- MANUAL APPLY:
--   psql "$DATABASE_URL" -f sql/migrations/MIG_267__media_assets_foundation.sql

-- ============================================================
-- Table: trapper.media_assets
-- Core table for tracking all media files (photos, documents)
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.media_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source tracking: where did this media come from?
    source_system TEXT NOT NULL DEFAULT 'unknown',  -- 'airtable', 'supabase', 'upload'
    source_key TEXT NULL,                           -- e.g., Airtable attachment ID

    -- Storage location (for Supabase-hosted media)
    storage_path TEXT NULL,                         -- e.g., 'requests/123/photo1.jpg'
    storage_bucket TEXT NULL,                       -- e.g., 'media-private'

    -- File metadata
    original_filename TEXT NULL,
    mime_type TEXT NULL,                            -- e.g., 'image/jpeg', 'application/pdf'
    byte_size BIGINT NULL,

    -- Temporal data
    captured_at TIMESTAMPTZ NULL,                   -- When the photo was taken (EXIF or manual)

    -- Standard timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for source lookups (finding by Airtable attachment ID)
CREATE INDEX IF NOT EXISTS idx_media_assets_source
    ON trapper.media_assets(source_system, source_key)
    WHERE source_key IS NOT NULL;

-- Index for storage lookups
CREATE INDEX IF NOT EXISTS idx_media_assets_storage
    ON trapper.media_assets(storage_bucket, storage_path)
    WHERE storage_path IS NOT NULL;

COMMENT ON TABLE trapper.media_assets IS 'Core table for all media files (photos, documents). UI_245.';
COMMENT ON COLUMN trapper.media_assets.source_system IS 'Where this media originated: airtable, supabase, upload';
COMMENT ON COLUMN trapper.media_assets.source_key IS 'Original identifier from source system (e.g., Airtable attachment ID)';
COMMENT ON COLUMN trapper.media_assets.storage_path IS 'Path within Supabase storage bucket';
COMMENT ON COLUMN trapper.media_assets.captured_at IS 'When the photo was actually taken (from EXIF or manual entry)';

-- ============================================================
-- Table: trapper.request_media
-- Join table linking media to requests
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.request_media (
    request_id UUID NOT NULL REFERENCES trapper.requests(id) ON DELETE CASCADE,
    media_id UUID NOT NULL REFERENCES trapper.media_assets(id) ON DELETE CASCADE,

    -- Role/purpose of this media for this request
    role TEXT NULL,                                 -- 'field_photo', 'proof', 'before', 'after'

    -- Ordering (optional, for display sequence)
    display_order INT NULL DEFAULT 0,

    -- Standard timestamp
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Composite primary key
    PRIMARY KEY (request_id, media_id)
);

-- Index for finding all media for a request
CREATE INDEX IF NOT EXISTS idx_request_media_request
    ON trapper.request_media(request_id);

-- Index for finding all requests for a media item
CREATE INDEX IF NOT EXISTS idx_request_media_media
    ON trapper.request_media(media_id);

COMMENT ON TABLE trapper.request_media IS 'Join table linking media assets to trapping requests. UI_245.';
COMMENT ON COLUMN trapper.request_media.role IS 'Purpose of this media: field_photo, proof, before, after';

-- ============================================================
-- Done
-- ============================================================

-- Verify tables exist
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'media_assets') THEN
        RAISE NOTICE 'MIG_267: trapper.media_assets created successfully';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'request_media') THEN
        RAISE NOTICE 'MIG_267: trapper.request_media created successfully';
    END IF;
END $$;
