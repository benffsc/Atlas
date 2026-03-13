-- MIG_2923: Reclassify trapper tiers from Airtable approval statuses
--
-- Problem: All Airtable-sourced trappers have NULL trapper_type in trapper_profiles
-- or no profile at all. Airtable had distinct approval statuses that map to tiers.
--
-- Fixes FFS-471

BEGIN;

-- =========================================================================
-- Step 1: Create missing trapper_profiles for community trappers
-- These have person_roles.role='trapper' but no trapper_profiles row
-- =========================================================================

-- Community trappers (active)
INSERT INTO sot.trapper_profiles (person_id, trapper_type, is_active, has_signed_contract, source_system)
VALUES
  ('311ec534-379d-41ab-8727-33216c691fa0', 'community_trapper', true, false, 'airtable'),   -- Thea Torgersen
  ('f8d88cc0-b7e1-4b2f-8d20-caf6ed3aab45', 'community_trapper', true, false, 'airtable'),   -- Sharon Conley
  ('74940678-e637-4e70-a366-f20760aa0ab4', 'community_trapper', true, false, 'airtable'),   -- Erika Wasmund
  ('764347d9-b74d-43a8-acef-7a628a638372', 'community_trapper', true, false, 'airtable'),   -- Sandra Percell
  ('32535423-34ff-46c5-bec6-b358c7d0cdca', 'community_trapper', true, false, 'airtable'),   -- Shelley Redding
  ('39fc333c-04d1-4d6b-9011-5e16803f3a95', 'community_trapper', true, false, 'airtable'),   -- Jason Farthing
  ('626b95ab-afb3-419d-b576-b2ee2367cf91', 'community_trapper', true, false, 'airtable')    -- Yazlee Jaimes
ON CONFLICT (person_id) DO UPDATE SET
  trapper_type = 'community_trapper',
  updated_at = NOW();

-- Community trappers (inactive)
INSERT INTO sot.trapper_profiles (person_id, trapper_type, is_active, has_signed_contract, source_system)
VALUES
  ('0b186e31-9962-41c2-b12f-ece7091798bc', 'community_trapper', false, false, 'airtable'),  -- Donna Best
  ('cc60c711-d254-49dc-a53d-c2cbdd9f02b6', 'community_trapper', false, false, 'airtable'),  -- Mike Raxter
  ('e364ae05-c196-4406-a89f-936bbd00dfb9', 'community_trapper', false, false, 'airtable')   -- Bettina Kirby
ON CONFLICT (person_id) DO UPDATE SET
  trapper_type = 'community_trapper',
  is_active = false,
  updated_at = NOW();

-- =========================================================================
-- Step 2: Update existing profiles with NULL trapper_type
-- =========================================================================

-- Vanessa Clark: should be community_trapper (active)
UPDATE sot.trapper_profiles SET trapper_type = 'community_trapper', updated_at = NOW()
WHERE person_id = '3bfc98ad-128a-48c0-9aeb-51412883666e';

-- Inactive trappers: update existing profiles
UPDATE sot.trapper_profiles SET is_active = false, updated_at = NOW()
WHERE person_id IN (
  '77cd4677-eedf-4ccc-aa1f-51c5e2bd0746',  -- Anna Woods
  'd5316a28-bb47-4f1d-b066-7c2a1ed0bd3a',  -- Becky Williams
  '196f44a8-5777-4e21-ba5c-462220f4c0c2',  -- Ellen Beckworth
  '7907ef60-2dcb-4dd1-9027-ba66ce9ec30b'   -- Tina Piatt
);

-- Also set their trapper_type to community_trapper (they came from Airtable, not VH)
UPDATE sot.trapper_profiles SET trapper_type = 'community_trapper', updated_at = NOW()
WHERE person_id IN (
  '77cd4677-eedf-4ccc-aa1f-51c5e2bd0746',  -- Anna Woods
  'd5316a28-bb47-4f1d-b066-7c2a1ed0bd3a',  -- Becky Williams
  '196f44a8-5777-4e21-ba5c-462220f4c0c2',  -- Ellen Beckworth
  '7907ef60-2dcb-4dd1-9027-ba66ce9ec30b',  -- Tina Piatt
  '3bfc98ad-128a-48c0-9aeb-51412883666e'   -- Vanessa Clark
)
AND trapper_type IS NULL;

-- =========================================================================
-- Step 3: Add notes from Airtable to relevant profiles
-- =========================================================================

UPDATE sot.trapper_profiles SET
  notes = COALESCE(notes || E'\n', '') || '[Airtable] Only Sonoma Valley area (Semi-Active)',
  updated_at = NOW()
WHERE person_id = 'a7c56b39-64bb-41c6-8534-8eb16cb3517b'  -- Tom Donahue
  AND (notes IS NULL OR notes NOT LIKE '%Only Sonoma Valley%');

-- =========================================================================
-- Step 4: Verification
-- =========================================================================

DO $$
DECLARE
  v_rec RECORD;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== MIG_2923 Verification ===';
  RAISE NOTICE '';
  RAISE NOTICE 'Trapper profile distribution:';
  FOR v_rec IN
    SELECT tp.trapper_type, tp.is_active, COUNT(*) as cnt
    FROM sot.trapper_profiles tp
    JOIN sot.people p ON p.person_id = tp.person_id AND p.merged_into_person_id IS NULL
    GROUP BY tp.trapper_type, tp.is_active
    ORDER BY tp.trapper_type, tp.is_active DESC
  LOOP
    RAISE NOTICE '  %-20s active=%-5s  count=%',
      COALESCE(v_rec.trapper_type, 'NULL'), v_rec.is_active, v_rec.cnt;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE 'Profiles with NULL trapper_type (should be 0):';
  FOR v_rec IN
    SELECT p.display_name
    FROM sot.trapper_profiles tp
    JOIN sot.people p ON p.person_id = tp.person_id AND p.merged_into_person_id IS NULL
    WHERE tp.trapper_type IS NULL
  LOOP
    RAISE NOTICE '  !! %', v_rec.display_name;
  END LOOP;
END $$;

COMMIT;
