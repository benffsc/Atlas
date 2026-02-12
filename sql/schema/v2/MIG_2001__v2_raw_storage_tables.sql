-- MIG_2001: V2 Source Layer - Raw JSON Storage Tables
--
-- Purpose: Create append-only tables for raw source data
-- This is Layer 1 of the 3-layer architecture (Source → OPS → SOT)
--
-- Raw data is stored as JSONB for:
-- 1. Immutable audit trail (never modified after insert)
-- 2. Hash-based change detection between syncs
-- 3. Reference for debugging and re-processing

\echo ''
\echo '=============================================='
\echo '  MIG_2001: Source Layer - Raw Storage Tables'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CLINICHQ RAW DATA
-- ============================================================================

\echo '1. Creating source.clinichq_raw...'

CREATE TABLE IF NOT EXISTS source.clinichq_raw (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Record classification
    record_type TEXT NOT NULL CHECK (record_type IN (
        'appointment', 'owner', 'cat', 'procedure', 'vaccination', 'unknown'
    )),

    -- Source identification
    source_record_id TEXT NOT NULL,  -- ClinicHQ internal ID
    file_upload_id UUID,              -- Reference to file_uploads table

    -- Raw data
    payload JSONB NOT NULL,
    row_hash TEXT NOT NULL,           -- MD5/SHA hash for change detection

    -- Timestamps
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_run_id UUID REFERENCES source.sync_runs(sync_id),

    -- Deduplication (same record, same hash = skip)
    UNIQUE (record_type, source_record_id, row_hash)
);

CREATE INDEX IF NOT EXISTS idx_clinichq_raw_type ON source.clinichq_raw(record_type);
CREATE INDEX IF NOT EXISTS idx_clinichq_raw_source_id ON source.clinichq_raw(source_record_id);
CREATE INDEX IF NOT EXISTS idx_clinichq_raw_fetched ON source.clinichq_raw(fetched_at);
CREATE INDEX IF NOT EXISTS idx_clinichq_raw_file ON source.clinichq_raw(file_upload_id);

COMMENT ON TABLE source.clinichq_raw IS
'Layer 1 SOURCE: Raw ClinicHQ data as JSONB.
Append-only - never modify after insert.
Used for audit trail and re-processing.';

\echo '   Created source.clinichq_raw'

-- ============================================================================
-- 2. SHELTERLUV RAW DATA
-- ============================================================================

\echo ''
\echo '2. Creating source.shelterluv_raw...'

CREATE TABLE IF NOT EXISTS source.shelterluv_raw (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Record classification
    record_type TEXT NOT NULL CHECK (record_type IN (
        'animal', 'person', 'event', 'outcome', 'intake', 'movement', 'unknown'
    )),

    -- Source identification
    source_record_id TEXT NOT NULL,  -- ShelterLuv Internal-ID

    -- Raw data
    payload JSONB NOT NULL,
    row_hash TEXT NOT NULL,

    -- Timestamps
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_run_id UUID REFERENCES source.sync_runs(sync_id),

    -- Deduplication
    UNIQUE (record_type, source_record_id, row_hash)
);

CREATE INDEX IF NOT EXISTS idx_shelterluv_raw_type ON source.shelterluv_raw(record_type);
CREATE INDEX IF NOT EXISTS idx_shelterluv_raw_source_id ON source.shelterluv_raw(source_record_id);
CREATE INDEX IF NOT EXISTS idx_shelterluv_raw_fetched ON source.shelterluv_raw(fetched_at);

COMMENT ON TABLE source.shelterluv_raw IS
'Layer 1 SOURCE: Raw ShelterLuv API responses as JSONB.
Append-only - never modify after insert.';

\echo '   Created source.shelterluv_raw'

-- ============================================================================
-- 3. VOLUNTEERHUB RAW DATA
-- ============================================================================

\echo ''
\echo '3. Creating source.volunteerhub_raw...'

