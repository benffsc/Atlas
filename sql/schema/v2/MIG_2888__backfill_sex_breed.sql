-- MIG_2888: Backfill sex, breed, coat_length from scrape (FFS-379)
--
-- Data source: source.clinichq_scrape.animal_species_sex_breed
-- Format: "Cat | Female | Domestic Short Hair"
-- Regex: ^Cat \| (Male|Female|Unknown) \| (.+)$
--
-- Fields backfilled:
--   sex        → 'male' / 'female' (only where NULL)
--   breed      → mapped from free text (only where NULL)
--   coat_length → inferred: "Short Hair"→'short', "Medium Hair"→'medium', "Long Hair"→'long'
--
-- Safety: Only fills NULLs. Never overwrites existing values. Merge-aware.
-- Depends on: MIG_2879 (clinichq_scrape), MIG_2885 (registered IDs)

BEGIN;

-- =============================================================================
-- Step 1: Create temp table with parsed scrape data
-- =============================================================================

CREATE TEMP TABLE _parsed_scrape AS
WITH parsed AS (
    SELECT
        s.record_id,
        s.microchip,
        s.extracted_clinichq_id,
        s.animal_id,
        s.appointment_date,
        -- Parse sex
        CASE
            WHEN s.animal_species_sex_breed ~* '^Cat \| Female \|' THEN 'female'
            WHEN s.animal_species_sex_breed ~* '^Cat \| Male \|' THEN 'male'
            ELSE NULL
        END AS parsed_sex,
        -- Parse breed (everything after second pipe)
        BTRIM((regexp_match(s.animal_species_sex_breed, '^Cat \| [^|]+ \| (.+)$'))[1]) AS parsed_breed,
        -- Parse coat length from breed name
        CASE
            WHEN s.animal_species_sex_breed ~* 'Short Hair' THEN 'short'
            WHEN s.animal_species_sex_breed ~* 'Medium Hair' THEN 'medium'
            WHEN s.animal_species_sex_breed ~* 'Long Hair' THEN 'long'
            ELSE NULL
        END AS parsed_coat_length
    FROM source.clinichq_scrape s
    WHERE s.animal_species_sex_breed IS NOT NULL
      AND s.animal_species_sex_breed ~* '^Cat \|'
      AND (s.checkout_status = 'Checked Out'
           OR (s.checkout_status = 'Canceled' AND s.extracted_clinichq_id IS NOT NULL))
)
SELECT * FROM parsed
WHERE parsed_sex IS NOT NULL OR parsed_breed IS NOT NULL;

-- =============================================================================
-- Step 2: Backfill sex via microchip match
-- =============================================================================

WITH sex_from_scrape AS (
    SELECT DISTINCT ON (ci.cat_id)
        ci.cat_id,
        ps.parsed_sex
    FROM _parsed_scrape ps
    JOIN sot.cat_identifiers ci
        ON ci.id_type = 'microchip'
        AND ci.id_value = ps.microchip
    WHERE ps.microchip IS NOT NULL AND ps.microchip != '' AND ps.microchip != '---'
      AND ps.parsed_sex IS NOT NULL
    ORDER BY ci.cat_id, ps.appointment_date DESC
)
UPDATE sot.cats c
SET sex = sfs.parsed_sex,
    updated_at = NOW()
FROM sex_from_scrape sfs
WHERE sfs.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NULL
  AND c.sex IS NULL;

-- Via clinichq_animal_id
WITH sex_from_scrape_id AS (
    SELECT DISTINCT ON (ci.cat_id)
        ci.cat_id,
        ps.parsed_sex
    FROM _parsed_scrape ps
    JOIN sot.cat_identifiers ci
        ON ci.id_type = 'clinichq_animal_id'
        AND ci.id_value = COALESCE(
            ps.extracted_clinichq_id,
            CASE WHEN ps.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN ps.animal_id END
        )
    WHERE COALESCE(ps.extracted_clinichq_id,
            CASE WHEN ps.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN ps.animal_id END) IS NOT NULL
      AND ps.parsed_sex IS NOT NULL
    ORDER BY ci.cat_id, ps.appointment_date DESC
)
UPDATE sot.cats c
SET sex = sfsi.parsed_sex,
    updated_at = NOW()
FROM sex_from_scrape_id sfsi
WHERE sfsi.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NULL
  AND c.sex IS NULL;

-- =============================================================================
-- Step 3: Backfill breed via microchip match
-- =============================================================================

WITH breed_from_scrape AS (
    SELECT DISTINCT ON (ci.cat_id)
        ci.cat_id,
        ps.parsed_breed
    FROM _parsed_scrape ps
    JOIN sot.cat_identifiers ci
        ON ci.id_type = 'microchip'
        AND ci.id_value = ps.microchip
    WHERE ps.microchip IS NOT NULL AND ps.microchip != '' AND ps.microchip != '---'
      AND ps.parsed_breed IS NOT NULL AND ps.parsed_breed != ''
    ORDER BY ci.cat_id, ps.appointment_date DESC
)
UPDATE sot.cats c
SET breed = bfs.parsed_breed,
    updated_at = NOW()
