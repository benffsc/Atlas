-- MIG_2893: Fix sex/breed/coat_length backfill — wrong regex in MIG_2888 (FFS-379)
--
-- Bug: MIG_2888 used regex '^Cat \| [^|]+ \| (.+)$' (pipe-delimited)
-- but actual data format is 'Cat Female - Domestic Short Hair (Mixed)' (dash-delimited).
-- Result: 0 rows parsed, 0 cats updated. coat_length is NULL for all 40,780 cats.
--
-- Fix: Correct regex pattern. Main impact is coat_length (24,731 cats fillable).
-- Sex and breed already 99%+ from ops.appointments — only 1 gap each from scrape.
--
-- Safety: Only fills NULLs. Never overwrites existing values. Merge-aware.
-- Depends on: MIG_2891 (extracted_microchip)

BEGIN;

-- =============================================================================
-- Step 1: Create temp table with correctly parsed scrape data
-- =============================================================================

CREATE TEMP TABLE _parsed_scrape_2893 AS
WITH parsed AS (
    SELECT
        s.record_id,
        s.extracted_microchip,
        s.extracted_clinichq_id,
        s.animal_id,
        s.appointment_date,
        -- Parse sex: "Cat Female - ..." or "Cat Male - ..."
        CASE
            WHEN s.animal_species_sex_breed ~* '^Cat Female' THEN 'female'
            WHEN s.animal_species_sex_breed ~* '^Cat Male' THEN 'male'
            ELSE NULL
        END AS parsed_sex,
        -- Parse breed: everything between " - " and optional " (Pattern)"
        -- "Cat Female - Domestic Short Hair (Mixed)" → "Domestic Short Hair"
        BTRIM((regexp_match(s.animal_species_sex_breed,
            '^Cat (?:Male|Female|Unknown) - (.+?)(?:\s*\(.*\))?$'))[1]) AS parsed_breed,
        -- Parse coat length from breed name
        CASE
            WHEN s.animal_species_sex_breed ~* 'Short Hair' THEN 'short'
            WHEN s.animal_species_sex_breed ~* 'Medium Hair' THEN 'medium'
            WHEN s.animal_species_sex_breed ~* 'Long Hair' THEN 'long'
            ELSE NULL
        END AS parsed_coat_length
    FROM source.clinichq_scrape s
    WHERE s.animal_species_sex_breed IS NOT NULL
      AND s.animal_species_sex_breed ~* '^Cat '
      AND (s.checkout_status = 'Checked Out'
           OR (s.checkout_status = 'Canceled' AND s.extracted_clinichq_id IS NOT NULL))
)
SELECT * FROM parsed
WHERE parsed_sex IS NOT NULL OR parsed_breed IS NOT NULL OR parsed_coat_length IS NOT NULL;

-- =============================================================================
-- Step 2: Backfill sex via extracted_microchip
-- =============================================================================

WITH sex_chip AS (
    SELECT DISTINCT ON (ci.cat_id) ci.cat_id, ps.parsed_sex
    FROM _parsed_scrape_2893 ps
    JOIN sot.cat_identifiers ci ON ci.id_type = 'microchip' AND ci.id_value = ps.extracted_microchip
    WHERE ps.extracted_microchip IS NOT NULL AND ps.parsed_sex IS NOT NULL
    ORDER BY ci.cat_id, ps.appointment_date DESC
)
UPDATE sot.cats c
SET sex = sc.parsed_sex, updated_at = NOW()
FROM sex_chip sc
WHERE sc.cat_id = c.cat_id AND c.merged_into_cat_id IS NULL AND c.sex IS NULL;

-- Via clinichq_animal_id
WITH sex_id AS (
    SELECT DISTINCT ON (ci.cat_id) ci.cat_id, ps.parsed_sex
    FROM _parsed_scrape_2893 ps
    JOIN sot.cat_identifiers ci ON ci.id_type = 'clinichq_animal_id'
        AND ci.id_value = COALESCE(ps.extracted_clinichq_id,
            CASE WHEN ps.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN ps.animal_id END)
    WHERE COALESCE(ps.extracted_clinichq_id,
        CASE WHEN ps.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN ps.animal_id END) IS NOT NULL
      AND ps.parsed_sex IS NOT NULL
    ORDER BY ci.cat_id, ps.appointment_date DESC
)
UPDATE sot.cats c
SET sex = si.parsed_sex, updated_at = NOW()
FROM sex_id si
WHERE si.cat_id = c.cat_id AND c.merged_into_cat_id IS NULL AND c.sex IS NULL;

-- =============================================================================
-- Step 3: Backfill breed via extracted_microchip
-- =============================================================================

WITH breed_chip AS (
    SELECT DISTINCT ON (ci.cat_id) ci.cat_id, ps.parsed_breed
    FROM _parsed_scrape_2893 ps
    JOIN sot.cat_identifiers ci ON ci.id_type = 'microchip' AND ci.id_value = ps.extracted_microchip
    WHERE ps.extracted_microchip IS NOT NULL
      AND ps.parsed_breed IS NOT NULL AND ps.parsed_breed != '' AND ps.parsed_breed != 'N/A'
    ORDER BY ci.cat_id, ps.appointment_date DESC
)
UPDATE sot.cats c
SET breed = bc.parsed_breed, updated_at = NOW()
FROM breed_chip bc
WHERE bc.cat_id = c.cat_id AND c.merged_into_cat_id IS NULL AND c.breed IS NULL;

