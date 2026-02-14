-- MIG_186: Raw Media Intake Layer
--
-- Extends the Raw → Normalize → SoT pattern to media imports.
-- All media from external sources (Airtable, etc.) goes through this layer.
--
-- Flow: Airtable Photos → raw_airtable_media → request_media

BEGIN;

-- ============================================================================
-- 1. RAW AIRTABLE MEDIA TABLE
-- ============================================================================
-- Captures raw photo/media data from Airtable before processing

CREATE TABLE IF NOT EXISTS trapper.raw_airtable_media (
    raw_media_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Airtable identifiers
    airtable_record_id TEXT NOT NULL,           -- Record from Trapper Cats or Trapper Reports
    airtable_attachment_id TEXT NOT NULL,       -- Attachment ID within the record
    airtable_table TEXT NOT NULL,               -- 'trapper_cats' or 'trapper_reports'

    -- Source request linkage
    airtable_request_id TEXT,                   -- Airtable Trapping Request ID

    -- Attachment metadata from Airtable
    filename TEXT NOT NULL,
    url TEXT NOT NULL,                          -- Airtable CDN URL (temporary)
    size_bytes INTEGER,
    mime_type TEXT,
    width INTEGER,
    height INTEGER,

    -- Content info
    media_type TEXT NOT NULL DEFAULT 'site_photo',  -- 'cat_photo' or 'site_photo'
    caption TEXT,
    cat_description TEXT,
    notes TEXT,

    -- Processing state
    processing_status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'downloaded', 'imported', 'failed', 'skipped'
    error_message TEXT,

    -- Local storage (populated after download)
    local_filename TEXT,
    local_path TEXT,

    -- Target record (populated after import)
    target_request_id UUID,
    target_media_id UUID,

    -- Audit
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,

    -- Prevent duplicates
    UNIQUE(airtable_record_id, airtable_attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_airtable_media_status ON trapper.raw_airtable_media(processing_status);
CREATE INDEX IF NOT EXISTS idx_raw_airtable_media_request ON trapper.raw_airtable_media(airtable_request_id);

COMMENT ON TABLE trapper.raw_airtable_media IS
'Raw media intake from Airtable. Photos are downloaded, then imported to request_media.';

-- ============================================================================
-- 2. FUNCTION: Import media from raw to request_media
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.import_raw_media(p_raw_media_id UUID)
RETURNS UUID AS $$
DECLARE
    v_raw RECORD;
    v_request_id UUID;
    v_media_id UUID;
BEGIN
    -- Get raw record
    SELECT * INTO v_raw FROM trapper.raw_airtable_media WHERE raw_media_id = p_raw_media_id;

    IF v_raw IS NULL THEN
        RAISE EXCEPTION 'Raw media record not found: %', p_raw_media_id;
    END IF;

    IF v_raw.processing_status NOT IN ('pending', 'downloaded') THEN
        RAISE EXCEPTION 'Raw media already processed: %', p_raw_media_id;
    END IF;

    IF v_raw.local_path IS NULL THEN
        RAISE EXCEPTION 'Media not downloaded yet: %', p_raw_media_id;
    END IF;

    -- Find Atlas request_id from Airtable request ID
    SELECT request_id INTO v_request_id
    FROM trapper.sot_requests
    WHERE source_record_id = v_raw.airtable_request_id
    LIMIT 1;

    IF v_request_id IS NULL THEN
        -- Mark as skipped - no matching request
        UPDATE trapper.raw_airtable_media
        SET processing_status = 'skipped',
            error_message = 'No Atlas request found for Airtable ID: ' || COALESCE(v_raw.airtable_request_id, 'NULL'),
            processed_at = NOW()
        WHERE raw_media_id = p_raw_media_id;
        RETURN NULL;
    END IF;

    -- Insert into request_media
    INSERT INTO trapper.request_media (
        request_id, media_type, original_filename, stored_filename,
        file_size_bytes, mime_type, storage_provider, storage_path,
        caption, notes, cat_description, uploaded_by,
        airtable_record_id, airtable_attachment_id, synced_from_airtable
    ) VALUES (
        v_request_id,
        v_raw.media_type::trapper.media_type,
        v_raw.filename,
        v_raw.local_filename,
        v_raw.size_bytes,
        v_raw.mime_type,
        'local',
        v_raw.local_path,
        v_raw.caption,
        v_raw.notes,
        v_raw.cat_description,
        'airtable_sync',
        v_raw.airtable_record_id,
        v_raw.airtable_attachment_id,
        TRUE
    )
    RETURNING media_id INTO v_media_id;

    -- Update raw record
    UPDATE trapper.raw_airtable_media
    SET processing_status = 'imported',
        target_request_id = v_request_id,
        target_media_id = v_media_id,
        processed_at = NOW()
    WHERE raw_media_id = p_raw_media_id;

    RETURN v_media_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. FUNCTION: Batch import all downloaded media
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.import_all_raw_media()
RETURNS TABLE(imported INT, skipped INT, failed INT) AS $$
DECLARE
    v_imported INT := 0;
    v_skipped INT := 0;
    v_failed INT := 0;
    v_raw RECORD;
    v_result UUID;
BEGIN
    FOR v_raw IN
        SELECT raw_media_id FROM trapper.raw_airtable_media
        WHERE processing_status = 'downloaded'
    LOOP
        BEGIN
            v_result := trapper.import_raw_media(v_raw.raw_media_id);
            IF v_result IS NULL THEN
                v_skipped := v_skipped + 1;
            ELSE
                v_imported := v_imported + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            UPDATE trapper.raw_airtable_media
            SET processing_status = 'failed',
                error_message = SQLERRM,
                processed_at = NOW()
            WHERE raw_media_id = v_raw.raw_media_id;
            v_failed := v_failed + 1;
        END;
    END LOOP;

    RETURN QUERY SELECT v_imported, v_skipped, v_failed;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. VIEW: Media Import Status
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_media_import_status AS
SELECT
    processing_status,
    airtable_table,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE target_media_id IS NOT NULL) as imported_count
FROM trapper.raw_airtable_media
GROUP BY processing_status, airtable_table
ORDER BY processing_status, airtable_table;

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT 'Raw media intake table created:' AS info;
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'trapper' AND table_name = 'raw_airtable_media';
