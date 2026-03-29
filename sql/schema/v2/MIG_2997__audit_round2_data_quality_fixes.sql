-- MIG_2997: Audit Round 2 — Data Quality Fixes
--
-- FFS-892: Migration for Round 2 audit remediation
--
-- Sections:
-- A: Blacklist SCAS phones + split 2 real people from SCAS entity
-- B: Split 5 multi-identity people (~29 appointments)
-- C: Delete ~1,772 stale person_cat links (orphaned by Mar 25 reclassification)
-- D: Clean up E2E test pollution
-- E: Fix places missing sot_address_id
--
-- Created: 2026-03-27

\echo ''
\echo '=============================================='
\echo '  MIG_2997: Audit Round 2 — Data Quality Fixes'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- SECTION A: Blacklist SCAS phones + split 2 real people (FFS-892)
-- ============================================================================
-- SCAS (Sonoma County Animal Services) org phones absorbed individuals.
-- Two phones shared across multiple unrelated people all resolved to one entity.

\echo 'A. Blacklisting SCAS phones and splitting absorbed people...'

-- A1. Soft-blacklist SCAS phones
INSERT INTO sot.soft_blacklist (identifier_type, identifier_norm, reason, require_name_similarity, created_by)
VALUES
  ('phone', '7075657100', 'FFS-892: SCAS org phone absorbing individuals', 1.0, 'migration'),
  ('phone', '7075797999', 'FFS-892: SCAS org phone absorbing individuals', 1.0, 'migration')
ON CONFLICT (identifier_type, identifier_norm) DO NOTHING;

\echo '  → SCAS phones blacklisted'

-- A2. Remove SCAS phone identifiers from person_identifiers
DELETE FROM sot.person_identifiers
WHERE id_value_norm IN ('7075657100', '7075797999')
  AND id_type = 'phone';

\echo '  → SCAS phone identifiers removed'

-- A3. Split Gill Stiles and Kelli Snedeker out of SCAS entity
DO $$
DECLARE
  v_scas_id UUID := 'fe649373-55ad-4767-8dc7-3d51062eca51';
  v_new_person_id UUID;
  v_count INT;
BEGIN
  -- Gill Stiles (1 appointment)
  INSERT INTO sot.people (first_name, last_name, display_name, source_system)
  VALUES ('Gill', 'Stiles', 'Gill Stiles', 'clinichq')
  RETURNING person_id INTO v_new_person_id;

  UPDATE ops.appointments
  SET person_id = v_new_person_id, updated_at = NOW()
  WHERE person_id = v_scas_id
    AND client_name ILIKE '%Gill Stiles%';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '  Gill Stiles: % appointments reassigned → %', v_count, v_new_person_id;

  UPDATE ops.clinic_accounts
  SET resolved_person_id = v_new_person_id, updated_at = NOW()
  WHERE resolved_person_id = v_scas_id
    AND display_name ILIKE '%Gill Stiles%';

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_new_person_id, 'create',
    jsonb_build_object('split_from', v_scas_id, 'client_name', 'Gill Stiles'),
    jsonb_build_object('person_id', v_new_person_id), 'migration', 'migration',
    'FFS-892: Split from SCAS entity (org phone absorption)', NOW());

  -- Kelli Snedeker (1 appointment)
  INSERT INTO sot.people (first_name, last_name, display_name, source_system)
  VALUES ('Kelli', 'Snedeker', 'Kelli Snedeker', 'clinichq')
  RETURNING person_id INTO v_new_person_id;

  UPDATE ops.appointments
  SET person_id = v_new_person_id, updated_at = NOW()
  WHERE person_id = v_scas_id
    AND client_name ILIKE '%Kelli Snedeker%';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '  Kelli Snedeker: % appointments reassigned → %', v_count, v_new_person_id;

  UPDATE ops.clinic_accounts
  SET resolved_person_id = v_new_person_id, updated_at = NOW()
  WHERE resolved_person_id = v_scas_id
    AND display_name ILIKE '%Kelli Snedeker%';

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_new_person_id, 'create',
    jsonb_build_object('split_from', v_scas_id, 'client_name', 'Kelli Snedeker'),
    jsonb_build_object('person_id', v_new_person_id), 'migration', 'migration',
    'FFS-892: Split from SCAS entity (org phone absorption)', NOW());
