-- MIG_2432: Add Step Validation to Entity Linking Orchestrator
--
-- Problem: run_all_entity_linking() runs all steps sequentially with no validation
--          between steps. If an earlier step fails or produces no results, later
--          steps run on incomplete data.
--
-- Solution: Add validation between steps, track run history, and provide
--           detailed metrics for monitoring.
--
-- @see DATA_GAP_040
-- @see docs/ENTITY_LINKING_FORTIFICATION_PLAN.md
--
-- Created: 2026-02-21

\echo ''
\echo '=============================================='
\echo '  MIG_2432: Add Orchestrator Validation'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE RUN HISTORY TABLE
-- ============================================================================

\echo '1. Creating ops.entity_linking_runs table...'

CREATE TABLE IF NOT EXISTS ops.entity_linking_runs (
    run_id SERIAL PRIMARY KEY,
    result JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    warnings TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_entity_linking_runs_created
    ON ops.entity_linking_runs(created_at DESC);

COMMENT ON TABLE ops.entity_linking_runs IS
'Tracks all entity linking pipeline runs with metrics and status.
Used for monitoring and debugging. Populated by run_all_entity_linking().';

\echo '   Created ops.entity_linking_runs'

-- ============================================================================
-- 2. FIX run_all_entity_linking() - ADD VALIDATION
-- ============================================================================

\echo ''
\echo '2. Fixing sot.run_all_entity_linking()...'

CREATE OR REPLACE FUNCTION sot.run_all_entity_linking()
RETURNS JSONB AS $$
DECLARE
    v_result JSONB := '{}'::jsonb;
    v_warnings TEXT[] := '{}';
    v_start TIMESTAMPTZ;
    v_row RECORD;
    v_count INT;
    v_skipped INT;
    v_total_appointments INT;
    v_appointments_with_place INT;
    v_total_cats INT;
    v_cats_with_place INT;
    v_run_id INT;
    v_status TEXT := 'completed';
BEGIN
    v_start := clock_timestamp();

    -- Get baseline counts
    SELECT COUNT(*) INTO v_total_appointments FROM ops.appointments;
    SELECT COUNT(*) INTO v_total_cats FROM sot.cats WHERE merged_into_cat_id IS NULL;

    -- ========================================================================
    -- STEP 1: Link appointments to places
    -- ========================================================================
    FOR v_row IN SELECT * FROM sot.link_appointments_to_places() LOOP
        v_result := v_result || jsonb_build_object(
            'step1_' || v_row.source || '_linked', v_row.appointments_linked,
            'step1_' || v_row.source || '_unmatched', v_row.appointments_unmatched
        );
    END LOOP;

    -- Step 1 validation: Check coverage
    SELECT COUNT(*) INTO v_appointments_with_place
    FROM ops.appointments WHERE inferred_place_id IS NOT NULL;

    v_result := v_result || jsonb_build_object(
        'step1_total_appointments', v_total_appointments,
        'step1_with_inferred_place', v_appointments_with_place,
        'step1_coverage_pct', ROUND(100.0 * v_appointments_with_place / NULLIF(v_total_appointments, 0), 1)
    );

    -- Warning if coverage is low
    IF v_appointments_with_place < (v_total_appointments * 0.5) THEN
        v_warnings := array_append(v_warnings, 'step1_low_coverage: only ' ||
            v_appointments_with_place || ' of ' || v_total_appointments || ' appointments have places');
    END IF;

    -- ========================================================================
    -- STEP 2: Link cats to places via appointments (PRIMARY)
    -- ========================================================================
    SELECT cats_linked, cats_skipped INTO v_count, v_skipped
    FROM sot.link_cats_to_appointment_places();

    v_result := v_result || jsonb_build_object(
        'step2_cats_linked', v_count,
        'step2_cats_skipped', v_skipped
    );

    -- ========================================================================
    -- STEP 3: Link cats to places via person chain (SECONDARY)
    -- ========================================================================
    SELECT total_edges INTO v_count FROM sot.link_cats_to_places();

    v_result := v_result || jsonb_build_object(
        'step3_cats_linked', v_count
    );

    -- ========================================================================
    -- FINAL VALIDATION
    -- ========================================================================
    SELECT COUNT(DISTINCT cat_id) INTO v_cats_with_place FROM sot.cat_place;

    v_result := v_result || jsonb_build_object(
        'total_cats', v_total_cats,
        'cats_with_place_link', v_cats_with_place,
        'cat_coverage_pct', ROUND(100.0 * v_cats_with_place / NULLIF(v_total_cats, 0), 1),
        'duration_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start)::INT,
        'status', v_status
    );

    -- Add warnings if any
    IF array_length(v_warnings, 1) > 0 THEN
        v_result := v_result || jsonb_build_object('warnings', v_warnings);
        v_status := 'completed_with_warnings';
    END IF;

    -- Log run to history table
    INSERT INTO ops.entity_linking_runs (result, status, warnings, completed_at)
    VALUES (v_result, v_status, v_warnings, NOW())
    RETURNING run_id INTO v_run_id;

    v_result := v_result || jsonb_build_object('run_id', v_run_id);

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.run_all_entity_linking IS
'V2/MIG_2432: Master orchestrator for entity linking pipeline with validation.
Order of execution:
1. link_appointments_to_places() - Resolve inferred_place_id
2. link_cats_to_appointment_places() - PRIMARY: appointment-based linking
3. link_cats_to_places() - SECONDARY: person chain fallback

FIX: Now validates coverage between steps, logs warnings, and records
all runs to ops.entity_linking_runs for monitoring.

Returns JSONB with:
- Counts from each step
- Coverage percentages
- Duration
- Run ID for audit
- Warnings if any';

\echo '   Fixed sot.run_all_entity_linking()'

-- ============================================================================
-- 3. CREATE CONVENIENCE VIEW FOR RUN HISTORY
-- ============================================================================

\echo ''
\echo '3. Creating ops.v_entity_linking_history view...'

CREATE OR REPLACE VIEW ops.v_entity_linking_history AS
SELECT
    run_id,
    status,
    (result->>'step1_total_appointments')::int as total_appointments,
    (result->>'step1_with_inferred_place')::int as appointments_with_place,
    (result->>'step1_coverage_pct')::numeric as appointment_coverage_pct,
    (result->>'step2_cats_linked')::int as cats_via_appointments,
    (result->>'step2_cats_skipped')::int as cats_skipped,
    (result->>'step3_cats_linked')::int as cats_via_person_chain,
    (result->>'total_cats')::int as total_cats,
    (result->>'cats_with_place_link')::int as cats_with_place,
    (result->>'cat_coverage_pct')::numeric as cat_coverage_pct,
    (result->>'duration_ms')::int as duration_ms,
    warnings,
    created_at,
    completed_at
FROM ops.entity_linking_runs
ORDER BY created_at DESC;

COMMENT ON VIEW ops.v_entity_linking_history IS
'Friendly view of entity linking run history with extracted metrics.';

\echo '   Created ops.v_entity_linking_history'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Testing run_all_entity_linking()...'

SELECT jsonb_pretty(sot.run_all_entity_linking()) as run_result;

\echo ''
\echo 'Run history:'
SELECT * FROM ops.v_entity_linking_history LIMIT 3;

\echo ''
\echo '=============================================='
\echo '  MIG_2432 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  - Added ops.entity_linking_runs table for run history'
\echo '  - Added validation between pipeline steps'
\echo '  - Returns coverage percentages and warnings'
\echo '  - Logs all runs for audit trail'
\echo '  - Created ops.v_entity_linking_history view'
\echo ''
