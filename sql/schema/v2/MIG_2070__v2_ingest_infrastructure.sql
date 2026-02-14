-- MIG_2070: Create V2 ingest infrastructure and backfill appointments
-- Date: 2026-02-13
--
-- Issue: V2 ingest route references ops.file_uploads and ops.staged_records
-- but these tables don't exist. Also ops.appointments is empty while
-- trapper.sot_appointments has 47,747 records.
--
-- This migration:
-- 1. Creates ops.file_uploads (V2 file upload tracking)
-- 2. Creates ops.staged_records (V2 staging table)
-- 3. Backfills ops.appointments from trapper.sot_appointments

\echo ''
\echo '=============================================='
\echo '  MIG_2070: V2 Ingest Infrastructure'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE ops.file_uploads
-- ============================================================================

\echo '1. Creating ops.file_uploads...'

CREATE TABLE IF NOT EXISTS ops.file_uploads (
    upload_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL,
    source_system TEXT NOT NULL,
    source_table TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    file_size_bytes BIGINT,
    file_content BYTEA,  -- For serverless environments
    rows_total INT,
    rows_inserted INT,
    rows_updated INT,
    rows_skipped INT,
    data_date_min DATE,
    data_date_max DATE,
    error_message TEXT,
    post_processing_results JSONB,
    uploaded_by TEXT,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT file_uploads_status_check CHECK (
        status IN ('pending', 'processing', 'completed', 'failed')
    )
);

CREATE INDEX IF NOT EXISTS idx_ops_file_uploads_status ON ops.file_uploads(status);
CREATE INDEX IF NOT EXISTS idx_ops_file_uploads_source ON ops.file_uploads(source_system, source_table);
CREATE INDEX IF NOT EXISTS idx_ops_file_uploads_created ON ops.file_uploads(created_at DESC);

COMMENT ON TABLE ops.file_uploads IS 'V2 file upload tracking for ClinicHQ, Airtable, Google Maps imports';

-- ============================================================================
-- 2. CREATE ops.staged_records
-- ============================================================================

\echo '2. Creating ops.staged_records...'

CREATE TABLE IF NOT EXISTS ops.staged_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_system TEXT NOT NULL,
    source_table TEXT NOT NULL,
    source_row_id TEXT,
    payload JSONB NOT NULL,
    row_hash TEXT NOT NULL,
    file_upload_id UUID REFERENCES ops.file_uploads(upload_id),
    is_processed BOOLEAN DEFAULT FALSE,
    processing_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_system, source_table, row_hash)
);

CREATE INDEX IF NOT EXISTS idx_ops_staged_source ON ops.staged_records(source_system, source_table);
CREATE INDEX IF NOT EXISTS idx_ops_staged_upload ON ops.staged_records(file_upload_id);
CREATE INDEX IF NOT EXISTS idx_ops_staged_unprocessed ON ops.staged_records(is_processed) WHERE is_processed = FALSE;
CREATE INDEX IF NOT EXISTS idx_ops_staged_row_id ON ops.staged_records(source_system, source_table, source_row_id);

COMMENT ON TABLE ops.staged_records IS 'V2 staging table for raw imported records before processing';

-- ============================================================================
-- 3. BACKFILL ops.appointments FROM trapper.sot_appointments
-- ============================================================================

\echo ''
\echo '3. Backfilling ops.appointments from trapper.sot_appointments...'

-- First, check current counts
DO $$
DECLARE
    v1_count INT;
    v2_count INT;
BEGIN
    SELECT COUNT(*) INTO v1_count FROM trapper.sot_appointments;
    SELECT COUNT(*) INTO v2_count FROM ops.appointments;
    RAISE NOTICE 'V1 sot_appointments: % records', v1_count;
    RAISE NOTICE 'V2 ops.appointments: % records (before backfill)', v2_count;
END $$;

-- Backfill appointments (matching columns between V1 and V2)
INSERT INTO ops.appointments (
    appointment_id,
    cat_id,
    person_id,
    place_id,
    inferred_place_id,
    appointment_date,
    appointment_number,
    service_type,
    is_spay,
    is_neuter,
    is_alteration,
    vet_name,
    technician,
    temperature,
    medical_notes,
    is_lactating,
    is_pregnant,
    is_in_heat,
    owner_email,
    owner_phone,
    source_system,
    source_record_id,
    source_row_hash,
    created_at,
    updated_at
)
SELECT
    v1.appointment_id,
    v1.cat_id,
    v1.person_id,
    v1.place_id,
    v1.inferred_place_id,
    v1.appointment_date,
    v1.appointment_number,
    v1.service_type,
    COALESCE(v1.is_spay, v1.service_is_spay, FALSE),
    COALESCE(v1.is_neuter, v1.service_is_neuter, FALSE),
    COALESCE(v1.is_spay, v1.service_is_spay, FALSE) OR COALESCE(v1.is_neuter, v1.service_is_neuter, FALSE),
    v1.vet_name,
    v1.technician,
    v1.temperature,
    v1.medical_notes,
    v1.is_lactating,
    v1.is_pregnant,
    v1.is_in_heat,
    v1.owner_email,
    v1.owner_phone,
    COALESCE(v1.source_system, v1.data_source, 'clinichq'),
    v1.source_record_id,
    v1.source_row_hash,
    COALESCE(v1.created_at, NOW()),
    COALESCE(v1.updated_at, NOW())
FROM trapper.sot_appointments v1
WHERE NOT EXISTS (
    SELECT 1 FROM ops.appointments v2
    WHERE v2.appointment_id = v1.appointment_id
)
ON CONFLICT (appointment_id) DO NOTHING;

-- Report results
DO $$
DECLARE
    v2_count INT;
BEGIN
    SELECT COUNT(*) INTO v2_count FROM ops.appointments;
    RAISE NOTICE 'V2 ops.appointments: % records (after backfill)', v2_count;
END $$;

-- ============================================================================
-- 4. VERIFY DATA BY DATE
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Recent appointment dates in V2 ops.appointments:'
SELECT appointment_date, COUNT(*) as count
FROM ops.appointments
GROUP BY appointment_date
ORDER BY appointment_date DESC
LIMIT 10;

\echo ''
\echo '=============================================='
\echo '  MIG_2070 Complete!'
\echo '=============================================='
\echo ''