END $$;

\echo '  → SCAS splits complete'

-- ============================================================================
-- SECTION B: Split 5 multi-identity people (FFS-892)
-- ============================================================================
-- Five people have multiple unrelated identities collapsed via shared phone/email.
-- Each DO block: find source → create new person → reassign appointments + accounts.

\echo ''
\echo 'B. Splitting multi-identity people...'

-- B1. Sharon Conley (f8d88cc0...) — split out Kimberly Seanor (7), Lee Gillespie (4), Susan Rose (3)
\echo '  B1. Sharon Conley...'

DO $$
DECLARE
  v_source_id UUID;
  v_new_person_id UUID;
  v_count INT;
  v_total_reassigned INT := 0;
BEGIN
  SELECT person_id INTO STRICT v_source_id
  FROM sot.people
  WHERE person_id::TEXT LIKE 'f8d88cc0-%'
    AND merged_into_person_id IS NULL;

  -- Kimberly Seanor (7 appointments)
  INSERT INTO sot.people (first_name, last_name, display_name, source_system)
  VALUES ('Kimberly', 'Seanor', 'Kimberly Seanor', 'clinichq')
  RETURNING person_id INTO v_new_person_id;

  UPDATE ops.appointments
  SET person_id = v_new_person_id, updated_at = NOW()
  WHERE person_id = v_source_id
    AND client_name ILIKE '%Kimberly Seanor%';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total_reassigned := v_total_reassigned + v_count;
  RAISE NOTICE '  Kimberly Seanor: % appointments reassigned → %', v_count, v_new_person_id;

  UPDATE ops.clinic_accounts
  SET resolved_person_id = v_new_person_id, updated_at = NOW()
  WHERE resolved_person_id = v_source_id
    AND display_name ILIKE '%Kimberly Seanor%';

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_new_person_id, 'create',
    jsonb_build_object('split_from', v_source_id, 'client_name', 'Kimberly Seanor'),
    jsonb_build_object('person_id', v_new_person_id), 'migration', 'migration',
    'FFS-892: Split from Sharon Conley (multi-identity)', NOW());

  -- Lee Gillespie (4 appointments)
  INSERT INTO sot.people (first_name, last_name, display_name, source_system)
  VALUES ('Lee', 'Gillespie', 'Lee Gillespie', 'clinichq')
  RETURNING person_id INTO v_new_person_id;

  UPDATE ops.appointments
  SET person_id = v_new_person_id, updated_at = NOW()
  WHERE person_id = v_source_id
    AND client_name ILIKE '%Lee Gillespie%';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total_reassigned := v_total_reassigned + v_count;
  RAISE NOTICE '  Lee Gillespie: % appointments reassigned → %', v_count, v_new_person_id;

  UPDATE ops.clinic_accounts
  SET resolved_person_id = v_new_person_id, updated_at = NOW()
  WHERE resolved_person_id = v_source_id
    AND display_name ILIKE '%Lee Gillespie%';

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_new_person_id, 'create',
    jsonb_build_object('split_from', v_source_id, 'client_name', 'Lee Gillespie'),
    jsonb_build_object('person_id', v_new_person_id), 'migration', 'migration',
    'FFS-892: Split from Sharon Conley (multi-identity)', NOW());

  -- Susan Rose (3 appointments)
  INSERT INTO sot.people (first_name, last_name, display_name, source_system)
  VALUES ('Susan', 'Rose', 'Susan Rose', 'clinichq')
  RETURNING person_id INTO v_new_person_id;

  UPDATE ops.appointments
  SET person_id = v_new_person_id, updated_at = NOW()
  WHERE person_id = v_source_id
    AND client_name ILIKE '%Susan Rose%';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total_reassigned := v_total_reassigned + v_count;
  RAISE NOTICE '  Susan Rose: % appointments reassigned → %', v_count, v_new_person_id;

  UPDATE ops.clinic_accounts
  SET resolved_person_id = v_new_person_id, updated_at = NOW()
  WHERE resolved_person_id = v_source_id
    AND display_name ILIKE '%Susan Rose%';

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_new_person_id, 'create',
    jsonb_build_object('split_from', v_source_id, 'client_name', 'Susan Rose'),
    jsonb_build_object('person_id', v_new_person_id), 'migration', 'migration',
    'FFS-892: Split from Sharon Conley (multi-identity)', NOW());

  RAISE NOTICE 'Sharon Conley: % total appointments reassigned (expect 14, leaving ~8)', v_total_reassigned;

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_source_id, 'unmerge',
    jsonb_build_object('split_identities', ARRAY['Kimberly Seanor', 'Lee Gillespie', 'Susan Rose']),
    jsonb_build_object('appointments_reassigned', v_total_reassigned, 'new_people_created', 3),
    'migration', 'migration',
    'FFS-892: Split 3 people from Sharon Conley (multi-identity)', NOW());
