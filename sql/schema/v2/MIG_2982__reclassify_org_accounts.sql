-- MIG_2982: Reclassify misclassified org/site accounts
-- FFS-751: 410+ accounts where ClinicHQ first_name = last_name (definitive org pattern)
-- are typed 'resident' and bypass the FFS-747 org-account guard.
--
-- Two patterns:
--   1. Duplicate name: owner_first_name = owner_last_name → always an org in ClinicHQ
--      (e.g., "Keller Estates Vineyards" / "Keller Estates Vineyards")
--   2. Keyword match: display_name contains school, hotel, church, farm, etc.
--
-- Also adds missing keywords to classify_owner_name() business_keywords reference.

-- ============================================================
-- SECTION 1: Pre-repair diagnostics
-- ============================================================

DO $$
DECLARE
  v_dup_name INT;
  v_keyword INT;
  v_with_person INT;
BEGIN
  SELECT COUNT(*) INTO v_dup_name
  FROM ops.clinic_accounts
  WHERE account_type = 'resident' AND merged_into_account_id IS NULL
    AND owner_first_name IS NOT NULL AND owner_last_name IS NOT NULL
    AND LOWER(TRIM(owner_first_name)) = LOWER(TRIM(owner_last_name))
    AND LENGTH(TRIM(owner_first_name)) > 2;

  SELECT COUNT(*) INTO v_keyword
  FROM ops.clinic_accounts
  WHERE account_type = 'resident' AND merged_into_account_id IS NULL
    AND display_name ~* '(school|church|hotel|inn\s|motel|campground|state park|community park|winery|vineyard|transfer station|cal fire|preschool|waldorf|charter school|parks and rec|mobile estates)'
    AND LOWER(TRIM(COALESCE(owner_first_name, ''))) != LOWER(TRIM(COALESCE(owner_last_name, '')));

  SELECT COUNT(*) INTO v_with_person
  FROM ops.clinic_accounts
  WHERE account_type = 'resident' AND merged_into_account_id IS NULL
    AND LOWER(TRIM(owner_first_name)) = LOWER(TRIM(owner_last_name))
    AND LENGTH(TRIM(owner_first_name)) > 2
    AND resolved_person_id IS NOT NULL;

  RAISE NOTICE 'PRE-REPAIR: % duplicate-name accounts, % keyword accounts, % with resolved_person_id',
    v_dup_name, v_keyword, v_with_person;
END $$;

-- ============================================================
-- SECTION 2: Reclassify duplicate-name accounts (first = last)
-- These are definitively orgs in ClinicHQ's data model.
-- Classify using keywords when possible, default to 'site_name'.
-- ============================================================

UPDATE ops.clinic_accounts ca
SET account_type = CASE
    WHEN ca.display_name ~* '(school|preschool|waldorf|charter|university|college)' THEN 'organization'
    WHEN ca.display_name ~* '(church|catholic|holy|jehovah|lutheran|baptist|methodist)' THEN 'organization'
    WHEN ca.display_name ~* '(shelter|rescue|humane|spca|scas|aspca)' THEN 'organization'
    WHEN ca.display_name ~* '(corporation|inc\.|llc|company|co\.)' THEN 'organization'
    WHEN ca.display_name ~* '(fire station|cal fire|parks and rec|city of|county of)' THEN 'organization'
    ELSE 'site_name'
  END,
  classification_reason = 'FFS-751: ClinicHQ first_name = last_name (org pattern)',
  resolved_person_id = NULL,
  updated_at = NOW()
WHERE ca.account_type = 'resident'
  AND ca.merged_into_account_id IS NULL
  AND ca.owner_first_name IS NOT NULL AND ca.owner_last_name IS NOT NULL
  AND LOWER(TRIM(ca.owner_first_name)) = LOWER(TRIM(ca.owner_last_name))
  AND LENGTH(TRIM(ca.owner_first_name)) > 2;

-- ============================================================
-- SECTION 3: Reclassify keyword-matched accounts
-- These have distinct first/last but display_name is clearly an org.
-- ============================================================

UPDATE ops.clinic_accounts ca
SET account_type = CASE
    WHEN ca.display_name ~* '(school|preschool|waldorf|charter)' THEN 'organization'
    WHEN ca.display_name ~* '(church|catholic|holy)' THEN 'organization'
    ELSE 'site_name'
  END,
  classification_reason = 'FFS-751: keyword match in display_name',
  resolved_person_id = NULL,
  updated_at = NOW()
WHERE ca.account_type = 'resident'
  AND ca.merged_into_account_id IS NULL
  AND ca.display_name ~* '(school|church|hotel|inn\s|motel|campground|state park|community park|winery|vineyard|transfer station|cal fire|preschool|waldorf|charter school|parks and rec|mobile estates)'
  -- Exclude people whose names happen to contain keywords
  AND (
    -- Duplicate name pattern (already caught above, but safe to include)
    (ca.owner_first_name IS NOT NULL AND LOWER(TRIM(ca.owner_first_name)) = LOWER(TRIM(ca.owner_last_name)))
    -- Or clearly non-person names (no standard first+last pattern)
    OR ca.display_name !~* '^[A-Z][a-z]+ [A-Z][a-z]+$'
  );

