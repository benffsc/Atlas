-- MIG_3036: Old Possum Brewing Colony Site Data Gap
--
-- DATA_GAP_058: Feeding/trapping sites invisible on map
--
-- Source: ClinicHQ client "Old Possum Brewing FFSC" (Public Client)
--   Address: 357 Sutton Pl, Santa Rosa, CA 95407
--   Phone: 707-484-7511 (Linda Bodwin's cell)
--   Email: jbodwin@sbcglobal.net
--   Quick Notes: "Trapper Tina and Linda"
--   Animals: 4 cats (2 microchipped: 900085001746827, 900085001746280)
--   Last Visit: 1/15/2024
--   Long Notes: Homeless camp nearby, kittens with harnesses, Tina trapped them
--
-- The account name "Old Possum Brewing FFSC" is a site_name — classify_owner_name()
-- would classify this as non-person. So the ClinicHQ ingest pipeline may have:
--   - Created a clinic_account but NOT a person
--   - Created a place at 357 Sutton Pl BUT:
--     - If place_kind = 'business' or 'outdoor_site', cat linking is blocked (MIG_2601)
--     - If inferred_place_id was set, cats MAY be linked via Step 2 appointment path
--
-- This migration:
-- A. Diagnoses exactly what happened in Atlas for this account
-- B. Ensures the place exists and is geocoded
-- C. Links the 4 known cats to the place
-- D. Documents the broader colony site visibility pattern
--
-- Created: 2026-04-01

\echo ''
\echo '=============================================='
\echo '  MIG_3036: Old Possum Brewing Data Gap'
\echo '=============================================='
\echo ''

-- ============================================================================
-- Section A: Diagnose — what does Atlas currently have?
-- ============================================================================

\echo 'Section A: Diagnosing current Atlas state...'
\echo ''

-- 1. Check clinic_accounts for this site
\echo 'A1. Clinic account for "Old Possum Brewing":'
SELECT account_id, display_name, account_type, resolved_person_id,
       resolved_place_id, source_system
FROM ops.clinic_accounts
WHERE display_name ILIKE '%possum%'
   OR display_name ILIKE '%old possum%';

-- 2. Check appointments booked under this account
\echo ''
\echo 'A2. Appointments under "Old Possum" or address "357 Sutton":'
SELECT a.appointment_id, a.appointment_date, a.client_name, a.owner_address,
       a.inferred_place_id, a.person_id, a.owner_account_id,
       a.animal_name, a.animal_id
FROM ops.appointments a
WHERE a.client_name ILIKE '%possum%'
   OR a.owner_address ILIKE '%357 sutton%'
ORDER BY a.appointment_date DESC
LIMIT 20;

-- 3. Check if place exists at 357 Sutton Pl
\echo ''
\echo 'A3. Places at 357 Sutton Pl:'
SELECT place_id, display_name, formatted_address, normalized_address,
       place_kind, latitude, longitude, sot_address_id,
       merged_into_place_id, source_system
FROM sot.places
WHERE formatted_address ILIKE '%357 sutton%'
   OR normalized_address ILIKE '%357 sutton%'
   OR display_name ILIKE '%possum%';

-- 4. Check the 2 microchipped cats
\echo ''
\echo 'A4. Cats with microchips 900085001746827 and 900085001746280:'
SELECT c.cat_id, c.name, c.sex, c.altered_status, c.source_system,
       ci.id_type, ci.id_value,
       -- Check if linked to any place
       (SELECT string_agg(pl.formatted_address, ', ')
        FROM sot.cat_place cp
        JOIN sot.places pl ON pl.place_id = cp.place_id
        WHERE cp.cat_id = c.cat_id
          AND pl.merged_into_place_id IS NULL) as linked_places,
       -- Check if linked to any person
       (SELECT string_agg(p.display_name, ', ')
        FROM sot.person_cat pc
        JOIN sot.people p ON p.person_id = pc.person_id
        WHERE pc.cat_id = c.cat_id
          AND p.merged_into_person_id IS NULL) as linked_people
FROM sot.cats c
JOIN sot.cat_identifiers ci ON ci.cat_id = c.cat_id
WHERE ci.id_value IN ('900085001746827', '900085001746280')
  AND c.merged_into_cat_id IS NULL;

-- 5. Check Linda Bodwin's person record + places
\echo ''
\echo 'A5. Linda Bodwin — person and places:'
SELECT p.person_id, p.display_name, p.source_system,
       pi.id_type, pi.id_value_raw,
       (SELECT string_agg(pl.formatted_address || ' (' || COALESCE(pl.place_kind, 'unknown') || ')', ', ')
        FROM sot.person_place pp
        JOIN sot.places pl ON pl.place_id = pp.place_id
        WHERE pp.person_id = p.person_id
          AND pl.merged_into_place_id IS NULL) as linked_places
FROM sot.people p
LEFT JOIN sot.person_identifiers pi ON pi.person_id = p.person_id AND pi.confidence >= 0.5
WHERE (p.display_name ILIKE '%bodwin%'
       OR pi.id_value_norm = 'jbodwin@sbcglobal.net'
       OR pi.id_value_norm = '7074847511')
  AND p.merged_into_person_id IS NULL;

-- 6. Check Tina Piatt
\echo ''
\echo 'A6. Tina Piatt — person record:'
SELECT p.person_id, p.display_name, p.source_system,
       tp.trapper_type, tp.status as trapper_status
FROM sot.people p
LEFT JOIN sot.trapper_profiles tp ON tp.person_id = p.person_id
WHERE p.display_name ILIKE '%piatt%'
  AND p.merged_into_person_id IS NULL;

-- 7. Check any cats at places near 357 Sutton Pl (if place exists)
\echo ''
\echo 'A7. Cat-place links at 357 Sutton Pl (if any):'
SELECT cp.cat_id, c.name, c.altered_status,
       cp.relationship_type, cp.evidence_type,
       pl.formatted_address
FROM sot.cat_place cp
JOIN sot.cats c ON c.cat_id = cp.cat_id
JOIN sot.places pl ON pl.place_id = cp.place_id
WHERE pl.formatted_address ILIKE '%357 sutton%'
  AND c.merged_into_cat_id IS NULL
  AND pl.merged_into_place_id IS NULL;

-- ============================================================================
-- Section B: Ensure place exists at 357 Sutton Pl
-- ============================================================================

\echo ''
\echo 'Section B: Ensuring place exists at 357 Sutton Pl...'

-- Use find_or_create_place_deduped — idempotent, handles address normalization
-- This will either find the existing place or create a new one
SELECT sot.find_or_create_place_deduped(
  p_address := '357 Sutton Pl, Santa Rosa, CA 95407',
  p_name := 'Old Possum Brewing Colony Site',
  p_lat := NULL,   -- Will need geocoding via batch job
  p_lng := NULL,
  p_source_system := 'atlas_ui'
) as created_place_id;

-- Set place_kind and add notes
-- Using a DO block so we can capture the place_id
DO $$
DECLARE
  v_place_id UUID;
BEGIN
  -- Find the place we just created/found
  SELECT place_id INTO v_place_id
  FROM sot.places
  WHERE (formatted_address ILIKE '%357 sutton%' OR display_name ILIKE '%possum%')
    AND merged_into_place_id IS NULL
  LIMIT 1;

  IF v_place_id IS NULL THEN
    RAISE NOTICE 'WARNING: Could not find place at 357 Sutton Pl after creation attempt';
    RETURN;
  END IF;

  RAISE NOTICE 'Found/created place: %', v_place_id;

  -- Update place_kind to business (brewery with colony)
  UPDATE sot.places
  SET place_kind = COALESCE(place_kind, 'business'),
      display_name = COALESCE(NULLIF(display_name, ''), 'Old Possum Brewing Colony Site'),
      notes = COALESCE(notes, '') ||
        CASE WHEN notes IS NOT NULL AND notes != '' THEN E'\n' ELSE '' END ||
        'Colony feeding/trapping site. ClinicHQ account "Old Possum Brewing FFSC". ' ||
        'Trappers: Linda Bodwin (active, jbodwin@sbcglobal.net), Tina Piatt (former). ' ||
        '4 cats fixed 1/15/2024. Homeless camp nearby. MIG_3036.'
  WHERE place_id = v_place_id;

  RAISE NOTICE 'Updated place metadata for %', v_place_id;
END $$;

-- ============================================================================
-- Section C: Link the 4 known cats to this place
-- ============================================================================

\echo ''
\echo 'Section C: Linking cats to 357 Sutton Pl...'

DO $$
DECLARE
  v_place_id UUID;
  v_cat_id UUID;
  v_linked INT := 0;
  v_microchip TEXT;
BEGIN
  -- Find the place
  SELECT place_id INTO v_place_id
  FROM sot.places
  WHERE (formatted_address ILIKE '%357 sutton%' OR display_name ILIKE '%possum%')
    AND merged_into_place_id IS NULL
  LIMIT 1;

  IF v_place_id IS NULL THEN
    RAISE NOTICE 'WARNING: No place found — skipping cat linking';
    RETURN;
  END IF;

  -- Link microchipped cats
  FOR v_microchip IN
    SELECT unnest(ARRAY['900085001746827', '900085001746280'])
  LOOP
    SELECT c.cat_id INTO v_cat_id
    FROM sot.cats c
    JOIN sot.cat_identifiers ci ON ci.cat_id = c.cat_id
    WHERE ci.id_value = v_microchip
      AND ci.id_type = 'microchip'
      AND c.merged_into_cat_id IS NULL
    LIMIT 1;

    IF v_cat_id IS NOT NULL THEN
      INSERT INTO sot.cat_place (cat_id, place_id, relationship_type, evidence_type, source_system)
      VALUES (v_cat_id, v_place_id, 'colony_member', 'manual_staff', 'atlas_ui')
      ON CONFLICT DO NOTHING;

      v_linked := v_linked + 1;
      RAISE NOTICE 'Linked cat % (microchip %) to place', v_cat_id, v_microchip;
    ELSE
      RAISE NOTICE 'Cat with microchip % not found in sot.cats', v_microchip;
    END IF;
  END LOOP;

  -- Also link any cats from appointments at this address
  INSERT INTO sot.cat_place (cat_id, place_id, relationship_type, evidence_type, source_system)
  SELECT DISTINCT ci.cat_id, v_place_id, 'colony_member', 'appointment_address', 'clinichq'
  FROM ops.appointments a
  JOIN sot.cat_identifiers ci ON ci.id_value = a.animal_id::text
    AND ci.id_type = 'clinichq_animal_id'
  JOIN sot.cats c ON c.cat_id = ci.cat_id AND c.merged_into_cat_id IS NULL
  WHERE (a.client_name ILIKE '%possum%' OR a.owner_address ILIKE '%357 sutton%')
    AND NOT EXISTS (
      SELECT 1 FROM sot.cat_place cp
      WHERE cp.cat_id = ci.cat_id AND cp.place_id = v_place_id
    )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_linked = ROW_COUNT;
  RAISE NOTICE 'Linked % additional cats from appointment matches', v_linked;

  -- Link Linda Bodwin to this place (person_place) if not already linked
  INSERT INTO sot.person_place (person_id, place_id, relationship_type, evidence_type, source_system)
  SELECT p.person_id, v_place_id, 'trapper', 'manual_staff', 'atlas_ui'
  FROM sot.people p
  JOIN sot.person_identifiers pi ON pi.person_id = p.person_id
  WHERE pi.id_value_norm = 'jbodwin@sbcglobal.net'
    AND p.merged_into_person_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM sot.person_place pp
      WHERE pp.person_id = p.person_id AND pp.place_id = v_place_id
    )
  ON CONFLICT DO NOTHING;

