-- MIG_2884: Fix first-visit microchip-in-name appointments (FFS-385)
--
-- Problem: 22 appointments have cat_id = NULL where Animal Name is a 15-digit
-- microchip. The ingest pipeline's Step 1b only matched EXISTING cats via
-- cat_identifiers, so first visits (where the cat didn't exist yet) were missed.
-- Step 1c explicitly excluded microchip-like names with NOT (... ~ '^\d{15}$').
--
-- Root cause: Three-part pipeline gap:
--   1. Step 1b queries cat_identifiers — fails for first visits (cat doesn't exist)
--   2. Step 1c excludes microchip-pattern names — skips these rows entirely
--   3. extract_and_link_microchips_from_animal_name() — stub, never implemented
--
-- Fix: Create cats from the microchip in Animal Name, then link appointments.
-- Pipeline fix in route.ts adds Step 1b-bis for future uploads.
--
-- Safety: Only creates cats where microchip doesn't already exist. Uses
-- find_or_create_cat_by_microchip pattern. Never overwrites existing data.
-- Depends on: MIG_1002 (sot tables)

BEGIN;

-- =============================================================================
-- Step 1: Create cats for first-visit microchip-in-name records
-- =============================================================================

-- Find staged records where Animal Name is a microchip but no cat exists
WITH first_visit_chips AS (
    SELECT DISTINCT ON (TRIM(sr.payload->>'Animal Name'))
        TRIM(sr.payload->>'Animal Name') AS microchip,
        NULLIF(TRIM(sr.payload->>'Number'), '') AS clinichq_animal_id,
        NULLIF(TRIM(sr.payload->>'Sex'), '') AS sex,
        NULLIF(TRIM(sr.payload->>'Breed'), '') AS breed,
        NULLIF(TRIM(sr.payload->>'Primary Color'), '') AS color,
        sr.source_row_id
    FROM ops.staged_records sr
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'cat_info'
      -- Animal Name is a 15-digit microchip
      AND sr.payload->>'Animal Name' ~ '^[0-9]{15}$'
      -- No microchip in the Microchip Number field
      AND (sr.payload->>'Microchip Number' IS NULL OR TRIM(sr.payload->>'Microchip Number') = '')
      -- No existing cat with this microchip
      AND NOT EXISTS (
          SELECT 1 FROM sot.cat_identifiers ci
          WHERE ci.id_value = TRIM(sr.payload->>'Animal Name')
            AND ci.id_type = 'microchip'
      )
    ORDER BY TRIM(sr.payload->>'Animal Name'), sr.created_at DESC
),
created_cats AS (
    INSERT INTO sot.cats (
        cat_id, microchip, sex, breed, primary_color,
        clinichq_animal_id, source_system, source_record_id,
        created_at, updated_at
    )
    SELECT
        gen_random_uuid(),
        fvc.microchip,
        LOWER(fvc.sex),
        fvc.breed,
        fvc.color,
        fvc.clinichq_animal_id,
        'clinichq',
        fvc.source_row_id,
        NOW(),
        NOW()
    FROM first_visit_chips fvc
    RETURNING cat_id, microchip, clinichq_animal_id
),
-- Create identifiers for the new cats
inserted_identifiers AS (
    INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at)
    SELECT cc.cat_id, 'microchip', cc.microchip, 'clinichq', NOW()
    FROM created_cats cc
    UNION ALL
    SELECT cc.cat_id, 'clinichq_animal_id', cc.clinichq_animal_id, 'clinichq', NOW()
    FROM created_cats cc
    WHERE cc.clinichq_animal_id IS NOT NULL
    ON CONFLICT DO NOTHING
    RETURNING cat_id
)
SELECT COUNT(DISTINCT cat_id) AS cats_created FROM created_cats;

-- =============================================================================
-- Step 2: Link unlinked appointments via microchip in Animal Name
-- =============================================================================

-- Now that cats exist, link appointments where animal_name is a microchip
UPDATE ops.appointments a
SET cat_id = sot.get_canonical_cat_id(ci.cat_id)
FROM ops.staged_records sr
JOIN sot.cat_identifiers ci
    ON ci.id_value = TRIM(sr.payload->>'Animal Name')
    AND ci.id_type = 'microchip'
WHERE a.appointment_number = sr.payload->>'Number'
  AND a.appointment_date = TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY')
  AND sr.source_system = 'clinichq'
  AND sr.source_table = 'appointment_info'
  AND a.cat_id IS NULL
  -- The appointment's animal has a microchip-like name
  AND sr.payload->>'Animal Name' ~ '^[0-9]{15}$'
  AND (sr.payload->>'Microchip Number' IS NULL OR TRIM(sr.payload->>'Microchip Number') = '');

-- =============================================================================
-- Step 3: Also try linking via clinichq_animal_id for any remaining
-- =============================================================================

UPDATE ops.appointments a
SET cat_id = sot.get_canonical_cat_id(ci.cat_id)
FROM sot.cat_identifiers ci
WHERE ci.id_value = a.appointment_number
  AND ci.id_type = 'clinichq_animal_id'
  AND a.cat_id IS NULL
  AND a.source_system = 'clinichq';

-- =============================================================================
-- Verification
-- =============================================================================

DO $$
DECLARE
    v_unlinked INTEGER;
    v_unlinked_with_chip_name INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_unlinked
    FROM ops.appointments
    WHERE cat_id IS NULL AND source_system = 'clinichq';

    SELECT COUNT(*) INTO v_unlinked_with_chip_name
    FROM ops.appointments a
    JOIN ops.staged_records sr ON sr.payload->>'Number' = a.appointment_number
        AND sr.source_system = 'clinichq' AND sr.source_table = 'cat_info'
    WHERE a.cat_id IS NULL AND a.source_system = 'clinichq'
      AND sr.payload->>'Animal Name' ~ '^[0-9]{15}$';

    RAISE NOTICE 'MIG_2884: First-visit microchip-in-name fix';
    RAISE NOTICE '  Remaining unlinked appointments: %', v_unlinked;
    RAISE NOTICE '  Unlinked with microchip-in-name: % (should be 0)', v_unlinked_with_chip_name;
END $$;

COMMIT;
