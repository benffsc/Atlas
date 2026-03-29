-- MIG_3013: Fix 3 Data Limitations — Colony Trends, Trapper Resolution, ShelterLuv Places
--
-- Context: FFS-989 data integrity audit found 3 structural limitations:
-- 1. Colony trends: 99.9% "insufficient_data" — simple 2-estimate comparison needs 2+ estimates
--    but most places have only 1. Replace with composite 5-signal scoring.
-- 2. Trip reports: 0% trapper_person_id (62 reports, all NULL) — staff use freeform text.
--    Backfill from request_trapper_assignments.
-- 3. ShelterLuv people: 35/3,136 adopters still missing person_place (no email match).
--    Add phone fallback + cover ALL ShelterLuv people, not just adopters.
--
-- All data needed already exists in the database. These are design gaps, not bugs.
--
-- Created: 2026-03-29

\echo ''
\echo '=============================================='
\echo '  MIG_3013: Fix Data Limitations'
\echo '=============================================='
\echo ''

-- ============================================================================
-- SECTION A: sot.ensure_shelterluv_person_places()
-- ============================================================================
-- Covers ALL ShelterLuv people (not just adopters) with phone fallback.
-- Follows exact pattern of ensure_adopter_person_places() (MIG_3008).

\echo '1. Creating sot.ensure_shelterluv_person_places()...'

CREATE OR REPLACE FUNCTION sot.ensure_shelterluv_person_places(
    p_batch_size INT DEFAULT 500
)
RETURNS TABLE(people_checked INT, person_places_created INT, people_skipped INT) AS $$
DECLARE
    v_checked INT := 0;
    v_created INT := 0;
    v_skipped INT := 0;
    v_rec RECORD;
    v_email TEXT;
    v_phone TEXT;
    v_sl_payload JSONB;
    v_address TEXT;
    v_place_id UUID;
BEGIN
    -- Process ShelterLuv people who lack person_place records
    FOR v_rec IN
        SELECT DISTINCT pi.person_id
        FROM sot.person_identifiers pi
        WHERE pi.source_system = 'shelterluv'
          AND pi.confidence >= 0.5
          -- Skip people who already have a person_place
          AND NOT EXISTS (
              SELECT 1 FROM sot.person_place pp
              WHERE pp.person_id = pi.person_id
          )
          -- Skip merged people
          AND EXISTS (
              SELECT 1 FROM sot.people p
              WHERE p.person_id = pi.person_id
                AND p.merged_into_person_id IS NULL
          )
        LIMIT p_batch_size
    LOOP
        v_checked := v_checked + 1;
        v_sl_payload := NULL;

        -- Step 1: Find high-confidence email
        SELECT pi.id_value_norm INTO v_email
        FROM sot.person_identifiers pi
        WHERE pi.person_id = v_rec.person_id
          AND pi.id_type = 'email'
          AND pi.confidence >= 0.5
        ORDER BY pi.confidence DESC
        LIMIT 1;

        -- Step 2: Match email to ShelterLuv person record
        IF v_email IS NOT NULL THEN
            SELECT sr.payload INTO v_sl_payload
            FROM source.shelterluv_raw sr
            WHERE sr.record_type = 'person'
              AND LOWER(TRIM(sr.payload->>'Email')) = v_email
            ORDER BY sr.fetched_at DESC
            LIMIT 1;
        END IF;

        -- Step 3: Phone fallback if email match failed
        IF v_sl_payload IS NULL THEN
            v_phone := sot.get_phone(v_rec.person_id);
            IF v_phone IS NOT NULL THEN
                SELECT sr.payload INTO v_sl_payload
                FROM source.shelterluv_raw sr
                WHERE sr.record_type = 'person'
                  AND sot.norm_phone_us(sr.payload->>'Phone') = v_phone
                LIMIT 1;
            END IF;
        END IF;

        IF v_sl_payload IS NULL THEN
            INSERT INTO ops.entity_linking_skipped (entity_type, entity_id, reason, created_at)
            VALUES ('person_shelterluv', v_rec.person_id, 'no_sl_person_match', NOW())
            ON CONFLICT (entity_type, entity_id, reason) DO NOTHING;
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        -- Step 4: Extract address from ShelterLuv payload
        v_address := CONCAT_WS(', ',
            NULLIF(TRIM(v_sl_payload->>'Street'), ''),
            NULLIF(TRIM(v_sl_payload->>'City'), ''),
            NULLIF(TRIM(v_sl_payload->>'State'), ''),
            NULLIF(TRIM(v_sl_payload->>'Zip'), '')
        );

        IF v_address IS NULL OR LENGTH(TRIM(v_address)) < 5 THEN
            INSERT INTO ops.entity_linking_skipped (entity_type, entity_id, reason, created_at)
            VALUES ('person_shelterluv', v_rec.person_id, 'no_sl_address', NOW())
            ON CONFLICT (entity_type, entity_id, reason) DO NOTHING;
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        -- Step 5: Find or create place
        BEGIN
            v_place_id := sot.find_or_create_place_deduped(
                p_formatted_address := v_address,
                p_display_name      := NULL,
                p_lat               := NULL,
                p_lng               := NULL,
                p_source_system     := 'shelterluv'
            );
        EXCEPTION WHEN OTHERS THEN
            INSERT INTO ops.entity_linking_skipped (entity_type, entity_id, reason, created_at)
            VALUES ('person_shelterluv', v_rec.person_id, 'place_creation_failed', NOW())
            ON CONFLICT (entity_type, entity_id, reason) DO NOTHING;
            v_skipped := v_skipped + 1;
            CONTINUE;
        END;

        IF v_place_id IS NULL THEN
            INSERT INTO ops.entity_linking_skipped (entity_type, entity_id, reason, created_at)
            VALUES ('person_shelterluv', v_rec.person_id, 'place_creation_returned_null', NOW())
            ON CONFLICT (entity_type, entity_id, reason) DO NOTHING;
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        -- Step 6: Create person_place record
        INSERT INTO sot.person_place (
            person_id, place_id, relationship_type, evidence_type,
            confidence, source_system, source_table
        ) VALUES (
            v_rec.person_id, v_place_id, 'resident', 'imported',
            0.7, 'shelterluv', 'ensure_shelterluv_person_places'
        )
        ON CONFLICT (person_id, place_id, relationship_type) DO NOTHING;

        IF FOUND THEN
            v_created := v_created + 1;
        END IF;
    END LOOP;

    people_checked := v_checked;
    person_places_created := v_created;
    people_skipped := v_skipped;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.ensure_shelterluv_person_places IS
