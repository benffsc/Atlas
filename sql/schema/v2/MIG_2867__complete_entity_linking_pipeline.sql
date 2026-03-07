-- ============================================================================
-- MIG_2867: Complete Entity Linking Pipeline — Add Missing Steps
-- ============================================================================
-- Problem: run_all_entity_linking() (MIG_2860) is missing two critical steps:
--   - link_appointments_to_owners() (MIG_2600) — ties appointments to person identities
--   - link_appointments_to_requests() (MIG_2523) — ties appointments to operational requests
--
-- Both functions exist but are orphaned (never called by the orchestrator).
-- After person merges or identity re-resolution, appointments may point to
-- stale/merged person records because the link is never refreshed.
--
-- FFS-305, FFS-306
-- ============================================================================

\echo ''
\echo '================================================'
\echo '  MIG_2867: Complete Entity Linking Pipeline'
\echo '================================================'
\echo ''

-- ============================================================================
-- 0a. Drop stale zero-arg overload of link_appointments_to_owners
-- ============================================================================

\echo '0a. Dropping stale zero-arg overload of link_appointments_to_owners...'

-- V1 leftover: zero-arg version conflicts with V2 version (which has default param).
-- Calling without args is ambiguous when both exist.
DROP FUNCTION IF EXISTS sot.link_appointments_to_owners();

\echo '   Dropped stale overload'

-- ============================================================================
-- 0b. Create ops.data_quality_review_queue (needed by link_appointments_to_requests)
-- ============================================================================

\echo ''
\echo '0b. Creating ops.data_quality_review_queue table...'

CREATE TABLE IF NOT EXISTS ops.data_quality_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  issue_type TEXT NOT NULL,
  suggested_action TEXT,
  details JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dqrq_status ON ops.data_quality_review_queue(status);
