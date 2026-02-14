-- MIG_257: Add file upload tracking to staged_records
--
-- Track which upload each staged record came from. This enables:
-- 1. Accurate date range tracking per upload
-- 2. Ability to rollback/delete records from a specific upload
-- 3. Audit trail of which export produced which data
--
-- MANUAL APPLY:
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_257__add_file_upload_tracking.sql

\echo ''
\echo '=============================================='
\echo 'MIG_257: Add file upload tracking to staged_records'
\echo '=============================================='
\echo ''

-- Add file_upload_id column to staged_records
ALTER TABLE trapper.staged_records
ADD COLUMN IF NOT EXISTS file_upload_id UUID REFERENCES trapper.file_uploads(upload_id);

-- Add index for efficient lookups by upload
CREATE INDEX IF NOT EXISTS idx_staged_records_file_upload
ON trapper.staged_records (file_upload_id)
WHERE file_upload_id IS NOT NULL;

-- Add comment
COMMENT ON COLUMN trapper.staged_records.file_upload_id IS
'References the file_upload that created this record. NULL for records created before this feature.';

\echo ''
\echo 'Done! staged_records now tracks file_upload_id.'
\echo ''
\echo 'Records created before this migration will have NULL file_upload_id.'
\echo 'New records will be linked to their source upload.'
