-- MIG_2400__fix_clinichq_batch_upload.sql
-- Fix ClinicHQ batch upload infrastructure
--
-- Issue: The batch upload routes expect columns and views that don't exist:
-- 1. ops.file_uploads missing batch_id, batch_ready columns
-- 2. ops.v_clinichq_batch_status view returns wrong columns
-- 3. ops.get_batch_files_in_order() is a stub
--
-- Routes affected:
-- - /api/ingest/batch/[id]/route.ts
-- - /api/ingest/batch/[id]/process/route.ts
-- - /api/ingest/upload/route.ts

\echo ''
\echo '=============================================='
\echo '  MIG_2400: Fix ClinicHQ Batch Upload'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. ADD MISSING COLUMNS TO ops.file_uploads
-- ============================================================================

\echo '1. Adding missing columns to ops.file_uploads...'

-- batch_id groups ClinicHQ files for coordinated processing
ALTER TABLE ops.file_uploads ADD COLUMN IF NOT EXISTS batch_id UUID;
ALTER TABLE ops.file_uploads ADD COLUMN IF NOT EXISTS batch_ready BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.file_uploads ADD COLUMN IF NOT EXISTS processing_order INT;

-- file_hash for duplicate detection (referenced by upload route)
ALTER TABLE ops.file_uploads ADD COLUMN IF NOT EXISTS file_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_ops_file_uploads_batch ON ops.file_uploads(batch_id);
CREATE INDEX IF NOT EXISTS idx_ops_file_uploads_hash ON ops.file_uploads(file_hash);

COMMENT ON COLUMN ops.file_uploads.batch_id IS 'Groups related files for batch processing';
COMMENT ON COLUMN ops.file_uploads.batch_ready IS 'Set to true when batch processing is complete';
COMMENT ON COLUMN ops.file_uploads.processing_order IS 'Order for batch processing (1=cat_info, 2=owner_info, 3=appointment_info)';

-- Add uploaded_at alias (routes query uploaded_at but table has created_at)
-- This is a safe workaround - create a generated column or rename
-- For now, just ensure queries work by using created_at
-- The uploads route should be updated to query created_at instead of uploaded_at

-- ============================================================================
-- 2. CREATE PROPER v_clinichq_batch_status VIEW
-- ============================================================================

\echo '2. Creating proper v_clinichq_batch_status view...'

-- Drop the old view that has wrong columns
DROP VIEW IF EXISTS ops.v_clinichq_batch_status CASCADE;

CREATE OR REPLACE VIEW ops.v_clinichq_batch_status AS
WITH batch_files AS (
    SELECT
        fu.batch_id,
        fu.source_table,
        fu.status,
        fu.original_filename,
        fu.upload_id,
        fu.created_at,
        fu.processing_order,
        fu.post_processing_results
    FROM ops.file_uploads fu
    WHERE fu.source_system = 'clinichq'
      AND fu.batch_id IS NOT NULL
)
SELECT
    bf.batch_id,
    COUNT(*)::INT AS files_uploaded,
    COUNT(*) FILTER (WHERE bf.source_table = 'cat_info')::INT AS has_cat_info,
    COUNT(*) FILTER (WHERE bf.source_table = 'owner_info')::INT AS has_owner_info,
    COUNT(*) FILTER (WHERE bf.source_table = 'appointment_info')::INT AS has_appointment_info,
    (COUNT(*) = 3)::BOOLEAN AS is_complete,
    MIN(bf.created_at) AS batch_started,
    MAX(bf.created_at) AS last_upload,
    CASE
        WHEN COUNT(*) < 3 THEN 'incomplete'
        WHEN COUNT(*) FILTER (WHERE bf.status = 'processing') > 0 THEN 'processing'
        WHEN COUNT(*) FILTER (WHERE bf.status = 'failed') > 0 THEN 'failed'
        WHEN COUNT(*) FILTER (WHERE bf.status = 'completed') = 3 THEN 'completed'
        WHEN COUNT(*) FILTER (WHERE bf.status = 'pending') > 0 THEN 'ready'
        ELSE 'unknown'
    END AS batch_status,
    jsonb_agg(
        jsonb_build_object(
            'upload_id', bf.upload_id,
            'source_table', bf.source_table,
            'status', bf.status,
            'original_filename', bf.original_filename,
            'uploaded_at', bf.created_at,
            'processing_order', bf.processing_order
        ) ORDER BY bf.processing_order NULLS LAST, bf.created_at
    ) AS files
FROM batch_files bf
GROUP BY bf.batch_id;

COMMENT ON VIEW ops.v_clinichq_batch_status IS 'ClinicHQ batch upload status for coordinated 3-file processing';

-- ============================================================================
-- 3. CREATE PROPER get_batch_files_in_order FUNCTION
-- ============================================================================

\echo '3. Creating proper get_batch_files_in_order function...'

CREATE OR REPLACE FUNCTION ops.get_batch_files_in_order(p_batch_id UUID)
RETURNS TABLE (
    upload_id UUID,
    source_table TEXT,
    status TEXT,
    original_filename TEXT,
    processing_order INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        fu.upload_id,
        fu.source_table,
        fu.status,
        fu.original_filename,
        CASE fu.source_table
            WHEN 'cat_info' THEN 1
            WHEN 'owner_info' THEN 2
            WHEN 'appointment_info' THEN 3
            ELSE 99
        END AS processing_order
    FROM ops.file_uploads fu
    WHERE fu.batch_id = p_batch_id
      AND fu.source_system = 'clinichq'
    ORDER BY
        CASE fu.source_table
            WHEN 'cat_info' THEN 1
            WHEN 'owner_info' THEN 2
            WHEN 'appointment_info' THEN 3
            ELSE 99
        END;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION ops.get_batch_files_in_order(UUID) IS 'Returns batch files in correct processing order: cat_info, owner_info, appointment_info';

-- ============================================================================
-- 4. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'ops.file_uploads columns:'
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'file_uploads'
  AND column_name IN ('batch_id', 'batch_ready', 'processing_order')
ORDER BY column_name;

\echo ''
\echo 'v_clinichq_batch_status columns:'
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'v_clinichq_batch_status'
ORDER BY ordinal_position;

\echo ''
\echo '=============================================='
\echo '  MIG_2400 Complete!'
\echo '=============================================='
\echo ''