'Fills person_place gaps for ALL ShelterLuv people who lack address records.
Matches by email first, then phone fallback. Extracts address from
source.shelterluv_raw person records. MIG_3013.';


-- ============================================================================
-- SECTION B: Update ensure_adopter_person_places() with phone fallback
-- ============================================================================

\echo '2. Updating ensure_adopter_person_places() with phone fallback...'

CREATE OR REPLACE FUNCTION sot.ensure_adopter_person_places()
RETURNS TABLE(adopters_checked INT, person_places_created INT, adopters_skipped INT) AS $$
DECLARE
    v_checked INT := 0;
    v_created INT := 0;
    v_skipped INT := 0;
    v_rec RECORD;
    v_email TEXT;
    v_phone TEXT;
    v_sl_payload JSONB;
    v_address TEXT;
    v_place_id UUID;
BEGIN
    -- Process each adopter who has a resolved person_id but no person_place record
    FOR v_rec IN
        SELECT DISTINCT ac.adopter_person_id
        FROM sot.v_adoption_context ac
        WHERE ac.adopter_person_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM sot.person_place pp
              WHERE pp.person_id = ac.adopter_person_id
          )
    LOOP
        v_checked := v_checked + 1;
        v_sl_payload := NULL;

        -- Step 1: Find adopter's high-confidence email
        SELECT pi.id_value_norm INTO v_email
        FROM sot.person_identifiers pi
        WHERE pi.person_id = v_rec.adopter_person_id
          AND pi.id_type = 'email'
          AND pi.confidence >= 0.5
        ORDER BY pi.confidence DESC
        LIMIT 1;

        -- Step 2: Match email to ShelterLuv person record
        IF v_email IS NOT NULL THEN
            SELECT sr.payload INTO v_sl_payload
            FROM source.shelterluv_raw sr
            WHERE sr.record_type = 'person'
              AND LOWER(TRIM(sr.payload->>'Email')) = v_email
            ORDER BY sr.fetched_at DESC
            LIMIT 1;
        END IF;

        -- Step 2b: Phone fallback if email match failed (MIG_3013)
        IF v_sl_payload IS NULL THEN
            v_phone := sot.get_phone(v_rec.adopter_person_id);
            IF v_phone IS NOT NULL THEN
                SELECT sr.payload INTO v_sl_payload
                FROM source.shelterluv_raw sr
                WHERE sr.record_type = 'person'
                  AND sot.norm_phone_us(sr.payload->>'Phone') = v_phone
                LIMIT 1;
            END IF;
        END IF;

        IF v_sl_payload IS NULL THEN
            -- Log skip: no email or phone match in ShelterLuv
            INSERT INTO ops.entity_linking_skipped (entity_type, entity_id, reason, created_at)
            VALUES ('adopter', v_rec.adopter_person_id, 'adopter_no_email_or_phone_match', NOW())
            ON CONFLICT (entity_type, entity_id, reason) DO NOTHING;
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        -- Step 3: Extract address from ShelterLuv payload
        v_address := CONCAT_WS(', ',
            NULLIF(TRIM(v_sl_payload->>'Street'), ''),
            NULLIF(TRIM(v_sl_payload->>'City'), ''),
            NULLIF(TRIM(v_sl_payload->>'State'), ''),
            NULLIF(TRIM(v_sl_payload->>'Zip'), '')
        );

        IF v_address IS NULL OR LENGTH(TRIM(v_address)) < 5 THEN
            INSERT INTO ops.entity_linking_skipped (entity_type, entity_id, reason, created_at)
            VALUES ('adopter', v_rec.adopter_person_id, 'adopter_no_sl_address', NOW())
            ON CONFLICT (entity_type, entity_id, reason) DO NOTHING;
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        -- Step 4: Find or create the place
        BEGIN
            v_place_id := sot.find_or_create_place_deduped(
                p_formatted_address := v_address,
                p_display_name      := NULL,
                p_lat               := NULL,
                p_lng               := NULL,
                p_source_system     := 'shelterluv'
            );
        EXCEPTION WHEN OTHERS THEN
            INSERT INTO ops.entity_linking_skipped (entity_type, entity_id, reason, created_at)
            VALUES ('adopter', v_rec.adopter_person_id, 'adopter_place_creation_failed', NOW())
            ON CONFLICT (entity_type, entity_id, reason) DO NOTHING;
            v_skipped := v_skipped + 1;
            CONTINUE;
        END;

        IF v_place_id IS NULL THEN
            INSERT INTO ops.entity_linking_skipped (entity_type, entity_id, reason, created_at)
            VALUES ('adopter', v_rec.adopter_person_id, 'adopter_place_creation_returned_null', NOW())
            ON CONFLICT (entity_type, entity_id, reason) DO NOTHING;
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        -- Step 5: Create person_place record
        INSERT INTO sot.person_place (
            person_id, place_id, relationship_type, evidence_type,
            confidence, source_system, source_table
        ) VALUES (
            v_rec.adopter_person_id, v_place_id, 'resident', 'imported',
            0.75, 'shelterluv', 'ensure_adopter_person_places'
        )
        ON CONFLICT (person_id, place_id, relationship_type) DO NOTHING;

        IF FOUND THEN
            v_created := v_created + 1;
        END IF;
    END LOOP;

    adopters_checked := v_checked;
    person_places_created := v_created;
    adopters_skipped := v_skipped;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.ensure_adopter_person_places IS
