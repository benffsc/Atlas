\echo ''
\echo '=================================================='
\echo 'MIG_582: Update Entity Linking Chain'
\echo '=================================================='
\echo ''
\echo 'Adds partner org linking and place inference to the'
\echo 'entity linking chain.'
\echo ''

-- ============================================================
-- Update run_all_entity_linking to include new functions
-- ============================================================
\echo 'Updating run_all_entity_linking function...'

CREATE OR REPLACE FUNCTION trapper.run_all_entity_linking()
RETURNS TABLE(operation text, count integer) AS $$
DECLARE
  v_count INT;
  v_cats INT;
  v_places INT;
  v_updated INT;
  v_created INT;
  v_linked INT;
  v_skipped INT;
  v_rec RECORD;
BEGIN
  -- 1. Link appointments to owners first (critical for cat-place linking)
  SELECT appointments_updated, persons_created, persons_linked
  INTO v_updated, v_created, v_linked
  FROM trapper.link_appointments_to_owners();
  RETURN QUERY SELECT 'appointments_linked_to_owners'::TEXT, v_updated;
  RETURN QUERY SELECT 'persons_created_for_appointments'::TEXT, v_created;

  -- 2. Create places from intake
  SELECT trapper.create_places_from_intake() INTO v_count;
  RETURN QUERY SELECT 'places_created_from_intake'::TEXT, v_count;

  -- 3. Link intake requesters to places
  SELECT trapper.link_intake_requesters_to_places() INTO v_count;
  RETURN QUERY SELECT 'intake_requester_place_links'::TEXT, v_count;

  -- 4. Link cats to places (now includes appointments with proper person_id)
  SELECT cats_linked, places_involved INTO v_cats, v_places
  FROM trapper.run_cat_place_linking();
  RETURN QUERY SELECT 'cats_linked_to_places'::TEXT, v_cats;

  -- 5. Link appointments to trappers
  SELECT trapper.run_appointment_trapper_linking() INTO v_count;
  RETURN QUERY SELECT 'appointments_linked_to_trappers'::TEXT, v_count;

  -- 6. Link cats to places via appointment person_id
  WITH additional_links AS (
    INSERT INTO trapper.cat_place_relationships (
      cat_id, place_id, relationship_type, confidence, source_system, source_table
    )
    SELECT DISTINCT
      a.cat_id, ppr.place_id, 'appointment_site'::TEXT, 0.85,
      'clinichq', 'appointment_person_link'
    FROM trapper.sot_appointments a
    JOIN trapper.person_place_relationships ppr ON ppr.person_id = a.person_id
    WHERE a.cat_id IS NOT NULL
      AND a.person_id IS NOT NULL
      AND ppr.place_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trapper.cat_place_relationships cpr
        WHERE cpr.cat_id = a.cat_id AND cpr.place_id = ppr.place_id
      )
    RETURNING cat_id
  )
  SELECT COUNT(DISTINCT cat_id) INTO v_count FROM additional_links;
  RETURN QUERY SELECT 'cats_linked_via_appointment_person'::TEXT, v_count;

  -- 7. Link cats to requests (MIG_565)
  SELECT linked, skipped INTO v_linked, v_skipped
  FROM trapper.link_cats_to_requests_safe();
  RETURN QUERY SELECT 'cats_linked_to_requests'::TEXT, v_linked;

  -- 8. NEW: Link appointments to partner organizations (MIG_580)
  -- Detects SCAS/FFSC/etc. patterns in staged data and sets partner_org_id
  FOR v_rec IN SELECT * FROM trapper.link_appointments_to_partner_orgs() LOOP
    RETURN QUERY SELECT ('partner_org_' || lower(replace(v_rec.source, ' ', '_')))::TEXT, v_rec.appointments_linked;
  END LOOP;

  -- 9. NEW: Infer place_id for appointments (MIG_581)
  -- Links appointments to places via person_place_relationships and owner_accounts
  FOR v_rec IN SELECT * FROM trapper.infer_appointment_places() LOOP
    RETURN QUERY SELECT ('inferred_place_' || lower(replace(v_rec.source, ' ', '_')))::TEXT, v_rec.appointments_linked;
  END LOOP;

END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.run_all_entity_linking IS
'Orchestrates all entity linking operations in the correct order:
1. Link appointments to owners
2. Create places from intake
3. Link intake requesters to places
4. Link cats to places
5. Link appointments to trappers
6. Link cats to places via appointment person_id
7. Link cats to requests
8. Link appointments to partner orgs (SCAS, FFSC, etc.)
9. Infer places for appointments from person/account relationships

Run via cron every 15 minutes or after data ingest.';

-- ============================================================
-- SUMMARY
-- ============================================================
\echo ''
\echo '=================================================='
\echo 'MIG_582 Complete!'
\echo '=================================================='
\echo ''

\echo 'Updated run_all_entity_linking to include:'
\echo '  - link_appointments_to_partner_orgs()'
\echo '  - infer_appointment_places()'
\echo ''

\echo 'Testing the updated function:'
SELECT * FROM trapper.run_all_entity_linking();

\echo ''
\echo 'Entity linking chain is now complete.'
\echo ''
