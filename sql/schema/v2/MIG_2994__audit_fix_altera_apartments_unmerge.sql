-- MIG_2994: Audit Fix — Altera Apartments Un-merge (7 People via Shared Phone)
--
-- FFS-881: ClinicHQ Data Quality Audit Remediation
-- FFS-883: Un-merge Altera Apartments: 7 people collapsed via shared phone
--
-- Phone 415-246-9162 was shared by 7 unrelated people in 5+ cities.
-- All resolved to a single entity: Altera Apartments (28f4f1ae-a5df-49b6-bb25-2e22cb361eff).
-- 33 appointments and 5 clinic accounts affected.
--
-- This migration:
-- 1. Soft-blacklists the shared phone
-- 2. Creates new person records for 6 distinct identities
-- 3. Reassigns appointments and clinic accounts
-- 4. Cleans up stale person_place links
--
-- Created: 2026-03-27

\echo ''
\echo '=============================================='
\echo '  MIG_2994: Altera Apartments Un-merge'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- STEP 1: Soft-blacklist the shared phone
-- ============================================================================

\echo '1. Soft-blacklisting phone 4152469162...'

INSERT INTO sot.soft_blacklist (identifier_type, identifier_norm, reason, require_name_similarity, created_by)
VALUES ('phone', '4152469162', 'FFS-883: Shared by 7+ unrelated people across 5 cities (Altera Apartments org phone)', 1.0, 'migration')
ON CONFLICT (identifier_type, identifier_norm) DO NOTHING;

\echo '  → Phone blacklisted'

-- ============================================================================
-- STEP 2: Remove the shared phone from sot.person_identifiers
-- ============================================================================
-- The phone was attached to the Altera person. Removing it prevents future
-- matching through this phone number.

\echo '2. Removing shared phone from person_identifiers...'

DELETE FROM sot.person_identifiers
WHERE id_value_norm = '4152469162'
  AND id_type = 'phone';

\echo '  → Phone identifier removed'

-- ============================================================================
-- STEP 3: Create new person records + reassign appointments & accounts
-- ============================================================================

\echo '3. Creating new person records and reassigning data...'

DO $$
DECLARE
  v_altera_id UUID := '28f4f1ae-a5df-49b6-bb25-2e22cb361eff';
  v_new_person_id UUID;
  v_total_reassigned INT := 0;
  v_count INT;