END $$;

\echo '  → Sharon Conley splits complete'

-- B2. Marie Pullman (8725ee82...) — split out PJ Belmont (3), VIAVI Corporation → NULL (1)
\echo '  B2. Marie Pullman...'

DO $$
DECLARE
  v_source_id UUID;
  v_new_person_id UUID;
  v_count INT;
  v_total_reassigned INT := 0;
BEGIN
  SELECT person_id INTO STRICT v_source_id
  FROM sot.people
  WHERE person_id::TEXT LIKE '8725ee82-%'
    AND merged_into_person_id IS NULL;

  -- PJ Belmont (3 appointments)
  INSERT INTO sot.people (first_name, last_name, display_name, source_system)
  VALUES ('PJ', 'Belmont', 'PJ Belmont', 'clinichq')
  RETURNING person_id INTO v_new_person_id;

  UPDATE ops.appointments
  SET person_id = v_new_person_id, updated_at = NOW()
  WHERE person_id = v_source_id
    AND client_name ILIKE '%PJ Belmont%';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total_reassigned := v_total_reassigned + v_count;
  RAISE NOTICE '  PJ Belmont: % appointments reassigned → %', v_count, v_new_person_id;

  UPDATE ops.clinic_accounts
  SET resolved_person_id = v_new_person_id, updated_at = NOW()
  WHERE resolved_person_id = v_source_id
    AND display_name ILIKE '%PJ Belmont%';

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_new_person_id, 'create',
    jsonb_build_object('split_from', v_source_id, 'client_name', 'PJ Belmont'),
    jsonb_build_object('person_id', v_new_person_id), 'migration', 'migration',
    'FFS-892: Split from Marie Pullman (multi-identity)', NOW());

  -- VIAVI Corporation (1 appointment) — org name, don't create a person
  UPDATE ops.appointments
  SET person_id = NULL, updated_at = NOW()
  WHERE person_id = v_source_id
    AND client_name ILIKE '%VIAVI%';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total_reassigned := v_total_reassigned + v_count;
  RAISE NOTICE '  VIAVI Corporation: % appointments nullified', v_count;

  UPDATE ops.clinic_accounts
  SET resolved_person_id = NULL, updated_at = NOW()
  WHERE resolved_person_id = v_source_id
    AND display_name ILIKE '%VIAVI%';

  RAISE NOTICE 'Marie Pullman: % total appointments affected (expect 4)', v_total_reassigned;

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_source_id, 'unmerge',
    jsonb_build_object('split_identities', ARRAY['PJ Belmont', 'VIAVI Corporation (→NULL)'], 'appointments_affected', v_total_reassigned),
    jsonb_build_object('new_people_created', 1, 'nullified', 1),
    'migration', 'migration',
    'FFS-892: Split PJ Belmont + nullify VIAVI from Marie Pullman', NOW());
END $$;

\echo '  → Marie Pullman splits complete'

-- B3. Bettina Kirby (e364ae05...) — split out Frances Batey (7), Bob Garcia (1)
\echo '  B3. Bettina Kirby...'