'Fills person_place gap for ShelterLuv adopters who lack address records.
Matches by email first, then phone fallback (MIG_3013). Extracts address from
source.shelterluv_raw person records. FFS-978, MIG_3008.';


-- ============================================================================
-- SECTION C: Run backfills
-- ============================================================================

\echo ''
\echo '3. Running backfills...'

-- C1: Adopter phone fallback backfill (picks up the ~35 adopters missed by email-only)
\echo '   Running adopter backfill (with phone fallback)...'
SELECT * FROM sot.ensure_adopter_person_places();

-- C2: ShelterLuv general backfill (all ShelterLuv people without person_place)
\echo '   Running ShelterLuv person_place backfill...'
SELECT * FROM sot.ensure_shelterluv_person_places();

-- Re-run cat-place linking to propagate new person_places
\echo '   Re-running cat-place linking...'
SELECT * FROM sot.link_cats_to_places();

-- C3: Trip report trapper backfill from request assignments
\echo '   Backfilling trip report trapper_person_id from assignments...'

UPDATE ops.trapper_trip_reports tr
SET trapper_person_id = rta.trapper_person_id
FROM ops.request_trapper_assignments rta
WHERE rta.request_id = tr.request_id
  AND rta.assignment_type = 'primary'
  AND rta.status IN ('active', 'accepted')
  AND tr.trapper_person_id IS NULL;

\echo '   Trip report trapper backfill complete'


-- ============================================================================
-- SECTION D: Update run_all_entity_linking() — Add Step 3d
-- ============================================================================

