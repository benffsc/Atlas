-- MIG_2894: Extract FIV/FeLV test results from scrape free-text notes (FFS-405)
--
-- Pattern in animal_quick_notes: "05/15/23 AH Combo Neg/Neg"
-- Also: "10/09/24 AH Combo FIV+", "02/22/23 AH Combo FIV Pos FeLV Neg"
--
-- 323 dated combo test patterns. 33 FIV+ cats not in ops.cat_test_results.
-- 81 cats with combo tests have no existing test record.
--
-- Beacon value: FIV+ is the most important ecological signal for disease hotspots.
--
-- Safety: ON CONFLICT DO NOTHING. Only adds new test results.
-- Depends on: MIG_2891 (extracted_microchip)

BEGIN;

-- =============================================================================
-- Step 1: Extract combo test results into temp table
-- =============================================================================

CREATE TEMP TABLE _scrape_combo_tests AS
WITH raw_extracts AS (
    -- Pattern 1: "MM/DD/YY AH Combo Neg/Neg" or "Combo NEG/NEG"
    SELECT
        s.record_id,
        s.extracted_microchip,
        s.extracted_clinichq_id,
        s.animal_id,
        s.appointment_date,
        -- Extract date
        (regexp_match(s.animal_quick_notes,
            '(\d{1,2}/\d{1,2}/\d{2,4})\s+\w{2,3}\s+[Cc]ombo', 'i'))[1] AS test_date_raw,
        -- Extract the result text after "Combo"
        (regexp_match(s.animal_quick_notes,
            '\d{1,2}/\d{1,2}/\d{2,4}\s+\w{2,3}\s+[Cc]ombo\s+([^\n]{3,40})', 'i'))[1] AS result_text,
        s.animal_quick_notes AS source_text,
        'animal_quick_notes' AS source_field
    FROM source.clinichq_scrape s
    WHERE s.animal_quick_notes ~* '\d{1,2}/\d{1,2}/\d{2,4}\s+\w{2,3}\s+[Cc]ombo'
      AND s.checkout_status = 'Checked Out'

    UNION ALL

    -- Pattern 2: Same in internal_medical_notes
    SELECT
        s.record_id,
        s.extracted_microchip,
        s.extracted_clinichq_id,
        s.animal_id,
        s.appointment_date,
        (regexp_match(s.internal_medical_notes,
            '(\d{1,2}/\d{1,2}/\d{2,4})\s+\w{2,3}\s+[Cc]ombo', 'i'))[1] AS test_date_raw,
        (regexp_match(s.internal_medical_notes,
            '\d{1,2}/\d{1,2}/\d{2,4}\s+\w{2,3}\s+[Cc]ombo\s+([^\n]{3,40})', 'i'))[1] AS result_text,
        s.internal_medical_notes AS source_text,
        'internal_medical_notes' AS source_field
    FROM source.clinichq_scrape s
    WHERE s.internal_medical_notes ~* '\d{1,2}/\d{1,2}/\d{2,4}\s+\w{2,3}\s+[Cc]ombo'
      AND s.checkout_status = 'Checked Out'

    UNION ALL

    -- Pattern 3: Undated "COMBO NEG/NEG" or "COMBO TEST Neg/Neg" in quick notes
    SELECT
        s.record_id,
        s.extracted_microchip,
        s.extracted_clinichq_id,
        s.animal_id,
        s.appointment_date,
        NULL AS test_date_raw,
        (regexp_match(s.animal_quick_notes,
            '[Cc]ombo\s+(?:[Tt]est\s+)?([^\n]{3,40})', 'i'))[1] AS result_text,
        s.animal_quick_notes AS source_text,
        'animal_quick_notes' AS source_field
    FROM source.clinichq_scrape s
    WHERE s.animal_quick_notes ~* '[Cc]ombo\s+(?:[Tt]est\s+)?(NEG|POS|[+-]|FIV|FeLV)'
      AND s.animal_quick_notes !~* '\d{1,2}/\d{1,2}/\d{2,4}\s+\w{2,3}\s+[Cc]ombo'
      AND s.checkout_status = 'Checked Out'
)
SELECT DISTINCT ON (record_id, source_field)
    record_id,
    extracted_microchip,
    extracted_clinichq_id,
    animal_id,
    appointment_date,
    -- Parse date: handle MM/DD/YY and MM/DD/YYYY
    CASE
        WHEN test_date_raw ~ '^\d{1,2}/\d{1,2}/\d{4}$'
            THEN TO_DATE(test_date_raw, 'MM/DD/YYYY')
        WHEN test_date_raw ~ '^\d{1,2}/\d{1,2}/\d{2}$'
            THEN TO_DATE(test_date_raw, 'MM/DD/YY')
        ELSE NULL
    END AS test_date,
    result_text,
    -- Parse FIV result
    CASE
        WHEN result_text ~* 'FIV\s*(POS|\+)' THEN 'positive'
        WHEN result_text ~* 'FIV\s*(NEG|-)' THEN 'negative'
        WHEN result_text ~* '^(NEG|Neg)\s*/\s*(NEG|Neg)' THEN 'negative'  -- "Neg/Neg" = both negative
        WHEN result_text ~* '(POS|Pos|\+)\s*/\s*(NEG|Neg|-)' THEN 'positive'  -- "Pos/Neg" = FIV+/FeLV-
        WHEN result_text ~* '(NEG|Neg|-)\s*/\s*(POS|Pos|\+)' THEN 'negative'  -- "Neg/Pos" = FIV-/FeLV+
        ELSE NULL
    END AS fiv_result,
    -- Parse FeLV result
    CASE
        WHEN result_text ~* 'FeLV\s*(POS|\+)' THEN 'positive'
        WHEN result_text ~* 'FeLV\s*(NEG|-)' THEN 'negative'
        WHEN result_text ~* '^(NEG|Neg)\s*/\s*(NEG|Neg)' THEN 'negative'
        WHEN result_text ~* '(POS|Pos|\+)\s*/\s*(NEG|Neg|-)' THEN 'negative'  -- "Pos/Neg" = FIV+/FeLV-
        WHEN result_text ~* '(NEG|Neg|-)\s*/\s*(POS|Pos|\+)' THEN 'positive'  -- "Neg/Pos" = FIV-/FeLV+
        ELSE NULL
    END AS felv_result,
    source_text,
    source_field
