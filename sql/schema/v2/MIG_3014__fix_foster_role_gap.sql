-- MIG_3014: Fix Foster Role Gap (FFS-324)
--
-- Problem: Only 20 of ~210 foster persons have the 'foster' role in sot.person_roles.
-- The /api/fosters route queries person_roles, so 190 fosters are invisible.
--
-- Root causes:
-- A) 78 VH volunteers in foster-approved groups were never processed because the
--    VH sync cron never ran process_volunteerhub_group_roles() for them.
-- B) 112 SL-only fosters have person_cat evidence (relationship_type='foster') but
--    process_shelterluv_events() never creates person_roles entries.
--
-- Fix:
-- A) Backfill VH foster roles by calling process_volunteerhub_group_roles()
-- B) New function ensure_foster_roles_from_person_cat() + backfill
-- C) Add to entity linking pipeline (Step 3e) for ongoing coverage
-- D) Add foster role creation to process_shelterluv_events() for new events
--
-- Created: 2026-03-29

\echo ''
\echo '=============================================='
\echo '  MIG_3014: Fix Foster Role Gap'
\echo '=============================================='
\echo ''

-- Pre-fix baseline
\echo 'PRE-FIX baseline:'
SELECT
  (SELECT COUNT(*) FROM sot.person_roles WHERE role = 'foster') AS current_foster_roles,
  (SELECT COUNT(DISTINCT person_id) FROM sot.person_cat WHERE relationship_type = 'foster') AS persons_with_foster_cats;


-- ============================================================================
-- SECTION A: Backfill VH foster roles
-- ============================================================================
-- 78 matched VH volunteers in foster-approved groups missing the foster role.
-- Uses the existing process_volunteerhub_group_roles() function.

\echo ''
\echo '1. Backfilling VH foster roles...'

SELECT ops.process_volunteerhub_group_roles(vv.matched_person_id, vv.volunteerhub_id)
FROM source.volunteerhub_volunteers vv
JOIN source.volunteerhub_group_memberships vgm ON vgm.volunteerhub_id = vv.volunteerhub_id
JOIN source.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
WHERE vug.atlas_role = 'foster'
  AND vgm.left_at IS NULL
  AND vv.matched_person_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sot.person_roles pr
    WHERE pr.person_id = vv.matched_person_id AND pr.role = 'foster'
  );

\echo '   VH foster role backfill complete'


-- ============================================================================
-- SECTION B: sot.ensure_foster_roles_from_person_cat()
-- ============================================================================
-- Creates foster roles for people with ShelterLuv foster evidence (person_cat)
-- who don't already have a foster role from any source.
-- VH = authority for ACTIVE fosters. SL = historical evidence → 'inactive'.
-- If the person is also in a VH foster group, process_volunteerhub_group_roles()
-- will have already created an 'active' role, so ON CONFLICT skips them.

\echo ''
\echo '2. Creating sot.ensure_foster_roles_from_person_cat()...'

CREATE OR REPLACE FUNCTION sot.ensure_foster_roles_from_person_cat()
RETURNS TABLE(roles_created INT) AS $$
DECLARE
    v_created INT;
    v_default_status TEXT;
BEGIN
    -- Read default status from admin config (MIG_3016), fallback to 'inactive'
    SELECT TRIM(BOTH '"' FROM value::text) INTO v_default_status
    FROM ops.app_config WHERE key = 'foster.sl_default_status';
    IF v_default_status IS NULL THEN v_default_status := 'inactive'; END IF;

    INSERT INTO sot.person_roles (person_id, role, role_status, source_system, source_record_id, notes)
    SELECT DISTINCT pc.person_id,
        'foster',
        v_default_status,
        'shelterluv',
        'person_cat_evidence',
        'Auto-created from ShelterLuv foster events'
    FROM sot.person_cat pc
    WHERE pc.relationship_type = 'foster'
      -- Skip people who already have a foster role (from any source)
      AND NOT EXISTS (
          SELECT 1 FROM sot.person_roles pr
          WHERE pr.person_id = pc.person_id AND pr.role = 'foster'
      )
      -- Skip merged people
      AND EXISTS (
          SELECT 1 FROM sot.people p
          WHERE p.person_id = pc.person_id AND p.merged_into_person_id IS NULL
      )
    ON CONFLICT (person_id, role) DO NOTHING;

    GET DIAGNOSTICS v_created = ROW_COUNT;
    roles_created := v_created;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.ensure_foster_roles_from_person_cat IS
