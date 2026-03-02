-- MIG_2404__fix_cat_test_results_columns.sql
-- Fix ops.cat_test_results schema for trigger_extract_test_results
--
-- Issues fixed:
-- 1. Missing columns: evidence_source, extraction_confidence, raw_text, updated_at
-- 2. Missing unique index for ON CONFLICT clause
-- 3. Trigger function was inserting TEXT into ops.test_result enum without cast
--
-- Errors encountered:
--   "column 'evidence_source' of relation 'cat_test_results' does not exist"
--   "column 'result' is of type ops.test_result but expression is of type text"

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

-- Fix trigger function to cast text to enum
CREATE OR REPLACE FUNCTION ops.trigger_extract_test_results()
RETURNS TRIGGER AS $$
DECLARE
    rec RECORD;
BEGIN
    -- Only process if cat_id and medical_notes exist
    IF NEW.cat_id IS NULL OR NEW.medical_notes IS NULL THEN
        RETURN NEW;
    END IF;

    -- Skip if notes unchanged
    IF TG_OP = 'UPDATE' AND OLD.medical_notes = NEW.medical_notes THEN
        RETURN NEW;
    END IF;

    -- Extract and insert results
    FOR rec IN
        SELECT * FROM ops.extract_test_results_from_appointment(NEW.appointment_id)
    LOOP
        INSERT INTO ops.cat_test_results (
            cat_id, appointment_id, test_type, test_date, result, result_detail,
            evidence_source, extraction_confidence, raw_text, source_system
        )
        VALUES (
            NEW.cat_id, NEW.appointment_id, rec.test_type, NEW.appointment_date,
            rec.result::ops.test_result,  -- Cast text to enum
            rec.result_detail, 'extracted', rec.confidence,
            SUBSTRING(NEW.medical_notes FROM 1 FOR 500), 'clinichq'
        )
        ON CONFLICT (cat_id, test_type, test_date, appointment_id) DO UPDATE
        SET result = EXCLUDED.result,
            result_detail = EXCLUDED.result_detail,
            extraction_confidence = EXCLUDED.extraction_confidence,
            updated_at = NOW();
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

\echo ''
\echo '  MIG_2404 Complete!'
\echo '=============================================='
\echo ''