FROM breed_from_scrape bfs
WHERE bfs.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NULL
  AND c.breed IS NULL;

-- Via clinichq_animal_id
WITH breed_from_scrape_id AS (
    SELECT DISTINCT ON (ci.cat_id)
        ci.cat_id,
        ps.parsed_breed
    FROM _parsed_scrape ps
    JOIN sot.cat_identifiers ci
        ON ci.id_type = 'clinichq_animal_id'
        AND ci.id_value = COALESCE(
            ps.extracted_clinichq_id,
            CASE WHEN ps.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN ps.animal_id END
        )
    WHERE COALESCE(ps.extracted_clinichq_id,
            CASE WHEN ps.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN ps.animal_id END) IS NOT NULL
      AND ps.parsed_breed IS NOT NULL AND ps.parsed_breed != ''
    ORDER BY ci.cat_id, ps.appointment_date DESC
)
UPDATE sot.cats c
SET breed = bfsi.parsed_breed,
    updated_at = NOW()
FROM breed_from_scrape_id bfsi
WHERE bfsi.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NULL
  AND c.breed IS NULL;

-- =============================================================================
-- Step 4: Backfill coat_length via microchip match
-- =============================================================================

WITH coat_from_scrape AS (
    SELECT DISTINCT ON (ci.cat_id)
        ci.cat_id,
        ps.parsed_coat_length
    FROM _parsed_scrape ps
    JOIN sot.cat_identifiers ci
        ON ci.id_type = 'microchip'
        AND ci.id_value = ps.microchip
    WHERE ps.microchip IS NOT NULL AND ps.microchip != '' AND ps.microchip != '---'
      AND ps.parsed_coat_length IS NOT NULL
    ORDER BY ci.cat_id, ps.appointment_date DESC
)
UPDATE sot.cats c
SET coat_length = cfs.parsed_coat_length,
    updated_at = NOW()
FROM coat_from_scrape cfs
WHERE cfs.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NULL
  AND c.coat_length IS NULL;

-- Via clinichq_animal_id
WITH coat_from_scrape_id AS (
    SELECT DISTINCT ON (ci.cat_id)
        ci.cat_id,
        ps.parsed_coat_length
    FROM _parsed_scrape ps
    JOIN sot.cat_identifiers ci
        ON ci.id_type = 'clinichq_animal_id'
        AND ci.id_value = COALESCE(
            ps.extracted_clinichq_id,
            CASE WHEN ps.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN ps.animal_id END
        )
    WHERE COALESCE(ps.extracted_clinichq_id,
            CASE WHEN ps.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN ps.animal_id END) IS NOT NULL
      AND ps.parsed_coat_length IS NOT NULL
    ORDER BY ci.cat_id, ps.appointment_date DESC
)
UPDATE sot.cats c
SET coat_length = cfsi.parsed_coat_length,
    updated_at = NOW()
FROM coat_from_scrape_id cfsi
WHERE cfsi.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NULL
  AND c.coat_length IS NULL;

-- =============================================================================
-- Cleanup
-- =============================================================================

DROP TABLE IF EXISTS _parsed_scrape;

-- =============================================================================
-- Verification
-- =============================================================================

DO $$
DECLARE
    v_total INTEGER;
    v_has_sex INTEGER;
    v_has_breed INTEGER;
    v_has_coat INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total FROM sot.cats WHERE merged_into_cat_id IS NULL;
    SELECT COUNT(*) INTO v_has_sex FROM sot.cats WHERE merged_into_cat_id IS NULL AND sex IS NOT NULL;
    SELECT COUNT(*) INTO v_has_breed FROM sot.cats WHERE merged_into_cat_id IS NULL AND breed IS NOT NULL;
    SELECT COUNT(*) INTO v_has_coat FROM sot.cats WHERE merged_into_cat_id IS NULL AND coat_length IS NOT NULL;

    RAISE NOTICE 'MIG_2888: sex/breed/coat_length backfill complete';
    RAISE NOTICE '  Total cats: %', v_total;
    RAISE NOTICE '  Has sex: % (%.1f%%)', v_has_sex, (v_has_sex::numeric / v_total * 100);
    RAISE NOTICE '  Has breed: % (%.1f%%)', v_has_breed, (v_has_breed::numeric / v_total * 100);
    RAISE NOTICE '  Has coat_length: % (%.1f%%)', v_has_coat, (v_has_coat::numeric / v_total * 100);
END $$;

COMMIT;