'Creates foster roles from ShelterLuv person_cat evidence for people who lack
a foster role from any source. Reads default status from ops.app_config
key "foster.sl_default_status" (admin-editable). MIG_3014/MIG_3016.';


-- ============================================================================
-- SECTION C: Run SL foster role backfill
-- ============================================================================

\echo '   Running SL foster role backfill...'
SELECT * FROM sot.ensure_foster_roles_from_person_cat();

\echo '   Post-VH + SL backfill:'
SELECT role, role_status, source_system, COUNT(*)
FROM sot.person_roles WHERE role = 'foster'
GROUP BY 1, 2, 3 ORDER BY 4 DESC;


-- ============================================================================
-- SECTION D: Update run_all_entity_linking() — Add Step 3e
-- ============================================================================

\echo ''
\echo '3. Updating run_all_entity_linking() with Step 3e (foster roles)...'

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
    -- Step 3c variables (FFS-978)
    v_adopters_checked INT;
    v_person_places_created INT;
    v_adopters_skipped INT;
    -- Step 3d variables (MIG_3013)
    v_sl_people_checked INT;
    v_sl_person_places_created INT;
    v_sl_people_skipped INT;
    -- Step 3e variable (MIG_3014)
    v_foster_roles_created INT;
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

    SELECT COUNT(*) INTO v_total_appointments FROM ops.appointments;
    SELECT COUNT(*) INTO v_total_cats FROM sot.cats WHERE merged_into_cat_id IS NULL;

    -- ========================================================================
    -- STEP 1: Link appointments to places (CRITICAL — abort on failure)
    -- ========================================================================
    v_current_step := 'step1_link_appointments_to_places';
    BEGIN
        SELECT COUNT(*) INTO v_count FROM sot.link_appointments_to_places();
        SELECT COUNT(*) INTO v_appointments_with_place FROM ops.appointments WHERE inferred_place_id IS NOT NULL;
        v_result := v_result || jsonb_build_object(
            'step1_coverage_pct', ROUND(100.0 * v_appointments_with_place / NULLIF(v_total_appointments, 0), 1)
        );
    EXCEPTION WHEN OTHERS THEN
        v_status := 'failed';
        v_result := v_result || jsonb_build_object(
            'step1_error', SQLERRM, 'step1_coverage_pct', 0,
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
        SELECT cats_linked INTO v_count FROM sot.link_cats_to_appointment_places();
        v_result := v_result || jsonb_build_object('step2_cats_linked', COALESCE(v_count, 0));
        IF v_count = 0 THEN
            DECLARE v_unlinkable INT;
            BEGIN
                SELECT COUNT(DISTINCT a.cat_id) INTO v_unlinkable
                FROM ops.appointments a
                WHERE a.cat_id IS NOT NULL AND a.inferred_place_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = a.cat_id);
                IF v_unlinkable > 0 THEN
                    v_warnings := array_append(v_warnings,
                        'step2 linked 0 cats but ' || v_unlinkable || ' cats with appointments have no cat_place link');
                END IF;
            END;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN v_status := 'partial_failure'; END IF;
        v_result := v_result || jsonb_build_object('step2_error', SQLERRM, 'step2_cats_linked', 0);
        v_warnings := array_append(v_warnings, 'step2 failed: ' || SQLERRM);
    END;

    -- ========================================================================
    -- STEP 3: Link cats to places via person chain (SECONDARY/FALLBACK)
    -- ========================================================================
    v_current_step := 'step3_link_cats_to_places';
    BEGIN
        SELECT cats_linked_home, cats_skipped INTO v_count, v_skipped FROM sot.link_cats_to_places();
        v_result := v_result || jsonb_build_object(
            'step3_cats_linked', COALESCE(v_count, 0), 'step3_cats_skipped', COALESCE(v_skipped, 0)
        );
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN v_status := 'partial_failure'; END IF;
        v_result := v_result || jsonb_build_object('step3_error', SQLERRM, 'step3_cats_linked', 0);
        v_warnings := array_append(v_warnings, 'step3 failed: ' || SQLERRM);
    END;

    -- ========================================================================
    -- STEP 3b (MIG_2998): Cleanup stale person-cat links
    -- ========================================================================
    v_current_step := 'step3b_cleanup_stale_person_cat';
    BEGIN
        v_stale_person_cat := sot.cleanup_stale_person_cat_links();
        v_result := v_result || jsonb_build_object('step3b_stale_person_cat_removed', COALESCE(v_stale_person_cat, 0));
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN v_status := 'partial_failure'; END IF;
        v_result := v_result || jsonb_build_object('step3b_error', SQLERRM, 'step3b_stale_person_cat_removed', 0);
        v_warnings := array_append(v_warnings, 'step3b failed: ' || SQLERRM);
    END;

    -- ========================================================================
    -- STEP 3c (MIG_3008/FFS-978): Ensure adopter person_places from ShelterLuv
    -- ========================================================================
    v_current_step := 'step3c_ensure_adopter_person_places';
    BEGIN
        SELECT eapp.adopters_checked, eapp.person_places_created, eapp.adopters_skipped
        INTO v_adopters_checked, v_person_places_created, v_adopters_skipped
        FROM sot.ensure_adopter_person_places() eapp;
        v_result := v_result || jsonb_build_object(
            'step3c_adopters_checked', COALESCE(v_adopters_checked, 0),
            'step3c_person_places_created', COALESCE(v_person_places_created, 0),
            'step3c_adopters_skipped', COALESCE(v_adopters_skipped, 0)
        );
        IF COALESCE(v_person_places_created, 0) > 0 THEN
            SELECT total_edges INTO v_count FROM sot.link_cats_to_places();
            v_result := v_result || jsonb_build_object('step3c_cats_linked_from_new_places', COALESCE(v_count, 0));
        END IF;
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN v_status := 'partial_failure'; END IF;
        v_result := v_result || jsonb_build_object(
            'step3c_error', SQLERRM, 'step3c_adopters_checked', 0,
            'step3c_person_places_created', 0, 'step3c_adopters_skipped', 0
        );
        v_warnings := array_append(v_warnings, 'step3c failed (non-fatal): ' || SQLERRM);
    END;

    -- ========================================================================
    -- STEP 3d (MIG_3013): Ensure ShelterLuv person_places (all SL people)
    -- ========================================================================
    v_current_step := 'step3d_ensure_shelterluv_person_places';
    BEGIN
        SELECT eapp.people_checked, eapp.person_places_created, eapp.people_skipped
        INTO v_sl_people_checked, v_sl_person_places_created, v_sl_people_skipped
        FROM sot.ensure_shelterluv_person_places() eapp;
        v_result := v_result || jsonb_build_object(
            'step3d_people_checked', COALESCE(v_sl_people_checked, 0),
            'step3d_person_places_created', COALESCE(v_sl_person_places_created, 0),
            'step3d_people_skipped', COALESCE(v_sl_people_skipped, 0)
        );
        IF COALESCE(v_sl_person_places_created, 0) > 0 THEN
            SELECT total_edges INTO v_count FROM sot.link_cats_to_places();
            v_result := v_result || jsonb_build_object('step3d_cats_linked_from_new_places', COALESCE(v_count, 0));
        END IF;
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN v_status := 'partial_failure'; END IF;
        v_result := v_result || jsonb_build_object(
            'step3d_error', SQLERRM, 'step3d_people_checked', 0,
            'step3d_person_places_created', 0, 'step3d_people_skipped', 0
        );
        v_warnings := array_append(v_warnings, 'step3d failed (non-fatal): ' || SQLERRM);
    END;

    -- ========================================================================
    -- STEP 3e (MIG_3014/FFS-324): Ensure foster roles from person_cat evidence
    -- ========================================================================
    v_current_step := 'step3e_ensure_foster_roles';
    BEGIN
        SELECT efrpc.roles_created INTO v_foster_roles_created
        FROM sot.ensure_foster_roles_from_person_cat() efrpc;
        v_result := v_result || jsonb_build_object(
            'step3e_foster_roles_created', COALESCE(v_foster_roles_created, 0)
        );
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN v_status := 'partial_failure'; END IF;
        v_result := v_result || jsonb_build_object('step3e_error', SQLERRM, 'step3e_foster_roles_created', 0);
        v_warnings := array_append(v_warnings, 'step3e failed (non-fatal): ' || SQLERRM);
    END;

    -- ========================================================================
    -- STEP 4: Cat-Request Attribution (place family + time window)
    -- ========================================================================
    v_current_step := 'step4_cat_request_attribution';
    BEGIN
        v_stale_removed := sot.cleanup_stale_request_cat_links();
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
        IF v_status != 'partial_failure' THEN v_status := 'partial_failure'; END IF;
        v_result := v_result || jsonb_build_object('step4_error', SQLERRM, 'step4_cats_linked_to_requests', 0);
        v_warnings := array_append(v_warnings, 'step4 failed: ' || SQLERRM);
    END;

    -- ========================================================================
    -- STEP 5: Link appointments to owners
    -- ========================================================================
    v_current_step := 'step5_link_appointments_to_owners';
    BEGIN
        SELECT appointments_updated, persons_linked INTO v_appts_updated, v_persons_linked
        FROM sot.link_appointments_to_owners();
        v_result := v_result || jsonb_build_object('step5_appointments_linked_to_owners', COALESCE(v_appts_updated, 0));
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN v_status := 'partial_failure'; END IF;
        v_result := v_result || jsonb_build_object('step5_error', SQLERRM, 'step5_appointments_linked_to_owners', 0);
        v_warnings := array_append(v_warnings, 'step5 failed: ' || SQLERRM);
    END;

    -- ========================================================================
    -- STEP 6: Link appointments to requests
    -- ========================================================================
    v_current_step := 'step6_link_appointments_to_requests';
    BEGIN
        SELECT tier1_linked, tier2_queued, tier3_queued INTO v_tier1, v_tier2, v_tier3
        FROM ops.link_appointments_to_requests();
        v_result := v_result || jsonb_build_object(
            'step6_appointments_linked_to_requests_tier1', v_tier1,
            'step6_appointments_queued_tier2', v_tier2,
            'step6_appointments_queued_tier3', v_tier3
        );
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN v_status := 'partial_failure'; END IF;
        v_result := v_result || jsonb_build_object('step6_error', SQLERRM, 'step6_appointments_linked_to_requests_tier1', 0);
        v_warnings := array_append(v_warnings, 'step6 failed: ' || SQLERRM);
    END;

    -- ========================================================================
    -- STEP 7 (MIG_2908): Queue unofficial trapper candidates
    -- ========================================================================
    v_current_step := 'step7_queue_trapper_candidates';
    BEGIN
        SELECT candidates_found, candidates_queued INTO v_candidates_found, v_candidates_queued
        FROM sot.queue_unofficial_trapper_candidates();
        v_result := v_result || jsonb_build_object(
            'step7_trapper_candidates_found', COALESCE(v_candidates_found, 0),
            'step7_trapper_candidates_queued', COALESCE(v_candidates_queued, 0)
        );
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN v_status := 'partial_failure'; END IF;
        v_result := v_result || jsonb_build_object(
            'step7_error', SQLERRM, 'step7_trapper_candidates_found', 0, 'step7_trapper_candidates_queued', 0
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

    IF array_length(v_warnings, 1) > 0 AND v_status = 'completed' THEN
        v_status := 'completed_with_warnings';
    END IF;
    v_result := v_result || jsonb_build_object('status', v_status);

    INSERT INTO ops.entity_linking_runs (result, status, warnings, completed_at)
    VALUES (v_result, v_status, v_warnings, NOW())
    RETURNING run_id INTO v_run_id;
    v_result := v_result || jsonb_build_object('run_id', v_run_id);

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- SECTION E: Verification
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Foster roles by source:'
SELECT role, role_status, source_system, COUNT(*)
FROM sot.person_roles WHERE role = 'foster'
GROUP BY 1, 2, 3 ORDER BY 4 DESC;

\echo ''
\echo 'Foster coverage:'
SELECT
  (SELECT COUNT(*) FROM sot.person_roles WHERE role = 'foster') AS total_foster_roles,
  (SELECT COUNT(DISTINCT person_id) FROM sot.person_cat WHERE relationship_type = 'foster') AS persons_with_foster_cats,
  (SELECT COUNT(DISTINCT pc.person_id)
   FROM sot.person_cat pc
   WHERE pc.relationship_type = 'foster'
     AND NOT EXISTS (SELECT 1 FROM sot.person_roles pr WHERE pr.person_id = pc.person_id AND pr.role = 'foster')
  ) AS still_missing_role;

\echo ''
\echo 'Top fosters now visible in /api/fosters:'
SELECT p.display_name, pr.source_system, pr.role_status,
  (SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.person_id = p.person_id AND pc.relationship_type = 'foster') AS cats_fostered
FROM sot.person_roles pr
JOIN sot.people p ON p.person_id = pr.person_id
WHERE pr.role = 'foster'
ORDER BY cats_fostered DESC LIMIT 10;

\echo ''
\echo '=============================================='
\echo '  MIG_3014 Complete'
\echo '=============================================='