CREATE INDEX IF NOT EXISTS idx_dqrq_entity ON ops.data_quality_review_queue(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_dqrq_issue_type ON ops.data_quality_review_queue(issue_type);

COMMENT ON TABLE ops.data_quality_review_queue IS
'Queue for data quality issues requiring human review. Used by link_appointments_to_requests()
for Tier 2 (address fuzzy match) and Tier 3 (person+proximity) matches. FFS-305.';

\echo '   Created ops.data_quality_review_queue'

-- ============================================================================
-- 1. Replace run_all_entity_linking() with complete version
-- ============================================================================

\echo ''
\echo '1. Replacing sot.run_all_entity_linking() with missing steps...'

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
    -- Step 4 variables
    v_before INT;
    v_during INT;
    v_grace INT;
    v_stale_removed INT;
    -- Step 5/6 variables
    v_tier1 INT;
    v_tier2 INT;
    v_tier3 INT;
    v_appts_updated INT;
    v_persons_linked INT;
    -- Step tracking
    v_current_step TEXT;
BEGIN
    v_start := clock_timestamp();

    -- Get baseline counts
    SELECT COUNT(*) INTO v_total_appointments FROM ops.appointments;
    SELECT COUNT(*) INTO v_total_cats FROM sot.cats WHERE merged_into_cat_id IS NULL;

    -- ========================================================================
    -- STEP 1: Link appointments to places
    -- ========================================================================
    v_current_step := 'step1_link_appointments_to_places';
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
        v_status := 'failed';
        v_result := v_result || jsonb_build_object(
            'step1_error', SQLERRM,
            'failed_at', v_current_step
        );
        v_warnings := array_append(v_warnings, 'CRITICAL: step1 failed: ' || SQLERRM);
        -- Step 1 failure is critical — Steps 2/3 depend on inferred_place_id.
        -- Log and abort.
        INSERT INTO ops.entity_linking_runs (result, status, warnings, completed_at)
        VALUES (
            v_result || jsonb_build_object('status', v_status, 'duration_ms',
                EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start)::INT),
            v_status, v_warnings, NOW()
        ) RETURNING run_id INTO v_run_id;
        RETURN v_result || jsonb_build_object('run_id', v_run_id, 'status', v_status);
    END;

    -- ========================================================================
    -- STEP 2: Link cats to places via appointments (PRIMARY)
    -- ========================================================================
    v_current_step := 'step2_link_cats_to_appointment_places';
    BEGIN
        SELECT cats_linked, cats_skipped INTO v_count, v_skipped
        FROM sot.link_cats_to_appointment_places();

        v_result := v_result || jsonb_build_object(
            'step2_cats_linked', v_count,
            'step2_cats_skipped', v_skipped
        );

        -- Step 2 validation
        IF v_count = 0 AND v_skipped > 100 THEN
            v_warnings := array_append(v_warnings, 'step2_all_skipped: 0 cats linked, ' ||
                v_skipped || ' skipped — check inferred_place_id coverage');
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v_status := 'partial_failure';
        v_result := v_result || jsonb_build_object(
            'step2_error', SQLERRM,
            'step2_cats_linked', 0,
            'step2_cats_skipped', 0
        );
        v_warnings := array_append(v_warnings, 'step2 failed: ' || SQLERRM);
        -- Continue to Step 3 — person-chain fallback may still work
    END;

    -- ========================================================================
    -- STEP 3: Link cats to places via person chain (SECONDARY)
    -- ========================================================================
    v_current_step := 'step3_link_cats_to_places';
    BEGIN
        SELECT total_edges INTO v_count FROM sot.link_cats_to_places();

        v_result := v_result || jsonb_build_object(
            'step3_cats_linked', v_count
        );
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN
            v_status := 'partial_failure';
        END IF;
        v_result := v_result || jsonb_build_object(
            'step3_error', SQLERRM,
            'step3_cats_linked', 0
        );
        v_warnings := array_append(v_warnings, 'step3 failed: ' || SQLERRM);
        -- Continue to Step 4
    END;

    -- ========================================================================
    -- STEP 4: Cat-Request Attribution (MIG_2825)
    -- ========================================================================
    v_current_step := 'step4_cat_request_attribution';
    BEGIN
        -- Step 4a: Cleanup stale automated links
        v_stale_removed := sot.cleanup_stale_request_cat_links();

        -- Step 4b: Create new valid links via attribution window + place family
        SELECT linked, before_request, during_request, grace_period
        INTO v_count, v_before, v_during, v_grace
        FROM sot.link_cats_to_requests_attribution();

        v_result := v_result || jsonb_build_object(
            'step4_cats_linked_to_requests', v_count,
            'step4_stale_links_removed', v_stale_removed,
            'step4_before_request', v_before,
            'step4_during_request', v_during,
            'step4_grace_period', v_grace
        );
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN
            v_status := 'partial_failure';
        END IF;
        v_result := v_result || jsonb_build_object(
            'step4_error', SQLERRM,
            'step4_cats_linked_to_requests', 0,
            'step4_stale_links_removed', 0
        );
        v_warnings := array_append(v_warnings, 'step4 failed: ' || SQLERRM);
    END;

    -- ========================================================================
    -- STEP 5 (NEW): Link appointments to owners via email (MIG_2600/FFS-306)
    -- ========================================================================
    v_current_step := 'step5_link_appointments_to_owners';
    BEGIN
        SELECT appointments_updated, persons_linked
        INTO v_appts_updated, v_persons_linked
        FROM sot.link_appointments_to_owners();

        v_result := v_result || jsonb_build_object(
            'step5_appointments_linked_to_owners', v_appts_updated,
            'step5_persons_linked', v_persons_linked
        );
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN
            v_status := 'partial_failure';
        END IF;
        v_result := v_result || jsonb_build_object(
            'step5_error', SQLERRM,
            'step5_appointments_linked_to_owners', 0
        );
        v_warnings := array_append(v_warnings, 'step5 failed: ' || SQLERRM);
    END;

    -- ========================================================================
    -- STEP 6 (NEW): Link appointments to requests (MIG_2523/FFS-305)
    -- ========================================================================
    v_current_step := 'step6_link_appointments_to_requests';
    BEGIN
        SELECT tier1_linked, tier2_queued, tier3_queued
        INTO v_tier1, v_tier2, v_tier3
        FROM ops.link_appointments_to_requests();

        v_result := v_result || jsonb_build_object(
            'step6_appointments_linked_to_requests_tier1', v_tier1,
            'step6_appointments_queued_tier2', v_tier2,
            'step6_appointments_queued_tier3', v_tier3
        );
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN
            v_status := 'partial_failure';
        END IF;
        v_result := v_result || jsonb_build_object(
            'step6_error', SQLERRM,
            'step6_appointments_linked_to_requests_tier1', 0
        );
        v_warnings := array_append(v_warnings, 'step6 failed: ' || SQLERRM);
    END;

    -- ========================================================================
    -- FINAL VALIDATION
    -- ========================================================================
    SELECT COUNT(DISTINCT cat_id) INTO v_cats_with_place FROM sot.cat_place;

    v_result := v_result || jsonb_build_object(
        'total_cats', v_total_cats,
        'cats_with_place_link', v_cats_with_place,
        'cat_coverage_pct', ROUND(100.0 * v_cats_with_place / NULLIF(v_total_cats, 0), 1),
        'duration_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start)::INT
    );

    -- Determine final status BEFORE inserting
    IF array_length(v_warnings, 1) > 0 AND v_status = 'completed' THEN
        v_status := 'completed_with_warnings';
    END IF;

    v_result := v_result || jsonb_build_object('status', v_status);

    -- Log run to history table (with correct status now)
    INSERT INTO ops.entity_linking_runs (result, status, warnings, completed_at)
    VALUES (v_result, v_status, v_warnings, NOW())
    RETURNING run_id INTO v_run_id;

    v_result := v_result || jsonb_build_object('run_id', v_run_id);

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.run_all_entity_linking IS
'V2/MIG_2867: Master orchestrator for entity linking pipeline.
Complete pipeline with all 6 steps (MIG_2860 had only 4).

Order of execution:
1. link_appointments_to_places() - Resolve inferred_place_id (CRITICAL - abort on failure)
2. link_cats_to_appointment_places() - PRIMARY: appointment-based cat-place linking
3. link_cats_to_places() - SECONDARY: person chain fallback
4. Cat-Request Attribution:
   4a. cleanup_stale_request_cat_links() - Remove outdated automated links
   4b. link_cats_to_requests_attribution() - Create valid links via place family
5. link_appointments_to_owners() - Link appointments to people via email (FFS-306)
6. link_appointments_to_requests() - Link appointments to operational requests (FFS-305)

Per-step exception handling: step 1 aborts on failure, steps 2-6 continue.
FFS-305, FFS-306.';

\echo '   Replaced run_all_entity_linking() with 6-step pipeline'

-- ============================================================================
-- 2. Verification
-- ============================================================================

\echo ''
\echo '2. Verifying function exists with updated signature...'

SELECT
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as return_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'sot' AND p.proname = 'run_all_entity_linking';

\echo ''
\echo '================================================'
\echo '  MIG_2867 Complete (FFS-305, FFS-306)'
\echo '================================================'
\echo ''
\echo 'Added to run_all_entity_linking():'
\echo '  Step 5: link_appointments_to_owners() — email-based appointment→person linking'
\echo '  Step 6: link_appointments_to_requests() — place-based appointment→request linking'
\echo ''
\echo 'To run the complete pipeline:'
\echo '  SELECT jsonb_pretty(sot.run_all_entity_linking());'
\echo ''
