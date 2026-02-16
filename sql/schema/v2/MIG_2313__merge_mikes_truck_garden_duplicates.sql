-- MIG_2313: Merge "Mike's Truck Garden" duplicate person records
--
-- Root cause: ClinicHQ appointments booked with business name as owner name
-- Created 19 orphan records with no identifiers (INV-24)
-- "Mike's Truck Garden" is a trapping site name, not a person (INV-20)
--
-- Fix: Merge all duplicates into oldest record, mark as organization

BEGIN;

-- Step 1: Get the canonical (oldest) person_id
DO $$
DECLARE
  v_canonical_id UUID;
  v_place_id UUID;
  v_count INT;
BEGIN
  -- Get the oldest record as canonical
  SELECT person_id INTO v_canonical_id
  FROM sot.people
  WHERE display_name = 'Mike''s Truck Garden'
    AND merged_into_person_id IS NULL
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_canonical_id IS NULL THEN
    RAISE NOTICE 'No Mike''s Truck Garden records found, skipping';
    RETURN;
  END IF;

  -- Get the linked place
  SELECT place_id INTO v_place_id
  FROM sot.person_place
  WHERE person_id = v_canonical_id
  LIMIT 1;

  RAISE NOTICE 'Canonical person_id: %, place_id: %', v_canonical_id, v_place_id;

  -- Step 2: Count duplicates to merge
  SELECT COUNT(*) INTO v_count
  FROM sot.people
  WHERE display_name = 'Mike''s Truck Garden'
    AND merged_into_person_id IS NULL
    AND person_id != v_canonical_id;

  RAISE NOTICE 'Merging % duplicates into canonical record', v_count;

  -- Step 3: Update person_place relationships to point to canonical
  UPDATE sot.person_place
  SET person_id = v_canonical_id
  WHERE person_id IN (
    SELECT person_id FROM sot.people
    WHERE display_name = 'Mike''s Truck Garden'
      AND merged_into_person_id IS NULL
      AND person_id != v_canonical_id
  )
  AND NOT EXISTS (
    -- Avoid duplicates
    SELECT 1 FROM sot.person_place
    WHERE person_id = v_canonical_id
      AND place_id = sot.person_place.place_id
  );

  -- Step 4: Mark duplicates as merged
  UPDATE sot.people
  SET merged_into_person_id = v_canonical_id,
      updated_at = NOW()
  WHERE display_name = 'Mike''s Truck Garden'
    AND merged_into_person_id IS NULL
    AND person_id != v_canonical_id;

  -- Step 5: Mark canonical as organization
  UPDATE sot.people
  SET entity_type = 'organization',
      updated_at = NOW()
  WHERE person_id = v_canonical_id;

  RAISE NOTICE 'Successfully merged % duplicates into %', v_count, v_canonical_id;
END;
$$;

-- Verification
SELECT
  COUNT(*) FILTER (WHERE merged_into_person_id IS NULL) as active_records,
  COUNT(*) FILTER (WHERE merged_into_person_id IS NOT NULL) as merged_records,
  COUNT(*) as total_records
FROM sot.people
WHERE display_name = 'Mike''s Truck Garden';

COMMIT;