FROM raw_extracts
WHERE result_text IS NOT NULL
ORDER BY record_id, source_field;

-- =============================================================================
-- Step 2: Insert combo test results for matched cats
-- =============================================================================

WITH resolved AS (
    SELECT
        COALESCE(ci_chip.cat_id, ci_id.cat_id) AS cat_id,
        COALESCE(
            t.test_date,
            CASE WHEN t.appointment_date ~ '^[A-Z][a-z]{2} \d{2}, \d{4}$'
                 THEN TO_DATE(t.appointment_date, 'Mon DD, YYYY')
            END
        ) AS test_date,
        t.fiv_result,
        t.felv_result,
        t.result_text,
        t.source_text,
        t.source_field
    FROM _scrape_combo_tests t
    LEFT JOIN sot.cat_identifiers ci_chip
        ON ci_chip.id_type = 'microchip' AND ci_chip.id_value = t.extracted_microchip
        AND t.extracted_microchip IS NOT NULL
    LEFT JOIN sot.cat_identifiers ci_id
        ON ci_id.id_type = 'clinichq_animal_id'
        AND ci_id.id_value = COALESCE(t.extracted_clinichq_id,
            CASE WHEN t.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN t.animal_id END)
        AND ci_chip.cat_id IS NULL
    WHERE COALESCE(ci_chip.cat_id, ci_id.cat_id) IS NOT NULL
      AND (t.fiv_result IS NOT NULL OR t.felv_result IS NOT NULL)
),
matched_tests AS (
    SELECT DISTINCT ON (cat_id, test_date)
        cat_id, test_date, fiv_result, felv_result, result_text, source_text, source_field
    FROM resolved
    WHERE test_date IS NOT NULL
    ORDER BY cat_id, test_date, source_field
)
-- Insert as combo tests (one row per test date per cat)
INSERT INTO ops.cat_test_results (
    test_id, cat_id, test_type, test_date, result, felv_status, fiv_status,
    source_system, source_record_id, evidence_source, extraction_confidence,
    raw_text, created_at
)
SELECT
    gen_random_uuid(),
    mt.cat_id,
    'combo',
    mt.test_date,
    -- Overall result: positive if either is positive
    CASE
        WHEN mt.fiv_result = 'positive' OR mt.felv_result = 'positive' THEN 'positive'::ops.test_result
        ELSE 'negative'::ops.test_result
    END,
    mt.felv_result,
    mt.fiv_result,
    'clinichq',
    'scrape_notes_' || mt.source_field,
    'scrape_free_text',
    0.8,  -- High confidence for dated structured pattern, but free-text
    LEFT(mt.result_text, 200),
    NOW()
FROM matched_tests mt
-- Don't duplicate: skip if this cat already has a test on this date
WHERE NOT EXISTS (
    SELECT 1 FROM ops.cat_test_results ctr
    WHERE ctr.cat_id = mt.cat_id
      AND ctr.test_date = mt.test_date
      AND ctr.test_type IN ('combo', 'fiv', 'felv')
);

-- =============================================================================
-- Cleanup + Verification
-- =============================================================================

DROP TABLE IF EXISTS _scrape_combo_tests;

DO $$
DECLARE
    v_total INTEGER;
    v_fiv_pos INTEGER;
    v_felv_pos INTEGER;
    v_from_scrape INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total FROM ops.cat_test_results;
    SELECT COUNT(*) INTO v_fiv_pos FROM ops.cat_test_results WHERE fiv_status = 'positive';
    SELECT COUNT(*) INTO v_felv_pos FROM ops.cat_test_results WHERE felv_status = 'positive';
    SELECT COUNT(*) INTO v_from_scrape FROM ops.cat_test_results WHERE evidence_source = 'scrape_free_text';

    RAISE NOTICE 'MIG_2894: FIV/FeLV extraction from scrape notes';
    RAISE NOTICE '  Total test results: %', v_total;
    RAISE NOTICE '  FIV positive: %', v_fiv_pos;
    RAISE NOTICE '  FeLV positive: %', v_felv_pos;
    RAISE NOTICE '  New from scrape notes: %', v_from_scrape;
END $$;

COMMIT;
