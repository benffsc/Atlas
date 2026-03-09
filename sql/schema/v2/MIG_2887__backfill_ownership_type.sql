-- MIG_2887: Backfill ownership_type from scrape animal_type (FFS-377)
--
-- Data source: source.clinichq_scrape.animal_type — 100% populated (41,230 rows)
-- Maps ClinicHQ animal classification to sot.cats.ownership_type:
--   'Community Cat (Feral)'    → 'feral'
--   'Community Cat (Friendly)' → 'community'
--   'Owned'                    → 'owned'
--   'Shelter'                  → 'stray'
--
-- Uses most recent appointment per cat (DISTINCT ON + ORDER BY date DESC).
-- Only fills where ownership_type IS NULL or 'unknown'.
--
-- Safety: Never overwrites existing specific values. Merge-aware.
-- Depends on: MIG_2879 (clinichq_scrape), MIG_2885 (registered IDs)

BEGIN;

-- =============================================================================
-- Step 1: Backfill via microchip match
-- =============================================================================

WITH scrape_ownership AS (
    SELECT DISTINCT ON (ci.cat_id)
        ci.cat_id,
        CASE s.animal_type
            WHEN 'Community Cat (Feral)' THEN 'feral'
            WHEN 'Community Cat (Friendly)' THEN 'community'
            WHEN 'Owned' THEN 'owned'
            WHEN 'Shelter' THEN 'stray'
            ELSE NULL
        END AS mapped_type
    FROM source.clinichq_scrape s
    JOIN sot.cat_identifiers ci
        ON ci.id_type = 'microchip'
        AND ci.id_value = s.microchip
    JOIN sot.cats c
        ON c.cat_id = ci.cat_id
        AND c.merged_into_cat_id IS NULL
    WHERE s.microchip IS NOT NULL
      AND s.microchip != ''
      AND s.microchip != '---'
      AND s.animal_type IS NOT NULL
      AND s.animal_type != ''
      AND (s.checkout_status = 'Checked Out'
           OR (s.checkout_status = 'Canceled' AND s.extracted_clinichq_id IS NOT NULL))
    ORDER BY ci.cat_id, s.appointment_date DESC
)
UPDATE sot.cats c
SET ownership_type = so.mapped_type,
    updated_at = NOW()
FROM scrape_ownership so
WHERE so.cat_id = c.cat_id
  AND so.mapped_type IS NOT NULL
  AND c.merged_into_cat_id IS NULL
  AND (c.ownership_type IS NULL OR c.ownership_type = 'unknown');

-- =============================================================================
-- Step 2: Backfill via clinichq_animal_id match (cats without microchips)
-- =============================================================================

WITH scrape_ownership_by_id AS (
    SELECT DISTINCT ON (ci.cat_id)
        ci.cat_id,
        CASE s.animal_type
            WHEN 'Community Cat (Feral)' THEN 'feral'
            WHEN 'Community Cat (Friendly)' THEN 'community'
            WHEN 'Owned' THEN 'owned'
            WHEN 'Shelter' THEN 'stray'
            ELSE NULL
        END AS mapped_type
    FROM source.clinichq_scrape s
    JOIN sot.cat_identifiers ci
        ON ci.id_type = 'clinichq_animal_id'
        AND ci.id_value = COALESCE(
            s.extracted_clinichq_id,
            CASE WHEN s.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN s.animal_id END
        )
    JOIN sot.cats c
        ON c.cat_id = ci.cat_id
        AND c.merged_into_cat_id IS NULL
    WHERE COALESCE(s.extracted_clinichq_id,
            CASE WHEN s.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN s.animal_id END) IS NOT NULL
      AND s.animal_type IS NOT NULL
      AND s.animal_type != ''
      AND (s.checkout_status = 'Checked Out'
           OR (s.checkout_status = 'Canceled' AND s.extracted_clinichq_id IS NOT NULL))
    ORDER BY ci.cat_id, s.appointment_date DESC
)
UPDATE sot.cats c
SET ownership_type = soi.mapped_type,
    updated_at = NOW()
FROM scrape_ownership_by_id soi
WHERE soi.cat_id = c.cat_id
  AND soi.mapped_type IS NOT NULL
  AND c.merged_into_cat_id IS NULL
  AND (c.ownership_type IS NULL OR c.ownership_type = 'unknown');

-- =============================================================================
-- Verification
-- =============================================================================

DO $$
DECLARE
    v_type RECORD;
    v_null_count INTEGER;
BEGIN
    RAISE NOTICE 'MIG_2887: ownership_type backfill complete';
    RAISE NOTICE '';
    RAISE NOTICE '  ownership_type distribution:';
    FOR v_type IN
        SELECT COALESCE(ownership_type, 'NULL') AS otype, COUNT(*) AS ct
        FROM sot.cats WHERE merged_into_cat_id IS NULL
        GROUP BY 1 ORDER BY ct DESC
    LOOP
        RAISE NOTICE '    %: %', v_type.otype, v_type.ct;
    END LOOP;

    SELECT COUNT(*) INTO v_null_count
    FROM sot.cats WHERE merged_into_cat_id IS NULL AND ownership_type IS NULL;
    RAISE NOTICE '';
    RAISE NOTICE '  Remaining NULL: %', v_null_count;
END $$;

COMMIT;