DO $$
DECLARE
  v_source_id UUID;
  v_new_person_id UUID;
  v_count INT;
  v_total_reassigned INT := 0;
BEGIN
  SELECT person_id INTO STRICT v_source_id
  FROM sot.people
  WHERE person_id::TEXT LIKE 'e364ae05-%'
    AND merged_into_person_id IS NULL;

  -- Frances Batey (7 appointments)
  INSERT INTO sot.people (first_name, last_name, display_name, source_system)
  VALUES ('Frances', 'Batey', 'Frances Batey', 'clinichq')
  RETURNING person_id INTO v_new_person_id;

  UPDATE ops.appointments
  SET person_id = v_new_person_id, updated_at = NOW()
  WHERE person_id = v_source_id
    AND client_name ILIKE '%Frances Batey%';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total_reassigned := v_total_reassigned + v_count;
  RAISE NOTICE '  Frances Batey: % appointments reassigned → %', v_count, v_new_person_id;

  UPDATE ops.clinic_accounts
  SET resolved_person_id = v_new_person_id, updated_at = NOW()
  WHERE resolved_person_id = v_source_id
    AND display_name ILIKE '%Frances Batey%';

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_new_person_id, 'create',
    jsonb_build_object('split_from', v_source_id, 'client_name', 'Frances Batey'),
    jsonb_build_object('person_id', v_new_person_id), 'migration', 'migration',
    'FFS-892: Split from Bettina Kirby (multi-identity)', NOW());

  -- Bob Garcia (1 appointment)
  INSERT INTO sot.people (first_name, last_name, display_name, source_system)
  VALUES ('Bob', 'Garcia', 'Bob Garcia', 'clinichq')
  RETURNING person_id INTO v_new_person_id;

  UPDATE ops.appointments
  SET person_id = v_new_person_id, updated_at = NOW()
  WHERE person_id = v_source_id
    AND client_name ILIKE '%Bob Garcia%';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total_reassigned := v_total_reassigned + v_count;
  RAISE NOTICE '  Bob Garcia: % appointments reassigned → %', v_count, v_new_person_id;

  UPDATE ops.clinic_accounts
  SET resolved_person_id = v_new_person_id, updated_at = NOW()
  WHERE resolved_person_id = v_source_id
    AND display_name ILIKE '%Bob Garcia%';

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_new_person_id, 'create',
    jsonb_build_object('split_from', v_source_id, 'client_name', 'Bob Garcia'),
    jsonb_build_object('person_id', v_new_person_id), 'migration', 'migration',
    'FFS-892: Split from Bettina Kirby (multi-identity)', NOW());

  RAISE NOTICE 'Bettina Kirby: % total appointments reassigned (expect 8)', v_total_reassigned;

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_source_id, 'unmerge',
    jsonb_build_object('split_identities', ARRAY['Frances Batey', 'Bob Garcia'], 'appointments_affected', v_total_reassigned),
    jsonb_build_object('new_people_created', 2),
    'migration', 'migration',
    'FFS-892: Split 2 people from Bettina Kirby (multi-identity)', NOW());
END $$;

\echo '  → Bettina Kirby splits complete'

-- B4. Maria Padilla (17a879b9...) — split out Elena Delgado (1), Martin Ortiz (1)
\echo '  B4. Maria Padilla...'

DO $$
DECLARE
  v_source_id UUID;
  v_new_person_id UUID;
  v_count INT;
  v_total_reassigned INT := 0;
