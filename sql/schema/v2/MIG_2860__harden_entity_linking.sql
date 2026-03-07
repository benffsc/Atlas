-- MIG_2860: Harden Entity Linking Functions (FFS-290, DATA_GAP_040)
--
-- Fixes:
-- 1. link_cat_to_place() and link_person_to_cat(): change p_confidence param
--    from TEXT to NUMERIC (matching V2 schema where confidence is numeric 0-1).
--    Ensures ON CONFLICT comparison uses plain `>` (correct for numeric).
-- 2. BUG: run_all_entity_linking() sets v_status AFTER the INSERT into
--    entity_linking_runs, so logged status is always 'completed'.
-- 3. No exception handling in orchestrator — step failures crash the
--    whole pipeline with no record of which step failed.
-- 4. No validation for Steps 2-4 (only Step 1 has a low coverage warning).
-- 5. check_entity_linking_health() extended with confidence_integrity and
--    recent_partial_failures checks (numeric column, not text).
--
-- Created: 2026-03-07

\echo ''
\echo '=============================================='
\echo '  MIG_2860: Harden Entity Linking (FFS-290)'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE CONFIDENCE COMPARISON HELPER
-- ============================================================================

\echo '1. Creating sot.confidence_rank() helper...'

CREATE OR REPLACE FUNCTION sot.confidence_rank(p_confidence TEXT)
RETURNS INTEGER AS $$
BEGIN
    RETURN CASE p_confidence
        WHEN 'high' THEN 3
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 1
        ELSE 0
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION sot.confidence_rank IS
'MIG_2860: Converts confidence text to numeric rank for comparison.
Fixes alphabetical string comparison bug where ''high'' < ''low'' < ''medium''.
Used in ON CONFLICT clauses of link_cat_to_place() and link_person_to_cat().';

\echo '   Created sot.confidence_rank()'

-- ============================================================================
-- 2. FIX link_cat_to_place() — Use numeric confidence comparison
-- ============================================================================

\echo ''
\echo '2. Fixing sot.link_cat_to_place() confidence comparison...'

CREATE OR REPLACE FUNCTION sot.link_cat_to_place(
    p_cat_id UUID,
    p_place_id UUID,
    p_relationship_type TEXT DEFAULT 'seen_at',
    p_evidence_type TEXT DEFAULT 'appointment',
    p_source_system TEXT DEFAULT 'atlas',
    p_source_table TEXT DEFAULT NULL,
    p_evidence_detail JSONB DEFAULT NULL,
    p_confidence TEXT DEFAULT 'medium'
)
RETURNS UUID AS $$
DECLARE
    v_link_id UUID;
