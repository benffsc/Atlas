-- MIG_2885: Register clinichq_animal_ids from scrape data (FFS-376)
--
-- The scrape contains 20,480 extracted_clinichq_id values (XX-XXXX format from
-- animal_heading_raw), but only ~1,579 match existing sot.cat_identifiers.
-- Gap of ~19K IDs that could bridge scrape data to sot.cats.
--
-- Strategy: For scrape records with extracted_clinichq_id where the cat is
-- ALREADY matched by microchip but lacks a clinichq_animal_id identifier,
-- register the ID. This is safe because the microchip match is high-confidence.
--
-- Impact: Dramatically increases enrichment coverage for Phases 3-6
-- (altered_status, ownership_type, sex/breed, colors).
--
-- Safety: Only registers IDs for cats already identified by microchip.
-- Never creates new cats. ON CONFLICT DO NOTHING for idempotency.
-- Depends on: MIG_2879 (clinichq_scrape), MIG_2883 (extracted_clinichq_id)

BEGIN;

-- =============================================================================
-- Step 1: Register clinichq_animal_ids for microchip-matched cats
-- =============================================================================

WITH ids_to_register AS (
    SELECT DISTINCT ON (ci.cat_id, s.extracted_clinichq_id)
        ci.cat_id,
        s.extracted_clinichq_id
    FROM source.clinichq_scrape s
    JOIN sot.cat_identifiers ci
        ON ci.id_type = 'microchip'
        AND ci.id_value = s.microchip
    JOIN sot.cats c
        ON c.cat_id = ci.cat_id
        AND c.merged_into_cat_id IS NULL
    WHERE s.extracted_clinichq_id IS NOT NULL
      AND s.microchip IS NOT NULL
      AND s.microchip != ''
      AND s.microchip != '---'
      -- Don't duplicate existing identifiers
      AND NOT EXISTS (
          SELECT 1 FROM sot.cat_identifiers ex
          WHERE ex.cat_id = ci.cat_id
            AND ex.id_type = 'clinichq_animal_id'
            AND ex.id_value = s.extracted_clinichq_id
      )
    ORDER BY ci.cat_id, s.extracted_clinichq_id, s.appointment_date DESC
)
INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at)
SELECT
    itr.cat_id,
    'clinichq_animal_id',
    itr.extracted_clinichq_id,
    'clinichq',
    NOW()
FROM ids_to_register itr
ON CONFLICT DO NOTHING;

-- =============================================================================
-- Step 2: Also register clinichq_animal_ids from the scrape's animal_id field
-- where it's in XX-XXXX format (not already a microchip)
-- =============================================================================

WITH animal_ids_to_register AS (
    SELECT DISTINCT ON (ci.cat_id, s.animal_id)
        ci.cat_id,
        s.animal_id
    FROM source.clinichq_scrape s
    JOIN sot.cat_identifiers ci
        ON ci.id_type = 'microchip'
        AND ci.id_value = s.microchip
    JOIN sot.cats c
        ON c.cat_id = ci.cat_id
        AND c.merged_into_cat_id IS NULL
    WHERE s.animal_id IS NOT NULL
      AND s.animal_id ~ '^[0-9]{1,3}-[0-9]+$'  -- XX-XXXX format
      AND s.microchip IS NOT NULL
      AND s.microchip != ''
      AND s.microchip != '---'
      AND (s.checkout_status = 'Checked Out'
           OR (s.checkout_status = 'Canceled' AND s.extracted_clinichq_id IS NOT NULL))
      AND NOT EXISTS (
          SELECT 1 FROM sot.cat_identifiers ex
          WHERE ex.cat_id = ci.cat_id
            AND ex.id_type = 'clinichq_animal_id'
            AND ex.id_value = s.animal_id
      )
    ORDER BY ci.cat_id, s.animal_id, s.appointment_date DESC
)
INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at)
SELECT
    aitr.cat_id,
    'clinichq_animal_id',
    aitr.animal_id,
    'clinichq',
    NOW()
FROM animal_ids_to_register aitr
ON CONFLICT DO NOTHING;

-- =============================================================================
-- Step 3: Also update sot.cats.clinichq_animal_id where NULL
-- =============================================================================

UPDATE sot.cats c
SET clinichq_animal_id = ci.id_value,
    updated_at = NOW()
FROM sot.cat_identifiers ci
WHERE ci.cat_id = c.cat_id
  AND ci.id_type = 'clinichq_animal_id'
  AND c.clinichq_animal_id IS NULL
  AND c.merged_into_cat_id IS NULL;

-- =============================================================================
-- Verification
-- =============================================================================

DO $$
DECLARE
    v_total_clinichq_ids INTEGER;
    v_cats_with_clinichq_id INTEGER;
    v_scrape_matchable INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total_clinichq_ids
    FROM sot.cat_identifiers WHERE id_type = 'clinichq_animal_id';

    SELECT COUNT(*) INTO v_cats_with_clinichq_id
    FROM sot.cats WHERE clinichq_animal_id IS NOT NULL AND merged_into_cat_id IS NULL;

    SELECT COUNT(DISTINCT s.extracted_clinichq_id) INTO v_scrape_matchable
    FROM source.clinichq_scrape s
    JOIN sot.cat_identifiers ci
        ON ci.id_type = 'clinichq_animal_id'
        AND ci.id_value = COALESCE(s.extracted_clinichq_id, s.animal_id)
    WHERE COALESCE(s.extracted_clinichq_id, s.animal_id) IS NOT NULL;

    RAISE NOTICE 'MIG_2885: clinichq_animal_id registration complete';
    RAISE NOTICE '  Total clinichq_animal_id identifiers: %', v_total_clinichq_ids;
    RAISE NOTICE '  Cats with clinichq_animal_id column: %', v_cats_with_clinichq_id;
    RAISE NOTICE '  Scrape IDs now matchable: %', v_scrape_matchable;
END $$;

COMMIT;
