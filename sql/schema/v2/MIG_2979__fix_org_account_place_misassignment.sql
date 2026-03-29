-- MIG_2979: Fix org/site account place misassignment
-- FFS-747: inferred_place_id ignores owner_info address when org account shares contact info
--
-- ROOT CAUSE: When a ClinicHQ org account (e.g., "Sonoma County Landfill") shares an email/phone
-- with a personal account (e.g., Sue Molsberry), three things go wrong:
--   1. link_appointments_to_owners() sets person_id via email, crossing org/person boundary
--   2. link_appointments_to_places() Step 1 fails on exact normalized_address mismatch
--      (e.g., "parking lot, 500 mecham rd..." ≠ "500 mecham rd...")
--   3. Fallback to person→place links to the person's HOME, not the org's address
--
-- SCOPE: 277 appointments (261 cats) across 48 org/site/address accounts confirmed mislinked.
--        610 appointments total have owner_address with no matching place.
--
-- This migration fixes the functions. MIG_2980 repairs the data.
--
-- IMPORTANT: Also patches ops.run_clinichq_post_processing() Step 4 (from MIG_2975)
-- which was already deployed. The guard is added to MIG_2975 source file AND re-applied
-- here so that this migration is self-contained.

-- ============================================================
-- SECTION 1: Fix link_appointments_to_owners()
-- Add org-account guard: don't set person_id when the appointment
-- belongs to an org/site/address account.
-- ============================================================

