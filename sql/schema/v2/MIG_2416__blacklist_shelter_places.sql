-- MIG_2416: Investigate & Blacklist Shelter Places
--
-- Problem: 217 Healdsburg Ave has 2,381 cats linked - likely a shelter
-- Need to investigate and add to place_soft_blacklist if confirmed
--
-- Also check: 1814 Empire Industrial Ct (FFSC Clinic) - 2,353 cats
-- Should already be in blacklist but verify

BEGIN;

-- 1. Investigate 217 Healdsburg Ave
DO $$
DECLARE
  v_place_id UUID;
  v_display_name TEXT;
  v_cat_count INT;
  v_clinichq_cats INT;
  v_shelterluv_cats INT;
  v_petlink_cats INT;
BEGIN
  -- Find the place
  SELECT place_id, display_name
  INTO v_place_id, v_display_name
  FROM sot.places
  WHERE display_name ILIKE '%217 Healdsburg%'
  AND merged_into_place_id IS NULL
  LIMIT 1;

  IF v_place_id IS NULL THEN
    RAISE NOTICE 'MIG_2416: 217 Healdsburg Ave not found';
    RETURN;
  END IF;

  -- Count cats by source
  SELECT
    COUNT(*) FILTER (WHERE c.source_system = 'clinichq'),
    COUNT(*) FILTER (WHERE c.source_system = 'shelterluv'),
    COUNT(*) FILTER (WHERE c.source_system = 'petlink'),
    COUNT(*)
  INTO v_clinichq_cats, v_shelterluv_cats, v_petlink_cats, v_cat_count
  FROM sot.cats c
  JOIN sot.cat_place_relationships cpr ON cpr.cat_id = c.cat_id
  WHERE cpr.place_id = v_place_id
  AND c.merged_into_cat_id IS NULL;

  RAISE NOTICE 'MIG_2416: % has % cats (ClinicHQ: %, ShelterLuv: %, PetLink: %)',
    v_display_name, v_cat_count, v_clinichq_cats, v_shelterluv_cats, v_petlink_cats;

  -- If majority from ShelterLuv, it's likely a shelter
  IF v_shelterluv_cats > v_cat_count * 0.5 THEN
    RAISE NOTICE 'MIG_2416: Majority ShelterLuv - likely a shelter. Adding to blacklist.';

    -- Check if already in blacklist
    IF NOT EXISTS (
      SELECT 1 FROM sot.place_soft_blacklist
      WHERE place_id = v_place_id
    ) THEN
      INSERT INTO sot.place_soft_blacklist (place_id, blacklist_type, reason, created_by)
      VALUES (v_place_id, 'all', 'Shelter location (ShelterLuv) - not residential', 'MIG_2416');
      RAISE NOTICE 'MIG_2416: Added to place_soft_blacklist';
    ELSE
      RAISE NOTICE 'MIG_2416: Already in blacklist';
    END IF;
  ELSE
    RAISE NOTICE 'MIG_2416: Not majority ShelterLuv - manual review recommended';
  END IF;
END $$;

-- 2. Verify FFSC Clinic is in blacklist
DO $$
DECLARE
  v_place_id UUID;
  v_in_blacklist BOOLEAN;
BEGIN
  SELECT place_id INTO v_place_id
  FROM sot.places
  WHERE display_name ILIKE '%1814 Empire Industrial%'
  AND merged_into_place_id IS NULL
  LIMIT 1;

  IF v_place_id IS NULL THEN
    RAISE NOTICE 'MIG_2416: 1814 Empire Industrial Ct not found';
    RETURN;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM sot.place_soft_blacklist WHERE place_id = v_place_id
  ) INTO v_in_blacklist;

  IF v_in_blacklist THEN
    RAISE NOTICE 'MIG_2416: FFSC Clinic already in blacklist - OK';
  ELSE
    RAISE NOTICE 'MIG_2416: WARNING - FFSC Clinic NOT in blacklist! Adding...';
    INSERT INTO sot.place_soft_blacklist (place_id, blacklist_type, reason, created_by)
    VALUES (v_place_id, 'disease_computation', 'FFSC Clinic - cats treated here not residential', 'MIG_2416');
  END IF;
END $$;

-- 3. Find other places with suspiciously high cat counts
-- (More than 100 cats linked might indicate shelter/clinic)
SELECT
  p.place_id,
  p.display_name,
  p.source_system,
  COUNT(DISTINCT cpr.cat_id) as cat_count,
  CASE
    WHEN psb.place_id IS NOT NULL THEN 'BLACKLISTED'
    ELSE 'NOT BLACKLISTED'
  END as blacklist_status
FROM sot.places p
JOIN sot.cat_place_relationships cpr ON cpr.place_id = p.place_id
LEFT JOIN sot.place_soft_blacklist psb ON psb.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL
GROUP BY p.place_id, p.display_name, p.source_system, psb.place_id
HAVING COUNT(DISTINCT cpr.cat_id) > 100
ORDER BY cat_count DESC;

COMMIT;
