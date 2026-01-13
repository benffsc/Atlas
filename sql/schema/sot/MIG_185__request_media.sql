-- MIG_185: Request Media Management
--
-- Implements photo/media management for trapping requests:
-- 1. Cat-specific photos (photos of individual cats)
-- 2. Site documentation (colony photos, location pics, evidence)
--
-- Design principles:
-- - Append-only: Never lose old images
-- - Categorized: Cat photos vs site photos
-- - Linked: Photos can be linked to specific cats after trapping
-- - Audited: Track who uploaded what and when

BEGIN;

-- ============================================================================
-- 1. MEDIA TYPE ENUM
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE trapper.media_type AS ENUM (
        'cat_photo',        -- Photo of a specific cat
        'site_photo',       -- General colony/location photo
        'evidence',         -- Documentation (hazards, conditions)
        'map_screenshot',   -- Map/location reference
        'document',         -- Forms, permits, etc.
        'other'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 2. REQUEST MEDIA TABLE
-- ============================================================================
-- Stores metadata about uploaded media files

CREATE TABLE IF NOT EXISTS trapper.request_media (
    media_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES trapper.sot_requests(request_id) ON DELETE CASCADE,

    -- Media info
    media_type trapper.media_type NOT NULL DEFAULT 'site_photo',
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL,  -- {request_id}_{timestamp}_{hash}.{ext}
    file_size_bytes INTEGER,
    mime_type TEXT,

    -- Storage location
    storage_provider TEXT NOT NULL DEFAULT 'local',  -- 'local', 'supabase', 's3'
    storage_path TEXT NOT NULL,                      -- Full path or URL
    thumbnail_path TEXT,                             -- For images

    -- Content description
    caption TEXT,
    notes TEXT,

    -- Cat linking (for cat_photo type)
    linked_cat_id UUID REFERENCES trapper.sot_cats(cat_id),
    cat_description TEXT,  -- Before cat is identified: "orange tabby", "black female"

    -- Audit
    uploaded_by TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Soft delete (preserve history)
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at TIMESTAMPTZ,
    archived_by TEXT,
    archive_reason TEXT,

    -- Airtable sync
    airtable_record_id TEXT,
    airtable_attachment_id TEXT,
    synced_from_airtable BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_request_media_request ON trapper.request_media(request_id);
CREATE INDEX IF NOT EXISTS idx_request_media_type ON trapper.request_media(media_type);
CREATE INDEX IF NOT EXISTS idx_request_media_cat ON trapper.request_media(linked_cat_id) WHERE linked_cat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_request_media_uploaded ON trapper.request_media(uploaded_at);

COMMENT ON TABLE trapper.request_media IS
'Append-only media storage for request photos. Cat photos can be linked to sot_cats after identification.';

-- ============================================================================
-- 3. MEDIA COLLECTIONS (for grouping)
-- ============================================================================
-- Groups related media (e.g., "Day 1 trapping session", "Initial site visit")

CREATE TABLE IF NOT EXISTS trapper.media_collections (
    collection_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES trapper.sot_requests(request_id) ON DELETE CASCADE,

    name TEXT NOT NULL,
    description TEXT,
    collection_date DATE,

    -- Audit
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_collections_request ON trapper.media_collections(request_id);

-- Link table for collection membership
CREATE TABLE IF NOT EXISTS trapper.media_collection_items (
    collection_id UUID NOT NULL REFERENCES trapper.media_collections(collection_id) ON DELETE CASCADE,
    media_id UUID NOT NULL REFERENCES trapper.request_media(media_id) ON DELETE CASCADE,
    sort_order INTEGER DEFAULT 0,
    PRIMARY KEY (collection_id, media_id)
);

-- ============================================================================
-- 4. VIEW: REQUEST MEDIA SUMMARY
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_request_media_summary AS
SELECT
    r.request_id,
    r.summary,
    COUNT(rm.media_id) FILTER (WHERE NOT rm.is_archived) AS total_media,
    COUNT(rm.media_id) FILTER (WHERE rm.media_type = 'cat_photo' AND NOT rm.is_archived) AS cat_photos,
    COUNT(rm.media_id) FILTER (WHERE rm.media_type = 'site_photo' AND NOT rm.is_archived) AS site_photos,
    COUNT(rm.media_id) FILTER (WHERE rm.linked_cat_id IS NOT NULL AND NOT rm.is_archived) AS linked_to_cats,
    MAX(rm.uploaded_at) AS last_upload_at,
    ARRAY_AGG(DISTINCT rm.uploaded_by) FILTER (WHERE NOT rm.is_archived) AS uploaders
FROM trapper.sot_requests r
LEFT JOIN trapper.request_media rm ON rm.request_id = r.request_id
GROUP BY r.request_id, r.summary;

-- ============================================================================
-- 5. FUNCTION: ARCHIVE MEDIA (soft delete)
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.archive_media(
    p_media_id UUID,
    p_archived_by TEXT,
    p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE trapper.request_media
    SET is_archived = TRUE,
        archived_at = NOW(),
        archived_by = p_archived_by,
        archive_reason = p_reason
    WHERE media_id = p_media_id
      AND NOT is_archived;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 6. FUNCTION: LINK PHOTO TO CAT
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.link_photo_to_cat(
    p_media_id UUID,
    p_cat_id UUID,
    p_linked_by TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Verify media is a cat photo
    IF NOT EXISTS (
        SELECT 1 FROM trapper.request_media
        WHERE media_id = p_media_id AND media_type = 'cat_photo'
    ) THEN
        RAISE EXCEPTION 'Media % is not a cat photo', p_media_id;
    END IF;

    -- Verify cat exists
    IF NOT EXISTS (SELECT 1 FROM trapper.sot_cats WHERE cat_id = p_cat_id) THEN
        RAISE EXCEPTION 'Cat % not found', p_cat_id;
    END IF;

    UPDATE trapper.request_media
    SET linked_cat_id = p_cat_id
    WHERE media_id = p_media_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT 'Media tables created:' AS info;
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'trapper'
AND table_name IN ('request_media', 'media_collections', 'media_collection_items')
ORDER BY table_name;
