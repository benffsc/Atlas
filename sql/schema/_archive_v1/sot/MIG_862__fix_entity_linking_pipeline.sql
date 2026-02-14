\echo '=== MIG_862: Fix Entity Linking Pipeline ==='
\echo 'Fixes DQ_CLINIC_001: column reference bug, adds person-cat step, increases batch limit'
\echo ''

-- ============================================================================
-- FIX 1: Increase batch limit in link_appointments_to_owners (500 → 2000)
-- ============================================================================

\echo 'Step 1: Recreating link_appointments_to_owners with higher batch limit...'

CREATE OR REPLACE FUNCTION trapper.link_appointments_to_owners()
RETURNS TABLE (
  appointments_updated INT,
  persons_created INT,
  persons_linked INT
) AS $$
DECLARE
  v_updated INT := 0;
  v_persons_created INT := 0;
  v_persons_linked INT := 0;
BEGIN
  -- Step 1: Backfill owner_email and owner_phone from staged_records
  WITH updates AS (
    UPDATE trapper.sot_appointments a
    SET
      owner_email = LOWER(TRIM(sr.payload->>'Owner Email')),
      owner_phone = trapper.norm_phone_us(sr.payload->>'Owner Phone')
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND sr.payload->>'Number' = a.appointment_number
      AND a.owner_email IS NULL
      AND sr.payload->>'Owner Email' IS NOT NULL
      AND sr.payload->>'Owner Email' != ''
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_updated FROM updates;

  -- Step 2: Create/link persons for appointments with owner_email but no person_id
  WITH appts_needing_persons AS (
    SELECT DISTINCT
      a.appointment_id,
      a.owner_email,
      a.owner_phone,
      a.appointment_number
    FROM trapper.sot_appointments a
    WHERE a.owner_email IS NOT NULL
      AND a.person_id IS NULL
    LIMIT 2000  -- MIG_862: Increased from 500 to clear backlogs faster
  ),
  person_links AS (
    SELECT
      anp.appointment_id,
      anp.owner_email,
      trapper.find_or_create_person(
        anp.owner_email,
        anp.owner_phone,
        sr.payload->>'Owner First Name',
        sr.payload->>'Owner Last Name',
        sr.payload->>'Owner Address',
        'clinichq'
      ) AS person_id
    FROM appts_needing_persons anp
    LEFT JOIN trapper.staged_records sr ON
      sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND sr.payload->>'Number' = anp.appointment_number
  ),
  updates AS (
    UPDATE trapper.sot_appointments a
    SET person_id = pl.person_id
    FROM person_links pl
    WHERE a.appointment_id = pl.appointment_id
      AND pl.person_id IS NOT NULL
    RETURNING a.appointment_id, pl.person_id
  )
  SELECT COUNT(DISTINCT appointment_id), COUNT(DISTINCT person_id)
  INTO v_persons_linked, v_persons_created
  FROM updates;

  RETURN QUERY SELECT v_updated, v_persons_created, v_persons_linked;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_appointments_to_owners IS
'MIG_862: Links owner information from staged_records to sot_appointments.
Batch limit increased from 500 to 2000 to clear backlogs faster.
Run as part of entity linking phase.';

\echo 'link_appointments_to_owners updated (LIMIT 2000)'

-- ============================================================================
-- FIX 2: Recreate run_all_entity_linking with:
--   a) Fixed column reference (linked → appointments_linked) in Step 4
--   b) New Step 7: Create person-cat relationships from linked appointments
-- ============================================================================

\echo ''
\echo 'Step 2: Recreating run_all_entity_linking with fixes...'

CREATE OR REPLACE FUNCTION trapper.run_all_entity_linking()
RETURNS TABLE(operation TEXT, count INT) AS $$
DECLARE
  v_count INT;
BEGIN
  -- Step 1: Link appointments to owners (creates people + person_id on appointments)
  BEGIN
    SELECT INTO v_count COALESCE((SELECT appointments_updated FROM trapper.link_appointments_to_owners()), 0);
    operation := 'link_appointments_to_owners'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_appointments_to_owners (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 2: Cat-place linking (cats → places via microchip + owner chain)
  BEGIN
    SELECT INTO v_count COALESCE((SELECT cats_linked FROM trapper.run_cat_place_linking()), 0);
    operation := 'run_cat_place_linking'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'run_cat_place_linking (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 3: Appointment trapper linking
  BEGIN
    SELECT INTO v_count COALESCE(trapper.run_appointment_trapper_linking(), 0);
    operation := 'run_appointment_trapper_linking'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'run_appointment_trapper_linking (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 4: Link appointments to partner orgs
  -- MIG_862 FIX: Column was 'linked' but function returns 'appointments_linked'
  BEGIN
    SELECT INTO v_count COALESCE((SELECT appointments_linked FROM trapper.link_all_appointments_to_partner_orgs()), 0);
    operation := 'link_all_appointments_to_partner_orgs'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_all_appointments_to_partner_orgs (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 5: Link cats to requests via attribution windows
  BEGIN
    SELECT INTO v_count COALESCE((SELECT linked FROM trapper.link_cats_to_requests_safe()), 0);
    operation := 'link_cats_to_requests_safe'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_cats_to_requests_safe (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 6: Infer appointment places from person→place relationships
  BEGIN
    WITH inferred AS (
      UPDATE trapper.sot_appointments a
      SET place_id = ppr.place_id
      FROM trapper.person_place_relationships ppr
      WHERE a.person_id = ppr.person_id
        AND a.place_id IS NULL
        AND ppr.place_id IS NOT NULL
      RETURNING a.appointment_id
    )
    SELECT INTO v_count COUNT(*) FROM inferred;
    operation := 'infer_appointment_places'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'infer_appointment_places (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 7 (NEW): Create person-cat relationships from linked appointments
  -- Appointments with both person_id and cat_id but no matching person_cat_relationships row
  BEGIN
    WITH missing_rels AS (
      INSERT INTO trapper.person_cat_relationships (
        person_id, cat_id, relationship_type, confidence,
        source_system, source_table
      )
      SELECT DISTINCT a.person_id, a.cat_id, 'caretaker', 'high',
        'clinichq', 'appointments'
      FROM trapper.sot_appointments a
      WHERE a.person_id IS NOT NULL
        AND a.cat_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM trapper.person_cat_relationships pcr
          WHERE pcr.person_id = a.person_id AND pcr.cat_id = a.cat_id
        )
      ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table) DO NOTHING
      RETURNING person_id
    )
    SELECT INTO v_count COUNT(*) FROM missing_rels;
    operation := 'create_person_cat_relationships'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'create_person_cat_relationships (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.run_all_entity_linking() IS
  'MIG_862: Orchestrates all entity linking steps with fault tolerance. '
  'Each step is wrapped in BEGIN/EXCEPTION so one failure does not block others. '
  'Fixes: (1) Column reference linked→appointments_linked in partner org step. '
  '(2) Adds Step 7: batch create person_cat_relationships from appointments.';

\echo 'run_all_entity_linking updated with fixes'

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=== MIG_862 Complete ==='
\echo ''
\echo 'Changes:'
\echo '  1. link_appointments_to_owners: LIMIT 500 → 2000'
\echo '  2. run_all_entity_linking Step 4: Fixed column "linked" → "appointments_linked"'
\echo '  3. run_all_entity_linking Step 7: NEW - Creates person_cat_relationships from appointments'
\echo ''
\echo 'Resolves: DQ_CLINIC_001a (partially), DQ_CLINIC_001b, DQ_CLINIC_001d'
