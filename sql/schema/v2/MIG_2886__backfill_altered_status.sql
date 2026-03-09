-- MIG_2886: Backfill altered_status and add altered_by column (FFS-378)
--
-- Data sources (priority order):
--   1. ops.appointments with is_spay = TRUE → 'spayed', altered_by = 'ffsc'
--   2. ops.appointments with is_neuter = TRUE → 'neutered', altered_by = 'ffsc'
--   3. ops.appointments with no_surgery_reason = 'Already Been Sterilized' → altered_by = 'pre_existing'
--   4. Scrape heading_labels_json "Spay/Neutered" → altered status known (sex determines spayed/neutered)
--   5. Scrape heading_labels_json "Not Spay/Neutered" → 'intact'
--
-- Critical distinction: "Altered by FFSC" (is_spay/is_neuter on appointment) vs
-- "pre-existing" (no_surgery_reason = 'Already Been Sterilized'). The scrape
-- label "Spay/Neutered" alone indicates status but not who performed it.
--
-- Safety: Only fills NULLs and 'unknown'. Never overwrites verified data.
-- Never overwrites non-NULL specific values (spayed/neutered/intact).
-- Depends on: MIG_1002 (sot.cats), MIG_2879 (clinichq_scrape), MIG_2885 (registered IDs)

BEGIN;

-- =============================================================================
-- Step 1: Add altered_by column to sot.cats
-- =============================================================================

ALTER TABLE sot.cats ADD COLUMN IF NOT EXISTS altered_by TEXT;

COMMENT ON COLUMN sot.cats.altered_by IS
    'Who altered the cat: ffsc (at FFSC clinic), pre_existing (arrived already altered), NULL (unknown). MIG_2886';

-- =============================================================================
-- Step 2: Backfill from ops.appointments — is_spay = TRUE (highest confidence)
-- =============================================================================

UPDATE sot.cats c
SET altered_status = 'spayed',
    altered_by = 'ffsc',
    updated_at = NOW()
FROM ops.appointments a
WHERE a.cat_id = c.cat_id
  AND a.is_spay = TRUE
  AND c.merged_into_cat_id IS NULL
  AND (c.altered_status IS NULL OR c.altered_status = 'unknown');

-- =============================================================================
-- Step 3: Backfill from ops.appointments — is_neuter = TRUE
-- =============================================================================

UPDATE sot.cats c
SET altered_status = 'neutered',
    altered_by = 'ffsc',
    updated_at = NOW()
FROM ops.appointments a
WHERE a.cat_id = c.cat_id
  AND a.is_neuter = TRUE
  AND c.merged_into_cat_id IS NULL
  AND (c.altered_status IS NULL OR c.altered_status = 'unknown');

-- =============================================================================
-- Step 4: Mark altered_by = 'ffsc' for cats already known to be altered at FFSC
-- (altered_status already set but altered_by is NULL)
-- =============================================================================

UPDATE sot.cats c
SET altered_by = 'ffsc',
    updated_at = NOW()
FROM ops.appointments a
WHERE a.cat_id = c.cat_id
  AND (a.is_spay = TRUE OR a.is_neuter = TRUE)
  AND c.merged_into_cat_id IS NULL
  AND c.altered_status IN ('spayed', 'neutered')
  AND c.altered_by IS NULL;

-- =============================================================================
-- Step 5: Mark pre-existing alterations (no_surgery_reason = 'Already Been Sterilized')
-- =============================================================================

UPDATE sot.cats c
SET altered_by = 'pre_existing',
    updated_at = NOW()
FROM ops.appointments a
WHERE a.cat_id = c.cat_id
  AND a.no_surgery_reason = 'Already Been Sterilized'
  AND c.merged_into_cat_id IS NULL
  AND c.altered_by IS NULL
  -- Don't override ffsc attribution
  AND NOT EXISTS (
      SELECT 1 FROM ops.appointments a2
      WHERE a2.cat_id = c.cat_id
        AND (a2.is_spay = TRUE OR a2.is_neuter = TRUE)
  );

-- For pre-existing cats that don't have altered_status set yet,
-- determine from sex
UPDATE sot.cats c
SET altered_status = CASE
        WHEN c.sex = 'female' THEN 'spayed'
        WHEN c.sex = 'male' THEN 'neutered'
        ELSE c.altered_status  -- leave as-is if sex unknown
    END,
    altered_by = 'pre_existing',
    updated_at = NOW()
FROM ops.appointments a
WHERE a.cat_id = c.cat_id
  AND a.no_surgery_reason = 'Already Been Sterilized'
  AND c.merged_into_cat_id IS NULL
  AND (c.altered_status IS NULL OR c.altered_status = 'unknown')
  AND c.sex IN ('male', 'female');

-- =============================================================================
-- Step 6: Backfill from scrape heading_labels — "Spay/Neutered" label
-- Match via microchip or clinichq_animal_id
-- =============================================================================

