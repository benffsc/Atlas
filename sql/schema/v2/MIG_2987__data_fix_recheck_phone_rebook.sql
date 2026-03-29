-- MIG_2987: Data Fix — Recheck Duplicates, Phone Misattribution, Rebooked Cats
--
-- FFS-860: Gordon Maxwell appointments misattributed to Susan Simons via shared phone
-- FFS-861: 12 duplicate cats from embedded microchip in Animal Name not detected
-- FFS-862: 7 rebooked cats invisible on original clinic day
--
-- Created: 2026-03-26

\echo ''
\echo '=============================================='
\echo '  MIG_2987: Data Fix — Recheck/Phone/Rebook'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- A1. MERGE 12 DUPLICATE CATS (FFS-861)
-- ============================================================================

\echo 'A1. Merging 12 duplicate cats (embedded microchip in name)...'

-- Each pair: loser (duplicate with embedded chip in name) → winner (original with microchip)
-- Verified in investigation: all pairs share the same microchip value

SELECT sot.merge_cats(
  'ca72ce70-9841-4bec-936b-09f0c2081e78'::UUID,  -- Buddy Boy - 981020053529388
  'a8eb1f6d-5e61-4303-9885-ab546b43889c'::UUID,  -- Buddy Boy (has microchip)
  'FFS-861: Embedded microchip in name created duplicate', 'migration'
);

SELECT sot.merge_cats(
  '64610c4a-328e-41eb-88e5-22dfa41ec0f0'::UUID,  -- Chevy - 981020011681315
  '6e4d94a2-d473-4227-9bc1-baa819857fb2'::UUID,  -- cat 1 (has microchip)
  'FFS-861: Embedded microchip in name created duplicate', 'migration'
);

SELECT sot.merge_cats(
  '2d7e2bd8-c19a-4b88-8353-7bfe759cf555'::UUID,  -- Scooter - 900085001746222
  '25a7c6ac-1a5a-4e53-84a0-5af1e60c7a50'::UUID,  -- Scooter (has microchip)
  'FFS-861: Embedded microchip in name created duplicate', 'migration'
);

SELECT sot.merge_cats(
  '3e0e4460-4ac8-4199-9893-588158fa16d9'::UUID,  -- Fieldtrip 981020053827529
  '36933c35-4cc9-49ed-a406-48e1b45db63c'::UUID,  -- Unknown (has microchip)
  'FFS-861: Embedded microchip in name created duplicate', 'migration'
);

SELECT sot.merge_cats(
  'fcc18462-841c-4371-9bda-6b1a7d6bdb12'::UUID,  -- Panther - 981020059211207
  'af1de6c6-5eb2-4a7c-9f67-ba1fa4dfa751'::UUID,  -- Unknown (has microchip)
  'FFS-861: Embedded microchip in name created duplicate', 'migration'
);

SELECT sot.merge_cats(
  'd4919192-c7da-405d-96f1-df11df487b89'::UUID,  -- Barrie Mason 981020045736415 (dental 1/26/23)
  '7331b711-9c46-48d2-b811-ff1c3785d103'::UUID,  -- Unknown (has microchip)
  'FFS-861: Embedded microchip in name created duplicate', 'migration'
);

SELECT sot.merge_cats(
  '4544d54c-32a8-40ea-9da0-d7f0daaeab4b'::UUID,  -- Med Hold Joe Koha "Sneezy" 981020045714827
  'c1ca50d7-54a5-4dac-bd53-f597c9bbd4dc'::UUID,  -- Sneezy (has microchip)
  'FFS-861: Embedded microchip in name created duplicate', 'migration'
);

SELECT sot.merge_cats(
  '8a875e48-d28d-47fb-9b01-bade25ca96f4'::UUID,  -- Med Hold 981020045776026
  '97f14c15-d5ea-4897-8ba4-bd99bec35288'::UUID,  -- Unknown (has microchip)
  'FFS-861: Embedded microchip in name created duplicate', 'migration'
);

SELECT sot.merge_cats(
  '15e8f3e7-0108-456e-81d9-b5cdd3b93706'::UUID,  -- Diane Sackett 981020049782426 hernia cat
  'c9db03bb-7241-4bb0-b3b0-bda3e8ee5fce'::UUID,  -- Mouse (has microchip)
  'FFS-861: Embedded microchip in name created duplicate', 'migration'
);

SELECT sot.merge_cats(
  'ecd5ad8a-5b53-4841-8adc-225e6cdde7f3'::UUID,  -- Mouse 981020053770334
  '76e296c2-705c-44e1-8c0b-5b564eff0215'::UUID,  -- Unknown (has microchip)
  'FFS-861: Embedded microchip in name created duplicate', 'migration'
);

SELECT sot.merge_cats(
  'fdcadf75-04ac-433d-bd8d-a9b25bc14fe5'::UUID,  -- Bob 900085001797178
  '8842d745-46fa-4ad3-a602-4ce9b1611ba4'::UUID,  -- Bob (has microchip)
  'FFS-861: Embedded microchip in name created duplicate', 'migration'
);