CREATE OR REPLACE FUNCTION sot.link_appointments_to_owners(p_batch_limit integer DEFAULT 2000)
 RETURNS TABLE(appointments_updated integer, persons_created integer, persons_linked integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_email_updated INT := 0;
  v_phone_updated INT := 0;
  v_phone_queued INT := 0;
  v_total_linked INT;
BEGIN
  -- =========================================================================
  -- PASS 1: Email matching (from MIG_2600)
  -- FFS-747: Added org-account guard to prevent cross-boundary person linking
  -- =========================================================================

  WITH email_matches AS (
    SELECT DISTINCT ON (a.appointment_id)
      a.appointment_id,
      p.person_id
    FROM ops.appointments a
    JOIN sot.person_identifiers pi ON
      LOWER(TRIM(a.owner_email)) = pi.id_value_norm
      AND pi.id_type = 'email'
      AND pi.confidence >= 0.5  -- INV-19: PetLink confidence filter
    JOIN sot.people p ON p.person_id = pi.person_id
      AND p.merged_into_person_id IS NULL  -- INV-7: Merge-aware
    WHERE a.person_id IS NULL  -- Only unlinked appointments
      AND a.owner_email IS NOT NULL
      AND TRIM(a.owner_email) != ''
      -- INV-23: Respect soft blacklist for org emails
      AND NOT EXISTS (
        SELECT 1 FROM sot.data_engine_soft_blacklist sb
        WHERE sb.identifier_type = 'email'
        AND LOWER(TRIM(a.owner_email)) = sb.identifier_norm
      )
      -- FFS-747: Do NOT set person_id when appointment belongs to non-person account
      AND NOT EXISTS (
        SELECT 1 FROM ops.clinic_accounts ca
        WHERE ca.account_id = a.owner_account_id
          AND ca.account_type IN ('organization', 'site_name', 'address')
          AND ca.resolved_person_id IS NULL
          AND ca.merged_into_account_id IS NULL
      )
    ORDER BY a.appointment_id, pi.confidence DESC
    LIMIT p_batch_limit
  )
  UPDATE ops.appointments a
  SET person_id = em.person_id,
      updated_at = NOW()
  FROM email_matches em
  WHERE a.appointment_id = em.appointment_id;

  GET DIAGNOSTICS v_email_updated = ROW_COUNT;

  -- =========================================================================
  -- PASS 2: Phone matching with address verification (INV-15)
  -- FFS-747: Added org-account guard
  -- =========================================================================

  -- Auto-link: same phone + similar address (similarity > 0.5)
  WITH phone_matches AS (
    SELECT DISTINCT ON (a.appointment_id)
      a.appointment_id,
      p.person_id,
      similarity(
        LOWER(COALESCE(a.owner_address, '')),
        LOWER(COALESCE(pl.formatted_address, ''))
      ) as addr_sim
    FROM ops.appointments a
    JOIN sot.person_identifiers pi ON
      sot.norm_phone_us(a.owner_phone) = pi.id_value_norm
      AND pi.id_type = 'phone'
      AND pi.confidence >= 0.5
    JOIN sot.people p ON p.person_id = pi.person_id
      AND p.merged_into_person_id IS NULL
    LEFT JOIN sot.places pl ON pl.place_id = p.primary_address_id
      AND pl.merged_into_place_id IS NULL
    WHERE a.person_id IS NULL  -- Still unlinked after email pass
      AND a.owner_email IS NULL  -- Phone-only (email already tried)
      AND sot.norm_phone_us(a.owner_phone) IS NOT NULL
      -- Respect soft blacklist for shared phones
      AND NOT EXISTS (
        SELECT 1 FROM sot.data_engine_soft_blacklist sb
        WHERE sb.identifier_type = 'phone'
        AND sot.norm_phone_us(a.owner_phone) = sb.identifier_norm
      )
      -- FFS-747: Do NOT set person_id when appointment belongs to non-person account
      AND NOT EXISTS (
        SELECT 1 FROM ops.clinic_accounts ca
        WHERE ca.account_id = a.owner_account_id
          AND ca.account_type IN ('organization', 'site_name', 'address')
          AND ca.resolved_person_id IS NULL
          AND ca.merged_into_account_id IS NULL
      )
      -- Address verification: similar address OR unknown address
      AND (
        a.owner_address IS NULL OR TRIM(a.owner_address) = ''
        OR pl.formatted_address IS NULL
        OR similarity(
          LOWER(COALESCE(a.owner_address, '')),
          LOWER(COALESCE(pl.formatted_address, ''))
        ) > 0.5
      )
    ORDER BY a.appointment_id, pi.confidence DESC,
      similarity(LOWER(COALESCE(a.owner_address, '')), LOWER(COALESCE(pl.formatted_address, ''))) DESC
    LIMIT p_batch_limit
  )
  UPDATE ops.appointments a
  SET person_id = pm.person_id,
      updated_at = NOW()
  FROM phone_matches pm
  WHERE a.appointment_id = pm.appointment_id;

  GET DIAGNOSTICS v_phone_updated = ROW_COUNT;

  -- Queue for review: same phone but DIFFERENT address (possible household member)
  INSERT INTO ops.data_quality_review_queue (
    entity_type, entity_id, issue_type, suggested_action, details
  )
  SELECT DISTINCT ON (a.appointment_id)
    'appointment',
    a.appointment_id,
    'phone_address_mismatch',
    'review_link',
    jsonb_build_object(
      'person_id', p.person_id,
      'person_name', p.display_name,
      'appointment_phone', a.owner_phone,
      'appointment_address', a.owner_address,
      'person_address', pl.formatted_address,
      'address_similarity', similarity(
        LOWER(COALESCE(a.owner_address, '')),
        LOWER(COALESCE(pl.formatted_address, ''))
      )
    )
  FROM ops.appointments a
  JOIN sot.person_identifiers pi ON
    sot.norm_phone_us(a.owner_phone) = pi.id_value_norm
    AND pi.id_type = 'phone'
    AND pi.confidence >= 0.5
  JOIN sot.people p ON p.person_id = pi.person_id
    AND p.merged_into_person_id IS NULL
  JOIN sot.places pl ON pl.place_id = p.primary_address_id
    AND pl.merged_into_place_id IS NULL
  WHERE a.person_id IS NULL
    AND a.owner_email IS NULL
    AND sot.norm_phone_us(a.owner_phone) IS NOT NULL
    AND a.owner_address IS NOT NULL AND TRIM(a.owner_address) != ''
    AND pl.formatted_address IS NOT NULL
    AND similarity(
      LOWER(a.owner_address),
      LOWER(pl.formatted_address)
    ) <= 0.5
    AND NOT EXISTS (
      SELECT 1 FROM ops.data_quality_review_queue q
      WHERE q.entity_id = a.appointment_id
        AND q.issue_type = 'phone_address_mismatch'
        AND q.status = 'pending'
    )
    AND NOT EXISTS (
      SELECT 1 FROM sot.data_engine_soft_blacklist sb
      WHERE sb.identifier_type = 'phone'
      AND sot.norm_phone_us(a.owner_phone) = sb.identifier_norm
    )
  ORDER BY a.appointment_id, pi.confidence DESC
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_phone_queued = ROW_COUNT;

  v_total_linked := v_email_updated + v_phone_updated;

  RAISE NOTICE 'link_appointments_to_owners: % email, % phone auto-linked, % phone queued for review',
    v_email_updated, v_phone_updated, v_phone_queued;

  RETURN QUERY SELECT v_total_linked, 0::INT, v_total_linked;
END;
$function$;


-- ============================================================
-- SECTION 2: Fix link_appointments_to_places()
-- - Step 1: Add fuzzy matching for prefix mismatches
-- - Step 1.5: Create places from unmatched owner_addresses
-- - Step 2: Add address cross-validation on person→place fallback
-- ============================================================

CREATE OR REPLACE FUNCTION sot.link_appointments_to_places()
 RETURNS TABLE(source text, appointments_linked integer, appointments_unmatched integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_linked INT;
    v_overridden INT;
    v_unmatched INT;
    v_created INT;
BEGIN
    -- STEP 1: Link via normalized owner address (exact match)
    -- MIG_2811: Can override existing inferred_place_id when address match is better
    WITH address_matches AS (
        SELECT
            a.appointment_id,
            pl.place_id AS matched_place_id,
            a.inferred_place_id AS current_place_id,
            ROW_NUMBER() OVER (
                PARTITION BY a.appointment_id
                ORDER BY pl.created_at ASC  -- prefer oldest (canonical) place
            ) as rn
        FROM ops.appointments a
        JOIN sot.places pl ON pl.normalized_address = sot.normalize_address(a.owner_address)
            AND pl.merged_into_place_id IS NULL
        WHERE a.owner_address IS NOT NULL
          AND TRIM(a.owner_address) != ''
          AND LENGTH(TRIM(a.owner_address)) > 10
          AND (a.inferred_place_id IS NULL
               OR a.inferred_place_id != pl.place_id)
    ),
    updates AS (
        UPDATE ops.appointments a
        SET
            inferred_place_id = m.matched_place_id,
            resolution_status = 'auto_linked'
        FROM address_matches m
        WHERE a.appointment_id = m.appointment_id
          AND m.rn = 1
        RETURNING a.appointment_id,
                  m.current_place_id
    )
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE current_place_id IS NOT NULL)
    INTO v_linked, v_overridden
    FROM updates;

    SELECT COUNT(*) INTO v_unmatched
    FROM ops.appointments
    WHERE inferred_place_id IS NULL
      AND owner_address IS NOT NULL
      AND TRIM(owner_address) != ''
      AND LENGTH(TRIM(owner_address)) > 10;

    IF v_overridden > 0 THEN
        RAISE NOTICE 'Step 1: % appointments linked (% overridden from wrong place)', v_linked, v_overridden;
    END IF;

    source := 'owner_address';
    appointments_linked := v_linked;
    appointments_unmatched := v_unmatched;
    RETURN NEXT;

    -- STEP 1b: Fuzzy match for prefix mismatches (FFS-747)
    -- Handles cases like "parking lot, 500 mecham rd..." vs "500 mecham rd..."
    -- Uses contained-in operator (%) with GIN index, then validates with street similarity.
    -- Scoped to only unmatched appointments to avoid cartesian explosion.
    WITH unmatched AS (
        SELECT a.appointment_id, a.owner_address,
            sot.normalize_address(a.owner_address) as norm_addr,
            split_part(sot.normalize_address(a.owner_address), ',', 1) as street_part
        FROM ops.appointments a
        WHERE a.inferred_place_id IS NULL
          AND a.owner_address IS NOT NULL
          AND TRIM(a.owner_address) != ''
          AND LENGTH(TRIM(a.owner_address)) > 10
          AND sot.normalize_address(a.owner_address) ~ '^\d+'
    ),
    fuzzy_matches AS (
        SELECT
            u.appointment_id,
            pl.place_id AS matched_place_id,
            similarity(u.street_part, split_part(pl.normalized_address, ',', 1)) as street_sim,
            ROW_NUMBER() OVER (
                PARTITION BY u.appointment_id
                ORDER BY similarity(u.street_part, split_part(pl.normalized_address, ',', 1)) DESC,
                         pl.created_at ASC
            ) as rn
        FROM unmatched u
        JOIN sot.places pl ON
            pl.normalized_address LIKE '%' || u.street_part || '%'
            AND pl.merged_into_place_id IS NULL
        WHERE similarity(u.street_part, split_part(pl.normalized_address, ',', 1)) > 0.5
    ),
    fuzzy_updates AS (
        UPDATE ops.appointments a
        SET
            inferred_place_id = fm.matched_place_id,
            resolution_status = 'auto_linked'
        FROM fuzzy_matches fm
        WHERE a.appointment_id = fm.appointment_id
          AND fm.rn = 1
        RETURNING a.appointment_id
    )
    SELECT COUNT(*) INTO v_linked FROM fuzzy_updates;

    source := 'owner_address_fuzzy';
    appointments_linked := v_linked;
    SELECT COUNT(*) INTO v_unmatched
    FROM ops.appointments
    WHERE inferred_place_id IS NULL
      AND owner_address IS NOT NULL AND TRIM(owner_address) != '' AND LENGTH(TRIM(owner_address)) > 10;
    appointments_unmatched := v_unmatched;
    RETURN NEXT;

    -- STEP 1.5: Create places from unmatched owner_addresses (FFS-747)
    -- For appointments that STILL have no inferred_place_id but DO have owner_address,
    -- create the place using the centralized function.
    -- Only for addresses that look like real addresses (start with a number, have comma).
    v_created := 0;
    WITH candidates AS (
        SELECT DISTINCT ON (sot.normalize_address(a.owner_address))
            a.appointment_id,
            a.owner_address,
            sot.normalize_address(a.owner_address) as norm_addr
        FROM ops.appointments a
        WHERE a.inferred_place_id IS NULL
          AND a.owner_address IS NOT NULL
          AND TRIM(a.owner_address) != ''
          AND LENGTH(TRIM(a.owner_address)) > 10
          AND a.owner_address LIKE '%,%'  -- Must have city/state separator
          AND sot.normalize_address(a.owner_address) ~ '^\d+'  -- Must start with a number
        ORDER BY sot.normalize_address(a.owner_address), a.appointment_date DESC
    ),
    new_places AS (
        SELECT
            c.norm_addr,
            sot.find_or_create_place_deduped(
                p_formatted_address := c.owner_address,
                p_source_system := 'clinichq'
            ) as place_id
        FROM candidates c
    ),
    place_links AS (
        UPDATE ops.appointments a
        SET
            inferred_place_id = np.place_id,
            resolution_status = 'auto_linked'
        FROM new_places np
        WHERE sot.normalize_address(a.owner_address) = np.norm_addr
          AND a.inferred_place_id IS NULL
          AND np.place_id IS NOT NULL
        RETURNING a.appointment_id
    )
    SELECT COUNT(*) INTO v_created FROM place_links;

    source := 'owner_address_created';
    appointments_linked := v_created;
    SELECT COUNT(*) INTO v_unmatched
    FROM ops.appointments
    WHERE inferred_place_id IS NULL
      AND owner_address IS NOT NULL AND TRIM(owner_address) != '' AND LENGTH(TRIM(owner_address)) > 10;
    appointments_unmatched := v_unmatched;
    RETURN NEXT;

    -- STEP 2: Link via resolved_person_id → person_place chain (FALLBACK only)
    -- FFS-747: Added address cross-validation. Only use person→place when:
    --   a) appointment has NO owner_address, OR
    --   b) person's place address is similar to the appointment's owner_address
    WITH person_place_matches AS (
        SELECT
            a.appointment_id,
            pp.place_id,
            ROW_NUMBER() OVER (
                PARTITION BY a.appointment_id
                ORDER BY pp.confidence DESC, pp.created_at DESC
            ) as rn
        FROM ops.appointments a
        JOIN sot.person_place pp ON pp.person_id = a.resolved_person_id
        JOIN sot.places pl ON pl.place_id = pp.place_id
            AND pl.merged_into_place_id IS NULL
        WHERE a.inferred_place_id IS NULL
          AND a.resolved_person_id IS NOT NULL
          -- FFS-747: Cross-validate STREET when available (full-address similarity
          -- is misleading when addresses share city/state/zip but different streets)
          AND (
              -- No address to compare: allow fallback
              a.owner_address IS NULL
              OR TRIM(a.owner_address) = ''
              OR LENGTH(TRIM(a.owner_address)) <= 10
              -- Street matches: safe to use person→place
              OR similarity(
                  split_part(sot.normalize_address(a.owner_address), ',', 1),
                  split_part(pl.normalized_address, ',', 1)
              ) > 0.4
          )
    ),
    updates AS (
        UPDATE ops.appointments a
        SET
            inferred_place_id = m.place_id,
            resolution_status = 'auto_linked'
        FROM person_place_matches m
        WHERE a.appointment_id = m.appointment_id
          AND m.rn = 1
        RETURNING a.appointment_id
    )
    SELECT COUNT(*) INTO v_linked FROM updates;

    -- Log skipped appointments (address mismatch) to entity_linking_skipped
    INSERT INTO ops.entity_linking_skipped (entity_type, entity_id, reason, details)
    SELECT
        'appointment',
        a.appointment_id,
        'person_place_address_mismatch',
        jsonb_build_object(
            'resolved_person_id', a.resolved_person_id,
            'owner_address', a.owner_address,
            'person_place_address', pl.formatted_address,
            'street_similarity', similarity(
                split_part(sot.normalize_address(a.owner_address), ',', 1),
                split_part(pl.normalized_address, ',', 1)
            )
        )
    FROM ops.appointments a
    JOIN sot.person_place pp ON pp.person_id = a.resolved_person_id
    JOIN sot.places pl ON pl.place_id = pp.place_id AND pl.merged_into_place_id IS NULL
    WHERE a.inferred_place_id IS NULL
      AND a.resolved_person_id IS NOT NULL
      AND a.owner_address IS NOT NULL
      AND TRIM(a.owner_address) != ''
      AND LENGTH(TRIM(a.owner_address)) > 10
      AND similarity(
          split_part(sot.normalize_address(a.owner_address), ',', 1),
          split_part(pl.normalized_address, ',', 1)
      ) <= 0.4
    ON CONFLICT DO NOTHING;

    -- Count remaining unmatched
    SELECT COUNT(*) INTO v_unmatched
    FROM ops.appointments
    WHERE inferred_place_id IS NULL
      AND resolved_person_id IS NOT NULL;

    source := 'person_place';
    appointments_linked := v_linked;
    appointments_unmatched := v_unmatched;
    RETURN NEXT;

    IF v_unmatched > 100 THEN
        RAISE NOTICE 'link_appointments_to_places: % appointments with resolved_person_id could not be matched', v_unmatched;
    END IF;

    RETURN;