-- Cats with "Spay/Neutered" label in scrape (means altered, determine type from sex)
WITH scrape_altered AS (
    SELECT DISTINCT ON (COALESCE(ci_chip.cat_id, ci_id.cat_id))
        COALESCE(ci_chip.cat_id, ci_id.cat_id) AS cat_id,
        s.animal_species_sex_breed
    FROM source.clinichq_scrape s
    LEFT JOIN sot.cat_identifiers ci_chip
        ON ci_chip.id_type = 'microchip'
        AND ci_chip.id_value = s.microchip
        AND s.microchip IS NOT NULL AND s.microchip != '' AND s.microchip != '---'
    LEFT JOIN sot.cat_identifiers ci_id
        ON ci_id.id_type = 'clinichq_animal_id'
        AND ci_id.id_value = COALESCE(s.extracted_clinichq_id,
            CASE WHEN s.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN s.animal_id END)
        AND ci_chip.cat_id IS NULL  -- Only use as fallback
    WHERE COALESCE(ci_chip.cat_id, ci_id.cat_id) IS NOT NULL
      AND s.heading_labels_json @> '"Spay/Neutered"'
      AND (s.checkout_status = 'Checked Out'
           OR (s.checkout_status = 'Canceled' AND s.extracted_clinichq_id IS NOT NULL))
    ORDER BY COALESCE(ci_chip.cat_id, ci_id.cat_id), s.appointment_date DESC
)
UPDATE sot.cats c
SET altered_status = CASE
        WHEN c.sex = 'female' THEN 'spayed'
        WHEN c.sex = 'male' THEN 'neutered'
        -- Try to determine sex from scrape field
        WHEN sa.animal_species_sex_breed ~* 'Female' THEN 'spayed'
        WHEN sa.animal_species_sex_breed ~* 'Male' THEN 'neutered'
        ELSE 'spayed'  -- Default: most FFSC patients are female (spay)
    END,
    updated_at = NOW()
FROM scrape_altered sa
WHERE sa.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NULL
  AND (c.altered_status IS NULL OR c.altered_status = 'unknown');

-- =============================================================================
-- Step 7: Backfill from scrape — "Not Spay/Neutered" label → intact
-- =============================================================================

WITH scrape_intact AS (
    SELECT DISTINCT ON (COALESCE(ci_chip.cat_id, ci_id.cat_id))
        COALESCE(ci_chip.cat_id, ci_id.cat_id) AS cat_id
    FROM source.clinichq_scrape s
    LEFT JOIN sot.cat_identifiers ci_chip
        ON ci_chip.id_type = 'microchip'
        AND ci_chip.id_value = s.microchip
        AND s.microchip IS NOT NULL AND s.microchip != '' AND s.microchip != '---'
    LEFT JOIN sot.cat_identifiers ci_id
        ON ci_id.id_type = 'clinichq_animal_id'
        AND ci_id.id_value = COALESCE(s.extracted_clinichq_id,
            CASE WHEN s.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN s.animal_id END)
        AND ci_chip.cat_id IS NULL
    WHERE COALESCE(ci_chip.cat_id, ci_id.cat_id) IS NOT NULL
      AND s.heading_labels_json @> '"Not Spay/Neutered"'
      AND (s.checkout_status = 'Checked Out'
           OR (s.checkout_status = 'Canceled' AND s.extracted_clinichq_id IS NOT NULL))
      -- Don't mark as intact if any other record shows them altered
      AND NOT EXISTS (
          SELECT 1 FROM source.clinichq_scrape s2
          WHERE (s2.microchip = s.microchip OR s2.extracted_clinichq_id = s.extracted_clinichq_id)
            AND s2.heading_labels_json @> '"Spay/Neutered"'
      )
    ORDER BY COALESCE(ci_chip.cat_id, ci_id.cat_id)
)
UPDATE sot.cats c
SET altered_status = 'intact',
    updated_at = NOW()
FROM scrape_intact si
WHERE si.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NULL
  AND (c.altered_status IS NULL OR c.altered_status = 'unknown');

-- =============================================================================
-- Verification
-- =============================================================================

DO $$
DECLARE
    v_status RECORD;
    v_by RECORD;
BEGIN
    RAISE NOTICE 'MIG_2886: altered_status + altered_by backfill complete';
    RAISE NOTICE '';
    RAISE NOTICE '  altered_status distribution:';
    FOR v_status IN
        SELECT COALESCE(altered_status, 'NULL') AS status, COUNT(*) AS ct
        FROM sot.cats WHERE merged_into_cat_id IS NULL
        GROUP BY 1 ORDER BY ct DESC
    LOOP
        RAISE NOTICE '    %: %', v_status.status, v_status.ct;
    END LOOP;

    RAISE NOTICE '';
    RAISE NOTICE '  altered_by distribution:';
    FOR v_by IN
        SELECT COALESCE(altered_by, 'NULL') AS by_whom, COUNT(*) AS ct
        FROM sot.cats WHERE merged_into_cat_id IS NULL
        GROUP BY 1 ORDER BY ct DESC
    LOOP
        RAISE NOTICE '    %: %', v_by.by_whom, v_by.ct;
    END LOOP;
END $$;

COMMIT;
