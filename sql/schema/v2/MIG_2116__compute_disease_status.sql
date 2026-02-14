-- MIG_2116: Compute Disease Status from V2 Data (V2 Native)
-- Date: 2026-02-14
--
-- Purpose: Compute place disease status from V2 test results and cat-place links
--          No V1 dependency - uses only ops.cat_test_results, sot.cat_place, ops.disease_types
--
-- Pipeline:
--   ops.cat_test_results + sot.cat_place → compute_place_disease_status() → ops.place_disease_status
--
-- Integrates with entity linking pipeline

\echo ''
\echo '=============================================='
\echo '  MIG_2116: Compute Disease Status (V2 Native)'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. DISEASE STATUS COMPUTATION FUNCTION
-- ============================================================================

\echo '1. Creating ops.compute_place_disease_status() function...'

CREATE OR REPLACE FUNCTION ops.compute_place_disease_status(p_place_id UUID DEFAULT NULL)
RETURNS TABLE(
    out_place_id UUID,
    diseases_updated INT
) AS $$
DECLARE
    v_place_rec RECORD;
    v_disease_rec RECORD;
    v_updated INT := 0;
    v_total_updated INT := 0;
BEGIN
    -- ========================================================================
    -- Iterate through places (single place or all)
    -- ========================================================================
    FOR v_place_rec IN
        SELECT p.place_id
        FROM sot.places p
        WHERE p.merged_into_place_id IS NULL
          AND (p_place_id IS NULL OR p.place_id = p_place_id)
    LOOP
        v_updated := 0;

        -- ====================================================================
        -- Aggregate test results for cats at this place
        -- ====================================================================
        FOR v_disease_rec IN
            WITH place_cats AS (
                -- Get all cats at this place
                SELECT DISTINCT cp.cat_id
                FROM sot.cat_place cp
                JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
                WHERE cp.place_id = v_place_rec.place_id
            ),
            place_test_results AS (
                -- Get test results for those cats
                SELECT
                    tr.test_type,
                    tr.result,
                    tr.test_date,
                    tr.cat_id
                FROM ops.cat_test_results tr
                JOIN place_cats pc ON pc.cat_id = tr.cat_id
            ),
            disease_summary AS (
                -- Aggregate by disease type
                SELECT
                    CASE
                        WHEN test_type IN ('felv', 'felv_fiv_combo') THEN 'felv'
                        WHEN test_type = 'fiv' THEN 'fiv'
                        WHEN test_type = 'felv_fiv_combo' THEN 'fiv'  -- Combo counts for both
                        ELSE test_type
                    END as disease_key,
                    COUNT(*) FILTER (WHERE result = 'positive') as positive_count,
                    COUNT(*) as total_tested,
                    MIN(test_date) FILTER (WHERE result = 'positive') as first_positive,
                    MAX(test_date) FILTER (WHERE result = 'positive') as last_positive
                FROM place_test_results
                GROUP BY 1
            )
            SELECT
                ds.disease_key,
                ds.positive_count,
                ds.total_tested,
                ds.first_positive,
                ds.last_positive,
                dt.decay_window_months
            FROM disease_summary ds
            JOIN ops.disease_types dt ON dt.disease_key = ds.disease_key
            WHERE ds.positive_count > 0
        LOOP
            -- Compute status based on decay window
            INSERT INTO ops.place_disease_status (
                place_id,
                disease_type_key,
                status,
                evidence_source,
                first_positive_date,
                last_positive_date,
                positive_cat_count,
                total_tested_count,
                set_at
            )
            VALUES (
                v_place_rec.place_id,
                v_disease_rec.disease_key,
                -- Status with time decay
                CASE
                    WHEN v_disease_rec.last_positive >= CURRENT_DATE - (v_disease_rec.decay_window_months * INTERVAL '1 month')
                    THEN 'confirmed_active'
                    ELSE 'historical'
                END,
                'computed',
                v_disease_rec.first_positive,
                v_disease_rec.last_positive,
                v_disease_rec.positive_count,
                v_disease_rec.total_tested,
                NOW()
            )
            ON CONFLICT (place_id, disease_type_key)
            DO UPDATE SET
                -- Don't overwrite manual overrides
                status = CASE
                    WHEN ops.place_disease_status.evidence_source IN ('manual')
                         AND ops.place_disease_status.status IN ('perpetual', 'false_flag', 'cleared')
                    THEN ops.place_disease_status.status
                    WHEN EXCLUDED.last_positive_date >= CURRENT_DATE - (v_disease_rec.decay_window_months * INTERVAL '1 month')
                    THEN 'confirmed_active'
                    ELSE 'historical'
                END,
                -- Only update counts, not source if manual
                last_positive_date = GREATEST(ops.place_disease_status.last_positive_date, EXCLUDED.last_positive_date),
                first_positive_date = LEAST(ops.place_disease_status.first_positive_date, EXCLUDED.first_positive_date),
                positive_cat_count = EXCLUDED.positive_cat_count,
                total_tested_count = EXCLUDED.total_tested_count,
                updated_at = NOW();

            v_updated := v_updated + 1;
        END LOOP;

        IF v_updated > 0 THEN
            v_total_updated := v_total_updated + v_updated;
            out_place_id := v_place_rec.place_id;
            diseases_updated := v_updated;
            RETURN NEXT;
        END IF;
    END LOOP;

    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.compute_place_disease_status(UUID) IS
'V2 Native: Compute place disease status from cat test results.
Uses ONLY V2 tables: ops.cat_test_results, sot.cat_place, ops.disease_types.
Respects manual overrides (perpetual, false_flag, cleared).
Call with NULL to process all places, or specific place_id.';