CREATE TABLE IF NOT EXISTS source.volunteerhub_raw (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Record classification
    record_type TEXT NOT NULL CHECK (record_type IN (
        'person', 'group', 'membership', 'activity', 'unknown'
    )),

    -- Source identification
    source_record_id TEXT NOT NULL,

    -- Raw data
    payload JSONB NOT NULL,
    row_hash TEXT NOT NULL,

    -- Timestamps
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_run_id UUID REFERENCES source.sync_runs(sync_id),

    -- Deduplication
    UNIQUE (record_type, source_record_id, row_hash)
);

CREATE INDEX IF NOT EXISTS idx_volunteerhub_raw_type ON source.volunteerhub_raw(record_type);
CREATE INDEX IF NOT EXISTS idx_volunteerhub_raw_source_id ON source.volunteerhub_raw(source_record_id);
CREATE INDEX IF NOT EXISTS idx_volunteerhub_raw_fetched ON source.volunteerhub_raw(fetched_at);

COMMENT ON TABLE source.volunteerhub_raw IS
'Layer 1 SOURCE: Raw VolunteerHub API responses as JSONB.
Append-only - never modify after insert.';

\echo '   Created source.volunteerhub_raw'

-- ============================================================================
-- 4. AIRTABLE RAW DATA
-- ============================================================================

\echo ''
\echo '4. Creating source.airtable_raw...'

CREATE TABLE IF NOT EXISTS source.airtable_raw (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Airtable structure
    base_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,  -- Airtable record ID (rec...)

    -- Raw data
    payload JSONB NOT NULL,
    row_hash TEXT NOT NULL,

    -- Timestamps
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_run_id UUID REFERENCES source.sync_runs(sync_id),

    -- Deduplication
    UNIQUE (base_id, table_name, record_id, row_hash)
);

CREATE INDEX IF NOT EXISTS idx_airtable_raw_base ON source.airtable_raw(base_id, table_name);
CREATE INDEX IF NOT EXISTS idx_airtable_raw_record ON source.airtable_raw(record_id);
CREATE INDEX IF NOT EXISTS idx_airtable_raw_fetched ON source.airtable_raw(fetched_at);

COMMENT ON TABLE source.airtable_raw IS
'Layer 1 SOURCE: Raw Airtable records as JSONB.
Append-only - never modify after insert.
base_id: identifies which Airtable base (Atlas Sync, etc.)
table_name: identifies which table in the base';

\echo '   Created source.airtable_raw'

-- ============================================================================
-- 5. PETLINK RAW DATA
-- ============================================================================

\echo ''
\echo '5. Creating source.petlink_raw...'

CREATE TABLE IF NOT EXISTS source.petlink_raw (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Record classification
    record_type TEXT NOT NULL CHECK (record_type IN (
        'microchip_registration', 'owner_update', 'unknown'
    )),

    -- Source identification
    microchip_id TEXT NOT NULL,  -- The microchip number

    -- Raw data
    payload JSONB NOT NULL,
    row_hash TEXT NOT NULL,

    -- Timestamps
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    file_upload_id UUID,
    sync_run_id UUID REFERENCES source.sync_runs(sync_id),

    -- Deduplication
    UNIQUE (record_type, microchip_id, row_hash)
);

CREATE INDEX IF NOT EXISTS idx_petlink_raw_microchip ON source.petlink_raw(microchip_id);
CREATE INDEX IF NOT EXISTS idx_petlink_raw_fetched ON source.petlink_raw(fetched_at);

COMMENT ON TABLE source.petlink_raw IS
'Layer 1 SOURCE: Raw PetLink microchip registry data as JSONB.
Note: PetLink emails may be fabricated by staff (confidence < 0.5).
Append-only - never modify after insert.';

\echo '   Created source.petlink_raw'

-- ============================================================================
-- 6. WEB INTAKE RAW DATA
-- ============================================================================

\echo ''
\echo '6. Creating source.web_intake_raw...'

