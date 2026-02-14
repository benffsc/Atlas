-- ============================================================================
-- MIG_971: ClinicHQ Batch Upload Support
-- ============================================================================
-- Problem: ClinicHQ files (cat_info, owner_info, appointment_info) are processed
-- independently, causing:
--   - Partial results after each file (confusing for staff)
--   - Entity linking runs 3x instead of 1x (inefficient)
--   - Order dependency issues (appointment_info needs cats created first)
--
-- Solution: Add batch tracking to file_uploads so we can:
--   - Group related files together
--   - Wait until all 3 are uploaded
--   - Process them in the correct order
--   - Run entity linking once at the end
-- ============================================================================

\echo ''
\echo '=============================================================================='
\echo 'MIG_971: ClinicHQ Batch Upload Support'
\echo '=============================================================================='
\echo ''

-- ============================================================================
-- PHASE 1: Add batch tracking columns to file_uploads
-- ============================================================================

\echo 'Phase 1: Adding batch tracking columns...'

ALTER TABLE trapper.file_uploads
  ADD COLUMN IF NOT EXISTS batch_id UUID,
  ADD COLUMN IF NOT EXISTS batch_ready BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN trapper.file_uploads.batch_id IS
'Groups related uploads together. For ClinicHQ, all 3 files (cat_info, owner_info, appointment_info) share the same batch_id.';

COMMENT ON COLUMN trapper.file_uploads.batch_ready IS
'True when all required files in the batch are uploaded and ready to process together.';

-- Index for batch queries
CREATE INDEX IF NOT EXISTS idx_file_uploads_batch
ON trapper.file_uploads(batch_id)
WHERE batch_id IS NOT NULL;

\echo 'Columns and index added.'

-- ============================================================================
-- PHASE 2: Create batch status view
-- ============================================================================

\echo ''
\echo 'Phase 2: Creating batch status view...'

CREATE OR REPLACE VIEW trapper.v_clinichq_batch_status AS
SELECT
  batch_id,
  COUNT(*) as files_uploaded,
  COUNT(*) FILTER (WHERE source_table = 'cat_info') as has_cat_info,
  COUNT(*) FILTER (WHERE source_table = 'owner_info') as has_owner_info,
  COUNT(*) FILTER (WHERE source_table = 'appointment_info') as has_appointment_info,
  COUNT(*) = 3 as is_complete,
  MIN(uploaded_at) as batch_started,
  MAX(uploaded_at) as last_upload,
  CASE
    WHEN COUNT(*) FILTER (WHERE status = 'failed') > 0 THEN 'failed'
    WHEN COUNT(*) FILTER (WHERE status = 'processing') > 0 THEN 'processing'
    WHEN COUNT(*) = 3 AND COUNT(*) FILTER (WHERE status = 'completed') = 3 THEN 'completed'
    WHEN COUNT(*) = 3 THEN 'ready'
    ELSE 'incomplete'
  END as batch_status,
  -- Include individual file details
  array_agg(
    json_build_object(
      'upload_id', upload_id,
      'source_table', source_table,
      'status', status,
      'original_filename', original_filename,
      'uploaded_at', uploaded_at
    ) ORDER BY
      CASE source_table
        WHEN 'cat_info' THEN 1
        WHEN 'owner_info' THEN 2
        WHEN 'appointment_info' THEN 3
        ELSE 4
      END
  ) as files
FROM trapper.file_uploads
WHERE source_system = 'clinichq'
  AND batch_id IS NOT NULL
  AND status != 'deleted'
GROUP BY batch_id;

COMMENT ON VIEW trapper.v_clinichq_batch_status IS
'MIG_971: Shows status of ClinicHQ batch uploads.
- files_uploaded: How many files (0-3)
- has_cat_info/owner_info/appointment_info: Which files present
- is_complete: True when all 3 files uploaded
- batch_status: incomplete, ready, processing, completed, failed
- files: Array of individual file details';

\echo 'View created.'

-- ============================================================================
-- PHASE 3: Create helper function for batch processing order
-- ============================================================================

\echo ''
\echo 'Phase 3: Creating batch helper functions...'

CREATE OR REPLACE FUNCTION trapper.get_batch_files_in_order(p_batch_id UUID)
RETURNS TABLE(
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
      ELSE 4
    END as processing_order
  FROM trapper.file_uploads fu
  WHERE fu.batch_id = p_batch_id
    AND fu.source_system = 'clinichq'
    AND fu.status != 'deleted'
  ORDER BY processing_order;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.get_batch_files_in_order(UUID) IS
'MIG_971: Returns files in a batch in correct processing order:
1. cat_info (creates cats, updates sex)
2. owner_info (creates people/places, links appointments)
3. appointment_info (creates procedures, links cats to places/requests)';

-- Function to check if a batch is ready to process
CREATE OR REPLACE FUNCTION trapper.is_batch_ready(p_batch_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT batch_status INTO v_status
  FROM trapper.v_clinichq_batch_status
  WHERE batch_id = p_batch_id;

  RETURN v_status = 'ready';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.is_batch_ready(UUID) IS
'MIG_971: Returns true if batch has all 3 files and is ready to process.';

\echo 'Helper functions created.'

-- ============================================================================
-- PHASE 4: Verify
-- ============================================================================

\echo ''
\echo 'Phase 4: Verification...'

\echo ''
\echo 'file_uploads columns:'
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'file_uploads'
  AND column_name IN ('batch_id', 'batch_ready')
ORDER BY column_name;

\echo ''
\echo 'View exists:'
SELECT viewname FROM pg_views WHERE schemaname = 'trapper' AND viewname = 'v_clinichq_batch_status';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================================================='
\echo 'MIG_971 Complete'
\echo '=============================================================================='
\echo ''
\echo 'Added to file_uploads:'
\echo '  - batch_id UUID (groups related files)'
\echo '  - batch_ready BOOLEAN (all files present)'
\echo ''
\echo 'Created:'
\echo '  - v_clinichq_batch_status (batch overview)'
\echo '  - get_batch_files_in_order(batch_id) (processing order)'
\echo '  - is_batch_ready(batch_id) (readiness check)'
\echo ''
\echo 'Next steps:'
\echo '  1. Update upload API to accept/return batch_id'
\echo '  2. Create batch status API endpoint'
\echo '  3. Create batch process API endpoint'
\echo '  4. Update ingest UI with batch upload section'
\echo ''
