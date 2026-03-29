-- MIG_3008: Link Adopted Cats to Adopter Addresses (FFS-978)
--
-- Problem: MIG_3005 created 3,132 person_cat adopter links from ShelterLuv adoption events.
-- The entity linking pipeline's Step 3 (link_cats_to_places()) already maps adopter -> home
-- via the person->place chain, but only when the adopter has a person_place record.
-- Many ShelterLuv adopters lack person_place records because not all went through the
-- place-creation pipeline. Result: adopted cats don't appear on the map.
--
-- Solution: Fill the person_place gap for adopters from ShelterLuv raw data, so the
-- existing Step 3 logic can create cat->place links automatically.
--
-- Approach: NOT a new cat_place linking function. Just ensure adopters have person_place
-- records. Then Step 3 handles the rest.

-- ============================================================================
-- SECTION A: Create sot.ensure_adopter_person_places()
-- ============================================================================

CREATE OR REPLACE FUNCTION sot.ensure_adopter_person_places()
RETURNS TABLE(adopters_checked INT, person_places_created INT, adopters_skipped INT) AS $$
DECLARE
    v_checked INT := 0;
    v_created INT := 0;
    v_skipped INT := 0;
    v_rec RECORD;
    v_email TEXT;
    v_sl_payload JSONB;
    v_address TEXT;
    v_place_id UUID;