END;
$function$;


-- ============================================================
-- SECTION 3: Fix run_all_entity_linking() step order
-- Move link_appointments_to_owners() BEFORE link_appointments_to_places()
-- so person_id is set correctly before place inference uses it.
-- Also matches the TS ingest route order.
-- ============================================================

CREATE OR REPLACE FUNCTION sot.run_all_entity_linking()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_result JSONB := '{}'::JSONB;
    v_count INT;
    v_skipped INT;
    v_stale_removed INT;
    v_before INT;
    v_during INT;
    v_grace INT;
    v_tier1 INT;
    v_tier2 INT;
    v_tier3 INT;
    v_candidates_found INT;
    v_candidates_queued INT;
    v_total_appointments INT;
    v_appointments_with_place INT;
    v_cats_with_place INT;
    v_warnings TEXT[] := '{}';
    v_current_step TEXT;
    v_appts_updated INT;
    v_persons_linked INT;
BEGIN
    -- Count total appointments for coverage metrics
    SELECT COUNT(*) INTO v_total_appointments FROM ops.appointments;

    -- FFS-747: Step 1 now runs link_appointments_to_owners FIRST
    -- so person_id is correctly set (with org guard) before place inference.
    v_current_step := 'step1_link_appointments_to_owners';
    BEGIN
        SELECT appointments_updated, persons_linked
        INTO v_appts_updated, v_persons_linked
        FROM sot.link_appointments_to_owners();

        v_result := v_result || jsonb_build_object(
            'step1_appointments_linked_to_owners', COALESCE(v_appts_updated, 0)
        );
    EXCEPTION WHEN OTHERS THEN
        v_result := v_result || jsonb_build_object(
            'step1_error', SQLERRM,
            'step1_appointments_linked_to_owners', 0
        );
        v_warnings := array_append(v_warnings, 'step1 failed: ' || SQLERRM);
    END;

    -- Step 2: Link appointments to places (uses person_id from step 1 as fallback)
    v_current_step := 'step2_link_appointments_to_places';
    BEGIN
        SELECT SUM(appointments_linked), SUM(appointments_unmatched)
        INTO v_count, v_skipped
        FROM sot.link_appointments_to_places();

        v_result := v_result || jsonb_build_object(
            'step2_appointments_linked_to_places', COALESCE(v_count, 0),
            'step2_appointments_unmatched', COALESCE(v_skipped, 0)
        );

        -- Coverage metrics
        SELECT COUNT(*) INTO v_appointments_with_place
        FROM ops.appointments
        WHERE inferred_place_id IS NOT NULL;

        v_result := v_result || jsonb_build_object(
            'step2_coverage_pct', ROUND(100.0 * v_appointments_with_place / NULLIF(v_total_appointments, 0), 1)
        );
    EXCEPTION WHEN OTHERS THEN
        v_result := v_result || jsonb_build_object(
            'step2_error', SQLERRM,
            'step2_coverage_pct', 0,
            'step2_appointments_linked_to_places', 0
        );
        v_warnings := array_append(v_warnings, 'step2 FAILED: ' || SQLERRM);
        -- Step 2 failure is critical — record but continue
        INSERT INTO ops.entity_linking_runs (result, status, warnings, completed_at)
        VALUES (v_result, 'failed', ARRAY['step2 CRITICAL failure: ' || SQLERRM], NOW())
        ON CONFLICT DO NOTHING;
    END;

    -- Step 3: Link cats to places via appointments
    v_current_step := 'step3_link_cats_to_appointment_places';
    BEGIN
        SELECT cats_linked INTO v_count
        FROM sot.link_cats_to_appointment_places();

        v_result := v_result || jsonb_build_object('step3_cats_linked', COALESCE(v_count, 0));

        -- Validate: warn if 0 cats linked but appointments exist with inferred places
        IF COALESCE(v_count, 0) = 0 AND v_appointments_with_place > 0 THEN
            v_warnings := array_append(v_warnings, 'step3 linked 0 cats despite ' || v_appointments_with_place || ' appointments with inferred places');
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v_result := v_result || jsonb_build_object(
            'step3_error', SQLERRM,
            'step3_cats_linked', 0
        );
        v_warnings := array_append(v_warnings, 'step3 failed: ' || SQLERRM);
    END;

    -- Step 4: Link cats to places via person_place (supplementary)
    v_current_step := 'step4_link_cats_to_places';
    BEGIN
        SELECT cats_linked_home, cats_skipped INTO v_count, v_skipped
        FROM sot.link_cats_to_places();

        v_result := v_result || jsonb_build_object(
            'step4_cats_linked', COALESCE(v_count, 0),
            'step4_cats_skipped', COALESCE(v_skipped, 0)
        );
    EXCEPTION WHEN OTHERS THEN
        v_result := v_result || jsonb_build_object(
            'step4_error', SQLERRM,
            'step4_cats_linked', 0
        );
        v_warnings := array_append(v_warnings, 'step4 failed: ' || SQLERRM);
    END;

    -- Step 5: Cat-request attribution
    v_current_step := 'step5_cat_request_attribution';
    BEGIN
        v_stale_removed := sot.cleanup_stale_request_cat_links();

        SELECT linked, before_request, during_request, grace_period
        INTO v_count, v_before, v_during, v_grace
        FROM sot.link_cats_to_requests_attribution();

        v_result := v_result || jsonb_build_object(
            'step5_stale_removed', COALESCE(v_stale_removed, 0),
            'step5_cats_linked_to_requests', COALESCE(v_count, 0),
            'step5_before', COALESCE(v_before, 0),
            'step5_during', COALESCE(v_during, 0),
            'step5_grace', COALESCE(v_grace, 0)
        );
    EXCEPTION WHEN OTHERS THEN
        v_result := v_result || jsonb_build_object(
            'step5_error', SQLERRM,
            'step5_cats_linked_to_requests', 0
        );
        v_warnings := array_append(v_warnings, 'step5 failed: ' || SQLERRM);
    END;

    -- Step 6: Link appointments to requests
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
        v_result := v_result || jsonb_build_object(
            'step6_error', SQLERRM,
            'step6_appointments_linked_to_requests_tier1', 0
        );
        v_warnings := array_append(v_warnings, 'step6 failed: ' || SQLERRM);
    END;

    -- Step 7: Queue unofficial trapper candidates
    v_current_step := 'step7_queue_trapper_candidates';
    BEGIN
        SELECT * INTO v_candidates_found, v_candidates_queued
        FROM sot.queue_unofficial_trapper_candidates();

        v_result := v_result || jsonb_build_object(
            'step7_trapper_candidates_found', COALESCE(v_candidates_found, 0),
            'step7_trapper_candidates_queued', COALESCE(v_candidates_queued, 0)
        );
    EXCEPTION WHEN OTHERS THEN
        v_result := v_result || jsonb_build_object(
            'step7_error', SQLERRM,
            'step7_trapper_candidates_found', 0,
            'step7_trapper_candidates_queued', 0
        );
        v_warnings := array_append(v_warnings, 'step7 failed (non-fatal): ' || SQLERRM);
    END;

    -- Final coverage metrics
    SELECT COUNT(*) INTO v_cats_with_place
    FROM sot.cat_place;

    v_result := v_result || jsonb_build_object(
        'cats_with_place_link', v_cats_with_place,
        'total_appointments', v_total_appointments,
        'appointments_with_place', v_appointments_with_place
    );

    -- Record run
    IF array_length(v_warnings, 1) > 0 THEN
        v_result := v_result || jsonb_build_object('warnings', v_warnings);
    END IF;

    INSERT INTO ops.entity_linking_runs (result, status, warnings, completed_at)
    VALUES (v_result, 'completed', v_warnings, NOW())
    ON CONFLICT DO NOTHING;

    RETURN v_result;
END;
$function$;


-- ============================================================
-- SECTION 4: Drop legacy ops.infer_appointment_places()
-- This function has an unguarded person_id → person_place fallback
-- and is no longer called by any code path.
-- ============================================================

DROP FUNCTION IF EXISTS ops.infer_appointment_places();
