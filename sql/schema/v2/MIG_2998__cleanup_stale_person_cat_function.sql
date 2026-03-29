-- MIG_2998: Permanent Stale Person-Cat Link Cleanup + Entity Linking Update
--
-- FFS-895: Add cleanup_stale_person_cat_links() as permanent pipeline step
--
-- 1. Creates sot.cleanup_stale_person_cat_links() — modeled after
--    sot.cleanup_stale_request_cat_links() (MIG_2825)
-- 2. Updates run_all_entity_linking() to call it as Step 3b
--    (between person-chain linking and cat-request attribution)
-- 3. Fixes Step 2 false-alarm warning (fires every run when all cats already linked)
-- 4. Updates v_entity_linking_history view with new field
--
-- Created: 2026-03-27

\echo ''
\echo '=============================================='
\echo '  MIG_2998: Stale Person-Cat Cleanup Function'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE sot.cleanup_stale_person_cat_links()
-- ============================================================================

\echo '1. Creating sot.cleanup_stale_person_cat_links()...'

CREATE OR REPLACE FUNCTION sot.cleanup_stale_person_cat_links()
RETURNS INTEGER
LANGUAGE plpgsql
AS $function$
DECLARE
  v_removed INTEGER := 0;
BEGIN
  -- Delete clinichq appointment-evidence person_cat links where no matching
  -- appointment connects that person to that cat.
  --
  -- Root cause: entity linking creates person_cat rows from appointments,
  -- but when appointments are reclassified (person_id changed/cleared),
  -- the derived person_cat rows become stale.
  --
  -- Only touches automated links:
  --   source_system = 'clinichq' AND evidence_type = 'appointment'
  -- Preserves manual/UI links, imported links, and other evidence types.
  WITH stale AS (
    DELETE FROM sot.person_cat pc
    WHERE pc.source_system = 'clinichq'
      AND pc.evidence_type = 'appointment'
      AND NOT EXISTS (
        SELECT 1 FROM ops.appointments a
        WHERE a.person_id = pc.person_id
          AND a.cat_id = pc.cat_id
      )
    RETURNING pc.person_id, pc.cat_id
  )
  SELECT COUNT(*) INTO v_removed FROM stale;

  IF v_removed > 0 THEN
    RAISE NOTICE 'cleanup_stale_person_cat_links: removed % stale links', v_removed;
  END IF;

  RETURN v_removed;
END;
$function$;

COMMENT ON FUNCTION sot.cleanup_stale_person_cat_links() IS
'MIG_2998/FFS-895: Removes clinichq appointment-evidence person_cat links
where no matching appointment connects person to cat. Preserves manual/imported
links. Modeled after cleanup_stale_request_cat_links() (MIG_2825).
Called as Step 3b in run_all_entity_linking().';

\echo '   Created sot.cleanup_stale_person_cat_links()'

-- ============================================================================
-- 2. UPDATE run_all_entity_linking() WITH STEP 3b
-- ============================================================================
-- Base: MIG_2910 version (7 steps with exception handling).
-- Changes:
--   - Add Step 3b: cleanup_stale_person_cat_links() between Steps 3 and 4
--   - Fix Step 2 false-alarm warning: only warn when cats genuinely can't link

\echo ''
\echo '2. Updating sot.run_all_entity_linking() with Step 3b...'

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
    -- Step 3b variable
    v_stale_person_cat INT;
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
    -- Step 7 variables (MIG_2908)
    v_candidates_found INT;
    v_candidates_queued INT;
    -- Step tracking
    v_current_step TEXT;
