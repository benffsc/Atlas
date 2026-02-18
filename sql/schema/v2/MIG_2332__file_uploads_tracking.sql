-- MIG_2332__file_uploads_tracking.sql
-- Create table to track bulk import files for audit/comparison

-- Create table in source schema
CREATE TABLE IF NOT EXISTS source.file_uploads (
  upload_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system TEXT NOT NULL,
  record_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_hash TEXT,  -- MD5 hash for deduplication
  file_size_bytes BIGINT,
  row_count INT,
  unique_record_count INT,
  date_range_start DATE,
  date_range_end DATE,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  uploaded_by TEXT,
  notes TEXT,
  -- Audit fields
  rows_with_microchip INT,
  rows_without_microchip INT,
  processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
  processed_at TIMESTAMPTZ,
  error_message TEXT
);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_file_uploads_source ON source.file_uploads(source_system, record_type);
CREATE INDEX IF NOT EXISTS idx_file_uploads_hash ON source.file_uploads(file_hash);

-- Insert records for the bulk import files (Feb 12, 2026)
INSERT INTO source.file_uploads (
  source_system, record_type, file_name, file_hash, file_size_bytes,
  row_count, unique_record_count, date_range_start, date_range_end,
  uploaded_at, uploaded_by, notes,
  rows_with_microchip, rows_without_microchip, processing_status, processed_at
) VALUES
  -- appointment_service bulk export
  ('clinichq', 'appointment_service',
   'report_76fe6716-4319-474b-838c-6391af85d624.xlsx',
   '8a4f84dbe5f4924e93fbb9e7b72f4fb3', 14507433,
   197196, 22155, '2021-01-04', '2026-02-11',
   '2026-02-12 20:26:06'::TIMESTAMPTZ, 'bulk_import',
   'V2 initial bulk import - appointment_service. Contains service items (multiple rows per visit). 89.9% rows missing microchip is expected - microchip only in certain service item rows.',
   19831, 177365, 'completed', '2026-02-13'::TIMESTAMPTZ),

  -- cat_info bulk export
  ('clinichq', 'cat_info',
   'report_174519f9-79cb-4c3c-a7ed-e280e643d4f1.xlsx',
   'f3cb489bda011f11097540104fa711b5', 1317922,
   23313, 22230, '2021-01-04', '2026-02-11',
   '2026-02-12 20:24:44'::TIMESTAMPTZ, 'bulk_import',
   'V2 initial bulk import - cat_info. One row per clinic visit. 3,294 appointments missing microchip were DROPPED by pipeline bug.',
   19847, 3466, 'completed', '2026-02-13'::TIMESTAMPTZ),

  -- owner_info bulk export
  ('clinichq', 'owner_info',
   'report_7bd98924-3466-4310-a72c-613170d3678b.xlsx',
   'd69b058eebcf33a91a920cfc55b0df22', 1555439,
   23313, 22230, '2021-01-04', '2026-02-11',
   '2026-02-12 20:24:37'::TIMESTAMPTZ, 'bulk_import',
   'V2 initial bulk import - owner_info. One row per clinic visit. 3,294 appointments missing microchip were DROPPED by pipeline bug.',
   19847, 3466, 'completed', '2026-02-13'::TIMESTAMPTZ)
ON CONFLICT DO NOTHING;

-- Create view to compare file upload stats vs database
CREATE OR REPLACE VIEW source.v_file_upload_audit AS
SELECT
  fu.upload_id,
  fu.source_system,
  fu.record_type,
  fu.file_name,
  fu.row_count AS file_rows,
  fu.unique_record_count AS file_unique_records,
  fu.rows_with_microchip,
  fu.rows_without_microchip,
  fu.date_range_start,
  fu.date_range_end,
  fu.uploaded_at,
  -- Compare to raw data
  COALESCE(raw_counts.raw_count, 0) AS raw_table_rows,
  fu.row_count - COALESCE(raw_counts.raw_count, 0) AS raw_difference,
  fu.processing_status,
  fu.notes
FROM source.file_uploads fu
LEFT JOIN (
  SELECT
    record_type,
    COUNT(*) as raw_count
  FROM source.clinichq_raw
  GROUP BY record_type
) raw_counts ON raw_counts.record_type = fu.record_type
ORDER BY fu.uploaded_at DESC;

COMMENT ON TABLE source.file_uploads IS 'Tracks bulk import files for audit and comparison against staged/canonical data';
COMMENT ON VIEW source.v_file_upload_audit IS 'Compares file upload metadata against actual raw table counts';