SELECT sot.merge_cats(
  '88e84015-1209-44c7-82c4-6c916cedefdc'::UUID,  -- Bicha (shared microchip via appointments)
  'c5903788-0d09-4e02-9e0a-f6e52a055126'::UUID,  -- Bicha (has microchip 981020049767313)
  'FFS-861: Embedded microchip in name created duplicate', 'migration'
);

\echo '  → 12 duplicate cats merged'

-- ============================================================================
-- A2. EXTRACT EMBEDDED MICROCHIPS FOR ~16 NON-DUPLICATE CATS
-- ============================================================================

\echo 'A2. Extracting embedded microchips for non-duplicate cats...'

-- For cats whose name contains a 9-15 digit pattern but no existing cat has that chip,
-- extract the chip, set it on the cat, and create a cat_identifiers row.
-- Skip cats that share the same embedded chip (e.g., feralwild211011149 litter).

DO $$
DECLARE
  v_count INT := 0;
  v_cat RECORD;
  v_extracted_chip TEXT;
  v_clean_name TEXT;
BEGIN
  FOR v_cat IN
    SELECT
      c.cat_id,
      c.name,
      (regexp_match(c.name, '([0-9]{9,15})'))[1] AS embedded_chip,
      regexp_replace(
        regexp_replace(c.name, '\s*[-#]?\s*[0-9]{9,15}\s*', ' '),
        '\s+', ' ', 'g'
      ) AS cleaned_name
    FROM sot.cats c
    WHERE c.merged_into_cat_id IS NULL
      AND c.microchip IS NULL
      AND c.name ~ '[0-9]{9,15}'
      -- Only process if extracted chip is unique to this cat
      AND NOT EXISTS (
        SELECT 1 FROM sot.cat_identifiers ci
        WHERE ci.id_value = (regexp_match(c.name, '([0-9]{9,15})'))[1]
          AND ci.id_type = 'microchip'
      )
      -- Skip if multiple cats share the same embedded chip (e.g., litter)
      AND (
        SELECT COUNT(*) FROM sot.cats c2
        WHERE c2.merged_into_cat_id IS NULL
          AND c2.name ~ (regexp_match(c.name, '([0-9]{9,15})'))[1]
      ) = 1
  LOOP
    v_extracted_chip := v_cat.embedded_chip;
    v_clean_name := TRIM(v_cat.cleaned_name);

    -- Set microchip on the cat record
    UPDATE sot.cats
    SET microchip = v_extracted_chip,
        name = CASE WHEN v_clean_name != '' AND v_clean_name != v_extracted_chip
                    THEN v_clean_name ELSE name END,
        updated_at = NOW()
    WHERE cat_id = v_cat.cat_id;

    -- Create cat_identifiers row
    INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at)
    VALUES (v_cat.cat_id, 'microchip', v_extracted_chip, 'clinichq', NOW())
    ON CONFLICT (id_type, id_value) DO NOTHING;

    -- Log to entity_edits
    INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
    VALUES (
      'cat', v_cat.cat_id, 'update',
      jsonb_build_object('name', v_cat.name, 'microchip', NULL),
      jsonb_build_object('name', v_clean_name, 'microchip', v_extracted_chip),
      'migration', 'migration', 'FFS-861: Extracted embedded microchip from name', NOW()
    );

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Extracted embedded microchips for % cats', v_count;
END $$;

-- ============================================================================
-- A3. FIX GORDON MAXWELL MISATTRIBUTION (FFS-860)
-- ============================================================================

\echo 'A3. Fixing Gordon Maxwell / Susan Simons misattribution...'

-- Gordon Maxwell: a14887ba-8fad-4a5a-8546-6390919d40f2
-- Susan Simons:   0053d5f1-2f77-4293-83c2-c9dcb402ea25
-- 1251 Lohrman:   4cb0502e-59eb-4f1e-81f3-4199f20fa704

-- Fix clinic account 8a264d41: Gordon Maxwell's account incorrectly resolved to Susan
UPDATE ops.clinic_accounts
SET resolved_person_id = 'a14887ba-8fad-4a5a-8546-6390919d40f2'::UUID,
    updated_at = NOW()
WHERE account_id = '8a264d41-c58d-4d98-9e08-6ce73f7e314a'::UUID
  AND resolved_person_id = '0053d5f1-2f77-4293-83c2-c9dcb402ea25'::UUID;

-- Fix clinic account ce447c26: Same issue
UPDATE ops.clinic_accounts
SET resolved_person_id = 'a14887ba-8fad-4a5a-8546-6390919d40f2'::UUID,
    updated_at = NOW()
WHERE account_id = 'ce447c26-9e14-41b4-bfd8-20ab6a3a023c'::UUID
  AND resolved_person_id = '0053d5f1-2f77-4293-83c2-c9dcb402ea25'::UUID;

-- Fix appointments: update person_id from Susan to Gordon where owner_address is Lohrman
UPDATE ops.appointments
SET person_id = 'a14887ba-8fad-4a5a-8546-6390919d40f2'::UUID
WHERE person_id = '0053d5f1-2f77-4293-83c2-c9dcb402ea25'::UUID
  AND owner_address ILIKE '%Lohrman%';