BEGIN
  -- -----------------------------------------------------------------------
  -- 3a. Carla Bass — 15 appointments, Oakland CA
  -- -----------------------------------------------------------------------
  INSERT INTO sot.people (first_name, last_name, display_name, source_system)
  VALUES ('Carla', 'Bass', 'Carla Bass', 'clinichq')
  RETURNING person_id INTO v_new_person_id;

  UPDATE ops.appointments
  SET person_id = v_new_person_id, updated_at = NOW()
  WHERE person_id = v_altera_id
    AND client_name ILIKE '%Carla Bass%';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total_reassigned := v_total_reassigned + v_count;
  RAISE NOTICE '  Carla Bass: % appointments reassigned → %', v_count, v_new_person_id;

  UPDATE ops.clinic_accounts
  SET resolved_person_id = v_new_person_id, updated_at = NOW()
  WHERE account_id = '948906e7-845e-4acc-b07e-5909bbb14122';

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_new_person_id, 'create',
    jsonb_build_object('split_from', v_altera_id, 'client_name', 'Carla Bass', 'address', '8055 Collins Dr, Oakland, CA 94621'),
    jsonb_build_object('person_id', v_new_person_id), 'migration', 'migration',
    'FFS-883: Split from Altera Apartments (shared phone 4152469162)', NOW());

  -- -----------------------------------------------------------------------
  -- 3b. Katherine Henry (Marin Friends Of Ferals) — 4 appointments, Firebaugh CA
  -- -----------------------------------------------------------------------
  INSERT INTO sot.people (first_name, last_name, display_name, source_system)
  VALUES ('Katherine', 'Henry', 'Katherine Henry', 'clinichq')
  RETURNING person_id INTO v_new_person_id;

  UPDATE ops.appointments
  SET person_id = v_new_person_id, updated_at = NOW()
  WHERE person_id = v_altera_id
    AND client_name ILIKE '%Katherine Henry%';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total_reassigned := v_total_reassigned + v_count;
  RAISE NOTICE '  Katherine Henry: % appointments reassigned → %', v_count, v_new_person_id;

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_new_person_id, 'create',
    jsonb_build_object('split_from', v_altera_id, 'client_name', 'Katherine Henry (Marin Friends Of Ferals)', 'address', '46290 West Panoche Rd, Firebaugh, CA 93622'),
    jsonb_build_object('person_id', v_new_person_id), 'migration', 'migration',
    'FFS-883: Split from Altera Apartments (shared phone 4152469162)', NOW());

  -- -----------------------------------------------------------------------
  -- 3c. Jane Brinlee — 4 appointments, El Sobrante CA
  -- -----------------------------------------------------------------------
  INSERT INTO sot.people (first_name, last_name, display_name, source_system)
  VALUES ('Jane', 'Brinlee', 'Jane Brinlee', 'clinichq')
  RETURNING person_id INTO v_new_person_id;

  UPDATE ops.appointments
  SET person_id = v_new_person_id, updated_at = NOW()
  WHERE person_id = v_altera_id
    AND client_name ILIKE '%Jane Brinlee%';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total_reassigned := v_total_reassigned + v_count;
  RAISE NOTICE '  Jane Brinlee: % appointments reassigned → %', v_count, v_new_person_id;

  UPDATE ops.clinic_accounts
  SET resolved_person_id = v_new_person_id, updated_at = NOW()
  WHERE account_id = 'c5b80c47-f476-493f-8f75-df0b4def889d';

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_new_person_id, 'create',
    jsonb_build_object('split_from', v_altera_id, 'client_name', 'Jane Brinlee', 'address', '754 Alhambra Rd, El Sobrante, CA 94803'),
    jsonb_build_object('person_id', v_new_person_id), 'migration', 'migration',
    'FFS-883: Split from Altera Apartments (shared phone 4152469162)', NOW());

  -- -----------------------------------------------------------------------
  -- 3d. Jeanie Garcia — 3 appointments, Valley Ford CA
  -- -----------------------------------------------------------------------
  INSERT INTO sot.people (first_name, last_name, display_name, source_system)
  VALUES ('Jeanie', 'Garcia', 'Jeanie Garcia', 'clinichq')
  RETURNING person_id INTO v_new_person_id;

  UPDATE ops.appointments
  SET person_id = v_new_person_id, updated_at = NOW()
  WHERE person_id = v_altera_id
    AND client_name ILIKE '%Jeanie Garcia%';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total_reassigned := v_total_reassigned + v_count;
  RAISE NOTICE '  Jeanie Garcia: % appointments reassigned → %', v_count, v_new_person_id;

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_new_person_id, 'create',
    jsonb_build_object('split_from', v_altera_id, 'client_name', 'Jeanie Garcia', 'address', '14485 Valley Ford Rd, Valley Ford, CA 94972'),
    jsonb_build_object('person_id', v_new_person_id), 'migration', 'migration',
    'FFS-883: Split from Altera Apartments (shared phone 4152469162)', NOW());

  -- -----------------------------------------------------------------------
  -- 3e. Harris Wolfson — 3 appointments, Petaluma CA
  -- -----------------------------------------------------------------------
  INSERT INTO sot.people (first_name, last_name, display_name, source_system)
  VALUES ('Harris', 'Wolfson', 'Harris Wolfson', 'clinichq')
  RETURNING person_id INTO v_new_person_id;

  UPDATE ops.appointments
  SET person_id = v_new_person_id, updated_at = NOW()
  WHERE person_id = v_altera_id
    AND client_name ILIKE '%Harris Wolfson%';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total_reassigned := v_total_reassigned + v_count;
  RAISE NOTICE '  Harris Wolfson: % appointments reassigned → %', v_count, v_new_person_id;

  UPDATE ops.clinic_accounts
  SET resolved_person_id = v_new_person_id, updated_at = NOW()
  WHERE account_id = '96d4bc3c-45db-4758-8279-207fc911cd36';

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_new_person_id, 'create',
    jsonb_build_object('split_from', v_altera_id, 'client_name', 'Harris Wolfson', 'address', '21 Liberty Ln, Petaluma, CA 94952'),
    jsonb_build_object('person_id', v_new_person_id), 'migration', 'migration',
    'FFS-883: Split from Altera Apartments (shared phone 4152469162)', NOW());

  -- -----------------------------------------------------------------------
  -- 3f. Jan Curry — 2 appointments, Novato CA
  -- -----------------------------------------------------------------------
  INSERT INTO sot.people (first_name, last_name, display_name, source_system)
  VALUES ('Jan', 'Curry', 'Jan Curry', 'clinichq')
  RETURNING person_id INTO v_new_person_id;

  UPDATE ops.appointments
  SET person_id = v_new_person_id, updated_at = NOW()
  WHERE person_id = v_altera_id
    AND client_name ILIKE '%Jan Curry%';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total_reassigned := v_total_reassigned + v_count;
  RAISE NOTICE '  Jan Curry: % appointments reassigned → %', v_count, v_new_person_id;

  UPDATE ops.clinic_accounts
  SET resolved_person_id = v_new_person_id, updated_at = NOW()
  WHERE account_id = '26fc4905-8d7a-49fd-afce-31532fddfda6';

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_new_person_id, 'create',
    jsonb_build_object('split_from', v_altera_id, 'client_name', 'Jan Curry', 'address', '99 Darryl Ave, Novato, CA 94947'),
    jsonb_build_object('person_id', v_new_person_id), 'migration', 'migration',
    'FFS-883: Split from Altera Apartments (shared phone 4152469162)', NOW());

  -- -----------------------------------------------------------------------
  -- 3g. Altera Apartments — 2 appointments, Petaluma CA (keeps original entity)
  -- -----------------------------------------------------------------------
  -- The Altera Apartments clinic account stays resolved to the original entity.
  -- Just ensure its account_type is correct.
  UPDATE ops.clinic_accounts
  SET account_type = 'organization', updated_at = NOW()
  WHERE account_id = '7c6e8e46-3c02-456c-8375-c74b7779545e'
    AND account_type IS DISTINCT FROM 'organization';

  RAISE NOTICE 'Total appointments reassigned from Altera: % (expect 31 of 33)', v_total_reassigned;

  -- Log the overall un-merge operation
  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_altera_id, 'unmerge',
    jsonb_build_object(
      'original_appointment_count', 33,
      'shared_phone', '4152469162',
      'absorbed_identities', 7
    ),
    jsonb_build_object(
      'appointments_reassigned', v_total_reassigned,
      'new_people_created', 6,
      'remaining_appointments', 2
    ),
    'migration', 'migration',
    'FFS-883: Un-merge Altera Apartments — 7 people collapsed via shared phone 4152469162',
    NOW());