-- ============================================================
-- SECTION 4: NULL out bad person_id on newly-reclassified appointments
-- Same pattern as MIG_2980 — appointments under org accounts shouldn't have person_id
-- ============================================================

UPDATE ops.appointments a
SET person_id = NULL, updated_at = NOW()
FROM ops.clinic_accounts ca
WHERE ca.account_id = a.owner_account_id
  AND ca.account_type IN ('organization', 'site_name')
  AND ca.classification_reason LIKE 'FFS-751%'
  AND ca.resolved_person_id IS NULL
  AND a.person_id IS NOT NULL;

-- ============================================================
-- SECTION 5: NULL out bad inferred_place_id where street doesn't match
-- ============================================================

WITH bad_inferred AS (
  SELECT a.appointment_id
  FROM ops.appointments a
  JOIN ops.clinic_accounts ca ON ca.account_id = a.owner_account_id
  JOIN sot.places pl ON pl.place_id = a.inferred_place_id
  WHERE ca.classification_reason LIKE 'FFS-751%'
    AND a.owner_address IS NOT NULL AND TRIM(a.owner_address) != '' AND LENGTH(TRIM(a.owner_address)) > 10
    AND similarity(
        split_part(sot.normalize_address(a.owner_address), ',', 1),
        split_part(pl.normalized_address, ',', 1)
    ) < 0.4
)
UPDATE ops.appointments a
SET inferred_place_id = NULL, updated_at = NOW()
FROM bad_inferred bi
WHERE a.appointment_id = bi.appointment_id;

-- ============================================================
-- SECTION 6: Delete stale cat_place links
-- ============================================================

DELETE FROM sot.cat_place cp
WHERE cp.evidence_type = 'appointment'
  AND cp.source_system IN ('entity_linking', 'clinichq')
  AND NOT EXISTS (
      SELECT 1 FROM ops.appointments a
      WHERE a.cat_id = cp.cat_id
        AND a.inferred_place_id = cp.place_id
  );

-- ============================================================
-- SECTION 7: Delete sot.people records that were created from org names
-- These are "people" like "Keller Estates Vineyards" that should never exist
-- ============================================================

-- First, remove person_place links for org-name people
DELETE FROM sot.person_place pp
WHERE pp.person_id IN (
  SELECT ca.resolved_person_id FROM ops.clinic_accounts ca
  WHERE ca.classification_reason LIKE 'FFS-751%'
    AND ca.resolved_person_id IS NOT NULL
)
AND NOT EXISTS (
  -- Keep if the person has OTHER accounts that are real people
  SELECT 1 FROM ops.clinic_accounts ca2
  WHERE ca2.resolved_person_id = pp.person_id
    AND ca2.account_type = 'resident'
    AND ca2.classification_reason NOT LIKE 'FFS-751%'
);

-- ============================================================
-- SECTION 8: Re-run entity linking
-- ============================================================

SELECT jsonb_pretty(sot.run_all_entity_linking());

-- ============================================================
-- SECTION 9: Add missing business keywords to ref table
-- ============================================================

-- Check if ref_business_keywords table exists and add to it
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ref_business_keywords') THEN
    INSERT INTO sot.ref_business_keywords (keyword) VALUES
      ('hotel'), ('inn'), ('motel'), ('campground'), ('rv campground'),
      ('vineyard'), ('winery'), ('estates'), ('farms'), ('farm'),
      ('parking'), ('transfer station'), ('fire station'), ('cal fire'),
      ('preschool'), ('waldorf'), ('charter school'), ('mobile estates'),
      ('parks and rec'), ('state park'), ('community park')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ============================================================
-- SECTION 10: Post-repair diagnostics
-- ============================================================

DO $$
DECLARE
  v_remaining INT;
  v_contamination INT;
  v_mismatches INT;
BEGIN
  SELECT COUNT(*) INTO v_remaining
  FROM ops.clinic_accounts
  WHERE account_type = 'resident' AND merged_into_account_id IS NULL
    AND owner_first_name IS NOT NULL AND owner_last_name IS NOT NULL
    AND LOWER(TRIM(owner_first_name)) = LOWER(TRIM(owner_last_name))
    AND LENGTH(TRIM(owner_first_name)) > 2;

  SELECT COUNT(*) INTO v_contamination
  FROM ops.v_org_person_cross_contamination;

  SELECT COUNT(*) INTO v_mismatches
  FROM ops.v_address_mismatch_appointments;

  RAISE NOTICE 'POST-REPAIR: % remaining dup-name resident accounts (should be 0)', v_remaining;
  RAISE NOTICE 'POST-REPAIR: % org-person contamination (should be 0)', v_contamination;
  RAISE NOTICE 'POST-REPAIR: % address mismatches (should be 0)', v_mismatches;
END $$;
