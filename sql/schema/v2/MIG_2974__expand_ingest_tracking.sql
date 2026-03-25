-- MIG_2974: Expand file_uploads for pipeline phase tracking
-- FFS-736: Adds columns for tracking processing phase, retry count,
-- and failure details to support the "thin serverless + fat database" architecture.
--
-- New status flow: pending → staging → staged → post_processing → completed | failed
-- Retry: failed files can be retried up to 3 times by the recovery cron.

-- Add processing_phase column for granular phase tracking
ALTER TABLE ops.file_uploads
  ADD COLUMN IF NOT EXISTS processing_phase TEXT DEFAULT 'pending';

-- Add retry tracking
ALTER TABLE ops.file_uploads
  ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0;

-- Add failure detail columns
ALTER TABLE ops.file_uploads
  ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE ops.file_uploads
  ADD COLUMN IF NOT EXISTS failed_at_step TEXT;

-- Index for the recovery cron to find stuck/failed uploads efficiently
CREATE INDEX IF NOT EXISTS idx_file_uploads_processing_phase
  ON ops.file_uploads (processing_phase)
  WHERE processing_phase IN ('staging', 'post_processing', 'failed');

-- Index for retry eligibility
CREATE INDEX IF NOT EXISTS idx_file_uploads_retry_eligible
  ON ops.file_uploads (processing_phase, retry_count)
  WHERE processing_phase = 'failed' AND retry_count < 3;

COMMENT ON COLUMN ops.file_uploads.processing_phase IS
  'Granular phase: pending → staging → staged → post_processing → completed | failed';
COMMENT ON COLUMN ops.file_uploads.retry_count IS
  'Number of times this upload has been retried (max 3)';
COMMENT ON COLUMN ops.file_uploads.last_error IS
  'Error message from the most recent failure';
COMMENT ON COLUMN ops.file_uploads.failed_at_step IS
  'Which processing step was executing when the failure occurred';