BEGIN
  SELECT person_id INTO STRICT v_source_id
  FROM sot.people
  WHERE person_id::TEXT LIKE '17a879b9-%'
    AND merged_into_person_id IS NULL;

  -- Elena Delgado (1 appointment)
  INSERT INTO sot.people (first_name, last_name, display_name, source_system)
  VALUES ('Elena', 'Delgado', 'Elena Delgado', 'clinichq')
  RETURNING person_id INTO v_new_person_id;

  UPDATE ops.appointments
  SET person_id = v_new_person_id, updated_at = NOW()
  WHERE person_id = v_source_id
    AND client_name ILIKE '%Elena Delgado%';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total_reassigned := v_total_reassigned + v_count;
  RAISE NOTICE '  Elena Delgado: % appointments reassigned → %', v_count, v_new_person_id;

  UPDATE ops.clinic_accounts
  SET resolved_person_id = v_new_person_id, updated_at = NOW()
  WHERE resolved_person_id = v_source_id
    AND display_name ILIKE '%Elena Delgado%';

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_new_person_id, 'create',
    jsonb_build_object('split_from', v_source_id, 'client_name', 'Elena Delgado'),
    jsonb_build_object('person_id', v_new_person_id), 'migration', 'migration',
    'FFS-892: Split from Maria Padilla (multi-identity)', NOW());

  -- Martin Ortiz (1 appointment)
  INSERT INTO sot.people (first_name, last_name, display_name, source_system)
  VALUES ('Martin', 'Ortiz', 'Martin Ortiz', 'clinichq')
  RETURNING person_id INTO v_new_person_id;

  UPDATE ops.appointments
  SET person_id = v_new_person_id, updated_at = NOW()
  WHERE person_id = v_source_id
    AND client_name ILIKE '%Martin Ortiz%';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total_reassigned := v_total_reassigned + v_count;
  RAISE NOTICE '  Martin Ortiz: % appointments reassigned → %', v_count, v_new_person_id;

  UPDATE ops.clinic_accounts
  SET resolved_person_id = v_new_person_id, updated_at = NOW()
  WHERE resolved_person_id = v_source_id
    AND display_name ILIKE '%Martin Ortiz%';

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_new_person_id, 'create',
    jsonb_build_object('split_from', v_source_id, 'client_name', 'Martin Ortiz'),
    jsonb_build_object('person_id', v_new_person_id), 'migration', 'migration',
    'FFS-892: Split from Maria Padilla (multi-identity)', NOW());

  RAISE NOTICE 'Maria Padilla: % total appointments reassigned (expect 2)', v_total_reassigned;

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_source_id, 'unmerge',
    jsonb_build_object('split_identities', ARRAY['Elena Delgado', 'Martin Ortiz'], 'appointments_affected', v_total_reassigned),
    jsonb_build_object('new_people_created', 2),
    'migration', 'migration',
    'FFS-892: Split 2 people from Maria Padilla (multi-identity)', NOW());
END $$;

\echo '  → Maria Padilla splits complete'

-- B5. Isabel Abarca (3894a965...) — split out Alexis Roldan (1)
\echo '  B5. Isabel Abarca...'

DO $$
DECLARE
  v_source_id UUID;
  v_new_person_id UUID;
  v_count INT;
BEGIN
  SELECT person_id INTO STRICT v_source_id
  FROM sot.people
  WHERE person_id::TEXT LIKE '3894a965-%'
    AND merged_into_person_id IS NULL;

  -- Alexis Roldan (1 appointment)
  INSERT INTO sot.people (first_name, last_name, display_name, source_system)
  VALUES ('Alexis', 'Roldan', 'Alexis Roldan', 'clinichq')
  RETURNING person_id INTO v_new_person_id;

  UPDATE ops.appointments
  SET person_id = v_new_person_id, updated_at = NOW()
  WHERE person_id = v_source_id
    AND client_name ILIKE '%Alexis Roldan%';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '  Alexis Roldan: % appointments reassigned → %', v_count, v_new_person_id;

  UPDATE ops.clinic_accounts
  SET resolved_person_id = v_new_person_id, updated_at = NOW()
  WHERE resolved_person_id = v_source_id
    AND display_name ILIKE '%Alexis Roldan%';

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_new_person_id, 'create',
    jsonb_build_object('split_from', v_source_id, 'client_name', 'Alexis Roldan'),
    jsonb_build_object('person_id', v_new_person_id), 'migration', 'migration',
    'FFS-892: Split from Isabel Abarca (multi-identity)', NOW());

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('person', v_source_id, 'unmerge',
    jsonb_build_object('split_identities', ARRAY['Alexis Roldan'], 'appointments_affected', v_count),
    jsonb_build_object('new_people_created', 1),
    'migration', 'migration',
    'FFS-892: Split Alexis Roldan from Isabel Abarca', NOW());