END $$;

\echo '  → New people created and appointments reassigned'

-- ============================================================================
-- STEP 4: Clean up stale person_place links on Altera
-- ============================================================================
-- Altera was linked to places from all 7 identities' addresses.
-- Keep only the Baywood Dr link (actual Altera Apartments address).

\echo '4. Cleaning up stale person_place links...'

DO $$
DECLARE
  v_deleted INT;
  v_altera_id UUID := '28f4f1ae-a5df-49b6-bb25-2e22cb361eff';
BEGIN
  -- Delete person_place rows for Altera that aren't at its actual address
  -- Keep links to places whose address contains "Baywood" (Altera's real address)
  WITH deleted AS (
    DELETE FROM sot.person_place pp
    WHERE pp.person_id = v_altera_id
      AND NOT EXISTS (
        SELECT 1 FROM sot.places p
        WHERE p.place_id = pp.place_id
          AND p.formatted_address ILIKE '%Baywood%'
      )
    RETURNING pp.place_id
  )
  SELECT COUNT(*) INTO v_deleted FROM deleted;

  RAISE NOTICE 'Removed % stale person_place links from Altera', v_deleted;
END $$;

-- Also clean up person_cat links — Altera (an apartment complex) shouldn't own cats
DO $$
DECLARE
  v_deleted INT;
  v_altera_id UUID := '28f4f1ae-a5df-49b6-bb25-2e22cb361eff';
BEGIN
  WITH deleted AS (
    DELETE FROM sot.person_cat
    WHERE person_id = v_altera_id
    RETURNING cat_id
  )
  SELECT COUNT(*) INTO v_deleted FROM deleted;

  RAISE NOTICE 'Removed % person_cat links from Altera', v_deleted;
END $$;

\echo '  → Stale links cleaned'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo 'Verification...'

DO $$
DECLARE
  v_altera_appts INT;
  v_altera_id UUID := '28f4f1ae-a5df-49b6-bb25-2e22cb361eff';
  v_blacklisted BOOLEAN;
  v_orphaned INT;
BEGIN
  -- Check Altera has only its own 2 appointments
  SELECT COUNT(*) INTO v_altera_appts
  FROM ops.appointments
  WHERE person_id = v_altera_id;
  RAISE NOTICE 'Altera remaining appointments: % (expect 2)', v_altera_appts;

  -- Check phone is blacklisted
  SELECT EXISTS(
    SELECT 1 FROM sot.soft_blacklist
    WHERE identifier_type = 'phone' AND identifier_norm = '4152469162'
  ) INTO v_blacklisted;
  RAISE NOTICE 'Phone blacklisted: %', v_blacklisted;

  -- Check no orphaned appointments (person_id still points to Altera but client_name isn't "Altera")
  SELECT COUNT(*) INTO v_orphaned
  FROM ops.appointments
  WHERE person_id = v_altera_id
    AND client_name NOT ILIKE '%Altera%';
  RAISE NOTICE 'Orphaned appointments (non-Altera name still on Altera): % (expect 0)', v_orphaned;

  IF v_altera_appts > 2 THEN
    RAISE WARNING 'Altera still has more than 2 appointments — check for unhandled client names';
  END IF;
  IF NOT v_blacklisted THEN
    RAISE WARNING 'Phone 4152469162 NOT blacklisted — insert failed';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- POST-MIGRATION: Re-run entity linking to refresh derived relationships
-- ============================================================================

\echo ''
\echo 'Post-migration: Re-running entity linking...'
\echo '  Run manually: SELECT sot.run_all_entity_linking();'
\echo ''
\echo '=============================================='
\echo '  MIG_2994 COMPLETE'
\echo '=============================================='
\echo ''