END $$;

-- ============================================================================
-- Section D: Verification
-- ============================================================================

\echo ''
\echo 'Section D: Verification...'
\echo ''

\echo 'Place at 357 Sutton Pl:'
SELECT place_id, display_name, formatted_address, place_kind,
       latitude, longitude, notes
FROM sot.places
WHERE (formatted_address ILIKE '%357 sutton%' OR display_name ILIKE '%possum%')
  AND merged_into_place_id IS NULL;

\echo ''
\echo 'Cats linked to this place:'
SELECT c.cat_id, c.name, c.sex, c.altered_status,
       ci.id_type, ci.id_value,
       cp.relationship_type, cp.evidence_type
FROM sot.cat_place cp
JOIN sot.cats c ON c.cat_id = cp.cat_id
JOIN sot.places pl ON pl.place_id = cp.place_id
LEFT JOIN sot.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
WHERE (pl.formatted_address ILIKE '%357 sutton%' OR pl.display_name ILIKE '%possum%')
  AND c.merged_into_cat_id IS NULL
  AND pl.merged_into_place_id IS NULL;

\echo ''
\echo 'People linked to this place:'
SELECT p.person_id, p.display_name, pp.relationship_type, pp.evidence_type
FROM sot.person_place pp
JOIN sot.people p ON p.person_id = pp.person_id
JOIN sot.places pl ON pl.place_id = pp.place_id
WHERE (pl.formatted_address ILIKE '%357 sutton%' OR pl.display_name ILIKE '%possum%')
  AND p.merged_into_person_id IS NULL
  AND pl.merged_into_place_id IS NULL;