-- Via clinichq_animal_id
WITH breed_id AS (
    SELECT DISTINCT ON (ci.cat_id) ci.cat_id, ps.parsed_breed
    FROM _parsed_scrape_2893 ps
    JOIN sot.cat_identifiers ci ON ci.id_type = 'clinichq_animal_id'
        AND ci.id_value = COALESCE(ps.extracted_clinichq_id,
            CASE WHEN ps.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN ps.animal_id END)
    WHERE COALESCE(ps.extracted_clinichq_id,
        CASE WHEN ps.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN ps.animal_id END) IS NOT NULL
      AND ps.parsed_breed IS NOT NULL AND ps.parsed_breed != '' AND ps.parsed_breed != 'N/A'
    ORDER BY ci.cat_id, ps.appointment_date DESC
)
UPDATE sot.cats c
SET breed = bi.parsed_breed, updated_at = NOW()
FROM breed_id bi
WHERE bi.cat_id = c.cat_id AND c.merged_into_cat_id IS NULL AND c.breed IS NULL;

-- =============================================================================
-- Step 4: Backfill coat_length via extracted_microchip (main impact: ~24,731 cats)
-- =============================================================================

WITH coat_chip AS (
    SELECT DISTINCT ON (ci.cat_id) ci.cat_id, ps.parsed_coat_length
    FROM _parsed_scrape_2893 ps
    JOIN sot.cat_identifiers ci ON ci.id_type = 'microchip' AND ci.id_value = ps.extracted_microchip
    WHERE ps.extracted_microchip IS NOT NULL AND ps.parsed_coat_length IS NOT NULL
    ORDER BY ci.cat_id, ps.appointment_date DESC
)
UPDATE sot.cats c
SET coat_length = cc.parsed_coat_length, updated_at = NOW()
FROM coat_chip cc
WHERE cc.cat_id = c.cat_id AND c.merged_into_cat_id IS NULL AND c.coat_length IS NULL;

-- Via clinichq_animal_id
WITH coat_id AS (
    SELECT DISTINCT ON (ci.cat_id) ci.cat_id, ps.parsed_coat_length
    FROM _parsed_scrape_2893 ps
    JOIN sot.cat_identifiers ci ON ci.id_type = 'clinichq_animal_id'
        AND ci.id_value = COALESCE(ps.extracted_clinichq_id,
            CASE WHEN ps.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN ps.animal_id END)
    WHERE COALESCE(ps.extracted_clinichq_id,
        CASE WHEN ps.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN ps.animal_id END) IS NOT NULL
      AND ps.parsed_coat_length IS NOT NULL
    ORDER BY ci.cat_id, ps.appointment_date DESC
)
UPDATE sot.cats c
SET coat_length = cid.parsed_coat_length, updated_at = NOW()
FROM coat_id cid
WHERE cid.cat_id = c.cat_id AND c.merged_into_cat_id IS NULL AND c.coat_length IS NULL;

-- =============================================================================
-- Cleanup
-- =============================================================================

DROP TABLE IF EXISTS _parsed_scrape_2893;

-- =============================================================================
-- Verification
-- =============================================================================

DO $$
DECLARE
    v_total INTEGER;
    v_has_sex INTEGER;
    v_has_breed INTEGER;
    v_has_coat INTEGER;
    v_coat RECORD;
BEGIN
    SELECT COUNT(*) INTO v_total FROM sot.cats WHERE merged_into_cat_id IS NULL;
    SELECT COUNT(*) INTO v_has_sex FROM sot.cats WHERE merged_into_cat_id IS NULL AND sex IS NOT NULL;
    SELECT COUNT(*) INTO v_has_breed FROM sot.cats WHERE merged_into_cat_id IS NULL AND breed IS NOT NULL;
    SELECT COUNT(*) INTO v_has_coat FROM sot.cats WHERE merged_into_cat_id IS NULL AND coat_length IS NOT NULL;

    RAISE NOTICE 'MIG_2893: sex/breed/coat_length backfill with FIXED regex';
    RAISE NOTICE '  Total cats: %', v_total;
    RAISE NOTICE '  Has sex: % (%.1f%%)', v_has_sex, (v_has_sex::numeric / v_total * 100);
    RAISE NOTICE '  Has breed: % (%.1f%%)', v_has_breed, (v_has_breed::numeric / v_total * 100);
    RAISE NOTICE '  Has coat_length: % (%.1f%%)', v_has_coat, (v_has_coat::numeric / v_total * 100);
    RAISE NOTICE '';

    RAISE NOTICE '  coat_length distribution:';
    FOR v_coat IN
        SELECT COALESCE(coat_length, 'NULL') AS cl, COUNT(*) AS ct
        FROM sot.cats WHERE merged_into_cat_id IS NULL
        GROUP BY 1 ORDER BY ct DESC
    LOOP
        RAISE NOTICE '    %: %', v_coat.cl, v_coat.ct;
    END LOOP;
END $$;

COMMIT;