\echo ''
\echo '4. Updating run_all_entity_linking() with Step 3d...'

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
    -- STEP 3b (MIG_2998): Cleanup stale person-cat links
    -- ========================================================================
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
            v_result := v_result || jsonb_build_object(
                'step3c_cats_linked_from_new_places', COALESCE(v_count, 0)
            );
        END IF;
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN
            v_status := 'partial_failure';
        END IF;
        v_result := v_result || jsonb_build_object(
            'step3c_error', SQLERRM,
            'step3c_adopters_checked', 0,
            'step3c_person_places_created', 0,
            'step3c_adopters_skipped', 0
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

        -- Re-run Step 3 if new person_places were created
        IF COALESCE(v_sl_person_places_created, 0) > 0 THEN
            SELECT total_edges INTO v_count FROM sot.link_cats_to_places();
            v_result := v_result || jsonb_build_object(
                'step3d_cats_linked_from_new_places', COALESCE(v_count, 0)
            );
        END IF;
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN
            v_status := 'partial_failure';
        END IF;
        v_result := v_result || jsonb_build_object(
            'step3d_error', SQLERRM,
            'step3d_people_checked', 0,
            'step3d_person_places_created', 0,
            'step3d_people_skipped', 0
        );
        v_warnings := array_append(v_warnings, 'step3d failed (non-fatal): ' || SQLERRM);
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
-- SECTION E: Rebuild matview with composite colony trends
-- ============================================================================
-- Replaces simple 2-estimate comparison (99.9% insufficient_data) with
-- 5-signal composite scoring: new-cat arrivals, alteration proportion,
-- appointment frequency, inter-arrival intervals, breeding presence.

\echo ''
\echo '5. Rebuilding matview with composite colony trends...'

DROP VIEW IF EXISTS ops.v_beacon_place_metrics CASCADE;
DROP MATERIALIZED VIEW IF EXISTS ops.mv_beacon_place_metrics CASCADE;

CREATE MATERIALIZED VIEW ops.mv_beacon_place_metrics AS
WITH place_cats AS (
    SELECT
        cp.place_id,
        COUNT(DISTINCT cp.cat_id) AS total_cats,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
        ) AS altered_cats,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IS NOT NULL
        ) AS known_status_cats,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IS NULL
        ) AS unknown_status_cats
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    GROUP BY cp.place_id
),
place_people AS (
    SELECT
        pp.place_id,
        COUNT(DISTINCT pp.person_id) AS total_people
    FROM sot.person_place pp
    GROUP BY pp.place_id
),
place_requests AS (
    SELECT
        r.place_id,
        COUNT(*) AS total_requests,
        COUNT(*) FILTER (
            WHERE r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
        ) AS active_requests
    FROM ops.requests r
    WHERE r.place_id IS NOT NULL
    GROUP BY r.place_id
),
place_appointments AS (
    SELECT
        place_id,
        COUNT(*) AS total_appointments,
        MAX(appointment_date) AS last_appointment_date
    FROM (
        SELECT place_id, appointment_id, appointment_date FROM ops.appointments WHERE place_id IS NOT NULL
        UNION
        SELECT inferred_place_id AS place_id, appointment_id, appointment_date FROM ops.appointments WHERE inferred_place_id IS NOT NULL
    ) combined
    GROUP BY place_id
),
latest_colony_estimates AS (
    SELECT DISTINCT ON (place_id)
        place_id,
        total_count_observed AS colony_estimate,
        estimate_method
    FROM sot.place_colony_estimates
    ORDER BY place_id, observed_date DESC NULLS LAST, created_at DESC
),
place_breeding AS (
    SELECT
        COALESCE(a.inferred_place_id, a.place_id) AS place_id,
        (COUNT(*) FILTER (WHERE (a.is_pregnant OR a.is_lactating)
            AND a.appointment_date >= CURRENT_DATE - INTERVAL '180 days') > 0) AS has_recent_breeding,
        MAX(a.appointment_date) FILTER (WHERE a.is_pregnant OR a.is_lactating) AS last_breeding_detected
    FROM ops.appointments a
    WHERE COALESCE(a.inferred_place_id, a.place_id) IS NOT NULL
      AND a.cat_id IS NOT NULL
    GROUP BY COALESCE(a.inferred_place_id, a.place_id)
),
-- =========================================================================
-- Composite colony trend signals (MIG_3013)
-- Replaces simple 2-estimate comparison with 5 operational signals
-- =========================================================================
-- Signal 1: New-cat arrival rate (last 6mo vs prior 6mo)
new_cat_signal AS (
    SELECT place_id,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '180 days') AS recent_new,
        COUNT(*) FILTER (WHERE created_at < CURRENT_DATE - INTERVAL '180 days'
                           AND created_at >= CURRENT_DATE - INTERVAL '360 days') AS prior_new
    FROM sot.cat_place
    GROUP BY place_id
),
-- Signal 2: Alteration proportion change (last 6mo vs prior 6mo)
alt_signal AS (
    SELECT cp.place_id,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IN ('spayed','neutered','altered')
              AND cp.created_at >= CURRENT_DATE - INTERVAL '180 days'
        ) AS recent_altered,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE cp.created_at >= CURRENT_DATE - INTERVAL '180 days'
        ) AS recent_total,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IN ('spayed','neutered','altered')
              AND cp.created_at < CURRENT_DATE - INTERVAL '180 days'
              AND cp.created_at >= CURRENT_DATE - INTERVAL '360 days'
        ) AS prior_altered,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE cp.created_at < CURRENT_DATE - INTERVAL '180 days'
              AND cp.created_at >= CURRENT_DATE - INTERVAL '360 days'
        ) AS prior_total
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    GROUP BY cp.place_id
),
-- Signal 3: Appointment frequency (last 6mo vs prior 6mo)
appt_signal AS (
    SELECT COALESCE(inferred_place_id, place_id) AS place_id,
        COUNT(*) FILTER (WHERE appointment_date >= CURRENT_DATE - INTERVAL '180 days') AS recent_appts,
        COUNT(*) FILTER (WHERE appointment_date < CURRENT_DATE - INTERVAL '180 days'
                           AND appointment_date >= CURRENT_DATE - INTERVAL '360 days') AS prior_appts
    FROM ops.appointments
    WHERE COALESCE(inferred_place_id, place_id) IS NOT NULL
    GROUP BY COALESCE(inferred_place_id, place_id)
),
-- Signal 4: Inter-arrival interval (avg days between new cats, last 12mo)
interval_signal AS (
    SELECT place_id,
        CASE WHEN COUNT(*) >= 3 THEN
            AVG(days_gap)
        ELSE NULL END AS avg_arrival_interval_days
    FROM (
        SELECT place_id, created_at,
            EXTRACT(DAY FROM created_at - LAG(created_at) OVER (PARTITION BY place_id ORDER BY created_at)) AS days_gap
        FROM sot.cat_place
        WHERE created_at >= CURRENT_DATE - INTERVAL '365 days'
    ) gaps
    WHERE days_gap IS NOT NULL
    GROUP BY place_id
),
-- Signal 5: Breeding presence (last 12mo — longer window than place_breeding's 6mo)
breeding_trend_signal AS (
    SELECT COALESCE(inferred_place_id, place_id) AS place_id,
        TRUE AS has_breeding_12mo
    FROM ops.appointments
    WHERE (is_pregnant = TRUE OR is_lactating = TRUE)
      AND appointment_date >= CURRENT_DATE - INTERVAL '365 days'
      AND COALESCE(inferred_place_id, place_id) IS NOT NULL
    GROUP BY COALESCE(inferred_place_id, place_id)
),
-- Combine 5 signals into composite colony trend score
colony_trends AS (
    SELECT place_id,
        CASE
            WHEN total_cats < 3 THEN 'insufficient_data'
            WHEN composite_score >= 3 THEN 'growing'
            WHEN composite_score <= -3 THEN 'shrinking'
            ELSE 'stable'
        END AS colony_trend,
        composite_score
    FROM (
        SELECT pc.place_id, pc.total_cats,
            COALESCE(
                -- New-cat signal: +2 growing if recent > prior*1.3, -2 if declining
                CASE
                    WHEN ncs.prior_new > 0 AND ncs.recent_new > ncs.prior_new * 1.3 THEN 2
                    WHEN ncs.prior_new > 0 AND ncs.recent_new < ncs.prior_new * 0.7 THEN -2
                    ELSE 0
                END, 0) +
            COALESCE(
                -- Alteration proportion: +2 growing if dropping, -2 if rising (more fixed = stabilizing)
                CASE
                    WHEN als.recent_total >= 3 AND als.prior_total >= 3
                        AND (als.recent_altered::numeric / als.recent_total) < (als.prior_altered::numeric / als.prior_total) - 0.1
                    THEN 2
                    WHEN als.recent_total >= 3 AND als.prior_total >= 3
                        AND (als.recent_altered::numeric / als.recent_total) > (als.prior_altered::numeric / als.prior_total) + 0.1
                    THEN -2
                    ELSE 0
                END, 0) +
            COALESCE(
                -- Appointment frequency: +1 if spike, -1 if declining
                CASE
                    WHEN aps.prior_appts > 2 AND aps.recent_appts > aps.prior_appts * 1.5 THEN 1
                    WHEN aps.prior_appts > 2 AND aps.recent_appts < aps.prior_appts * 0.5 THEN -1
                    ELSE 0
                END, 0) +
            COALESCE(
                -- Inter-arrival: +1 if intervals shortening (<30d avg), -1 if lengthening (>90d)
                CASE
                    WHEN isig.avg_arrival_interval_days IS NOT NULL AND isig.avg_arrival_interval_days < 30 THEN 1
                    WHEN isig.avg_arrival_interval_days IS NOT NULL AND isig.avg_arrival_interval_days > 90 THEN -1
                    ELSE 0
                END, 0) +
            COALESCE(
                -- Breeding: +3 growing if any breeding detected in last 12mo
                CASE WHEN bs.has_breeding_12mo THEN 3 ELSE 0 END, 0)
            AS composite_score
        FROM place_cats pc
        LEFT JOIN new_cat_signal ncs ON ncs.place_id = pc.place_id
        LEFT JOIN alt_signal als ON als.place_id = pc.place_id
        LEFT JOIN appt_signal aps ON aps.place_id = pc.place_id
        LEFT JOIN interval_signal isig ON isig.place_id = pc.place_id
        LEFT JOIN breeding_trend_signal bs ON bs.place_id = pc.place_id
    ) scored
),
immigration AS (
    SELECT cp.place_id,
        COUNT(DISTINCT cp.cat_id) AS new_intact_count,
        MAX(cp.created_at) AS last_new_arrival
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    WHERE cp.created_at >= CURRENT_DATE - INTERVAL '180 days'
      AND c.altered_status NOT IN ('spayed', 'neutered', 'altered')
    GROUP BY cp.place_id
)
SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    p.place_kind,
    ST_Y(p.location::geometry) AS latitude,
    ST_X(p.location::geometry) AS longitude,
    COALESCE(pc.total_cats, 0)::INTEGER AS total_cats,
    COALESCE(pc.altered_cats, 0)::INTEGER AS altered_cats,
    COALESCE(pc.known_status_cats, 0)::INTEGER AS known_status_cats,
    COALESCE(pc.unknown_status_cats, 0)::INTEGER AS unknown_status_cats,
    CASE
        WHEN COALESCE(pc.known_status_cats, 0) > 0
        THEN ROUND(COALESCE(pc.altered_cats, 0)::numeric / pc.known_status_cats * 100, 1)
        ELSE NULL
    END AS alteration_rate_pct,
    COALESCE(pp.total_people, 0)::INTEGER AS total_people,
    COALESCE(pr.total_requests, 0)::INTEGER AS total_requests,
    COALESCE(pr.active_requests, 0)::INTEGER AS active_requests,
    COALESCE(pa.total_appointments, 0)::INTEGER AS total_appointments,
    pa.last_appointment_date,
    lce.colony_estimate,
    lce.estimate_method,
    GREATEST(
        p.updated_at,
        pa.last_appointment_date::timestamptz
    ) AS last_activity_at,
    NULL::TEXT AS zone_code,
    COALESCE(pb.has_recent_breeding, FALSE) AS has_recent_breeding,
    pb.last_breeding_detected::DATE AS last_breeding_detected,
    COALESCE(ct.colony_trend, 'insufficient_data') AS colony_trend,
    ct.composite_score AS colony_trend_score,
    COALESCE(im.new_intact_count, 0)::INTEGER AS new_intact_arrivals,
    CASE
        WHEN COALESCE(
            CASE WHEN COALESCE(pc.known_status_cats, 0) > 0
                 THEN ROUND(COALESCE(pc.altered_cats, 0)::numeric / pc.known_status_cats * 100, 1)
                 ELSE NULL END, 0) >= 50
             AND COALESCE(pc.total_cats, 0) >= 3
             AND COALESCE(im.new_intact_count, 0) >= 3 THEN 'high'
        WHEN COALESCE(
            CASE WHEN COALESCE(pc.known_status_cats, 0) > 0
                 THEN ROUND(COALESCE(pc.altered_cats, 0)::numeric / pc.known_status_cats * 100, 1)
                 ELSE NULL END, 0) >= 50
             AND COALESCE(im.new_intact_count, 0) >= 1 THEN 'moderate'
        ELSE 'none'
    END AS immigration_pressure
FROM sot.places p
LEFT JOIN place_cats pc ON pc.place_id = p.place_id
LEFT JOIN place_people pp ON pp.place_id = p.place_id
LEFT JOIN place_requests pr ON pr.place_id = p.place_id
LEFT JOIN place_appointments pa ON pa.place_id = p.place_id
LEFT JOIN latest_colony_estimates lce ON lce.place_id = p.place_id
LEFT JOIN place_breeding pb ON pb.place_id = p.place_id
LEFT JOIN colony_trends ct ON ct.place_id = p.place_id
LEFT JOIN immigration im ON im.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL;

-- Recreate all indexes
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_place_id
    ON ops.mv_beacon_place_metrics(place_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_place_id_unique
    ON ops.mv_beacon_place_metrics(place_id);
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_total_cats
    ON ops.mv_beacon_place_metrics(total_cats DESC);
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_coords
    ON ops.mv_beacon_place_metrics(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_alteration
    ON ops.mv_beacon_place_metrics(alteration_rate_pct);
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_breeding
    ON ops.mv_beacon_place_metrics(has_recent_breeding) WHERE has_recent_breeding = TRUE;
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_trend
    ON ops.mv_beacon_place_metrics(colony_trend);
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_immigration
    ON ops.mv_beacon_place_metrics(immigration_pressure) WHERE immigration_pressure != 'none';

COMMENT ON MATERIALIZED VIEW ops.mv_beacon_place_metrics IS
'MIG_3013: Per-place beacon metrics with composite colony trends.
5-signal scoring: new-cat arrivals, alteration proportion, appointment frequency,
inter-arrival intervals, breeding presence. Replaces simple 2-estimate comparison.
Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY ops.mv_beacon_place_metrics;';

CREATE VIEW ops.v_beacon_place_metrics AS
SELECT * FROM ops.mv_beacon_place_metrics;

COMMENT ON VIEW ops.v_beacon_place_metrics IS
'API-compatible view wrapping mv_beacon_place_metrics materialized view';

\echo '   Rebuilt matview with composite colony trends'


-- ============================================================================
-- SECTION F: Update compute_place_readiness() — read trend from matview
-- ============================================================================
-- Instead of computing colony_trend inline from place_colony_estimates (which
-- required 2+ estimates), read the composite trend from the matview directly.

\echo ''
\echo '6. Updating compute_place_readiness() to use composite colony trend...'

CREATE OR REPLACE FUNCTION ops.compute_place_readiness(p_place_id UUID)
RETURNS TABLE(
  readiness_score INT,
  readiness_label TEXT,
  dimension_scores JSONB
) AS $$
DECLARE
  v_alteration_rate NUMERIC;
  v_has_breeding BOOLEAN;
  v_colony_trend TEXT;
  v_last_activity TIMESTAMPTZ;
  v_days_since_activity INT;
  v_alt_score INT;
  v_breeding_score INT;
  v_stability_score INT;
  v_recency_score INT;
  v_total INT;
  v_label TEXT;
  v_threshold_complete INT;
  v_threshold_nearly INT;
  v_threshold_progress INT;
BEGIN
  SELECT COALESCE(value::INT, 80) INTO v_threshold_complete
    FROM ops.app_config WHERE key = 'beacon.readiness_complete_threshold';
  IF v_threshold_complete IS NULL THEN v_threshold_complete := 80; END IF;

  SELECT COALESCE(value::INT, 60) INTO v_threshold_nearly
    FROM ops.app_config WHERE key = 'beacon.readiness_nearly_complete_threshold';
  IF v_threshold_nearly IS NULL THEN v_threshold_nearly := 60; END IF;

  SELECT COALESCE(value::INT, 30) INTO v_threshold_progress
    FROM ops.app_config WHERE key = 'beacon.readiness_in_progress_threshold';
  IF v_threshold_progress IS NULL THEN v_threshold_progress := 30; END IF;

  -- MIG_3013: Read alteration, activity, AND colony_trend from matview
  -- (colony_trend is now composite 5-signal score, not simple 2-estimate comparison)
  SELECT alteration_rate_pct, last_activity_at, colony_trend
    INTO v_alteration_rate, v_last_activity, v_colony_trend
    FROM ops.mv_beacon_place_metrics
    WHERE place_id = p_place_id;

  IF v_colony_trend IS NULL THEN v_colony_trend := 'insufficient_data'; END IF;

  SELECT COALESCE(has_recent_breeding, FALSE)
    INTO v_has_breeding
    FROM ops.v_place_breeding_activity
    WHERE place_id = p_place_id;
  IF v_has_breeding IS NULL THEN v_has_breeding := FALSE; END IF;

  v_alt_score := CASE
    WHEN v_alteration_rate IS NULL THEN 0
    WHEN v_alteration_rate >= 90 THEN 25
    WHEN v_alteration_rate >= 75 THEN 20
    WHEN v_alteration_rate >= 50 THEN 15
    WHEN v_alteration_rate >= 25 THEN 10
    ELSE 5
  END;

  v_breeding_score := CASE WHEN v_has_breeding THEN 0 ELSE 25 END;

  v_stability_score := CASE
    WHEN v_colony_trend = 'stable' THEN 25
    WHEN v_colony_trend = 'shrinking' THEN 20
    WHEN v_colony_trend = 'insufficient_data' THEN 10
    WHEN v_colony_trend = 'growing' THEN 5
    ELSE 10
  END;

  v_days_since_activity := EXTRACT(DAY FROM NOW() - v_last_activity)::INT;
  v_recency_score := CASE
    WHEN v_days_since_activity IS NULL THEN 0
    WHEN v_days_since_activity <= 30 THEN 25
    WHEN v_days_since_activity <= 90 THEN 20
    WHEN v_days_since_activity <= 180 THEN 15
    WHEN v_days_since_activity <= 365 THEN 10
    ELSE 5
  END;

  v_total := v_alt_score + v_breeding_score + v_stability_score + v_recency_score;

  v_label := CASE
    WHEN v_total >= v_threshold_complete THEN 'complete'
    WHEN v_total >= v_threshold_nearly THEN 'nearly_complete'
    WHEN v_total >= v_threshold_progress THEN 'in_progress'
    ELSE 'needs_work'
  END;

  RETURN QUERY SELECT
    v_total,
    v_label,
    jsonb_build_object(
      'alteration', jsonb_build_object('score', v_alt_score, 'max', 25, 'rate_pct', v_alteration_rate),
      'breeding_absence', jsonb_build_object('score', v_breeding_score, 'max', 25, 'has_recent_breeding', v_has_breeding),
      'stability', jsonb_build_object('score', v_stability_score, 'max', 25, 'trend', v_colony_trend),
      'recency', jsonb_build_object('score', v_recency_score, 'max', 25, 'days_since_activity', v_days_since_activity)
    );
END;
$$ LANGUAGE plpgsql STABLE;

\echo '   Updated compute_place_readiness() to use composite colony trend'


-- ============================================================================
-- SECTION G: Verification
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

-- Colony trend distribution (should have fewer 'insufficient_data' vs MIG_3012)
\echo ''
\echo 'Colony trend distribution (places with cats):'
SELECT colony_trend, COUNT(*) FROM ops.mv_beacon_place_metrics
WHERE total_cats > 0 GROUP BY colony_trend ORDER BY COUNT(*) DESC;

\echo ''
\echo 'Colony trend score distribution:'
SELECT
  CASE
    WHEN colony_trend_score IS NULL THEN 'no_score'
    WHEN colony_trend_score <= -3 THEN 'strong_shrink'
    WHEN colony_trend_score < 0 THEN 'mild_shrink'
    WHEN colony_trend_score = 0 THEN 'neutral'
    WHEN colony_trend_score < 3 THEN 'mild_growth'
    ELSE 'strong_growth'
  END AS score_bucket,
  COUNT(*)
FROM ops.mv_beacon_place_metrics
WHERE total_cats >= 3
GROUP BY 1 ORDER BY 2 DESC;

-- Trip report trapper coverage (should be > 0%)
\echo ''
\echo 'Trip report trapper resolution:'
SELECT
  COUNT(trapper_person_id) AS resolved,
  COUNT(*) AS total,
  ROUND(100.0 * COUNT(trapper_person_id) / NULLIF(COUNT(*), 0), 1) AS pct
FROM ops.trapper_trip_reports;

-- ShelterLuv person_place coverage
\echo ''
\echo 'ShelterLuv person_place records:'
SELECT COUNT(*) AS sl_people_with_place
FROM sot.person_place
WHERE source_system = 'shelterluv';

-- Adopter coverage (should be higher than before phone fallback)
\echo ''
\echo 'Adopter person_place coverage:'
SELECT
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM sot.person_place pp WHERE pp.person_id = ac.adopter_person_id
  )) AS with_place,
  COUNT(*) AS total
FROM sot.v_adoption_context ac
WHERE adopter_person_id IS NOT NULL;

-- Skip reasons breakdown
\echo ''
\echo 'ShelterLuv skip reasons:'
SELECT reason, COUNT(*) FROM ops.entity_linking_skipped
WHERE entity_type = 'person_shelterluv' GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '=============================================='
\echo '  MIG_3013 Complete'
\echo '=============================================='
