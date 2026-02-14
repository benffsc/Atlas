-- MIG_2060: Create ops.cat_test_results table for V2
-- Date: 2026-02-13
--
-- Recreates cat_test_results in ops schema for V2 compatibility.
-- Backfills from V1 trapper.cat_test_results.
--
-- This is critical for FeLV/FIV disease tracking and place risk assessment.

\echo ''
\echo '=============================================='
\echo '  MIG_2060: ops.cat_test_results'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE ENUM (if not exists)
-- ============================================================================

\echo '1. Creating test_result enum...'

DO $$ BEGIN
    CREATE TYPE ops.test_result AS ENUM ('positive', 'negative', 'inconclusive', 'not_performed');
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'ops.test_result enum already exists';
END $$;

-- ============================================================================
-- 2. CREATE TABLE
-- ============================================================================

\echo ''
\echo '2. Creating ops.cat_test_results table...'

CREATE TABLE IF NOT EXISTS ops.cat_test_results (
    test_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL REFERENCES sot.cats(cat_id),
    appointment_id UUID REFERENCES ops.appointments(appointment_id),

    -- Test details
    test_type TEXT NOT NULL,       -- felv_fiv, skin_scrape, ringworm_woods_lamp, bmbt, heartworm
    test_date DATE NOT NULL,
    result ops.test_result NOT NULL,
    result_detail TEXT,            -- Additional result info (e.g., "FeLV+/FIV-")

    -- Parsed FeLV/FIV status for quick queries
    felv_status TEXT,              -- positive, negative, inconclusive, not_tested
    fiv_status TEXT,               -- positive, negative, inconclusive, not_tested

    -- Source tracking
    source_system TEXT NOT NULL,
    source_record_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ops_cat_tests_cat ON ops.cat_test_results(cat_id);
CREATE INDEX IF NOT EXISTS idx_ops_cat_tests_type ON ops.cat_test_results(test_type);
CREATE INDEX IF NOT EXISTS idx_ops_cat_tests_date ON ops.cat_test_results(test_date);
CREATE INDEX IF NOT EXISTS idx_ops_cat_tests_felv_pos ON ops.cat_test_results(cat_id)
    WHERE felv_status = 'positive';
CREATE INDEX IF NOT EXISTS idx_ops_cat_tests_fiv_pos ON ops.cat_test_results(cat_id)
    WHERE fiv_status = 'positive';

\echo '   Created ops.cat_test_results'

-- ============================================================================
-- 3. BACKFILL FROM V1 (if V1 table exists)
-- ============================================================================

\echo ''
\echo '3. Backfilling from V1 trapper.cat_test_results...'

DO $$
DECLARE
    v_count INT;
BEGIN
    -- Check if V1 table exists
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'trapper' AND table_name = 'cat_test_results'
    ) THEN
        -- Backfill, mapping cat_id to V2 sot.cats
        INSERT INTO ops.cat_test_results (
            test_id, cat_id, appointment_id,
            test_type, test_date, result, result_detail,
            felv_status, fiv_status,
            source_system, source_record_id, created_at
        )
        SELECT
            v1.test_id,
            COALESCE(c.cat_id, v1.cat_id),  -- Use V2 cat_id if mapped
            NULL,  -- appointment_id needs separate mapping
            v1.test_type,
            v1.test_date,
            v1.result::text::ops.test_result,
            v1.result_detail,
            -- Parse FeLV/FIV from result_detail
            CASE
                WHEN v1.test_type = 'felv_fiv' AND v1.result_detail ILIKE '%FeLV+%' THEN 'positive'
                WHEN v1.test_type = 'felv_fiv' AND v1.result_detail ILIKE '%FeLV-%' THEN 'negative'
                WHEN v1.test_type = 'felv_fiv' AND v1.result::text = 'positive' THEN 'positive'
                WHEN v1.test_type = 'felv_fiv' AND v1.result::text = 'negative' THEN 'negative'
                ELSE NULL
            END,
            CASE
                WHEN v1.test_type = 'felv_fiv' AND v1.result_detail ILIKE '%FIV+%' THEN 'positive'
                WHEN v1.test_type = 'felv_fiv' AND v1.result_detail ILIKE '%FIV-%' THEN 'negative'
                ELSE NULL
            END,
            v1.source_system,
            v1.source_record_id,
            v1.created_at
        FROM trapper.cat_test_results v1
        LEFT JOIN sot.cats c ON c.microchip = (
            SELECT microchip FROM trapper.sot_cats WHERE cat_id = v1.cat_id
        )
        WHERE NOT EXISTS (
            SELECT 1 FROM ops.cat_test_results o WHERE o.test_id = v1.test_id
        );

        GET DIAGNOSTICS v_count = ROW_COUNT;
        RAISE NOTICE 'Backfilled % test results from V1', v_count;
    ELSE
        RAISE NOTICE 'V1 trapper.cat_test_results does not exist - skipping backfill';
    END IF;
END $$;

-- ============================================================================
-- 4. CREATE VIEW for easy FeLV/FIV lookup
-- ============================================================================

\echo ''
\echo '4. Creating v_cat_disease_status view...'

CREATE OR REPLACE VIEW ops.v_cat_disease_status AS
SELECT
    c.cat_id,
    c.name AS cat_name,
    c.microchip,
    -- Latest FeLV status
    (
        SELECT tr.felv_status
        FROM ops.cat_test_results tr
        WHERE tr.cat_id = c.cat_id
          AND tr.test_type = 'felv_fiv'
          AND tr.felv_status IS NOT NULL
        ORDER BY tr.test_date DESC
        LIMIT 1
    ) AS felv_status,
    -- Latest FIV status
    (
        SELECT tr.fiv_status
        FROM ops.cat_test_results tr
        WHERE tr.cat_id = c.cat_id
          AND tr.test_type = 'felv_fiv'
          AND tr.fiv_status IS NOT NULL
        ORDER BY tr.test_date DESC
        LIMIT 1
    ) AS fiv_status,
    -- Last test date
    (
        SELECT MAX(tr.test_date)
        FROM ops.cat_test_results tr
        WHERE tr.cat_id = c.cat_id AND tr.test_type = 'felv_fiv'
    ) AS last_test_date,
    -- Is disease positive?
    EXISTS (
        SELECT 1 FROM ops.cat_test_results tr
        WHERE tr.cat_id = c.cat_id
          AND (tr.felv_status = 'positive' OR tr.fiv_status = 'positive')
    ) AS is_disease_positive
FROM sot.cats c
WHERE c.merged_into_cat_id IS NULL;

COMMENT ON VIEW ops.v_cat_disease_status IS 'Quick lookup of FeLV/FIV status per cat for disease tracking';

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Table row count:'
SELECT COUNT(*) as test_results_count FROM ops.cat_test_results;

\echo ''
\echo 'Test types present:'
SELECT test_type, COUNT(*) as count
FROM ops.cat_test_results
GROUP BY test_type
ORDER BY count DESC;

\echo ''
\echo 'Disease positive cats:'
SELECT
    COUNT(*) FILTER (WHERE felv_status = 'positive') as felv_positive,
    COUNT(*) FILTER (WHERE fiv_status = 'positive') as fiv_positive
FROM ops.cat_test_results
WHERE test_type = 'felv_fiv';

\echo ''
\echo '=============================================='
\echo '  MIG_2060 Complete!'
\echo '=============================================='
\echo ''