-- Remove Susan's bogus resident link to 1251 Lohrman
DELETE FROM sot.person_place
WHERE person_id = '0053d5f1-2f77-4293-83c2-c9dcb402ea25'::UUID
  AND place_id = '4cb0502e-59eb-4f1e-81f3-4199f20fa704'::UUID;

-- Log the fix
INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
VALUES (
  'person',
  'a14887ba-8fad-4a5a-8546-6390919d40f2'::UUID,
  'update',
  jsonb_build_object(
    'issue', 'FFS-860',
    'problem', 'Gordon Maxwell appointments attributed to Susan Simons via shared phone 7075436499',
    'old_person_id', '0053d5f1-2f77-4293-83c2-c9dcb402ea25',
    'affected_accounts', ARRAY['8a264d41-c58d-4d98-9e08-6ce73f7e314a', 'ce447c26-9e14-41b4-bfd8-20ab6a3a023c']
  ),
  jsonb_build_object(
    'fix', 'Reassigned clinic accounts and appointments to Gordon Maxwell',
    'removed_link', 'Susan Simons resident link to 1251 Lohrman removed'
  ),
  'migration', 'migration', 'FFS-860: Phone misattribution fix', NOW()
);

\echo '  → Gordon Maxwell accounts and appointments fixed'

-- ============================================================================
-- A4. ASSIGN CLINIC DAY NUMBERS FOR REBOOKED CATS (FFS-862)
-- ============================================================================

\echo 'A4. Assigning clinic_day_numbers for rebooked cats...'

-- These 3 cats have user-provided numbers from the 03/16 schedule:
-- #31: 981020053911818 (26-987), #32: 981020053916218 (26-986), #34: 981020053919554 (26-984)
-- The others (26-985, 26-988, 26-982) get sequential numbers after the last assigned

-- Assign known numbers first
UPDATE ops.appointments a
SET clinic_day_number = 31
FROM sot.cat_identifiers ci
WHERE ci.cat_id = a.cat_id
  AND ci.id_type = 'microchip'
  AND ci.id_value = '981020053911818'
  AND a.appointment_date = '2026-03-18';

UPDATE ops.appointments a
SET clinic_day_number = 32
FROM sot.cat_identifiers ci
WHERE ci.cat_id = a.cat_id
  AND ci.id_type = 'microchip'
  AND ci.id_value = '981020053916218'
  AND a.appointment_date = '2026-03-18';

UPDATE ops.appointments a
SET clinic_day_number = 34
FROM sot.cat_identifiers ci
WHERE ci.cat_id = a.cat_id
  AND ci.id_type = 'microchip'
  AND ci.id_value = '981020053919554'
  AND a.appointment_date = '2026-03-18';

\echo '  → Assigned known clinic_day_numbers (31, 32, 34) for rebooked cats'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo 'Verification...'

-- Check merged cats
DO $$
DECLARE
  v_merged INT;
  v_gordon_appts INT;
  v_susan_lohrman INT;
BEGIN
  SELECT COUNT(*) INTO v_merged
  FROM sot.cats
  WHERE merged_into_cat_id IS NOT NULL
    AND cat_id IN (
      'ca72ce70-9841-4bec-936b-09f0c2081e78',
      '64610c4a-328e-41eb-88e5-22dfa41ec0f0',
      '2d7e2bd8-c19a-4b88-8353-7bfe759cf555',
      '3e0e4460-4ac8-4199-9893-588158fa16d9',
      'fcc18462-841c-4371-9bda-6b1a7d6bdb12',
      'd4919192-c7da-405d-96f1-df11df487b89',
      '4544d54c-32a8-40ea-9da0-d7f0daaeab4b',
      '8a875e48-d28d-47fb-9b01-bade25ca96f4',
      '15e8f3e7-0108-456e-81d9-b5cdd3b93706',
      'ecd5ad8a-5b53-4841-8adc-225e6cdde7f3',
      'fdcadf75-04ac-433d-bd8d-a9b25bc14fe5',
      '88e84015-1209-44c7-82c4-6c916cedefdc'
    );
  RAISE NOTICE 'A1: % of 12 duplicate cats merged', v_merged;

  -- Check Gordon Maxwell appointments
  SELECT COUNT(*) INTO v_gordon_appts
  FROM ops.appointments
  WHERE person_id = 'a14887ba-8fad-4a5a-8546-6390919d40f2'
    AND owner_address ILIKE '%Lohrman%';
  RAISE NOTICE 'A3: % Gordon Maxwell appointments at Lohrman', v_gordon_appts;

  -- Check Susan no longer linked to Lohrman
  SELECT COUNT(*) INTO v_susan_lohrman
  FROM sot.person_place
  WHERE person_id = '0053d5f1-2f77-4293-83c2-c9dcb402ea25'
    AND place_id = '4cb0502e-59eb-4f1e-81f3-4199f20fa704';
  RAISE NOTICE 'A3: Susan-Lohrman links remaining: % (should be 0)', v_susan_lohrman;
END $$;

COMMIT;

\echo ''
\echo '=============================================='
\echo '  MIG_2987 COMPLETE'
\echo '=============================================='
\echo ''
