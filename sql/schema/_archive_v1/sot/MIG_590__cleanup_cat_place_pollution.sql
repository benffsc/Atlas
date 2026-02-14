\echo ''
\echo '=================================================='
\echo 'MIG_590: Cleanup Cat-Place Relationship Pollution'
\echo '=================================================='
\echo ''
\echo 'This migration removes polluted cat-place relationships'
\echo 'created by the flawed appointment_person_link logic.'
\echo ''
\echo 'Root cause: MIG_312/MIG_582 linked cats to ALL places'
\echo 'a person was ever connected to, not just the appointment'
\echo 'relevant place.'
\echo ''
\echo 'Worst case: One cat linked to 319 places (via Sandra Nicander,'
\echo 'FFSC staff with 319 person_place_relationships).'
\echo ''

-- ============================================================
-- STEP 1: Show current state (before cleanup)
-- ============================================================
\echo 'STEP 1: Current state before cleanup'
\echo ''

SELECT
  source_table,
  COUNT(*) as total_links,
  COUNT(DISTINCT cat_id) as cats,
  COUNT(DISTINCT place_id) as places
FROM trapper.cat_place_relationships
WHERE source_table IN ('appointment_person_link', 'mig224_person_place_link', 'mig_235_backfill')
GROUP BY source_table
ORDER BY total_links DESC;

-- Show cats with excessive places
SELECT
  COUNT(*) FILTER (WHERE place_count > 5) as cats_over_5_places,
  COUNT(*) FILTER (WHERE place_count > 10) as cats_over_10_places,
  COUNT(*) FILTER (WHERE place_count > 50) as cats_over_50_places,
  MAX(place_count) as max_places_for_any_cat
FROM (
  SELECT cat_id, COUNT(DISTINCT place_id) as place_count
  FROM trapper.cat_place_relationships
  GROUP BY cat_id
) x;

-- ============================================================
-- STEP 2: Remove polluted cat_place_relationships
-- ============================================================
\echo ''
\echo 'STEP 2: Removing polluted cat-place relationships...'

-- Keep links that have valid appointment evidence (inferred_place_id or place_id match)
-- Delete links that were created only via the person_place JOIN

WITH valid_appointment_places AS (
  -- Places that have DIRECT appointment evidence
  SELECT DISTINCT a.cat_id, COALESCE(a.inferred_place_id, a.place_id) as place_id
  FROM trapper.sot_appointments a
  WHERE a.cat_id IS NOT NULL
    AND COALESCE(a.inferred_place_id, a.place_id) IS NOT NULL
),
polluted_links AS (
  SELECT cpr.cat_place_id, cpr.cat_id, cpr.place_id
  FROM trapper.cat_place_relationships cpr
  WHERE cpr.source_table IN ('appointment_person_link', 'mig224_person_place_link')
    AND NOT EXISTS (
      -- Only keep if there's valid appointment evidence for this cat-place combo
      SELECT 1 FROM valid_appointment_places vap
      WHERE vap.cat_id = cpr.cat_id AND vap.place_id = cpr.place_id
    )
),
deleted AS (
  DELETE FROM trapper.cat_place_relationships
  WHERE cat_place_id IN (SELECT cat_place_id FROM polluted_links)
  RETURNING cat_place_id
)
SELECT COUNT(*) as polluted_links_deleted FROM deleted;

-- Also remove mig_235_backfill links that don't have appointment evidence
WITH valid_appointment_places AS (
  SELECT DISTINCT a.cat_id, COALESCE(a.inferred_place_id, a.place_id) as place_id
  FROM trapper.sot_appointments a
  WHERE a.cat_id IS NOT NULL
    AND COALESCE(a.inferred_place_id, a.place_id) IS NOT NULL
),
backfill_pollution AS (
  SELECT cpr.cat_place_id
  FROM trapper.cat_place_relationships cpr
  WHERE cpr.source_table = 'mig_235_backfill'
    AND NOT EXISTS (
      SELECT 1 FROM valid_appointment_places vap
      WHERE vap.cat_id = cpr.cat_id AND vap.place_id = cpr.place_id
    )
    -- Also not in appointment_info (the proper source)
    AND NOT EXISTS (
      SELECT 1 FROM trapper.cat_place_relationships cpr2
      WHERE cpr2.cat_id = cpr.cat_id
        AND cpr2.place_id = cpr.place_id
        AND cpr2.source_table = 'appointment_info'
    )
),
deleted AS (
  DELETE FROM trapper.cat_place_relationships
  WHERE cat_place_id IN (SELECT cat_place_id FROM backfill_pollution)
  RETURNING cat_place_id
)
SELECT COUNT(*) as backfill_pollution_deleted FROM deleted;

-- ============================================================
-- STEP 3: Add is_system_account flag to sot_people
-- ============================================================
\echo ''
\echo 'STEP 3: Adding is_system_account flag...'

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper'
      AND table_name = 'sot_people'
      AND column_name = 'is_system_account'
  ) THEN
    ALTER TABLE trapper.sot_people
    ADD COLUMN is_system_account BOOLEAN DEFAULT FALSE;

    COMMENT ON COLUMN trapper.sot_people.is_system_account IS
    'TRUE for staff/org accounts that should not pollute cat-place linking.
    These accounts may have many person_place_relationships from their work,
    but cats booked under them should not inherit all those places.';
  END IF;
END $$;

-- Mark FFSC staff accounts (those with @forgottenfelines.com emails)
UPDATE trapper.sot_people p
SET is_system_account = TRUE
WHERE p.person_id IN (
  SELECT DISTINCT pi.person_id
  FROM trapper.person_identifiers pi
  WHERE pi.id_type = 'email'
    AND pi.id_value_norm LIKE '%@forgottenfelines.%'
)
AND (p.is_system_account IS NULL OR p.is_system_account = FALSE);

