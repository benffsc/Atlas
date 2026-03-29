-- MIG_2980: Repair mislinked appointments from org/site/address accounts
-- FFS-747: Data repair — depends on MIG_2979 function fixes being in place
--
-- This migration:
-- 1. NULLs out bad person_id on org-account appointments
-- 2. NULLs out bad inferred_place_id where booking address ≠ inferred place
-- 3. Removes stale cat_place links from mislinked appointments
-- 4. Re-runs the fixed entity linking pipeline

-- ============================================================
-- SECTION 1: Pre-repair diagnostics
-- ============================================================

DO $$
DECLARE
    v_bad_person_ids INT;
    v_bad_inferred INT;
    v_stale_cat_place INT;
BEGIN
    -- Count appointments with person_id on org accounts
    SELECT COUNT(*) INTO v_bad_person_ids
    FROM ops.appointments a
    JOIN ops.clinic_accounts ca ON ca.account_id = a.owner_account_id
    WHERE ca.account_type IN ('organization', 'site_name', 'address')
      AND ca.resolved_person_id IS NULL
      AND ca.merged_into_account_id IS NULL
      AND a.person_id IS NOT NULL;

    -- Count appointments where inferred address doesn't match booking address
    SELECT COUNT(*) INTO v_bad_inferred
    FROM ops.appointments a
    JOIN sot.places pl ON pl.place_id = a.inferred_place_id
    WHERE a.owner_address IS NOT NULL
      AND TRIM(a.owner_address) != ''
      AND LENGTH(TRIM(a.owner_address)) > 10
      AND similarity(
          sot.normalize_address(a.owner_address),
          pl.normalized_address
      ) < 0.3;

    RAISE NOTICE 'PRE-REPAIR: % appointments with person_id on org accounts', v_bad_person_ids;
    RAISE NOTICE 'PRE-REPAIR: % appointments with mismatched inferred_place_id', v_bad_inferred;
END $$;

-- ============================================================
-- SECTION 2: NULL out bad person_id on org-account appointments
-- ============================================================

UPDATE ops.appointments a
SET person_id = NULL,
    updated_at = NOW()
FROM ops.clinic_accounts ca
WHERE ca.account_id = a.owner_account_id
  AND ca.account_type IN ('organization', 'site_name', 'address')
  AND ca.resolved_person_id IS NULL
  AND ca.merged_into_account_id IS NULL
  AND a.person_id IS NOT NULL;

-- ============================================================
-- SECTION 3: NULL out bad inferred_place_id
-- Only for appointments where the inferred address is clearly wrong
-- (similarity < 0.3 against booking address)
-- ============================================================

-- Use STREET-level similarity, not full address — full address comparison is
-- misleading because shared city/state/zip inflates similarity for different streets.
-- e.g., "500 mecham rd, petaluma, ca 94952" vs "4590 roblar rd, petaluma, ca 94952" = 0.49 full, 0.08 street
UPDATE ops.appointments a
SET inferred_place_id = NULL,
    updated_at = NOW()
FROM sot.places pl
WHERE pl.place_id = a.inferred_place_id
  AND a.owner_address IS NOT NULL
  AND TRIM(a.owner_address) != ''
  AND LENGTH(TRIM(a.owner_address)) > 10
  AND similarity(
      split_part(sot.normalize_address(a.owner_address), ',', 1),
      split_part(pl.normalized_address, ',', 1)
  ) < 0.4;

-- ============================================================
-- SECTION 4: Remove stale cat_place links
-- Delete automated cat_place rows where the appointment no longer
-- supports the link (inferred_place_id was NULLed above).
-- Only targets automated links, not staff-verified.
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
-- SECTION 5: Re-run the fixed entity linking pipeline
-- This will:
-- - Set person_id correctly (with org guard from MIG_2979)
-- - Re-infer places using improved address matching
-- - Create new places where needed (Step 1.5)
-- - Re-link cats to correct places
-- ============================================================

SELECT jsonb_pretty(sot.run_all_entity_linking());

-- ============================================================
-- SECTION 6: Post-repair diagnostics
-- ============================================================

DO $$
DECLARE
    v_remaining_bad INT;
    v_landfill_cats INT;
    v_roblar_cats INT;
    v_mecham_cats INT;
BEGIN
    -- Should be 0: appointments with person_id on org accounts
    SELECT COUNT(*) INTO v_remaining_bad
    FROM ops.appointments a
    JOIN ops.clinic_accounts ca ON ca.account_id = a.owner_account_id
    WHERE ca.account_type IN ('organization', 'site_name', 'address')
      AND ca.resolved_person_id IS NULL
      AND ca.merged_into_account_id IS NULL
      AND a.person_id IS NOT NULL;

    -- Verify landfill cats moved: count at 4590 Roblar vs 500 Mecham
    SELECT COUNT(DISTINCT cp.cat_id) INTO v_roblar_cats
    FROM sot.cat_place cp
    JOIN sot.places p ON p.place_id = cp.place_id
    WHERE p.formatted_address ILIKE '%4590 Roblar%';

    SELECT COUNT(DISTINCT cp.cat_id) INTO v_mecham_cats
    FROM sot.cat_place cp
    JOIN sot.places p ON p.place_id = cp.place_id
    WHERE p.formatted_address ILIKE '%Mecham%';

    RAISE NOTICE 'POST-REPAIR: % appointments STILL with person_id on org accounts (should be 0)', v_remaining_bad;
    RAISE NOTICE 'POST-REPAIR: 4590 Roblar Road cats: % (should be ~10, was 73)', v_roblar_cats;
    RAISE NOTICE 'POST-REPAIR: Mecham Road (landfill) cats: % (should be ~60+, was 0)', v_mecham_cats;
END $$;
