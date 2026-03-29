-- MIG_3003: Tippy Data Discrepancy Fixes — Systemic Pipeline Enhancements
--
-- FFS-915: 1,499 cats with appointments but no place link
-- FFS-916: 25 completed requests with 0 cats (downstream of FFS-915)
-- FFS-917: 20 orphaned colonies (cats, no caretaker)
-- FFS-919: ShelterLuv adopt/foster cats not linked to destination place
-- FFS-920: Google Maps note for 211 E Shiloh Rd mislinked to 5811 Faught Rd
--
-- ROOT CAUSES (systemic, not one-off):
--   1. Entity linking creates person_cat(adopter/foster) but NOT person_place
--      for the adopter/foster. Step 3 can't propagate cat→place without person→place.
--   2. ClinicHQ-resolved persons booking appointments at addresses have no
--      person_place link created. Orphaned colonies result.
--   3. Step 1.5 rejects valid addresses without commas (e.g. "123 Main St CA 95401").
--
-- FIX: Three new pipeline functions added to run_all_entity_linking():
--   Step 1b: recover_missing_person_places() — creates person→place from source data
--   Step 1c: link_appointment_bookers_to_places() — creates person→place from bookings
--   Step 1d: create_places_for_unmatched_appointments() — relaxed address filter
--
-- ROOT CAUSE FIX: process_shelterluv_people_batch() now creates person_place
--   during ingest. Previously extracted address but never created place/link.
--   MIG_2444 was a one-time backfill; new SL people synced after had no person_place.
--
-- FFS-920 is a genuine one-off mislink (GM note at wrong place), kept as data fix.
--
-- Created: 2026-03-27

\echo ''
\echo '=============================================='
\echo '  MIG_3003: Tippy Data Discrepancy Fixes'
\echo '  Systemic Pipeline Enhancements'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- SECTION A: FFS-920 — Google Maps Note Mislinked (One-off Data Fix)
-- ============================================================================
-- Note for Robert/Kristin Feenan at 211 E Shiloh Rd was attached to
-- 5811 Faught Rd. This is human/algorithmic matching error, not a pipeline gap.

\echo 'A. FFS-920: Fixing mislinked Google Maps note (Shiloh Rd)...'

DO $$
DECLARE
  v_entry_id UUID;
  v_old_place_id UUID;
  v_new_place_id UUID;
  v_result RECORD;
BEGIN
  -- Find the mislinked entry
  SELECT gme.entry_id, gme.linked_place_id
  INTO v_entry_id, v_old_place_id
  FROM source.google_map_entries gme
  JOIN sot.places p ON p.place_id = gme.linked_place_id
  WHERE (gme.original_content ILIKE '%Shiloh%' OR gme.original_content ILIKE '%Feenan%'
         OR gme.kml_name ILIKE '%Shiloh%' OR gme.kml_name ILIKE '%Feenan%')
    AND p.formatted_address ILIKE '%Faught%'
    AND gme.linked_place_id IS NOT NULL
  LIMIT 1;

  IF v_entry_id IS NULL THEN
    RAISE NOTICE 'A: No mislinked Shiloh/Feenan entry found at Faught Rd — skipping';
    RETURN;
  END IF;

  RAISE NOTICE 'A: Found mislinked entry_id=% at place=%', v_entry_id, v_old_place_id;

  -- Unlink from wrong place
  SELECT * INTO v_result FROM ops.unlink_gm_entry(v_entry_id, 'migration_MIG_3003');
  IF NOT v_result.success THEN
    RAISE NOTICE 'A: Unlink failed: %', v_result.message;
    RETURN;
  END IF;

  -- Find or create correct place
  SELECT sot.find_or_create_place_deduped(
    '211 E Shiloh Rd, Windsor, CA 95492', NULL, NULL, NULL, 'google_maps'
  ) INTO v_new_place_id;

  IF v_new_place_id IS NULL THEN
    RAISE NOTICE 'A: Could not create place for 211 E Shiloh Rd — entry left unlinked';
    RETURN;
  END IF;

  -- Re-link to correct place
  SELECT * INTO v_result
  FROM ops.manual_link_gm_entry(v_entry_id, v_new_place_id, 'migration_MIG_3003');

  RAISE NOTICE 'A: Re-linked to 211 E Shiloh Rd (place=%): %', v_new_place_id, v_result.message;
END $$;

\echo ''