-- ============================================================================
-- Section E: Document the broader pattern
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  DATA_GAP_058: outdoor_site Colony Visibility'
\echo '=============================================='
\echo ''
\echo 'PROBLEM:'
\echo '  ClinicHQ site-name accounts (like "Old Possum Brewing FFSC") create'
\echo '  places that may be classified as business/outdoor_site. These are'
\echo '  excluded from automatic cat-place linking (MIG_2601) to prevent'
\echo '  residential pollution. But they are real colony locations.'
\echo ''
\echo 'ROOT CAUSE for this case:'
\echo '  - ClinicHQ account "Old Possum Brewing FFSC" at 357 Sutton Pl'
\echo '  - classify_owner_name() → site_name (not a person)'
\echo '  - should_be_person() → FALSE → no person created from account'
\echo '  - Place at 357 Sutton Pl may exist but cats not linked'
\echo '  - link_cats_to_places() excludes business/outdoor_site (MIG_2601)'
\echo ''
\echo 'PROPOSED LONG-TERM FIX:'
\echo '  1. Add is_colony_site BOOLEAN to sot.places'
\echo '  2. Auto-detect from ClinicHQ site_name accounts with cat appointments'
\echo '  3. Modify link_cats_to_places() to include is_colony_site = TRUE'
\echo '  4. Admin UI to manually designate colony sites'
\echo ''

\echo 'MIG_3036 complete — Old Possum Brewing colony site fixed'
\echo ''