CREATE TABLE IF NOT EXISTS source.web_intake_raw (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source identification
    submission_id UUID NOT NULL,  -- Original submission ID
    form_type TEXT DEFAULT 'public_intake',

    -- Raw data
    payload JSONB NOT NULL,
    row_hash TEXT NOT NULL,

    -- Request metadata
    ip_address TEXT,
    user_agent TEXT,

    -- Timestamps
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Deduplication (same submission = skip)
    UNIQUE (submission_id)
);

CREATE INDEX IF NOT EXISTS idx_web_intake_raw_submitted ON source.web_intake_raw(submitted_at);

COMMENT ON TABLE source.web_intake_raw IS
'Layer 1 SOURCE: Raw web intake form submissions as JSONB.
Preserves original form data before any processing.
submission_id links to ops.intake_submissions.';

\echo '   Created source.web_intake_raw'

-- ============================================================================
-- 7. HELPER FUNCTIONS FOR HASHING
-- ============================================================================

\echo ''
\echo '7. Creating hash helper functions...'

CREATE OR REPLACE FUNCTION source.compute_row_hash(p_payload JSONB)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT md5(p_payload::TEXT);
$$;

COMMENT ON FUNCTION source.compute_row_hash IS
'Computes MD5 hash of JSONB payload for change detection.
Same hash = record unchanged since last sync.';

CREATE OR REPLACE FUNCTION source.insert_clinichq_raw(
    p_record_type TEXT,
    p_source_record_id TEXT,
    p_payload JSONB,
    p_file_upload_id UUID DEFAULT NULL,
    p_sync_run_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
    v_id UUID;
    v_hash TEXT;
BEGIN
    v_hash := source.compute_row_hash(p_payload);

    INSERT INTO source.clinichq_raw (
        record_type, source_record_id, payload, row_hash,
        file_upload_id, sync_run_id
    ) VALUES (
        p_record_type, p_source_record_id, p_payload, v_hash,
        p_file_upload_id, p_sync_run_id
    )
    ON CONFLICT (record_type, source_record_id, row_hash) DO NOTHING
    RETURNING id INTO v_id;

    RETURN v_id;  -- NULL if duplicate (unchanged record)
END;
$$;

COMMENT ON FUNCTION source.insert_clinichq_raw IS
'Inserts ClinicHQ raw record with automatic hash computation.
Returns NULL if record with same hash already exists (unchanged).';

-- Similar helper for ShelterLuv
CREATE OR REPLACE FUNCTION source.insert_shelterluv_raw(
    p_record_type TEXT,
    p_source_record_id TEXT,
    p_payload JSONB,
    p_sync_run_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
    v_id UUID;
    v_hash TEXT;
BEGIN
    v_hash := source.compute_row_hash(p_payload);

    INSERT INTO source.shelterluv_raw (
        record_type, source_record_id, payload, row_hash, sync_run_id
    ) VALUES (
        p_record_type, p_source_record_id, p_payload, v_hash, p_sync_run_id
    )
    ON CONFLICT (record_type, source_record_id, row_hash) DO NOTHING
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

\echo '   Created hash helper functions'

-- ============================================================================
-- 8. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Source raw tables created:'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'source'
  AND table_name LIKE '%_raw'
ORDER BY table_name;

\echo ''
\echo '=============================================='
\echo '  MIG_2001 Complete'
\echo '=============================================='
\echo 'Created source.*_raw tables for:'
\echo '  - clinichq_raw (appointments, owners, cats)'
\echo '  - shelterluv_raw (animals, people, outcomes)'
\echo '  - volunteerhub_raw (volunteers, groups)'
\echo '  - airtable_raw (legacy requests)'
\echo '  - petlink_raw (microchip registrations)'
\echo '  - web_intake_raw (form submissions)'
\echo ''
\echo 'These tables are APPEND-ONLY:'
\echo '  - Never modify after insert'
\echo '  - Hash-based change detection'
\echo '  - Immutable audit trail'
\echo ''