-- ============================================================================
-- SECTION B: New Pipeline Function — sot.recover_missing_person_places()
-- ============================================================================
-- Creates person→place links from source data for persons who have
-- person_cat relationships (adopter, foster, owner, caretaker) but no
-- person_place link. Without person→place, Step 3 (person chain) can't
-- propagate cat→place.
--
-- Two passes:
--   Pass 1: ClinicHQ — resolved persons on clinic_accounts with addresses
--   Pass 2: ShelterLuv — persons matched by email to SL raw person records
--
-- Runs as Step 1b in the pipeline, AFTER Step 1 (appointments→places)
-- and BEFORE Step 2 (cats→appointment_places).

\echo 'B. Creating sot.recover_missing_person_places()...'

CREATE OR REPLACE FUNCTION sot.recover_missing_person_places()
RETURNS TABLE(persons_from_clinic INT, persons_from_shelterluv INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_clinic INT := 0;
  v_sl INT := 0;
  v_place_id UUID;
  rec RECORD;
  v_addr TEXT;
  v_city TEXT;
  v_state TEXT;
  v_zip TEXT;
  v_full_addr TEXT;
BEGIN
  -- ====================================================================
  -- PASS 1: ClinicHQ — clinic_accounts with resolved_person_id + address
  -- ====================================================================
  -- Persons resolved from ClinicHQ bookings who have address data on their
  -- clinic account but no person_place link in sot.
  FOR rec IN
    SELECT DISTINCT ON (ca.resolved_person_id)
      ca.resolved_person_id AS person_id,
      ca.owner_address,
      ca.owner_city,
      ca.owner_zip
    FROM ops.clinic_accounts ca
    JOIN sot.people p ON p.person_id = ca.resolved_person_id
      AND p.merged_into_person_id IS NULL
    WHERE ca.resolved_person_id IS NOT NULL
      AND ca.owner_address IS NOT NULL
      AND LENGTH(TRIM(ca.owner_address)) > 10
      AND ca.account_type NOT IN ('organization', 'site_name')
      -- Only persons with person_cat links but missing person_place
      AND EXISTS (
        SELECT 1 FROM sot.person_cat pc WHERE pc.person_id = ca.resolved_person_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM sot.person_place pp WHERE pp.person_id = ca.resolved_person_id
      )
      -- Exclude staff/trappers
      AND NOT EXISTS (
        SELECT 1 FROM sot.person_roles pr
        WHERE pr.person_id = ca.resolved_person_id
          AND pr.role_status = 'active'
          AND pr.role IN ('staff', 'trapper', 'coordinator', 'head_trapper')
      )
    ORDER BY ca.resolved_person_id, ca.last_appointment_date DESC NULLS LAST
  LOOP
    BEGIN
      -- Build full address from account fields
      v_full_addr := TRIM(rec.owner_address);
      IF rec.owner_city IS NOT NULL AND rec.owner_city != ''
         AND v_full_addr NOT ILIKE '%' || rec.owner_city || '%' THEN
        v_full_addr := v_full_addr || ', ' || rec.owner_city;
      END IF;
      IF rec.owner_zip IS NOT NULL AND rec.owner_zip != ''
         AND v_full_addr NOT LIKE '%' || rec.owner_zip || '%' THEN
        v_full_addr := v_full_addr || ' ' || rec.owner_zip;
      END IF;

      SELECT sot.find_or_create_place_deduped(v_full_addr, NULL, NULL, NULL, 'clinichq')
      INTO v_place_id;

      IF v_place_id IS NOT NULL THEN
        INSERT INTO sot.person_place (
          person_id, place_id, relationship_type,
          evidence_type, confidence, source_system, source_table
        ) VALUES (
          rec.person_id, v_place_id, 'resident',
          'inferred', 0.7, 'clinichq', 'clinic_accounts'
        )
        ON CONFLICT (person_id, place_id, relationship_type) DO NOTHING;

        IF FOUND THEN v_clinic := v_clinic + 1; END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'recover_person_places(clinic): error for person %: %', rec.person_id, SQLERRM;
    END;
  END LOOP;

  -- ====================================================================
  -- PASS 2: ShelterLuv — persons matched by email to raw person records
  -- ====================================================================
  -- ShelterLuv person records have Street Address 1, City, State, Zip.
  -- Person was resolved via email during event processing (MIG_2878).
  FOR rec IN
    SELECT DISTINCT ON (pi.person_id)
      pi.person_id,
      sr.payload
    FROM sot.person_identifiers pi
    JOIN source.shelterluv_raw sr ON sr.record_type = 'person'
      AND LOWER(TRIM(sr.payload->>'Email')) = pi.id_value_norm
    JOIN sot.people p ON p.person_id = pi.person_id
      AND p.merged_into_person_id IS NULL
    WHERE pi.id_type = 'email'
      AND pi.confidence >= 0.5
      AND COALESCE(
        NULLIF(TRIM(sr.payload->>'Street'), ''),
        NULLIF(TRIM(sr.payload->>'Street Address 1'), '')
      ) IS NOT NULL
      -- Only persons with person_cat links but missing person_place
      AND EXISTS (
        SELECT 1 FROM sot.person_cat pc WHERE pc.person_id = pi.person_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM sot.person_place pp WHERE pp.person_id = pi.person_id
      )
    ORDER BY pi.person_id
  LOOP
    BEGIN
      v_addr := COALESCE(
        NULLIF(TRIM(rec.payload->>'Street'), ''),
        NULLIF(TRIM(rec.payload->>'Street Address 1'), '')
      );
      v_city := TRIM(COALESCE(rec.payload->>'City', ''));
      v_state := TRIM(COALESCE(rec.payload->>'State', ''));
      v_zip := TRIM(COALESCE(rec.payload->>'Zip', ''));

      IF v_addr = '' OR v_addr IS NULL THEN CONTINUE; END IF;

      -- Build full address
      v_full_addr := v_addr;
      IF v_city != '' THEN v_full_addr := v_full_addr || ', ' || v_city; END IF;
      IF v_state != '' THEN v_full_addr := v_full_addr || ', ' || v_state; END IF;
      IF v_zip != '' THEN v_full_addr := v_full_addr || ' ' || v_zip; END IF;

      SELECT sot.find_or_create_place_deduped(v_full_addr, NULL, NULL, NULL, 'shelterluv')
      INTO v_place_id;

      IF v_place_id IS NOT NULL THEN
        INSERT INTO sot.person_place (
          person_id, place_id, relationship_type,
          evidence_type, confidence, source_system, source_table
        ) VALUES (
          rec.person_id, v_place_id, 'resident',
          'inferred', 0.75, 'shelterluv', 'people'
        )
        ON CONFLICT (person_id, place_id, relationship_type) DO NOTHING;

        IF FOUND THEN v_sl := v_sl + 1; END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'recover_person_places(shelterluv): error for person %: %', rec.person_id, SQLERRM;
    END;
  END LOOP;

  persons_from_clinic := v_clinic;
  persons_from_shelterluv := v_sl;
  RETURN NEXT;

  RAISE NOTICE 'recover_missing_person_places: clinic=%, shelterluv=%', v_clinic, v_sl;
END;
$$;

COMMENT ON FUNCTION sot.recover_missing_person_places IS
'MIG_3003/FFS-919: Recovers missing person→place links from source data.
Pass 1: ClinicHQ accounts with resolved_person_id and owner_address.
Pass 2: ShelterLuv raw person records matched by email.
Only targets persons who have person_cat links but no person_place link.
Enables Step 3 (person chain) to propagate cat→place for adopt/foster/relo cats.
Idempotent — safe to re-run (ON CONFLICT DO NOTHING).';

\echo ''

-- ============================================================================
-- SECTION C: New Pipeline Function — sot.link_appointment_bookers_to_places()
-- ============================================================================
-- Creates person→place links from appointment booking patterns.
-- When a resolved person booked appointments at a place (inferred_place_id)
-- but no person_place link exists, create one.
--
-- This fixes:
--   - Orphaned colonies (places with cats but no person)
--   - General person→place gaps from ClinicHQ data
--
-- Runs as Step 1c in the pipeline, after Step 1b (recover_missing_person_places).

\echo 'C. Creating sot.link_appointment_bookers_to_places()...'

CREATE OR REPLACE FUNCTION sot.link_appointment_bookers_to_places()
RETURNS TABLE(persons_linked INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_linked INT := 0;
BEGIN
  -- Bulk INSERT: for resolved persons on appointments who have
  -- inferred_place_id set but no person_place link.
  -- Uses DISTINCT ON to get one row per (person, place) pair.
  WITH person_place_counts AS (
    -- Pre-compute distinct place counts per person to avoid N^2 correlated subquery
    SELECT
      COALESCE(ca.resolved_person_id, a.person_id) AS person_id,
      COUNT(DISTINCT a.inferred_place_id) AS distinct_places
    FROM ops.appointments a
    LEFT JOIN ops.clinic_accounts ca ON ca.account_id = a.owner_account_id
    WHERE a.inferred_place_id IS NOT NULL
      AND COALESCE(ca.resolved_person_id, a.person_id) IS NOT NULL
    GROUP BY 1
  ),
  candidates AS (
    SELECT DISTINCT ON (person_id, place_id)
      person_id, place_id, appt_count
    FROM (
      SELECT
        COALESCE(ca.resolved_person_id, a.person_id) AS person_id,
        a.inferred_place_id AS place_id,
        COUNT(*) OVER (
          PARTITION BY COALESCE(ca.resolved_person_id, a.person_id), a.inferred_place_id
        ) AS appt_count
      FROM ops.appointments a
      LEFT JOIN ops.clinic_accounts ca ON ca.account_id = a.owner_account_id
      WHERE a.inferred_place_id IS NOT NULL
        AND COALESCE(ca.resolved_person_id, a.person_id) IS NOT NULL
        -- Exclude org/site accounts
        AND (ca.account_id IS NULL OR ca.account_type NOT IN ('organization', 'site_name'))
    ) sub
    WHERE person_id IS NOT NULL
      AND place_id IS NOT NULL
    ORDER BY person_id, place_id, appt_count DESC
  ),
  insertable AS (
    SELECT c.person_id, c.place_id, c.appt_count
    FROM candidates c
    -- Verify person exists and not merged
    JOIN sot.people p ON p.person_id = c.person_id AND p.merged_into_person_id IS NULL
    -- Verify place exists and not merged
    JOIN sot.places pl ON pl.place_id = c.place_id AND pl.merged_into_place_id IS NULL
    -- Exclude people who appear at too many distinct places (likely trappers)
    JOIN person_place_counts ppc ON ppc.person_id = c.person_id AND ppc.distinct_places <= 5
    -- Only if no person_place link exists
    WHERE NOT EXISTS (
      SELECT 1 FROM sot.person_place pp
      WHERE pp.person_id = c.person_id AND pp.place_id = c.place_id
    )
    -- Exclude staff/trappers
    AND NOT EXISTS (
      SELECT 1 FROM sot.person_roles pr
      WHERE pr.person_id = c.person_id
        AND pr.role_status = 'active'
        AND pr.role IN ('staff', 'trapper', 'coordinator', 'head_trapper')
    )
  ),
  inserted AS (
    INSERT INTO sot.person_place (
      person_id, place_id, relationship_type,
      evidence_type, confidence, source_system, source_table
    )
    SELECT
      i.person_id,
      i.place_id,
      CASE WHEN i.appt_count >= 3 THEN 'caretaker' ELSE 'resident' END,
      'inferred',
      CASE WHEN i.appt_count >= 3 THEN 0.7 ELSE 0.6 END,
      'clinichq',
      'appointments'
    FROM insertable i
    ON CONFLICT (person_id, place_id, relationship_type) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_linked FROM inserted;

  persons_linked := v_linked;
  RETURN NEXT;

  RAISE NOTICE 'link_appointment_bookers_to_places: % person_place links created', v_linked;
END;
$$;

COMMENT ON FUNCTION sot.link_appointment_bookers_to_places IS
'MIG_3003/FFS-917: Creates person→place links from appointment booking patterns.
When a resolved person booked appointments at a place but has no person_place link,
creates one. Assigns "caretaker" for 3+ appointments, "resident" otherwise.
Excludes staff/trappers and high-volume multi-place bookers (>5 places = likely trapper).
Fixes orphaned colonies and general person→place gaps from ClinicHQ data.
Idempotent — safe to re-run (ON CONFLICT DO NOTHING).';

\echo ''

-- ============================================================================
-- SECTION D: New Pipeline Function — sot.create_places_for_unmatched_appointments()
-- ============================================================================
-- Step 1.5 inside link_appointments_to_places() requires:
--   owner_address LIKE '%,%' (comma separator)
--   normalize_address() ~ '^\d+' (starts with digit)
--
-- This catches valid addresses without commas but with CA/zip patterns:
--   "123 Main St Santa Rosa CA 95401" (no comma, valid)
--   "PO Box 123 Petaluma CA" (starts with letter, but has CA)
--
-- Runs as Step 1d in the pipeline.

\echo 'D. Creating sot.create_places_for_unmatched_appointments()...'

CREATE OR REPLACE FUNCTION sot.create_places_for_unmatched_appointments()
RETURNS TABLE(places_created INT, appointments_linked INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_created INT := 0;
  v_linked INT := 0;
  rec RECORD;
  v_place_id UUID;
  v_updated INT;
BEGIN
  -- Process unmatched appointment addresses that Step 1.5 rejected
  -- because they lack commas but have identifiable CA address patterns.
  FOR rec IN
    SELECT DISTINCT ON (sot.normalize_address(a.owner_address))
      a.owner_address AS raw_addr,
      sot.normalize_address(a.owner_address) AS norm_addr
    FROM ops.appointments a
    WHERE a.inferred_place_id IS NULL
      AND a.owner_address IS NOT NULL
      AND TRIM(a.owner_address) != ''
      AND LENGTH(TRIM(a.owner_address)) > 10
      AND sot.normalize_address(a.owner_address) IS NOT NULL
      -- Must start with a digit (street address)
      AND sot.normalize_address(a.owner_address) ~ '^\d+'
      -- Explicitly target addresses that Step 1.5 missed (no comma)
      AND a.owner_address NOT LIKE '%,%'
      -- But must have recognizable CA location pattern
      AND (
        a.owner_address ~* '\bCA\b'                  -- State abbreviation
        OR a.owner_address ~* '\bCalifornia\b'        -- Full state name
        OR a.owner_address ~ '\b9[45]\d{3}\b'         -- CA zip code (94xxx/95xxx)
      )
    ORDER BY sot.normalize_address(a.owner_address), a.appointment_date DESC
  LOOP
    BEGIN
      SELECT sot.find_or_create_place_deduped(rec.raw_addr, NULL, NULL, NULL, 'clinichq')
      INTO v_place_id;

      IF v_place_id IS NOT NULL THEN
        v_created := v_created + 1;

        WITH updated AS (
          UPDATE ops.appointments
          SET inferred_place_id = v_place_id,
              resolution_status = 'auto_linked',
              updated_at = NOW()
          WHERE inferred_place_id IS NULL
            AND sot.normalize_address(owner_address) = rec.norm_addr
          RETURNING 1
        )
        SELECT COUNT(*) INTO v_updated FROM updated;

        v_linked := v_linked + v_updated;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'create_places_for_unmatched: error for "%": %', LEFT(rec.raw_addr, 60), SQLERRM;
    END;
  END LOOP;

  places_created := v_created;
  appointments_linked := v_linked;
  RETURN NEXT;

  RAISE NOTICE 'create_places_for_unmatched_appointments: % places, % appointments linked', v_created, v_linked;
END;
$$;

COMMENT ON FUNCTION sot.create_places_for_unmatched_appointments IS
'MIG_3003/FFS-915: Creates places for appointment addresses that Step 1.5 missed.
Targets addresses without commas but with CA state/zip patterns.
Uses find_or_create_place_deduped() for safe dedup.
Sets inferred_place_id on matching appointments.
Idempotent — safe to re-run.';

\echo ''

-- ============================================================================
-- SECTION E: Update run_all_entity_linking() — Add New Steps
-- ============================================================================
-- Inserts 3 new steps between Step 1 (appointments→places) and Step 2 (cats→places):
--   Step 1b: recover_missing_person_places()
--   Step 1c: link_appointment_bookers_to_places()
--   Step 1d: create_places_for_unmatched_appointments()
--
-- These run BEFORE cat linking so that:
--   - Person→place links exist for Step 3 (person chain)
--   - Additional places exist for Step 2 (appointment places)

\echo 'E. Updating sot.run_all_entity_linking() with new steps...'

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
    -- Step 1b variables
    v_clinic_persons INT;
    v_sl_persons INT;
    -- Step 1c variables
    v_booker_persons INT;
    -- Step 1d variables
    v_places_created INT;
    v_appts_linked INT;
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
    -- STEP 1b (NEW/MIG_3003): Recover missing person→place links
    -- ========================================================================
    -- Creates person_place from ClinicHQ accounts and ShelterLuv raw data.
    -- Enables Step 3 to propagate cat→place for adopt/foster/relo cases.
    v_current_step := 'step1b_recover_missing_person_places';
    BEGIN
        SELECT persons_from_clinic, persons_from_shelterluv
        INTO v_clinic_persons, v_sl_persons
        FROM sot.recover_missing_person_places();

        v_result := v_result || jsonb_build_object(
            'step1b_persons_from_clinic', COALESCE(v_clinic_persons, 0),
            'step1b_persons_from_shelterluv', COALESCE(v_sl_persons, 0)
        );
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN
            v_status := 'partial_failure';
        END IF;
        v_result := v_result || jsonb_build_object(
            'step1b_error', SQLERRM,
            'step1b_persons_from_clinic', 0,
            'step1b_persons_from_shelterluv', 0
        );
        v_warnings := array_append(v_warnings, 'step1b failed: ' || SQLERRM);
    END;

    -- ========================================================================
    -- STEP 1c (NEW/MIG_3003): Link appointment bookers to places
    -- ========================================================================
    -- Creates person_place from appointment booking patterns.
    -- Fixes orphaned colonies and general person→place gaps.
    v_current_step := 'step1c_link_appointment_bookers_to_places';
    BEGIN
        SELECT persons_linked
        INTO v_booker_persons
        FROM sot.link_appointment_bookers_to_places();

        v_result := v_result || jsonb_build_object(
            'step1c_booker_persons_linked', COALESCE(v_booker_persons, 0)
        );
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN
            v_status := 'partial_failure';
        END IF;
        v_result := v_result || jsonb_build_object(
            'step1c_error', SQLERRM,
            'step1c_booker_persons_linked', 0
        );
        v_warnings := array_append(v_warnings, 'step1c failed: ' || SQLERRM);
    END;

    -- ========================================================================
    -- STEP 1d (NEW/MIG_3003): Create places for unmatched appointments
    -- ========================================================================
    -- Relaxed address filter catches valid CA addresses without commas.
    v_current_step := 'step1d_create_places_for_unmatched';
    BEGIN
        SELECT places_created, appointments_linked
        INTO v_places_created, v_appts_linked
        FROM sot.create_places_for_unmatched_appointments();

        v_result := v_result || jsonb_build_object(
            'step1d_places_created', COALESCE(v_places_created, 0),
            'step1d_appointments_linked', COALESCE(v_appts_linked, 0)
        );
    EXCEPTION WHEN OTHERS THEN
        IF v_status != 'partial_failure' THEN
            v_status := 'partial_failure';
        END IF;
        v_result := v_result || jsonb_build_object(
            'step1d_error', SQLERRM,
            'step1d_places_created', 0,
            'step1d_appointments_linked', 0
        );
        v_warnings := array_append(v_warnings, 'step1d failed: ' || SQLERRM);
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
        -- Step 7 is non-fatal
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

    -- Log run to history table
    INSERT INTO ops.entity_linking_runs (result, status, warnings, completed_at)
    VALUES (v_result, v_status, v_warnings, NOW())
    RETURNING run_id INTO v_run_id;

    v_result := v_result || jsonb_build_object('run_id', v_run_id);

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.run_all_entity_linking IS
'V2/MIG_3003: Master orchestrator for entity linking pipeline.

Complete pipeline with 11 steps:
1.  link_appointments_to_places() - Resolve inferred_place_id (CRITICAL - abort on failure)
1b. recover_missing_person_places() - Create person→place from ClinicHQ/ShelterLuv source data (NEW)
1c. link_appointment_bookers_to_places() - Create person→place from booking patterns (NEW)
1d. create_places_for_unmatched_appointments() - Relaxed address filter recovery (NEW)
2.  link_cats_to_appointment_places() - PRIMARY: appointment-based cat-place linking
3.  link_cats_to_places() - SECONDARY: person chain fallback (MIG_2906: trapper-aware)
3b. cleanup_stale_person_cat_links() - Remove stale appointment-evidence person_cat links
4.  Cat-Request Attribution:
    4a. cleanup_stale_request_cat_links() - Remove outdated automated links
    4b. link_cats_to_requests_attribution() - Create valid links via place family
5.  link_appointments_to_owners() - Link appointments to people via email (FFS-306)
6.  link_appointments_to_requests() - Link appointments to operational requests (FFS-305)
7.  queue_unofficial_trapper_candidates() - Detect and queue Tier 3 trapper candidates (FFS-449)

MIG_3003 additions fix:
- FFS-919: ShelterLuv adopt/foster cats now get person→place for destination
- FFS-915: More appointment addresses resolved via relaxed filters
- FFS-917: Orphaned colonies get caretaker links from booking data
- FFS-916: Downstream — more cat→place links improve request attribution
';

\echo ''

-- ============================================================================
-- SECTION F: Fix Root Cause — process_shelterluv_people_batch() Person-Place
-- ============================================================================
-- ROOT CAUSE of FFS-919: process_shelterluv_people_batch() extracts address
-- (line 64-69) and passes it to data_engine_resolve_identity() for disambiguation,
-- but NEVER creates a place or person_place link. MIG_2444 was a one-time backfill
-- that covered existing records, but any ShelterLuv person synced AFTER that
-- migration still gets no person_place.
--
-- Fix: After resolving identity, if we have a valid address and person_id,
-- create a place via find_or_create_place_deduped() and link person→place.
-- This matches the pattern MIG_2444 used (confidence 0.8, source 'shelterluv')
-- but uses 0.75 to distinguish ingest-time links from backfill links.

\echo 'F. Fixing ops.process_shelterluv_people_batch() — add person_place creation...'

CREATE OR REPLACE FUNCTION ops.process_shelterluv_people_batch(p_batch_size INTEGER DEFAULT 100)
RETURNS TABLE(
  records_processed INTEGER,
  people_created INTEGER,
  people_updated INTEGER,
  errors INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_record RECORD;
  v_processed INT := 0;
  v_created INT := 0;
  v_updated INT := 0;
  v_errors INT := 0;
  v_person_id UUID;
  v_place_id UUID;
  v_result RECORD;
  v_email TEXT;
  v_phone TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_address TEXT;
BEGIN
  FOR v_record IN
    SELECT sr.id, sr.payload, sr.source_row_id
    FROM ops.staged_records sr
    WHERE sr.source_system = 'shelterluv'
      AND sr.source_table = 'people'
      AND sr.is_processed = FALSE
    ORDER BY sr.created_at ASC
    LIMIT p_batch_size
  LOOP
    v_processed := v_processed + 1;

    BEGIN
      -- Extract fields from payload
      v_email := NULLIF(TRIM(v_record.payload->>'Email'), '');
      v_phone := NULLIF(TRIM(v_record.payload->>'Phone'), '');
      v_first_name := NULLIF(TRIM(v_record.payload->>'Firstname'), '');
      v_last_name := NULLIF(TRIM(v_record.payload->>'Lastname'), '');
      v_address := CONCAT_WS(', ',
        NULLIF(TRIM(v_record.payload->>'Street'), ''),
        NULLIF(TRIM(v_record.payload->>'City'), ''),
        NULLIF(TRIM(v_record.payload->>'State'), ''),
        NULLIF(TRIM(v_record.payload->>'Zip'), '')
      );

      -- Skip if no identifiers
      IF v_email IS NULL AND v_phone IS NULL THEN
        UPDATE ops.staged_records
        SET is_processed = TRUE,
            processor_name = 'process_shelterluv_people_batch',
            processing_error = 'No email or phone'
        WHERE id = v_record.id;
        CONTINUE;
      END IF;

      -- Use correct 6-parameter signature (MIG_2401)
      SELECT * INTO v_result FROM sot.data_engine_resolve_identity(
        v_email,      -- p_email
        v_phone,      -- p_phone
        v_first_name, -- p_first_name
        v_last_name,  -- p_last_name
        v_address,    -- p_address
        'shelterluv'  -- p_source_system
      );

      v_person_id := v_result.resolved_person_id;

      IF v_person_id IS NOT NULL THEN
        IF v_result.decision_type = 'new_entity' THEN
          v_created := v_created + 1;
        ELSE
          v_updated := v_updated + 1;
        END IF;

        -- MIG_3003/FFS-919: Create person_place from ShelterLuv address
        -- Root cause fix: previous version extracted address but never created
        -- a place or person_place link. MIG_2444 was a one-time backfill.
        IF v_address IS NOT NULL AND LENGTH(v_address) > 10 THEN
          BEGIN
            v_place_id := sot.find_or_create_place_deduped(
              v_address, NULL, NULL, NULL, 'shelterluv'
            );
            IF v_place_id IS NOT NULL THEN
              INSERT INTO sot.person_place (
                person_id, place_id, relationship_type,
                evidence_type, confidence, source_system, source_table
              ) VALUES (
                v_person_id, v_place_id, 'resident',
                'inferred', 0.75, 'shelterluv', 'people'
              ) ON CONFLICT (person_id, place_id, relationship_type) DO NOTHING;
            END IF;
          EXCEPTION WHEN OTHERS THEN
            -- Don't fail person processing if place creation fails
            RAISE NOTICE 'SL people batch: place creation failed for person %: %',
              v_person_id, SQLERRM;
          END;
        END IF;

        -- Link to staged record
        UPDATE ops.staged_records
        SET is_processed = TRUE,
            processor_name = 'process_shelterluv_people_batch',
            resulting_entity_type = 'person',
            resulting_entity_id = v_person_id
        WHERE id = v_record.id;
      ELSE
        -- Decision type might be 'rejected' - still mark as processed
        UPDATE ops.staged_records
        SET is_processed = TRUE,
            processor_name = 'process_shelterluv_people_batch',
            processing_error = COALESCE(v_result.reason, 'Data Engine returned NULL')
        WHERE id = v_record.id;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      UPDATE ops.staged_records
      SET is_processed = TRUE,
          processor_name = 'process_shelterluv_people_batch',
          processing_error = SQLERRM
      WHERE id = v_record.id;
    END;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_created, v_updated, v_errors;
END;
$$;

COMMENT ON FUNCTION ops.process_shelterluv_people_batch(INTEGER) IS
'Process ShelterLuv people records through Data Engine (MIG_2401 + MIG_3003).
MIG_3003 fix: Now creates person_place link from ShelterLuv address during ingest.
Previously address was extracted but only used for disambiguation — no place or
person_place was ever created, causing FFS-919 (adopt/foster cats with no place link).
Uses find_or_create_place_deduped() + ON CONFLICT DO NOTHING for safety.';

\echo ''

-- ============================================================================
-- SECTION G: Update History View
-- ============================================================================

\echo 'G. Updating ops.v_entity_linking_history view...'

CREATE OR REPLACE VIEW ops.v_entity_linking_history AS
SELECT
    run_id,
    status,
    (result->>'step1_coverage_pct')::numeric as appointment_coverage_pct,
    -- New steps (MIG_3003)
    (result->>'step1b_persons_from_clinic')::int as persons_recovered_clinic,
    (result->>'step1b_persons_from_shelterluv')::int as persons_recovered_shelterluv,
    (result->>'step1c_booker_persons_linked')::int as booker_persons_linked,
    (result->>'step1d_places_created')::int as unmatched_places_created,
    (result->>'step1d_appointments_linked')::int as unmatched_appts_linked,
    -- Existing steps
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
MIG_3003: Added step1b/1c/1d columns for person recovery and unmatched place creation.';

\echo ''

-- ============================================================================
-- SECTION H: Verification Diagnostics
-- ============================================================================

\echo 'H. Pre-run diagnostics (run entity linking after this migration)...'

DO $$
DECLARE
  v_915_unlinked INT;
  v_916_no_cats INT;
  v_917_orphaned INT;
  v_persons_no_place INT;
BEGIN
  -- Cats with appointments but no place
  SELECT COUNT(DISTINCT a.cat_id) INTO v_915_unlinked
  FROM ops.appointments a
  JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
  WHERE a.cat_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = a.cat_id);

  -- Completed requests with 0 cats
  SELECT COUNT(*) INTO v_916_no_cats
  FROM ops.requests r
  WHERE r.status = 'completed'
    AND r.estimated_cat_count >= 5
    AND NOT EXISTS (SELECT 1 FROM sot.request_cat rc WHERE rc.request_id = r.request_id);

  -- Orphaned colonies
  SELECT COUNT(*) INTO v_917_orphaned
  FROM (
    SELECT cp.place_id
    FROM sot.cat_place cp
    JOIN sot.places p ON p.place_id = cp.place_id AND p.merged_into_place_id IS NULL
    WHERE NOT EXISTS (SELECT 1 FROM sot.person_place pp WHERE pp.place_id = cp.place_id)
    GROUP BY cp.place_id
    HAVING COUNT(DISTINCT cp.cat_id) >= 3
  ) x;

  -- Persons with person_cat but no person_place (the gap these fixes target)
  SELECT COUNT(DISTINCT pc.person_id) INTO v_persons_no_place
  FROM sot.person_cat pc
  JOIN sot.people p ON p.person_id = pc.person_id AND p.merged_into_person_id IS NULL
  WHERE NOT EXISTS (SELECT 1 FROM sot.person_place pp WHERE pp.person_id = pc.person_id);

  RAISE NOTICE 'H: PRE-FIX BASELINES:';
  RAISE NOTICE '   FFS-915 — cats with appts, no cat_place: % (target: decrease from ~1499)', v_915_unlinked;
  RAISE NOTICE '   FFS-916 — completed requests, 0 cats: % (target: decrease from ~25)', v_916_no_cats;
  RAISE NOTICE '   FFS-917 — orphaned colonies (3+ cats): % (target: decrease from ~20)', v_917_orphaned;
  RAISE NOTICE '   Persons with person_cat but no person_place: % (new steps 1b/1c target this)', v_persons_no_place;
END $$;

COMMIT;

\echo ''
\echo '=============================================='
\echo '  MIG_3003 Complete'
\echo '=============================================='
\echo ''
\echo '  Three new pipeline functions created:'
\echo '    - sot.recover_missing_person_places()       [Step 1b]'
\echo '    - sot.link_appointment_bookers_to_places()   [Step 1c]'
\echo '    - sot.create_places_for_unmatched_appointments() [Step 1d]'
\echo ''
\echo '  Root cause fix applied:'
\echo '    - ops.process_shelterluv_people_batch() now creates person_place during ingest'
\echo ''
\echo '  Bugs fixed:'
\echo '    - ShelterLuv address field: Street (V2) vs Street Address 1 (V1) — now COALESCE'
\echo '    - Correlated subquery in link_appointment_bookers_to_places() — pre-computed CTE'
\echo ''
\echo '  run_all_entity_linking() updated with steps 1b/1c/1d.'
\echo ''
\echo '  NEXT: Run entity linking to apply fixes:'
\echo '    SELECT jsonb_pretty(sot.run_all_entity_linking());'
\echo ''
\echo '  Then check ops.v_entity_linking_history for results.'
\echo ''