\echo '   Created ops.compute_place_disease_status()'

-- ============================================================================
-- 2. ALSO HANDLE FeLV/FIV COMBO SPLIT
-- ============================================================================

\echo ''
\echo '2. Creating helper for combo result splitting...'

-- When we see felv_fiv_combo positive, we need to create both felv and fiv entries
CREATE OR REPLACE FUNCTION ops.split_combo_results()
RETURNS INT AS $$
DECLARE
    v_split INT := 0;
BEGIN
    -- Insert FIV records from combo tests that show FIV positive
    INSERT INTO ops.place_disease_status (
        place_id, disease_type_key, status, evidence_source,
        first_positive_date, last_positive_date, positive_cat_count, set_at
    )
    SELECT DISTINCT
        cp.place_id,
        'fiv',
        'confirmed_active',
        'computed',
        MIN(tr.test_date),
        MAX(tr.test_date),
        COUNT(DISTINCT tr.cat_id),
        NOW()
    FROM ops.cat_test_results tr
    JOIN sot.cat_place cp ON cp.cat_id = tr.cat_id
    WHERE tr.test_type = 'felv_fiv_combo'
      AND tr.result = 'positive'
      AND tr.result_detail LIKE '%Positive'  -- FIV is positive (e.g., "Negative/Positive")
    GROUP BY cp.place_id
    ON CONFLICT (place_id, disease_type_key) DO UPDATE
    SET last_positive_date = GREATEST(ops.place_disease_status.last_positive_date, EXCLUDED.last_positive_date),
        positive_cat_count = EXCLUDED.positive_cat_count,
        updated_at = NOW();

    GET DIAGNOSTICS v_split = ROW_COUNT;
    RETURN v_split;
END;
$$ LANGUAGE plpgsql;

\echo '   Created ops.split_combo_results()'

-- ============================================================================
-- 3. WRAPPER FOR ENTITY LINKING PIPELINE
-- ============================================================================

\echo ''
\echo '3. Creating wrapper for entity linking integration...'

CREATE OR REPLACE FUNCTION ops.run_disease_status_computation()
RETURNS TABLE(places_updated INT, diseases_updated INT) AS $$
DECLARE
    v_places INT := 0;
    v_diseases INT := 0;
BEGIN
    -- Run computation for all places
    SELECT COUNT(*), SUM(diseases_updated)
    INTO v_places, v_diseases
    FROM ops.compute_place_disease_status(NULL);

    -- Split combo results
    PERFORM ops.split_combo_results();

    places_updated := v_places;
    diseases_updated := COALESCE(v_diseases, 0);

    RAISE NOTICE 'Disease status computation: % places, % disease records', v_places, v_diseases;

    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.run_disease_status_computation() IS
'Run disease status computation for all places. Call from entity linking pipeline.';

\echo '   Created ops.run_disease_status_computation()'

-- ============================================================================
-- 4. UPDATE ENTITY LINKING PIPELINE (if exists)
-- ============================================================================

\echo ''
\echo '4. Updating entity linking pipeline...'

DO $$
BEGIN
    -- Check if run_all_entity_linking exists and update it
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'ops' AND p.proname = 'run_all_entity_linking'
    ) THEN
        RAISE NOTICE 'ops.run_all_entity_linking() exists - disease computation should be called at end';
    ELSE
        -- Create a basic entity linking runner if it doesn't exist
        CREATE OR REPLACE FUNCTION ops.run_all_entity_linking()
        RETURNS TABLE(step TEXT, records_affected INT) AS $f$
        BEGIN
            -- Step 1: Disease status computation (V2 native)
            step := 'disease_status';
            SELECT diseases_updated INTO records_affected
            FROM ops.run_disease_status_computation();
            RETURN NEXT;

            RETURN;
        END;
        $f$ LANGUAGE plpgsql;

        COMMENT ON FUNCTION ops.run_all_entity_linking() IS
        'V2 entity linking pipeline. Currently runs disease status computation.';

        RAISE NOTICE 'Created ops.run_all_entity_linking()';
    END IF;
END $$;

-- ============================================================================
-- 5. INITIAL COMPUTATION
-- ============================================================================

\echo ''
\echo '5. Running initial disease status computation...'

SELECT * FROM ops.run_disease_status_computation();

-- ============================================================================
-- 6. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Disease status by type:'
SELECT disease_type_key, status, COUNT(*) as places
FROM ops.place_disease_status
GROUP BY disease_type_key, status
ORDER BY 1, 2;

\echo ''
\echo 'Places with active disease:'
SELECT
    COUNT(*) as total_places,
    COUNT(*) FILTER (WHERE status = 'confirmed_active') as active,
    COUNT(*) FILTER (WHERE status = 'suspected') as suspected,
    COUNT(*) FILTER (WHERE status = 'historical') as historical
FROM ops.place_disease_status;

\echo ''
\echo '=============================================='
\echo '  MIG_2116 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - ops.compute_place_disease_status() - main computation function'
\echo '  - ops.split_combo_results() - handles FeLV/FIV combo tests'
\echo '  - ops.run_disease_status_computation() - pipeline wrapper'
\echo ''
\echo 'V2 Pipeline:'
\echo '  ops.appointments → MIG_2117 → ops.cat_test_results'
\echo '  ops.cat_test_results + sot.cat_place → MIG_2116 → ops.place_disease_status'
\echo '  ops.place_disease_status → MIG_2110 → v_map_atlas_pins.disease_badges'
\echo ''