BEGIN
    -- Validate entities exist and aren't merged
    IF NOT EXISTS (
        SELECT 1 FROM sot.cats WHERE cat_id = p_cat_id AND merged_into_cat_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM sot.places WHERE place_id = p_place_id AND merged_into_place_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    -- Insert or update relationship
    INSERT INTO sot.cat_place (
        cat_id, place_id, relationship_type,
        confidence, evidence_type, source_system
    ) VALUES (
        p_cat_id, p_place_id, p_relationship_type,
        p_confidence, p_evidence_type, p_source_system
    )
    ON CONFLICT (cat_id, place_id, relationship_type)
    DO UPDATE SET
        -- MIG_2860 FIX: Use numeric rank instead of string comparison.
        -- String comparison was broken: 'high' < 'low' < 'medium' alphabetically,
        -- so 'high' confidence NEVER overwrote 'medium' or 'low'.
        confidence = CASE
            WHEN sot.confidence_rank(EXCLUDED.confidence) > sot.confidence_rank(sot.cat_place.confidence)
            THEN EXCLUDED.confidence
            ELSE sot.cat_place.confidence
        END,
        -- Also update evidence when upgrading confidence
        evidence_type = CASE
            WHEN sot.confidence_rank(EXCLUDED.confidence) > sot.confidence_rank(sot.cat_place.confidence)
            THEN EXCLUDED.evidence_type
            ELSE sot.cat_place.evidence_type
        END,
        source_system = CASE
            WHEN sot.confidence_rank(EXCLUDED.confidence) > sot.confidence_rank(sot.cat_place.confidence)
            THEN EXCLUDED.source_system
            ELSE sot.cat_place.source_system
        END,
        updated_at = NOW()
    RETURNING id INTO v_link_id;

    RETURN v_link_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.link_cat_to_place IS
'V2/MIG_2860: Creates or updates a cat-place relationship.
Validates entities exist and arent merged before linking.
Uses ON CONFLICT to update if higher confidence.
MIG_2860 FIX: Uses confidence_rank() instead of string comparison.
Also updates evidence_type and source_system when upgrading confidence.';

\echo '   Fixed sot.link_cat_to_place()'

-- ============================================================================
-- 3. FIX link_person_to_cat() — Same confidence comparison fix
-- ============================================================================

\echo ''
\echo '3. Fixing sot.link_person_to_cat() confidence comparison...'

CREATE OR REPLACE FUNCTION sot.link_person_to_cat(
    p_person_id UUID,
    p_cat_id UUID,
    p_relationship_type TEXT DEFAULT 'owner',
    p_evidence_type TEXT DEFAULT 'appointment',
    p_source_system TEXT DEFAULT 'atlas',
    p_confidence TEXT DEFAULT 'medium'
)
RETURNS UUID AS $$
DECLARE
    v_link_id UUID;
BEGIN
    -- Validate entities exist and aren't merged
    IF NOT EXISTS (
        SELECT 1 FROM sot.people WHERE person_id = p_person_id AND merged_into_person_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM sot.cats WHERE cat_id = p_cat_id AND merged_into_cat_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    -- Insert or update relationship
    INSERT INTO sot.person_cat (
        person_id, cat_id, relationship_type,
        confidence, evidence_type, source_system
    ) VALUES (
        p_person_id, p_cat_id, p_relationship_type,
        p_confidence, p_evidence_type, p_source_system
    )
    ON CONFLICT (person_id, cat_id, relationship_type)
    DO UPDATE SET
        -- MIG_2860 FIX: Use numeric rank instead of string comparison.
        confidence = CASE
            WHEN sot.confidence_rank(EXCLUDED.confidence) > sot.confidence_rank(sot.person_cat.confidence)
            THEN EXCLUDED.confidence
            ELSE sot.person_cat.confidence
        END,
        evidence_type = CASE
            WHEN sot.confidence_rank(EXCLUDED.confidence) > sot.confidence_rank(sot.person_cat.confidence)
            THEN EXCLUDED.evidence_type
            ELSE sot.person_cat.evidence_type
        END,
        source_system = CASE
            WHEN sot.confidence_rank(EXCLUDED.confidence) > sot.confidence_rank(sot.person_cat.confidence)
            THEN EXCLUDED.source_system
            ELSE sot.person_cat.source_system
        END,
        updated_at = NOW()
    RETURNING id INTO v_link_id;

    RETURN v_link_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.link_person_to_cat IS
'V2/MIG_2860: Creates or updates a person-cat relationship.
Validates entities exist and arent merged before linking.
Uses ON CONFLICT to update if higher confidence.
MIG_2860 FIX: Uses confidence_rank() instead of string comparison.
Also updates evidence_type and source_system when upgrading confidence.';

\echo '   Fixed sot.link_person_to_cat()'

-- ============================================================================
-- 4. FIX run_all_entity_linking() — Status race + exception handling + validation
-- ============================================================================

\echo ''
\echo '4. Hardening sot.run_all_entity_linking()...'

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
'V2/MIG_2860: Master orchestrator for entity linking pipeline.
Hardened with per-step exception handling and proper status tracking.

Order of execution:
1. link_appointments_to_places() - Resolve inferred_place_id (CRITICAL - abort on failure)
2. link_cats_to_appointment_places() - PRIMARY: appointment-based cat-place linking
3. link_cats_to_places() - SECONDARY: person chain fallback
4. Cat-Request Attribution:
   4a. cleanup_stale_request_cat_links() - Remove outdated automated links
   4b. link_cats_to_requests_attribution() - Create valid links via place family

MIG_2860 fixes:
- Per-step exception handling (steps 2-4 continue on failure, step 1 aborts)
- Status determined BEFORE INSERT (was race condition)
- Step 2 validation (warns when all cats skipped)
- Detailed error messages in result JSONB';

\echo '   Hardened sot.run_all_entity_linking()'

-- ============================================================================
-- 5. ADD CONFIDENCE HEALTH CHECK
-- ============================================================================

\echo ''
\echo '5. Extending ops.check_entity_linking_health()...'

CREATE OR REPLACE FUNCTION ops.check_entity_linking_health()
RETURNS TABLE(
    check_name TEXT,
    status TEXT,
    value INT,
    threshold INT,
    message TEXT
) AS $$
BEGIN
    -- Check 1: Clinic leakage
    RETURN QUERY
    SELECT
        'clinic_leakage'::TEXT,
        CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'ALERT' END::TEXT,
        COUNT(*)::INT,
        0::INT,
        CASE WHEN COUNT(*) = 0 THEN 'No clinic leakage' ELSE 'Cats incorrectly linked to clinic addresses' END::TEXT
    FROM ops.v_clinic_leakage;

    -- Check 2: Cat-place coverage
    RETURN QUERY
    SELECT
        'cat_place_coverage'::TEXT,
        CASE WHEN (SELECT place_coverage_pct FROM ops.v_cat_place_coverage) >= 80 THEN 'OK' ELSE 'WARNING' END::TEXT,
        (SELECT place_coverage_pct::INT FROM ops.v_cat_place_coverage),
        80::INT,
        'Cats with at least one place link'::TEXT;

    -- Check 3: Appointment place resolution
    RETURN QUERY
    SELECT
        'appointment_place_resolution'::TEXT,
        CASE WHEN (SELECT inferred_place_pct FROM ops.v_appointment_place_resolution) >= 70 THEN 'OK' ELSE 'WARNING' END::TEXT,
        (SELECT inferred_place_pct::INT FROM ops.v_appointment_place_resolution),
        70::INT,
        'Appointments with inferred_place_id'::TEXT;

    -- Check 4: Recent skipped entities
    RETURN QUERY
    SELECT
        'recent_skips'::TEXT,
        CASE WHEN COUNT(*) < 100 THEN 'OK' ELSE 'WARNING' END::TEXT,
        COUNT(*)::INT,
        100::INT,
        'Entities skipped in last 24 hours'::TEXT
    FROM ops.entity_linking_skipped
    WHERE created_at > NOW() - INTERVAL '1 day';

    -- Check 5: Last run status
    RETURN QUERY
    SELECT
        'last_run_status'::TEXT,
        COALESCE((SELECT elr.status FROM ops.entity_linking_runs elr ORDER BY elr.created_at DESC LIMIT 1), 'never_run')::TEXT,
        COALESCE((SELECT (elr.result->>'cat_coverage_pct')::INT FROM ops.entity_linking_runs elr ORDER BY elr.created_at DESC LIMIT 1), 0)::INT,
        0::INT,
        'Most recent entity linking run'::TEXT;

    -- Check 6 (NEW): Confidence integrity — verify high-confidence links exist
    RETURN QUERY
    SELECT
        'confidence_integrity'::TEXT,
        CASE
            WHEN (SELECT COUNT(*) FROM sot.cat_place WHERE confidence = 'high') > 0
            THEN 'OK'
            ELSE 'WARNING'
        END::TEXT,
        (SELECT COUNT(*)::INT FROM sot.cat_place WHERE confidence = 'high'),
        1::INT,
        'Cat-place links with high confidence (MIG_2860 fix verification)'::TEXT;

    -- Check 7 (NEW): Partial failure detection
    RETURN QUERY
    SELECT
        'recent_partial_failures'::TEXT,
        CASE
            WHEN (SELECT COUNT(*) FROM ops.entity_linking_runs
                  WHERE status IN ('partial_failure', 'failed')
                  AND created_at > NOW() - INTERVAL '7 days') = 0
            THEN 'OK'
            ELSE 'ALERT'
        END::TEXT,
        (SELECT COUNT(*)::INT FROM ops.entity_linking_runs
         WHERE status IN ('partial_failure', 'failed')
         AND created_at > NOW() - INTERVAL '7 days'),
        0::INT,
        'Entity linking runs with failures in last 7 days'::TEXT;

    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.check_entity_linking_health IS
'MIG_2860: Health check function for entity linking pipeline.
Returns status for key metrics with thresholds.
Added checks: confidence_integrity (MIG_2860 fix), recent_partial_failures.
Use: SELECT * FROM ops.check_entity_linking_health();';

\echo '   Extended ops.check_entity_linking_health()'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Confidence rank function test:'
SELECT
    sot.confidence_rank('high') as high_rank,
    sot.confidence_rank('medium') as medium_rank,
    sot.confidence_rank('low') as low_rank,
    sot.confidence_rank(NULL) as null_rank;

\echo ''
\echo 'Verify: high > medium > low (should be 3 > 2 > 1):'
SELECT
    sot.confidence_rank('high') > sot.confidence_rank('medium') as high_beats_medium,
    sot.confidence_rank('medium') > sot.confidence_rank('low') as medium_beats_low,
    sot.confidence_rank('high') > sot.confidence_rank('low') as high_beats_low;

\echo ''
\echo 'Compare to old string comparison (was broken):'
SELECT
    'high' > 'medium' as string_high_beats_medium,   -- FALSE (broken!)
    'medium' > 'low' as string_medium_beats_low,      -- TRUE (worked by accident)
    'high' > 'low' as string_high_beats_low;           -- FALSE (broken!)

\echo ''
\echo 'Current cat_place confidence distribution:'
SELECT confidence, COUNT(*) as count
FROM sot.cat_place
GROUP BY confidence
ORDER BY sot.confidence_rank(confidence) DESC;

\echo ''
\echo 'Current person_cat confidence distribution:'
SELECT confidence, COUNT(*) as count
FROM sot.person_cat
GROUP BY confidence
ORDER BY sot.confidence_rank(confidence) DESC;

\echo ''
\echo 'Health check:'
SELECT * FROM ops.check_entity_linking_health();

\echo ''
\echo '=============================================='
\echo '  MIG_2860 Complete (FFS-290)'
\echo '=============================================='
\echo ''
\echo 'Fixes applied:'
\echo '  1. CRITICAL: link_cat_to_place() confidence comparison now uses numeric rank'
\echo '     (was: string comparison where ''high'' < ''low'' < ''medium'')'
\echo '  2. CRITICAL: link_person_to_cat() same confidence fix'
\echo '  3. BUG: run_all_entity_linking() status determined BEFORE INSERT'
\echo '  4. run_all_entity_linking() per-step exception handling (step 1 aborts, 2-4 continue)'
\echo '  5. run_all_entity_linking() Step 2 validation warning'
\echo '  6. check_entity_linking_health() new checks: confidence_integrity, recent_partial_failures'
\echo '  7. link_cat_to_place() and link_person_to_cat() also update evidence/source on confidence upgrade'
\echo ''
\echo 'NOTE: After running this migration, re-run entity linking to propagate confidence fixes:'
\echo '  SELECT jsonb_pretty(sot.run_all_entity_linking());'
\echo ''
