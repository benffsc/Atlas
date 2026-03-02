-- MIG_2404__fix_cat_test_results_columns.sql
-- Add missing columns to ops.cat_test_results that trigger_extract_test_results needs
--
-- Issue: The trigger function references columns that didn't exist in the table:
--   - evidence_source
--   - extraction_confidence
--   - raw_text
--   - updated_at
--
-- This caused appointment_info processing to fail with:
--   "column 'evidence_source' of relation 'cat_test_results' does not exist"

\echo ''
\echo '=============================================='
\echo '  MIG_2404: Fix cat_test_results Columns'
\echo '=============================================='
\echo ''

ALTER TABLE ops.cat_test_results
  ADD COLUMN IF NOT EXISTS evidence_source TEXT,
  ADD COLUMN IF NOT EXISTS extraction_confidence NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS raw_text TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

COMMENT ON COLUMN ops.cat_test_results.evidence_source IS 'How the test result was determined (extracted, manual, imported)';
COMMENT ON COLUMN ops.cat_test_results.extraction_confidence IS 'Confidence score 0.00-1.00 for AI-extracted results';
COMMENT ON COLUMN ops.cat_test_results.raw_text IS 'Original text snippet the result was extracted from';

-- Add unique index for ON CONFLICT clause in trigger_extract_test_results
CREATE UNIQUE INDEX IF NOT EXISTS cat_test_results_unique_test
ON ops.cat_test_results (cat_id, test_type, test_date, appointment_id);

\echo ''
\echo '  MIG_2404 Complete!'
\echo '=============================================='
\echo ''