BEGIN
    -- Process each adopter who has a resolved person_id but no person_place record
    FOR v_rec IN
        SELECT DISTINCT ac.adopter_person_id
        FROM sot.v_adoption_context ac
        WHERE ac.adopter_person_id IS NOT NULL
          -- Skip adopters who already have a person_place
          AND NOT EXISTS (
              SELECT 1 FROM sot.person_place pp
              WHERE pp.person_id = ac.adopter_person_id
          )
    LOOP
        v_checked := v_checked + 1;

        -- Step 1: Find adopter's high-confidence email
        SELECT pi.id_value_norm INTO v_email
        FROM sot.person_identifiers pi
        WHERE pi.person_id = v_rec.adopter_person_id
          AND pi.id_type = 'email'
          AND pi.confidence >= 0.5
        ORDER BY pi.confidence DESC
        LIMIT 1;

        IF v_email IS NULL THEN
            -- Log skip: no email to match against ShelterLuv
            INSERT INTO ops.entity_linking_skipped (entity_type, entity_id, reason, created_at)
            VALUES ('adopter', v_rec.adopter_person_id, 'adopter_no_email', NOW())
            ON CONFLICT (entity_type, entity_id, reason) DO NOTHING;
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        -- Step 2: Find their ShelterLuv person record by email match
        SELECT sr.payload INTO v_sl_payload
        FROM source.shelterluv_raw sr
        WHERE sr.record_type = 'person'
          AND LOWER(TRIM(sr.payload->>'Email')) = v_email
        ORDER BY sr.fetched_at DESC
        LIMIT 1;

        IF v_sl_payload IS NULL THEN
            -- Log skip: email not found in ShelterLuv raw data
            INSERT INTO ops.entity_linking_skipped (entity_type, entity_id, reason, created_at)
            VALUES ('adopter', v_rec.adopter_person_id, 'adopter_no_sl_person_record', NOW())
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

        -- Skip garbage/empty addresses
        IF v_address IS NULL OR LENGTH(TRIM(v_address)) < 5 THEN
            INSERT INTO ops.entity_linking_skipped (entity_type, entity_id, reason, created_at)
            VALUES ('adopter', v_rec.adopter_person_id, 'adopter_no_sl_address', NOW())
            ON CONFLICT (entity_type, entity_id, reason) DO NOTHING;
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        -- Step 4: Find or create the place (uses centralized dedup function)
        BEGIN
            v_place_id := sot.find_or_create_place_deduped(
                p_formatted_address := v_address,
                p_display_name      := NULL,
                p_lat               := NULL,
                p_lng               := NULL,
                p_source_system     := 'shelterluv'
            );
        EXCEPTION WHEN OTHERS THEN
            -- Place creation failed (bad address format, etc.) — skip
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
            person_id,
            place_id,
            relationship_type,
            evidence_type,
            confidence,
            source_system,
            source_table
        ) VALUES (
            v_rec.adopter_person_id,
            v_place_id,
            'resident',
            'imported',
            0.75,
            'shelterluv',
            'ensure_adopter_person_places'
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
Matches adopter email to source.shelterluv_raw person records, extracts address,
creates person_place via find_or_create_place_deduped(). Step 3 then handles
cat->place linking automatically. FFS-978, MIG_3008.';


-- ============================================================================
-- SECTION B: Backfill Run
-- ============================================================================

-- Pre-backfill baseline
DO $$
DECLARE
    v_total INT;
    v_with_place INT;
BEGIN
    SELECT COUNT(DISTINCT ac.adopter_person_id),
           COUNT(DISTINCT ac.adopter_person_id) FILTER (WHERE EXISTS (
               SELECT 1 FROM sot.person_place pp WHERE pp.person_id = ac.adopter_person_id
           ))
    INTO v_total, v_with_place
    FROM sot.v_adoption_context ac
    WHERE ac.adopter_person_id IS NOT NULL;

    RAISE NOTICE 'PRE-BACKFILL: % total adopters, % with person_place (%.1f%%)',
        v_total, v_with_place,
        CASE WHEN v_total > 0 THEN 100.0 * v_with_place / v_total ELSE 0 END;
END $$;

-- Run the backfill
SELECT * FROM sot.ensure_adopter_person_places();

-- Re-run Step 3 to pick up newly addressable adopters
SELECT * FROM sot.link_cats_to_places();

-- Post-backfill check
DO $$
DECLARE
    v_total INT;
    v_with_place INT;
BEGIN
    SELECT COUNT(DISTINCT ac.adopter_person_id),
           COUNT(DISTINCT ac.adopter_person_id) FILTER (WHERE EXISTS (
               SELECT 1 FROM sot.person_place pp WHERE pp.person_id = ac.adopter_person_id
           ))
    INTO v_total, v_with_place
    FROM sot.v_adoption_context ac
    WHERE ac.adopter_person_id IS NOT NULL;

    RAISE NOTICE 'POST-BACKFILL: % total adopters, % with person_place (%.1f%%)',
        v_total, v_with_place,
        CASE WHEN v_total > 0 THEN 100.0 * v_with_place / v_total ELSE 0 END;
END $$;


-- ============================================================================
-- SECTION C: Update sot.run_all_entity_linking() — Add Step 3c
-- ============================================================================
-- Note: Step 3b is already taken by "cleanup stale person-cat links" (MIG_2998).
-- We add Step 3c for adopter person_places, between 3b and Step 4.

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
    -- Creates person_place records for adopters who lack them, using address
    -- data from source.shelterluv_raw. Then re-runs Step 3 to link their cats.
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

        -- If we created new person_places, re-run Step 3 to link cats
        IF COALESCE(v_person_places_created, 0) > 0 THEN
            SELECT total_edges INTO v_count FROM sot.link_cats_to_places();
            v_result := v_result || jsonb_build_object(
                'step3c_cats_linked_from_new_places', COALESCE(v_count, 0)
            );
        END IF;
    EXCEPTION WHEN OTHERS THEN
        -- Non-critical, continue to Step 4
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


-- ============================================================================
-- SECTION D: Verification Queries
-- ============================================================================

-- 1. Adopter person_place coverage
SELECT COUNT(DISTINCT ac.adopter_person_id) AS total_adopters,
       COUNT(DISTINCT ac.adopter_person_id) FILTER (WHERE EXISTS (
         SELECT 1 FROM sot.person_place pp WHERE pp.person_id = ac.adopter_person_id
       )) AS with_address
FROM sot.v_adoption_context ac WHERE ac.adopter_person_id IS NOT NULL;

-- 2. Cat-place coverage for adopted cats by placement type
SELECT ac.placement_type, COUNT(*) AS adoptions,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = ac.cat_id
       )) AS with_place
FROM sot.v_adoption_context ac WHERE ac.adopter_person_id IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC;

-- 3. Jackie Muzio spot check (FFS-919)
SELECT ac.cat_name, ac.placement_type, p.formatted_address
FROM sot.v_adoption_context ac
JOIN sot.cat_place cp ON cp.cat_id = ac.cat_id
JOIN sot.places p ON p.place_id = cp.place_id
WHERE ac.adopter_name ILIKE '%muzio%';

-- 4. Skip reasons breakdown
SELECT reason, COUNT(*) FROM ops.entity_linking_skipped
WHERE entity_type = 'adopter' GROUP BY 1 ORDER BY 2 DESC;
