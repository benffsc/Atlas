-- MIG_2095: Populate sot.cat_identifiers from denormalized sot.cats columns
-- Date: 2026-02-14
-- Issue: Clinic-days route joins to cat_identifiers but it may be empty
--        while sot.cats has denormalized microchip, clinichq_animal_id, shelterluv_animal_id

-- This migration populates the normalized cat_identifiers table from denormalized cat fields

-- ============================================================================
-- STEP 1: Populate microchips
-- ============================================================================
INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at)
SELECT
    c.cat_id,
    'microchip',
    c.microchip,
    COALESCE(c.source_system, 'clinichq'),
    COALESCE(c.created_at, NOW())
FROM sot.cats c
WHERE c.microchip IS NOT NULL
  AND c.microchip != ''
  AND c.merged_into_cat_id IS NULL
ON CONFLICT (id_type, id_value) DO NOTHING;

-- ============================================================================
-- STEP 2: Populate clinichq_animal_id
-- ============================================================================
INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at)
SELECT
    c.cat_id,
    'clinichq_animal_id',
    c.clinichq_animal_id,
    'clinichq',
    COALESCE(c.created_at, NOW())
FROM sot.cats c
WHERE c.clinichq_animal_id IS NOT NULL
  AND c.clinichq_animal_id != ''
  AND c.merged_into_cat_id IS NULL
ON CONFLICT (id_type, id_value) DO NOTHING;

-- ============================================================================
-- STEP 3: Populate shelterluv_animal_id
-- ============================================================================
INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at)
SELECT
    c.cat_id,
    'shelterluv_animal_id',
    c.shelterluv_animal_id,
    'shelterluv',
    COALESCE(c.created_at, NOW())
FROM sot.cats c
WHERE c.shelterluv_animal_id IS NOT NULL
  AND c.shelterluv_animal_id != ''
  AND c.merged_into_cat_id IS NULL
ON CONFLICT (id_type, id_value) DO NOTHING;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
DECLARE
    v_microchip_count INT;
    v_clinichq_count INT;
    v_shelterluv_count INT;
BEGIN
    SELECT COUNT(*) INTO v_microchip_count FROM sot.cat_identifiers WHERE id_type = 'microchip';
    SELECT COUNT(*) INTO v_clinichq_count FROM sot.cat_identifiers WHERE id_type = 'clinichq_animal_id';
    SELECT COUNT(*) INTO v_shelterluv_count FROM sot.cat_identifiers WHERE id_type = 'shelterluv_animal_id';

    RAISE NOTICE 'MIG_2095: cat_identifiers populated:';
    RAISE NOTICE '  - microchip: % records', v_microchip_count;
    RAISE NOTICE '  - clinichq_animal_id: % records', v_clinichq_count;
    RAISE NOTICE '  - shelterluv_animal_id: % records', v_shelterluv_count;
END $$;
