-- ============================================================================
-- MIG_557: Backfill Primary Address from Associated Places
-- ============================================================================
-- Run AFTER MIG_556 geocoding completes (when most places have sot_address_id).
--
-- Sets primary_address_id on sot_people where:
-- - Person has no primary_address_id
-- - Person has a person_place_relationship to a place with sot_address_id
-- - Uses highest confidence relationship as the primary address
--
-- Also creates a trigger to auto-set primary_address_id on future inserts
-- to person_place_relationships.
-- ============================================================================

\echo '=== MIG_557: Backfill Primary Addresses ==='

-- Preview: how many people will be updated
\echo 'People to update:'
SELECT COUNT(*) AS people_to_backfill
FROM trapper.sot_people p
WHERE p.primary_address_id IS NULL
  AND p.merged_into_person_id IS NULL
  AND EXISTS (
    SELECT 1 FROM trapper.person_place_relationships ppr
    JOIN trapper.places pl ON pl.place_id = ppr.place_id
    WHERE ppr.person_id = p.person_id
      AND pl.sot_address_id IS NOT NULL
      AND pl.merged_into_place_id IS NULL
  );

-- Backfill using highest-confidence associated place
UPDATE trapper.sot_people p
SET primary_address_id = sub.sot_address_id
FROM (
  SELECT DISTINCT ON (ppr.person_id)
    ppr.person_id,
    pl.sot_address_id
  FROM trapper.person_place_relationships ppr
  JOIN trapper.places pl ON pl.place_id = ppr.place_id
  WHERE pl.sot_address_id IS NOT NULL
    AND pl.merged_into_place_id IS NULL
  ORDER BY ppr.person_id, ppr.confidence DESC NULLS LAST, ppr.created_at DESC
) sub
WHERE sub.person_id = p.person_id
  AND p.primary_address_id IS NULL
  AND p.merged_into_person_id IS NULL;

\echo 'People updated:'
SELECT COUNT(*) AS updated
FROM trapper.sot_people
WHERE primary_address_id IS NOT NULL
  AND merged_into_person_id IS NULL;

-- Create trigger to auto-set primary_address_id on future person_place_relationships
CREATE OR REPLACE FUNCTION trapper.auto_set_primary_address()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_sot_address_id UUID;
BEGIN
  -- Only proceed if the person has no primary address
  IF EXISTS (
    SELECT 1 FROM trapper.sot_people
    WHERE person_id = NEW.person_id
      AND primary_address_id IS NULL
      AND merged_into_person_id IS NULL
  ) THEN
    -- Get the sot_address_id from the linked place
    SELECT pl.sot_address_id INTO v_sot_address_id
    FROM trapper.places pl
    WHERE pl.place_id = NEW.place_id
      AND pl.sot_address_id IS NOT NULL
      AND pl.merged_into_place_id IS NULL;

    IF v_sot_address_id IS NOT NULL THEN
      UPDATE trapper.sot_people
      SET primary_address_id = v_sot_address_id
      WHERE person_id = NEW.person_id
        AND primary_address_id IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_set_primary_address ON trapper.person_place_relationships;
CREATE TRIGGER trg_auto_set_primary_address
  AFTER INSERT ON trapper.person_place_relationships
  FOR EACH ROW
  EXECUTE FUNCTION trapper.auto_set_primary_address();

COMMENT ON FUNCTION trapper.auto_set_primary_address() IS
  'Auto-sets primary_address_id on sot_people when a person_place_relationship is created and the person has no primary address.';

\echo '=== MIG_557 Complete ==='