BEGIN
    v_start := clock_timestamp();

    -- Get baseline counts
    SELECT COUNT(*) INTO v_total_appointments FROM ops.appointments;
    SELECT COUNT(*) INTO v_total_cats FROM sot.cats WHERE merged_into_cat_id IS NULL;

    -- ========================================================================
    -- STEP 1: Link appointments to places (CRITICAL — abort on failure)
    -- ========================================================================
    v_current_step := 'step1_link_appointments_to_places';
    BEGIN
        SELECT COUNT(*) INTO v_count
        FROM sot.link_appointments_to_places();

        SELECT COUNT(*) INTO v_appointments_with_place
        FROM ops.appointments
        WHERE inferred_place_id IS NOT NULL;

        v_result := v_result || jsonb_build_object(
            'step1_coverage_pct', ROUND(100.0 * v_appointments_with_place / NULLIF(v_total_appointments, 0), 1)
        );
    EXCEPTION WHEN OTHERS THEN
        -- Step 1 is CRITICAL — abort entire pipeline
        v_status := 'failed';
        v_result := v_result || jsonb_build_object(
            'step1_error', SQLERRM,
            'step1_coverage_pct', 0,
            'status', 'failed',
            'duration_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start)::INT
        );
        INSERT INTO ops.entity_linking_runs (result, status, warnings, completed_at)
        VALUES (v_result, 'failed', ARRAY['step1 CRITICAL failure: ' || SQLERRM], NOW())
        RETURNING run_id INTO v_run_id;
        v_result := v_result || jsonb_build_object('run_id', v_run_id);
        RETURN v_result;
    END;

    -- ========================================================================
    -- STEP 2: Link cats to appointment places (PRIMARY)
    -- ========================================================================
    v_current_step := 'step2_link_cats_to_appointment_places';
    BEGIN
        SELECT cats_linked INTO v_count
        FROM sot.link_cats_to_appointment_places();

        v_result := v_result || jsonb_build_object('step2_cats_linked', COALESCE(v_count, 0));

        -- Only warn if there are cats with appointments at places but no cat_place link.
        -- v_count = 0 is normal when all linkable cats are already linked.
        IF v_count = 0 THEN
            DECLARE
                v_unlinkable INT;
            BEGIN
                SELECT COUNT(DISTINCT a.cat_id) INTO v_unlinkable
                FROM ops.appointments a
                WHERE a.cat_id IS NOT NULL
                  AND a.inferred_place_id IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM sot.cat_place cp
                    WHERE cp.cat_id = a.cat_id
                  );
                IF v_unlinkable > 0 THEN
                    v_warnings := array_append(v_warnings,
                        'step2 linked 0 cats but ' || v_unlinkable || ' cats with appointments have no cat_place link');
                END IF;
            END;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN
            v_status := 'partial_failure';
        END IF;
        v_result := v_result || jsonb_build_object(
            'step2_error', SQLERRM,
            'step2_cats_linked', 0
        );
        v_warnings := array_append(v_warnings, 'step2 failed: ' || SQLERRM);
    END;

    -- ========================================================================
    -- STEP 3: Link cats to places via person chain (SECONDARY/FALLBACK)
    -- ========================================================================
    v_current_step := 'step3_link_cats_to_places';
    BEGIN
        SELECT cats_linked_home, cats_skipped INTO v_count, v_skipped
        FROM sot.link_cats_to_places();

        v_result := v_result || jsonb_build_object(
            'step3_cats_linked', COALESCE(v_count, 0),
            'step3_cats_skipped', COALESCE(v_skipped, 0)
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
    END;

    -- ========================================================================
    -- STEP 3b (NEW/MIG_2998): Cleanup stale person-cat links
    -- ========================================================================
    -- Runs after cat-place linking but before cat-request attribution.
    -- Removes clinichq appointment-evidence person_cat links where the
    -- underlying appointment no longer connects that person to that cat.
    v_current_step := 'step3b_cleanup_stale_person_cat';
    BEGIN
        v_stale_person_cat := sot.cleanup_stale_person_cat_links();

        v_result := v_result || jsonb_build_object(
            'step3b_stale_person_cat_removed', COALESCE(v_stale_person_cat, 0)
        );
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN
            v_status := 'partial_failure';
        END IF;
        v_result := v_result || jsonb_build_object(
            'step3b_error', SQLERRM,
            'step3b_stale_person_cat_removed', 0
        );
        v_warnings := array_append(v_warnings, 'step3b failed: ' || SQLERRM);
    END;

    -- ========================================================================
    -- STEP 4: Cat-Request Attribution (place family + time window)
    -- MIG_2910/FFS-459: Fixed return type handling
    -- ========================================================================
    v_current_step := 'step4_cat_request_attribution';
    BEGIN
        -- 4a: Clean up stale automated links first
        -- cleanup_stale_request_cat_links() returns INTEGER (not TABLE)
        v_stale_removed := sot.cleanup_stale_request_cat_links();

        -- 4b: Create fresh links via place family + attribution window
        SELECT linked, before_request, during_request, grace_period
        INTO v_count, v_before, v_during, v_grace
        FROM sot.link_cats_to_requests_attribution();

        v_result := v_result || jsonb_build_object(
            'step4_stale_removed', COALESCE(v_stale_removed, 0),
            'step4_cats_linked_to_requests', COALESCE(v_count, 0),
            'step4_before', COALESCE(v_before, 0),
            'step4_during', COALESCE(v_during, 0),
            'step4_grace', COALESCE(v_grace, 0)
        );
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN
            v_status := 'partial_failure';
        END IF;
        v_result := v_result || jsonb_build_object(
            'step4_error', SQLERRM,
            'step4_cats_linked_to_requests', 0
        );
        v_warnings := array_append(v_warnings, 'step4 failed: ' || SQLERRM);
    END;

    -- ========================================================================
    -- STEP 5: Link appointments to owners (MIG_2600/FFS-306)
    -- ========================================================================
    v_current_step := 'step5_link_appointments_to_owners';
    BEGIN
        SELECT appointments_updated, persons_linked
        INTO v_appts_updated, v_persons_linked
        FROM sot.link_appointments_to_owners();

        v_result := v_result || jsonb_build_object(
            'step5_appointments_linked_to_owners', COALESCE(v_appts_updated, 0)
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
    -- STEP 6: Link appointments to requests (MIG_2523/FFS-305)
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
    -- STEP 7 (MIG_2908): Queue unofficial trapper candidates
    -- ========================================================================
    v_current_step := 'step7_queue_trapper_candidates';
    BEGIN
        SELECT candidates_found, candidates_queued
        INTO v_candidates_found, v_candidates_queued
        FROM sot.queue_unofficial_trapper_candidates();

        v_result := v_result || jsonb_build_object(
            'step7_trapper_candidates_found', COALESCE(v_candidates_found, 0),
            'step7_trapper_candidates_queued', COALESCE(v_candidates_queued, 0)
        );
    EXCEPTION WHEN OTHERS THEN
        -- Step 7 is non-fatal — trapper detection is advisory only
        IF v_status != 'partial_failure' THEN
            v_status := 'partial_failure';
        END IF;
        v_result := v_result || jsonb_build_object(
            'step7_error', SQLERRM,
            'step7_trapper_candidates_found', 0,
            'step7_trapper_candidates_queued', 0
        );
        v_warnings := array_append(v_warnings, 'step7 failed (non-fatal): ' || SQLERRM);
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
'V2/MIG_2998: Master orchestrator for entity linking pipeline.
FFS-895: Added Step 3b (cleanup_stale_person_cat_links).
Fixed Step 2 false-alarm warning to only fire when cats genuinely cannot link.

Complete pipeline with 8 steps:
1. link_appointments_to_places() - Resolve inferred_place_id (CRITICAL - abort on failure)
2. link_cats_to_appointment_places() - PRIMARY: appointment-based cat-place linking
3. link_cats_to_places() - SECONDARY: person chain fallback (MIG_2906: trapper-aware)
3b. cleanup_stale_person_cat_links() - Remove stale appointment-evidence person_cat links (NEW)
4. Cat-Request Attribution:
   4a. cleanup_stale_request_cat_links() - Remove outdated automated links
   4b. link_cats_to_requests_attribution() - Create valid links via place family
5. link_appointments_to_owners() - Link appointments to people via email (FFS-306)
6. link_appointments_to_requests() - Link appointments to operational requests (FFS-305)
7. queue_unofficial_trapper_candidates() - Detect and queue Tier 3 trapper candidates (FFS-449)
';

\echo '   Updated sot.run_all_entity_linking() with Step 3b'

-- ============================================================================
-- 3. UPDATE v_entity_linking_history VIEW
-- ============================================================================

\echo ''
\echo '3. Updating ops.v_entity_linking_history view...'

CREATE OR REPLACE VIEW ops.v_entity_linking_history AS
SELECT
    run_id,
    status,
    (result->>'step1_coverage_pct')::numeric as appointment_coverage_pct,
    (result->>'step2_cats_linked')::int as cats_via_appointments,
    (result->>'step3_cats_linked')::int as cats_via_person_chain,
    (result->>'step3b_stale_person_cat_removed')::int as stale_person_cat_removed,
    (result->>'step4_cats_linked_to_requests')::int as cats_linked_to_requests,
    (result->>'step4_stale_removed')::int as stale_request_links_removed,
    (result->>'step5_appointments_linked_to_owners')::int as appointments_linked_to_owners,
    (result->>'step7_trapper_candidates_found')::int as trapper_candidates_found,
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
'Friendly view of entity linking run history with extracted metrics.
MIG_2998: Added stale_person_cat_removed column (Step 3b).';

\echo '   Updated ops.v_entity_linking_history'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo 'Verification...'

-- Verify function exists
SELECT
  p.proname as function_name,
  pg_get_function_result(p.oid) as return_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'sot'
  AND p.proname = 'cleanup_stale_person_cat_links';

-- Verify run_all_entity_linking comment mentions step 3b
SELECT obj_description(p.oid, 'pg_proc') LIKE '%3b%' AS has_step_3b_in_comment
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'sot'
  AND p.proname = 'run_all_entity_linking';

\echo ''
\echo '=============================================='
\echo '  MIG_2998 COMPLETE'
\echo ''
\echo '  Next steps:'
\echo '  1. Run MIG_2997 first (data fixes)'
\echo '  2. Run MIG_2998 (this migration — function + pipeline update)'
\echo '  3. SELECT jsonb_pretty(sot.run_all_entity_linking());'
\echo '     → Expect step3b_stale_person_cat_removed = 0 (already cleaned by MIG_2997)'
\echo '  4. SELECT * FROM ops.check_entity_linking_health();'
\echo '=============================================='
\echo ''
