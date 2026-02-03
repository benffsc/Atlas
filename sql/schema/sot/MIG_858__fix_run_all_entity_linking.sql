\echo '=== MIG_858: Fix run_all_entity_linking() broken function reference ==='
\echo 'Replaces link_appointments_to_partner_orgs() (does not exist) with'
\echo 'link_all_appointments_to_partner_orgs() (correct name).'
\echo 'Wraps each step in BEGIN/EXCEPTION for fault tolerance.'

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

  -- Step 4: Link appointments to partner orgs (FIXED: was link_appointments_to_partner_orgs)
  BEGIN
    SELECT INTO v_count COALESCE((SELECT linked FROM trapper.link_all_appointments_to_partner_orgs()), 0);
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

  RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.run_all_entity_linking() IS
  'MIG_858: Orchestrates all entity linking steps with fault tolerance. '
  'Each step is wrapped in BEGIN/EXCEPTION so one failure does not block others. '
  'Fixed: replaced broken link_appointments_to_partner_orgs() with link_all_appointments_to_partner_orgs().';

\echo '=== MIG_858 complete ==='