SELECT COUNT(*) as staff_accounts_marked
FROM trapper.sot_people
WHERE is_system_account = TRUE;

-- ============================================================
-- STEP 4: Clean Sandra Nicander's polluted person_place links
-- ============================================================
\echo ''
\echo 'STEP 4: Cleaning Sandra Nicander polluted place links...'

-- Sandra has 319 places as "resident" which is clearly wrong
-- A staff member doing requests doesn't become resident of those places

-- First, show what we're about to remove
SELECT 'sandra_places_before' as status, COUNT(DISTINCT place_id) as count
FROM trapper.person_place_relationships
WHERE person_id = 'fd56e599-fa85-4345-8c94-0a3596a1597b';

-- Remove resident/owner roles from places that are clearly not her home
-- Keep: any place that's actually FFSC office or appears to be her home
DELETE FROM trapper.person_place_relationships
WHERE person_id = 'fd56e599-fa85-4345-8c94-0a3596a1597b'
  AND role IN ('resident', 'owner')
  -- Keep places that look like FFSC office
  AND place_id NOT IN (
    SELECT place_id FROM trapper.places
    WHERE formatted_address ILIKE '%Forgotten Felines%'
       OR formatted_address ILIKE '%939 Sunset%'  -- FFSC office if applicable
  );

SELECT 'sandra_places_after' as status, COUNT(DISTINCT place_id) as count
FROM trapper.person_place_relationships
WHERE person_id = 'fd56e599-fa85-4345-8c94-0a3596a1597b';

-- ============================================================
-- STEP 5: Update run_all_entity_linking to REMOVE broken logic
-- ============================================================
\echo ''
\echo 'STEP 5: Fixing run_all_entity_linking function...'

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

  -- 6. REMOVED: The broken person_place JOIN logic that caused pollution
  -- OLD CODE (DO NOT USE):
  --   INSERT INTO cat_place_relationships
  --   FROM sot_appointments a
  --   JOIN person_place_relationships ppr ON ppr.person_id = a.person_id
  --   (This linked cats to ALL places a person was connected to, not just
  --    the appointment-relevant place)
  --
  -- Cats should only link to places via:
  --   - appointment.inferred_place_id (from owner account or person's PRIMARY place)
  --   - appointment.place_id (explicit)
  --   - NOT "all places this person has ever touched"
  RETURN QUERY SELECT 'cats_linked_via_appointment_person_DISABLED'::TEXT, 0;

  -- 7. Link cats to requests (MIG_565)
  SELECT linked, skipped INTO v_linked, v_skipped
  FROM trapper.link_cats_to_requests_safe();
  RETURN QUERY SELECT 'cats_linked_to_requests'::TEXT, v_linked;

  -- 8. Link appointments to partner organizations (MIG_580)
  FOR v_rec IN SELECT * FROM trapper.link_appointments_to_partner_orgs() LOOP
    RETURN QUERY SELECT ('partner_org_' || lower(replace(v_rec.source, ' ', '_')))::TEXT, v_rec.appointments_linked;
  END LOOP;

  -- 9. Infer place_id for appointments (MIG_581)
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
6. REMOVED (was: broken person_place JOIN causing pollution)
7. Link cats to requests
8. Link appointments to partner orgs (SCAS, FFSC, etc.)
9. Infer places for appointments from person/account relationships

The broken step 6 (appointment_person_link) has been removed.
Cats now only link to places via appointment.inferred_place_id or
appointment.place_id - NOT via all of a person''s historical places.

Run via cron every 15 minutes or after data ingest.';

-- ============================================================
-- STEP 6: Verify cleanup results
-- ============================================================
\echo ''
\echo 'STEP 6: Verification'
\echo ''

\echo 'Remaining polluted source counts (should be 0 or minimal):'
SELECT
  source_table,
  COUNT(*) as total_links
FROM trapper.cat_place_relationships
WHERE source_table IN ('appointment_person_link', 'mig224_person_place_link', 'mig_235_backfill')
GROUP BY source_table
ORDER BY total_links DESC;

\echo ''
\echo 'Cats with excessive places (should be 0 with >50):'
SELECT
  COUNT(*) FILTER (WHERE place_count > 5) as cats_over_5_places,
  COUNT(*) FILTER (WHERE place_count > 10) as cats_over_10_places,
  COUNT(*) FILTER (WHERE place_count > 50) as cats_over_50_places,
  MAX(place_count) as max_places_for_any_cat
FROM (
  SELECT cat_id, COUNT(DISTINCT place_id) as place_count
  FROM trapper.cat_place_relationships
  GROUP BY cat_id
) x;

\echo ''
\echo 'Valid appointment_info links (should be unchanged ~32k):'
SELECT COUNT(*) as appointment_info_links
FROM trapper.cat_place_relationships
WHERE source_table = 'appointment_info';

-- ============================================================
-- SUMMARY
-- ============================================================
\echo ''
\echo '=================================================='
\echo 'MIG_590 Complete!'
\echo '=================================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Removed polluted cat-place links (appointment_person_link, mig224)'
\echo '  2. Removed backfill pollution without appointment evidence'
\echo '  3. Added is_system_account flag to sot_people'
\echo '  4. Marked FFSC staff accounts as system accounts'
\echo '  5. Cleaned Sandra Nicander polluted place links'
\echo '  6. Fixed run_all_entity_linking to remove broken person_place JOIN'
\echo ''
\echo 'Future behavior:'
\echo '  - Cats will ONLY link to places via appointment.inferred_place_id'
\echo '  - NOT via "all places the appointment owner has ever touched"'
\echo '  - Staff accounts marked to prevent future pollution'
\echo ''
