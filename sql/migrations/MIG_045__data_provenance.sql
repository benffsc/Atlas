-- MIG_045__data_provenance.sql
-- Add data provenance tracking to core entities
--
-- Purpose:
--   Track where data came from (legacy import vs app-created) so we can:
--   - Prefer app-created data in suggestions
--   - Filter legacy data appropriately
--   - Support gradual data cleanup
--
-- Also adds location_type for places to handle ambiguous locations.
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_045__data_provenance.sql

\echo '============================================'
\echo 'MIG_045: Data Provenance Tracking'
\echo '============================================'

-- ============================================
-- PART 1: Data source enum
-- ============================================
\echo ''
\echo 'Creating data_source type...'

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'data_source') THEN
        CREATE TYPE trapper.data_source AS ENUM (
            'legacy_import',    -- Historical imports (ClinicHQ, VolunteerHub before Atlas)
            'airtable_sync',    -- Ongoing Airtable sync during transition
            'file_upload',      -- Manual file upload via Atlas UI
            'app'               -- Created directly in Atlas app
        );
    END IF;
END$$;

-- ============================================
-- PART 2: Location type enum
-- ============================================
\echo ''
\echo 'Creating location_type type...'

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'location_type') THEN
        CREATE TYPE trapper.location_type AS ENUM (
            'geocoded',         -- Full address with Google Place ID
            'approximate',      -- Rough coordinates (map pin)
            'described'         -- Text description only ("corner of X and Y")
        );
    END IF;
END$$;

-- ============================================
-- PART 3: Add columns to sot_people
-- ============================================
\echo ''
\echo 'Adding data_source to sot_people...'

ALTER TABLE trapper.sot_people
    ADD COLUMN IF NOT EXISTS data_source trapper.data_source DEFAULT 'legacy_import',
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verified_by TEXT;

COMMENT ON COLUMN trapper.sot_people.data_source IS 'Where this record originated';
COMMENT ON COLUMN trapper.sot_people.verified_at IS 'When this record was manually verified/cleaned';
COMMENT ON COLUMN trapper.sot_people.verified_by IS 'Who verified this record';

-- ============================================
-- PART 4: Add columns to places
-- ============================================
\echo ''
\echo 'Adding data_source and location_type to places...'

ALTER TABLE trapper.places
    ADD COLUMN IF NOT EXISTS data_source trapper.data_source DEFAULT 'legacy_import',
    ADD COLUMN IF NOT EXISTS location_type trapper.location_type DEFAULT 'geocoded',
    ADD COLUMN IF NOT EXISTS location_description TEXT,
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verified_by TEXT;

COMMENT ON COLUMN trapper.places.data_source IS 'Where this record originated';
COMMENT ON COLUMN trapper.places.location_type IS 'How precise is the location';
COMMENT ON COLUMN trapper.places.location_description IS 'Freeform location description for approximate/described locations';
COMMENT ON COLUMN trapper.places.verified_at IS 'When this record was manually verified';
COMMENT ON COLUMN trapper.places.verified_by IS 'Who verified this record';

-- ============================================
-- PART 5: Add columns to sot_cats
-- ============================================
\echo ''
\echo 'Adding data_source to sot_cats...'

ALTER TABLE trapper.sot_cats
    ADD COLUMN IF NOT EXISTS data_source trapper.data_source DEFAULT 'legacy_import',
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verified_by TEXT;

COMMENT ON COLUMN trapper.sot_cats.data_source IS 'Where this record originated';
COMMENT ON COLUMN trapper.sot_cats.verified_at IS 'When this record was manually verified';
COMMENT ON COLUMN trapper.sot_cats.verified_by IS 'Who verified this record';

-- ============================================
-- PART 6: Add columns to sot_addresses
-- ============================================
\echo ''
\echo 'Adding data_source to sot_addresses...'

ALTER TABLE trapper.sot_addresses
    ADD COLUMN IF NOT EXISTS data_source trapper.data_source DEFAULT 'legacy_import';

COMMENT ON COLUMN trapper.sot_addresses.data_source IS 'Where this record originated';

-- ============================================
-- PART 7: File uploads tracking table
-- ============================================
\echo ''
\echo 'Creating file_uploads table...'

CREATE TABLE IF NOT EXISTS trapper.file_uploads (
    upload_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- File info
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL,  -- Renamed for storage
    file_size_bytes BIGINT,
    file_hash TEXT,  -- SHA256 for dedup detection

    -- Source info
    source_system TEXT NOT NULL,  -- 'clinichq', 'volunteerhub', 'airtable', etc.
    source_table TEXT,            -- 'owner_info', 'users', 'trapping_requests', etc.

    -- Processing status
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'processing', 'completed', 'failed'
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,

    -- Linked ingest run
    ingest_run_id UUID REFERENCES trapper.ingest_runs(run_id),

    -- Results
    rows_total INT,
    rows_inserted INT,
    rows_updated INT,
    rows_skipped INT,
    error_message TEXT,

    -- Who uploaded
    uploaded_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_file_uploads_status ON trapper.file_uploads(status);
CREATE INDEX IF NOT EXISTS idx_file_uploads_source ON trapper.file_uploads(source_system, source_table);
CREATE INDEX IF NOT EXISTS idx_file_uploads_hash ON trapper.file_uploads(file_hash);

COMMENT ON TABLE trapper.file_uploads IS
'Tracks file uploads for data ingestion via the Atlas UI.
Supports archive naming, duplicate detection, and processing status.';

-- ============================================
-- PART 8: Notes/Drafts table for incomplete info
-- ============================================
\echo ''
\echo 'Creating notes table...'

CREATE TABLE IF NOT EXISTS trapper.notes (
    note_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Content
    content TEXT NOT NULL,

    -- Optional location hint
    rough_location TEXT,           -- Freeform: "near Safeway on Cleveland"
    rough_lat NUMERIC(10,7),
    rough_lng NUMERIC(10,7),

    -- Status
    status TEXT NOT NULL DEFAULT 'open',  -- 'open', 'converted', 'archived'

    -- If converted to a request/place
    converted_to_place_id UUID REFERENCES trapper.places(place_id),
    converted_at TIMESTAMPTZ,

    -- Ownership
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_status ON trapper.notes(status);
CREATE INDEX IF NOT EXISTS idx_notes_created_by ON trapper.notes(created_by);

COMMENT ON TABLE trapper.notes IS
'Personal notes/drafts for incomplete information.
Can be converted to full requests when enough info is gathered.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_045 Complete'
\echo '============================================'

\echo ''
\echo 'New columns added:'
SELECT
    table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema = 'trapper'
AND column_name IN ('data_source', 'location_type', 'location_description', 'verified_at', 'verified_by')
ORDER BY table_name, column_name;

\echo ''
\echo 'New tables:'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'trapper'
AND table_name IN ('file_uploads', 'notes');
