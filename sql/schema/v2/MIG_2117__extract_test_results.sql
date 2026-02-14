-- MIG_2117: Extract Test Results from ops.appointments (V2 Native)
-- Date: 2026-02-14
--
-- Purpose: Extract FeLV/FIV test results from medical_notes in V2 appointments
--          No V1 dependency - derives data from ops.appointments.medical_notes
--
-- Pipeline:
--   ops.appointments.medical_notes → regex extraction → ops.cat_test_results
--   ops.cat_test_results + sot.cat_place → MIG_2116 → ops.place_disease_status

\echo ''
\echo '=============================================='
\echo '  MIG_2117: Extract Test Results (V2 Native)'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE OPS.CAT_TEST_RESULTS TABLE
-- ============================================================================

\echo '1. Creating ops.cat_test_results table...'

CREATE TABLE IF NOT EXISTS ops.cat_test_results (
    test_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Links
    cat_id UUID NOT NULL REFERENCES sot.cats(cat_id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES ops.appointments(appointment_id),

    -- Test info
    test_type TEXT NOT NULL CHECK (test_type IN ('felv', 'fiv', 'felv_fiv_combo', 'ringworm', 'heartworm', 'other')),
    test_date DATE NOT NULL,

    -- Results
    result TEXT NOT NULL CHECK (result IN ('positive', 'negative', 'inconclusive', 'not_performed')),
    result_detail TEXT,  -- e.g., "Positive/Negative" for combo

    -- Evidence
    evidence_source TEXT NOT NULL DEFAULT 'extracted' CHECK (evidence_source IN (
        'extracted',   -- AI/regex extraction from notes
        'manual',      -- Staff entered
        'imported',    -- Imported from external system
        'lab_result'   -- Direct from lab
    )),
    extraction_confidence NUMERIC(3,2) DEFAULT 0.8,
    raw_text TEXT,  -- The text that was extracted from

    -- Provenance
    source_system TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Unique constraint: one result per cat per test type per date per appointment
    UNIQUE (cat_id, test_type, test_date, appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_ops_cat_test_results_cat ON ops.cat_test_results(cat_id);
CREATE INDEX IF NOT EXISTS idx_ops_cat_test_results_appt ON ops.cat_test_results(appointment_id);
CREATE INDEX IF NOT EXISTS idx_ops_cat_test_results_date ON ops.cat_test_results(test_date);
CREATE INDEX IF NOT EXISTS idx_ops_cat_test_results_positive ON ops.cat_test_results(cat_id)
    WHERE result = 'positive';

COMMENT ON TABLE ops.cat_test_results IS
'V2 OPS: Cat test results extracted from appointments or entered manually.
Used by MIG_2116 compute_place_disease_status() to propagate disease status to places.';

\echo '   Created ops.cat_test_results table'

-- ============================================================================
-- 2. EXTRACTION FUNCTION
-- ============================================================================

\echo ''
\echo '2. Creating test result extraction function...'

CREATE OR REPLACE FUNCTION ops.extract_test_results_from_appointment(p_appointment_id UUID)
RETURNS TABLE(
    test_type TEXT,
    result TEXT,
    result_detail TEXT,
    confidence NUMERIC
) AS $$
DECLARE
    v_notes TEXT;
BEGIN
    -- Get medical notes
    SELECT medical_notes INTO v_notes
    FROM ops.appointments
    WHERE appointment_id = p_appointment_id;

    IF v_notes IS NULL THEN
        RETURN;
    END IF;

    -- Normalize for matching
    v_notes := LOWER(v_notes);

    -- ========================================================================
    -- SNAP TEST (FeLV/FIV Combo)
    -- ========================================================================

    -- SNAP Negative (both FeLV and FIV negative)
    IF v_notes ~* 'snap\s*(test)?\s*(neg|negative|-)' OR
       v_notes ~* '(neg|negative)\s*snap' THEN
        RETURN QUERY SELECT
            'felv_fiv_combo'::TEXT,
            'negative'::TEXT,
            'Negative/Negative'::TEXT,
            0.95::NUMERIC;

    -- SNAP Double Positive
    ELSIF v_notes ~* 'snap\s*(test)?\s*(positive|pos|\+)\s*/?\s*(positive|pos|\+)' THEN
        RETURN QUERY SELECT
            'felv_fiv_combo'::TEXT,
            'positive'::TEXT,
            'Positive/Positive'::TEXT,
            0.95::NUMERIC;

    -- ========================================================================
    -- Individual FeLV Results
    -- ========================================================================
    ELSIF v_notes ~* 'felv\s*[\+:]?\s*(positive|pos|\+)' OR
          v_notes ~* '(positive|pos|\+)\s*felv' OR
          v_notes ~* 'feline\s*leuk(emia)?\s*(positive|pos|\+)' THEN

        -- Check FIV as well for combo detection
        IF v_notes ~* 'fiv\s*[\+:]?\s*(neg|negative|-)' OR
           v_notes ~* '(neg|negative|-)\s*fiv' THEN
            RETURN QUERY SELECT
                'felv_fiv_combo'::TEXT,
                'positive'::TEXT,
                'Positive/Negative'::TEXT,
                0.9::NUMERIC;
        ELSIF v_notes ~* 'fiv\s*[\+:]?\s*(positive|pos|\+)' THEN
            RETURN QUERY SELECT
                'felv_fiv_combo'::TEXT,
                'positive'::TEXT,
                'Positive/Positive'::TEXT,
                0.9::NUMERIC;
        ELSE
            RETURN QUERY SELECT
                'felv'::TEXT,
                'positive'::TEXT,
                'FeLV Positive'::TEXT,
                0.85::NUMERIC;
        END IF;

    -- FeLV Negative
    ELSIF v_notes ~* 'felv\s*[\+:]?\s*(neg|negative|-)' OR
          v_notes ~* '(neg|negative|-)\s*felv' THEN
        -- Check FIV as well
        IF v_notes ~* 'fiv\s*[\+:]?\s*(neg|negative|-)' THEN
            RETURN QUERY SELECT
                'felv_fiv_combo'::TEXT,
                'negative'::TEXT,
                'Negative/Negative'::TEXT,
                0.9::NUMERIC;
        ELSIF v_notes ~* 'fiv\s*[\+:]?\s*(positive|pos|\+)' THEN
            RETURN QUERY SELECT
                'felv_fiv_combo'::TEXT,
                'positive'::TEXT,
                'Negative/Positive'::TEXT,
                0.9::NUMERIC;
        ELSE
            RETURN QUERY SELECT
                'felv'::TEXT,
                'negative'::TEXT,
                'FeLV Negative'::TEXT,
                0.85::NUMERIC;
        END IF;

    -- ========================================================================
    -- Individual FIV Results (when FeLV not mentioned)
    -- ========================================================================
    ELSIF v_notes ~* 'fiv\s*[\+:]?\s*(positive|pos|\+)' OR
          v_notes ~* '(positive|pos|\+)\s*fiv' OR
          v_notes ~* 'feline\s*immuno(deficiency)?\s*(positive|pos|\+)' THEN
        RETURN QUERY SELECT
            'fiv'::TEXT,
            'positive'::TEXT,
            'FIV Positive'::TEXT,
            0.85::NUMERIC;

    ELSIF v_notes ~* 'fiv\s*[\+:]?\s*(neg|negative|-)' OR
          v_notes ~* '(neg|negative|-)\s*fiv' THEN
        RETURN QUERY SELECT
            'fiv'::TEXT,
            'negative'::TEXT,
            'FIV Negative'::TEXT,
            0.85::NUMERIC;

    -- ========================================================================
    -- Ringworm
    -- ========================================================================
    ELSIF v_notes ~* 'ringworm\s*(positive|pos|\+|confirmed)' OR
          v_notes ~* '(positive|pos|\+|confirmed)\s*ringworm' OR
          v_notes ~* 'dermatophyt(e|osis)\s*(positive|pos|\+)' THEN
        RETURN QUERY SELECT
            'ringworm'::TEXT,
            'positive'::TEXT,
            'Ringworm'::TEXT,
            0.8::NUMERIC;
    END IF;

    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.extract_test_results_from_appointment(UUID) IS
'Extract FeLV/FIV/ringworm test results from appointment medical_notes.
Returns: test_type, result, result_detail, confidence.
Uses regex patterns to identify positive/negative test mentions.';

\echo '   Created ops.extract_test_results_from_appointment()'

-- ============================================================================
-- 3. BACKFILL: Extract from all existing appointments
-- ============================================================================

\echo ''
\echo '3. Extracting test results from existing appointments...'

DO $$
DECLARE
    v_extracted INT := 0;
    v_positive INT := 0;
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT
            a.appointment_id,
            a.cat_id,
            a.appointment_date,
            a.medical_notes,
            e.*
        FROM ops.appointments a
        CROSS JOIN LATERAL ops.extract_test_results_from_appointment(a.appointment_id) e
        WHERE a.cat_id IS NOT NULL
          AND a.medical_notes IS NOT NULL
    LOOP
        INSERT INTO ops.cat_test_results (
            cat_id, appointment_id, test_type, test_date, result, result_detail,
            evidence_source, extraction_confidence, raw_text, source_system
        )
        VALUES (
            rec.cat_id, rec.appointment_id, rec.test_type, rec.appointment_date,
            rec.result, rec.result_detail, 'extracted', rec.confidence,
            SUBSTRING(rec.medical_notes FROM 1 FOR 500), 'clinichq'
        )
        ON CONFLICT (cat_id, test_type, test_date, appointment_id) DO UPDATE
        SET result = EXCLUDED.result,
            result_detail = EXCLUDED.result_detail,
            extraction_confidence = EXCLUDED.extraction_confidence,
            updated_at = NOW();

        v_extracted := v_extracted + 1;
        IF rec.result = 'positive' THEN
            v_positive := v_positive + 1;
        END IF;
    END LOOP;

    RAISE NOTICE 'Extracted % test results (% positive)', v_extracted, v_positive;
END $$;

-- ============================================================================
-- 4. TRIGGER: Auto-extract on new/updated appointments
-- ============================================================================

\echo ''
\echo '4. Creating auto-extraction trigger...'

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
            rec.result, rec.result_detail, 'extracted', rec.confidence,
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

DROP TRIGGER IF EXISTS trg_extract_test_results ON ops.appointments;

CREATE TRIGGER trg_extract_test_results
AFTER INSERT OR UPDATE OF medical_notes
ON ops.appointments
FOR EACH ROW
EXECUTE FUNCTION ops.trigger_extract_test_results();

\echo '   Created trigger ops.trg_extract_test_results'

-- ============================================================================
-- 5. HELPER VIEWS
-- ============================================================================

\echo ''
\echo '5. Creating helper views...'

-- View: Cats with positive tests
CREATE OR REPLACE VIEW ops.v_cats_with_positive_tests AS
SELECT
    c.cat_id,
    c.name as cat_name,
    c.microchip,
    ARRAY_AGG(DISTINCT tr.test_type) as positive_tests,
    MAX(tr.test_date) as latest_positive_date
FROM sot.cats c
JOIN ops.cat_test_results tr ON tr.cat_id = c.cat_id
WHERE tr.result = 'positive'
  AND c.merged_into_cat_id IS NULL
GROUP BY c.cat_id, c.name, c.microchip;

COMMENT ON VIEW ops.v_cats_with_positive_tests IS
'Cats with positive test results. Used for disease tracking dashboard.';

-- View: Test result summary by type
CREATE OR REPLACE VIEW ops.v_test_result_summary AS
SELECT
    test_type,
    result,
    COUNT(*) as count,
    COUNT(DISTINCT cat_id) as unique_cats
FROM ops.cat_test_results
GROUP BY test_type, result
ORDER BY test_type, result;

COMMENT ON VIEW ops.v_test_result_summary IS
'Summary of test results by type and result. Useful for statistics.';

\echo '   Created ops.v_cats_with_positive_tests'
\echo '   Created ops.v_test_result_summary'

-- ============================================================================
-- 6. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Test results by type and result:'
SELECT test_type, result, COUNT(*) as count
FROM ops.cat_test_results
GROUP BY test_type, result
ORDER BY test_type, result;

\echo ''
\echo 'Appointments with medical notes:'
SELECT COUNT(*) as total,
       COUNT(*) FILTER (WHERE medical_notes IS NOT NULL) as with_notes,
       COUNT(*) FILTER (WHERE medical_notes ~* '(felv|fiv|snap|ringworm)') as with_test_mentions
FROM ops.appointments
WHERE cat_id IS NOT NULL;

\echo ''
\echo '=============================================='
\echo '  MIG_2117 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - ops.cat_test_results table'
\echo '  - ops.extract_test_results_from_appointment() function'
\echo '  - ops.trg_extract_test_results trigger'
\echo '  - ops.v_cats_with_positive_tests view'
\echo '  - ops.v_test_result_summary view'
\echo ''
\echo 'Pipeline: ops.appointments → extraction → ops.cat_test_results'
\echo ''
\echo 'Next: MIG_2116 propagates test results to place disease status'
\echo ''
