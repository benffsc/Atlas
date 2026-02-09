\echo ''
\echo '=============================================================================='
\echo 'MIG_957: Permanent Fix for Booking Address Priority in Entity Linking Pipeline'
\echo '=============================================================================='
\echo ''
\echo 'Problem: Cats at colony sites (e.g., Walker Rd Dairies) are linked to the wrong'
\echo 'place because:'
\echo '  1. run_all_entity_linking() runs link_cats_to_appointment_places() BEFORE'
\echo '     infer_appointment_places()'
\echo '  2. Cats get linked via person_place (home address) instead of booking_address'
\echo '     (the colony site where cats were actually trapped)'
\echo ''
\echo 'Solution: Reorder the pipeline to:'
\echo '  1. Infer appointment places FIRST (booking_address has priority)'
\echo '  2. THEN link cats to places (uses the correctly inferred place)'
\echo ''

-- ============================================================================
-- PHASE 1: Update run_all_entity_linking() with correct execution order
-- ============================================================================

\echo 'Phase 1: Updating run_all_entity_linking() with correct execution order...'

CREATE OR REPLACE FUNCTION trapper.run_all_entity_linking()
RETURNS TABLE(operation TEXT, count INT) AS $$
DECLARE
  v_count INT;
  v_rec RECORD;
BEGIN
  -- Step 1: Link appointments to owners via email
  BEGIN
    WITH linked AS (
      SELECT trapper.link_appointments_to_owners(2000)
    )
    SELECT INTO v_count (SELECT * FROM linked);
    operation := 'link_appointments_to_owners'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_appointments_to_owners (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 2: Link appointments via phone
  BEGIN
    WITH linked AS (
      SELECT trapper.link_appointments_via_phone()
    )
    SELECT INTO v_count (linked->>'appointments_linked')::INT FROM linked;
    operation := 'link_appointments_via_phone'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_appointments_via_phone (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 3: Link appointments via safe phone (uniquely identifying)
  BEGIN
    WITH linked AS (
      SELECT trapper.link_appointments_via_safe_phone(2000)
    )
    SELECT INTO v_count (SELECT * FROM linked);
    operation := 'link_appointments_via_safe_phone'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_appointments_via_safe_phone (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 4: Link partner org appointments
  BEGIN
    WITH linked AS (
      SELECT trapper.link_partner_org_appointments(2000) as appointments_linked
    )
    SELECT INTO v_count (SELECT appointments_linked FROM linked);
    operation := 'link_partner_org_appointments'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_partner_org_appointments (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- ============================================================================
  -- MIG_957 FIX: Steps 5 & 6 are REORDERED
  -- MUST infer appointment places BEFORE linking cats to places!
  -- booking_address (colony site) takes priority over person_place (home address)
  -- ============================================================================

  -- Step 5: FIRST - Infer appointment places (booking_address has highest priority)
  -- This sets inferred_place_id on appointments based on:
  --   1. booking_address (the address on the appointment - where cats were trapped)
  --   2. clinic_owner_accounts (for clinic-specific places)
  --   3. person_place_relationships (fallback to person's home address)
  BEGIN
    FOR v_rec IN SELECT * FROM trapper.infer_appointment_places() LOOP
      operation := 'infer_appointment_places:' || v_rec.source;
      count := v_rec.appointments_linked;
      RETURN NEXT;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    operation := 'infer_appointment_places (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 6: THEN - Link cats to places (uses inferred_place_id from step 5)
  -- This creates cat_place_relationships using the correctly inferred place
  BEGIN
    FOR v_rec IN SELECT * FROM trapper.link_cats_to_appointment_places() LOOP
      operation := 'link_cats_to_appointment_places';
      count := v_rec.cats_linked;
      RETURN NEXT;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_cats_to_appointment_places (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 7: Create person-cat relationships from linked appointments
  -- MIG_938: Exclude appointments with organizational contacts
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
        -- MIG_938: Exclude organizational contacts
        AND NOT trapper.is_organizational_contact(a.owner_email, a.owner_phone)
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
'MIG_957: Fixed execution order for booking address priority.

CRITICAL FIX: Steps 5 & 6 were reordered:
  - Step 5: infer_appointment_places() runs FIRST (booking_address priority)
  - Step 6: link_cats_to_appointment_places() runs AFTER (uses correct inferred_place_id)

This ensures cats at colony sites (like Walker Rd Dairies) are linked to the
booking_address (where they were trapped) instead of the caretaker''s home address.

Pipeline order:
  1. link_appointments_to_owners - Email matching
  2. link_appointments_via_phone - Phone matching
  3. link_appointments_via_safe_phone - Unique phone matching
  4. link_partner_org_appointments - Partner org matching
  5. infer_appointment_places - Sets inferred_place_id (booking_address first!)
  6. link_cats_to_appointment_places - Links cats to inferred places
  7. create_person_cat_relationships - Creates person-cat links';

\echo ''
\echo 'Phase 1 complete: run_all_entity_linking() updated with correct order.'

-- ============================================================================
-- PHASE 2: Verify the fix is in place
-- ============================================================================

\echo ''
\echo 'Phase 2: Verifying pipeline function exists and has correct order...'

SELECT
  'run_all_entity_linking' as function_name,
  CASE
    WHEN prosrc LIKE '%infer_appointment_places%link_cats_to_appointment_places%'
    THEN 'CORRECT ORDER'
    ELSE 'WRONG ORDER - CHECK MIGRATION'
  END as execution_order_status
FROM pg_proc
WHERE proname = 'run_all_entity_linking'
  AND pronamespace = 'trapper'::regnamespace;

\echo ''
\echo '=============================================================================='
\echo 'MIG_957 Complete!'
\echo '=============================================================================='
\echo ''
\echo 'Summary:'
\echo '  - run_all_entity_linking() now runs infer_appointment_places() BEFORE'
\echo '    link_cats_to_appointment_places()'
\echo '  - Booking addresses (colony sites) now take priority over home addresses'
\echo '  - Future syncs will correctly link cats to colony sites'
\echo ''
\echo 'All future cron jobs will maintain correct linking automatically.'
\echo ''