END $$;

\echo '  → Isabel Abarca split complete'

-- ============================================================================
-- SECTION C: Delete stale person_cat links (FFS-892)
-- ============================================================================
-- Root cause: MIG_2871 created person_cat links from appointments, then the
-- Mar 25 reclassification (MIG_2982) cleared person_id on ~7,500 appointments
-- but didn't clean corresponding person_cat rows. ~1,772 links now reference
-- person+cat pairs with no supporting appointment.

\echo ''
\echo 'C. Deleting stale person_cat links...'

DO $$
DECLARE
  v_deleted INT;
BEGIN
  WITH deleted AS (
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
  SELECT COUNT(*) INTO v_deleted FROM deleted;

  RAISE NOTICE 'C: Deleted % stale person_cat links (expect ~1,772)', v_deleted;

  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES ('system', gen_random_uuid(), 'bulk_fix',
    jsonb_build_object('stale_person_cat_deleted', v_deleted),
    jsonb_build_object('fix', 'Deleted clinichq appointment-evidence person_cat links with no matching appointment'),
    'migration', 'migration',
    'FFS-892: Clean stale person_cat links orphaned by MIG_2982 reclassification', NOW());
END $$;

\echo '  → Stale person_cat links deleted'

-- ============================================================================
-- SECTION D: Clean up E2E test people (FFS-892)
-- ============================================================================
-- E2E tests created test people with display_name containing 'E2E'.
-- Hard delete is OK — test data with no real relationships.

\echo ''
\echo 'D. Cleaning up E2E test people...'

DO $$
DECLARE
  v_people_deleted INT;
  v_pi_deleted INT;
  v_pp_deleted INT;
  v_pc_deleted INT;
BEGIN
  -- Delete in FK order to avoid constraint violations

  -- 1. person_identifiers
  WITH deleted AS (
    DELETE FROM sot.person_identifiers pi
    WHERE pi.person_id IN (
      SELECT person_id FROM sot.people WHERE display_name ILIKE '%E2E%'
    )
    RETURNING pi.person_id
  )
  SELECT COUNT(*) INTO v_pi_deleted FROM deleted;

  -- 2. person_place
  WITH deleted AS (
    DELETE FROM sot.person_place pp
    WHERE pp.person_id IN (
      SELECT person_id FROM sot.people WHERE display_name ILIKE '%E2E%'
    )
    RETURNING pp.person_id
  )
  SELECT COUNT(*) INTO v_pp_deleted FROM deleted;

  -- 3. person_cat
  WITH deleted AS (
    DELETE FROM sot.person_cat pc
    WHERE pc.person_id IN (
      SELECT person_id FROM sot.people WHERE display_name ILIKE '%E2E%'
    )
    RETURNING pc.person_id
  )
  SELECT COUNT(*) INTO v_pc_deleted FROM deleted;

  -- 4. people
  WITH deleted AS (
    DELETE FROM sot.people
    WHERE display_name ILIKE '%E2E%'
    RETURNING person_id
  )
  SELECT COUNT(*) INTO v_people_deleted FROM deleted;

  RAISE NOTICE 'D: Deleted % E2E test people (identifiers=%, places=%, cats=%)',
    v_people_deleted, v_pi_deleted, v_pp_deleted, v_pc_deleted;
END $$;

\echo '  → E2E test people cleaned'

-- ============================================================================
-- SECTION E: Fix places missing sot_address_id (FFS-892)
-- ============================================================================
-- Places with formatted_address but no sot_address_id violate the invariant
-- that every place with a formatted address MUST link to sot.addresses.

\echo ''
\echo 'E. Fixing places missing sot_address_id...'

DO $$
DECLARE
  v_place RECORD;
  v_address_id UUID;
  v_fixed INT := 0;
BEGIN
  FOR v_place IN
    SELECT place_id, formatted_address, latitude, longitude
    FROM sot.places
    WHERE formatted_address IS NOT NULL
      AND sot_address_id IS NULL
      AND merged_into_place_id IS NULL
  LOOP
    v_address_id := sot.find_or_create_address(
      p_raw_input := v_place.formatted_address,
      p_formatted_address := v_place.formatted_address,
      p_lat := v_place.latitude,
      p_lng := v_place.longitude,
      p_source_system := 'migration'
    );

    UPDATE sot.places
    SET sot_address_id = v_address_id, updated_at = NOW()
    WHERE place_id = v_place.place_id;

    v_fixed := v_fixed + 1;
  END LOOP;

  RAISE NOTICE 'E: Fixed % places with missing sot_address_id', v_fixed;
END $$;

\echo '  → Places fixed'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo 'Verification...'

DO $$
DECLARE
  v_scas_phones INT;
  v_sharon_appts INT;
  v_viavi_null BOOLEAN;
  v_stale_pc INT;
  v_e2e_people INT;
  v_missing_addr INT;
BEGIN
  -- Check SCAS phones in soft_blacklist
  SELECT COUNT(*) INTO v_scas_phones
  FROM sot.soft_blacklist
  WHERE identifier_norm IN ('7075657100', '7075797999');
  RAISE NOTICE 'SCAS phones in soft_blacklist: % (expect 2)', v_scas_phones;

  -- Check Sharon Conley remaining appointments
  SELECT COUNT(*) INTO v_sharon_appts
  FROM ops.appointments a
  JOIN sot.people p ON a.person_id = p.person_id
  WHERE p.person_id::TEXT LIKE 'f8d88cc0-%'
    AND p.merged_into_person_id IS NULL;
  RAISE NOTICE 'Sharon Conley remaining appointments: % (expect ~8)', v_sharon_appts;

  -- Check VIAVI appointment has NULL person_id
  SELECT EXISTS(
    SELECT 1 FROM ops.appointments
    WHERE client_name ILIKE '%VIAVI%'
      AND person_id IS NULL
  ) INTO v_viavi_null;
  RAISE NOTICE 'VIAVI appointment person_id is NULL: %', v_viavi_null;

  -- Check stale person_cat links
  SELECT COUNT(*) INTO v_stale_pc
  FROM sot.person_cat pc
  WHERE pc.source_system = 'clinichq'
    AND pc.evidence_type = 'appointment'
    AND NOT EXISTS (
      SELECT 1 FROM ops.appointments a
      WHERE a.person_id = pc.person_id
        AND a.cat_id = pc.cat_id
    );
  RAISE NOTICE 'Stale person_cat links: % (expect 0)', v_stale_pc;

  -- Check E2E test people
  SELECT COUNT(*) INTO v_e2e_people
  FROM sot.people
  WHERE display_name ILIKE '%E2E%';
  RAISE NOTICE 'E2E test people remaining: % (expect 0)', v_e2e_people;

  -- Check places missing sot_address_id
  SELECT COUNT(*) INTO v_missing_addr
  FROM sot.places
  WHERE formatted_address IS NOT NULL
    AND sot_address_id IS NULL
    AND merged_into_place_id IS NULL;
  RAISE NOTICE 'Places missing sot_address_id: % (expect 0)', v_missing_addr;

  -- Fail-safe assertions
  IF v_scas_phones < 2 THEN
    RAISE WARNING 'SCAS phones NOT fully blacklisted';
  END IF;
  IF v_stale_pc > 0 THEN
    RAISE WARNING 'Stale person_cat links REMAIN — investigate';
  END IF;
  IF v_e2e_people > 0 THEN
    RAISE WARNING 'E2E test people REMAIN — check for FK constraints';
  END IF;
  IF v_missing_addr > 0 THEN
    RAISE WARNING 'Places still missing sot_address_id — check find_or_create_address()';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- POST-MIGRATION: Re-run entity linking
-- ============================================================================

\echo ''
\echo 'Post-migration: Re-run entity linking to refresh derived relationships:'
\echo '  SELECT jsonb_pretty(sot.run_all_entity_linking());'
\echo ''
\echo '=============================================='
\echo '  MIG_2997 COMPLETE'
\echo '=============================================='
\echo ''
