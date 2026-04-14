-- MIG_3080: Add attachment columns to trapper_time_entries
--
-- Stores the scanned timesheet image/PDF path for future reference
-- when hours are entered via the AI scan feature.

ALTER TABLE ops.trapper_time_entries
  ADD COLUMN IF NOT EXISTS attachment_path TEXT,
  ADD COLUMN IF NOT EXISTS attachment_filename TEXT,
  ADD COLUMN IF NOT EXISTS attachment_mime_type TEXT;

COMMENT ON COLUMN ops.trapper_time_entries.attachment_path IS 'Supabase storage path for scanned timesheet image/PDF.';
COMMENT ON COLUMN ops.trapper_time_entries.attachment_filename IS 'Original filename of the uploaded timesheet scan.';
COMMENT ON COLUMN ops.trapper_time_entries.attachment_mime_type IS 'MIME type of the uploaded attachment (image/jpeg, application/pdf, etc).';
