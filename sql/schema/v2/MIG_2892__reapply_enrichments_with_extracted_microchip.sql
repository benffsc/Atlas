-- MIG_2892: Re-apply enrichments with fixed microchip matching (FFS-387)
--
-- MIG_2885-2889 matched scrape→cats via microchip using exact match on the raw
-- s.microchip column ("981020053773686 (PetLink) Failed"), which matched 0 rows.
-- MIG_2891 added s.extracted_microchip with the clean chip number.
--
-- This migration re-runs the microchip-path logic from MIG_2885-2889 using
-- s.extracted_microchip. The WHERE IS NULL OR = 'unknown' guards make these
-- idempotent — they only fill gaps left by the broken microchip matching.
--
-- Expected impact: ~7,632 additional cat records enriched via microchip path.
--
-- Safety: Only fills NULLs and 'unknown'. Never overwrites existing values.
-- Depends on: MIG_2891 (extracted_microchip column)

BEGIN;

-- =============================================================================
-- Step 1: Register clinichq_animal_ids for newly-matchable cats (MIG_2885 logic)
-- =============================================================================

-- 1a: From extracted_clinichq_id where cat matched by extracted_microchip
WITH ids_to_register AS (
    SELECT DISTINCT ON (ci.cat_id, s.extracted_clinichq_id)
        ci.cat_id,
        s.extracted_clinichq_id
    FROM source.clinichq_scrape s
    JOIN sot.cat_identifiers ci
        ON ci.id_type = 'microchip'
        AND ci.id_value = s.extracted_microchip
    JOIN sot.cats c
        ON c.cat_id = ci.cat_id
        AND c.merged_into_cat_id IS NULL
    WHERE s.extracted_clinichq_id IS NOT NULL
      AND s.extracted_microchip IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM sot.cat_identifiers ex
          WHERE ex.cat_id = ci.cat_id
            AND ex.id_type = 'clinichq_animal_id'
            AND ex.id_value = s.extracted_clinichq_id
      )
    ORDER BY ci.cat_id, s.extracted_clinichq_id, s.appointment_date DESC
)
INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at)
SELECT cat_id, 'clinichq_animal_id', extracted_clinichq_id, 'clinichq', NOW()
FROM ids_to_register
ON CONFLICT DO NOTHING;

-- 1b: From animal_id (XX-XXXX format) where cat matched by extracted_microchip
WITH animal_ids_to_register AS (
    SELECT DISTINCT ON (ci.cat_id, s.animal_id)
        ci.cat_id,
        s.animal_id
    FROM source.clinichq_scrape s
    JOIN sot.cat_identifiers ci
        ON ci.id_type = 'microchip'
        AND ci.id_value = s.extracted_microchip
    JOIN sot.cats c
        ON c.cat_id = ci.cat_id
        AND c.merged_into_cat_id IS NULL
    WHERE s.animal_id IS NOT NULL
      AND s.animal_id ~ '^[0-9]{1,3}-[0-9]+$'
      AND s.extracted_microchip IS NOT NULL
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
SELECT cat_id, 'clinichq_animal_id', animal_id, 'clinichq', NOW()
FROM animal_ids_to_register
ON CONFLICT DO NOTHING;

-- 1c: Update sot.cats.clinichq_animal_id where NULL
UPDATE sot.cats c
SET clinichq_animal_id = ci.id_value,
    updated_at = NOW()
FROM sot.cat_identifiers ci
WHERE ci.cat_id = c.cat_id
  AND ci.id_type = 'clinichq_animal_id'
  AND c.clinichq_animal_id IS NULL
  AND c.merged_into_cat_id IS NULL;

-- =============================================================================
-- Step 2: Backfill altered_status from scrape labels (MIG_2886 Steps 6-7 logic)
-- =============================================================================

-- 2a: "Spay/Neutered" label → altered (determine type from sex)
WITH scrape_altered AS (
    SELECT DISTINCT ON (COALESCE(ci_chip.cat_id, ci_id.cat_id))
        COALESCE(ci_chip.cat_id, ci_id.cat_id) AS cat_id,
        s.animal_species_sex_breed
    FROM source.clinichq_scrape s
    LEFT JOIN sot.cat_identifiers ci_chip
        ON ci_chip.id_type = 'microchip'
        AND ci_chip.id_value = s.extracted_microchip
        AND s.extracted_microchip IS NOT NULL
    LEFT JOIN sot.cat_identifiers ci_id
        ON ci_id.id_type = 'clinichq_animal_id'
        AND ci_id.id_value = COALESCE(s.extracted_clinichq_id,
            CASE WHEN s.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN s.animal_id END)
        AND ci_chip.cat_id IS NULL
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
        WHEN sa.animal_species_sex_breed ~* 'Female' THEN 'spayed'
        WHEN sa.animal_species_sex_breed ~* 'Male' THEN 'neutered'
        ELSE 'spayed'
    END,
    updated_at = NOW()
FROM scrape_altered sa
WHERE sa.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NULL
  AND (c.altered_status IS NULL OR c.altered_status = 'unknown');

-- 2b: "Not Spay/Neutered" label → intact
WITH scrape_intact AS (
    SELECT DISTINCT ON (COALESCE(ci_chip.cat_id, ci_id.cat_id))
        COALESCE(ci_chip.cat_id, ci_id.cat_id) AS cat_id
    FROM source.clinichq_scrape s
    LEFT JOIN sot.cat_identifiers ci_chip
        ON ci_chip.id_type = 'microchip'
        AND ci_chip.id_value = s.extracted_microchip
        AND s.extracted_microchip IS NOT NULL
    LEFT JOIN sot.cat_identifiers ci_id
        ON ci_id.id_type = 'clinichq_animal_id'
        AND ci_id.id_value = COALESCE(s.extracted_clinichq_id,
            CASE WHEN s.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN s.animal_id END)
        AND ci_chip.cat_id IS NULL
    WHERE COALESCE(ci_chip.cat_id, ci_id.cat_id) IS NOT NULL
      AND s.heading_labels_json @> '"Not Spay/Neutered"'
      AND (s.checkout_status = 'Checked Out'
           OR (s.checkout_status = 'Canceled' AND s.extracted_clinichq_id IS NOT NULL))
      AND NOT EXISTS (
          SELECT 1 FROM source.clinichq_scrape s2
          WHERE (s2.extracted_microchip = s.extracted_microchip OR s2.extracted_clinichq_id = s.extracted_clinichq_id)
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
-- Step 3: Backfill ownership_type (MIG_2887 Step 1 logic)
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
        AND ci.id_value = s.extracted_microchip
    JOIN sot.cats c
        ON c.cat_id = ci.cat_id
        AND c.merged_into_cat_id IS NULL
    WHERE s.extracted_microchip IS NOT NULL
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
-- Step 4: Backfill sex, breed, coat_length (MIG_2888 logic)
-- =============================================================================

CREATE TEMP TABLE _parsed_scrape_2892 AS
WITH parsed AS (
    SELECT
        s.record_id,
        s.extracted_microchip,
        s.extracted_clinichq_id,
        s.animal_id,
        s.appointment_date,
        CASE
            WHEN s.animal_species_sex_breed ~* '^Cat \| Female \|' THEN 'female'
            WHEN s.animal_species_sex_breed ~* '^Cat \| Male \|' THEN 'male'
            ELSE NULL
        END AS parsed_sex,
        BTRIM((regexp_match(s.animal_species_sex_breed, '^Cat \| [^|]+ \| (.+)$'))[1]) AS parsed_breed,
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

-- 4a: Sex via extracted_microchip
WITH sex_from_scrape AS (
    SELECT DISTINCT ON (ci.cat_id)
        ci.cat_id, ps.parsed_sex
    FROM _parsed_scrape_2892 ps
    JOIN sot.cat_identifiers ci
        ON ci.id_type = 'microchip'
        AND ci.id_value = ps.extracted_microchip
    WHERE ps.extracted_microchip IS NOT NULL
      AND ps.parsed_sex IS NOT NULL
    ORDER BY ci.cat_id, ps.appointment_date DESC
)
UPDATE sot.cats c
SET sex = sfs.parsed_sex, updated_at = NOW()
FROM sex_from_scrape sfs
WHERE sfs.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NULL
  AND c.sex IS NULL;

-- 4b: Breed via extracted_microchip
WITH breed_from_scrape AS (
    SELECT DISTINCT ON (ci.cat_id)
        ci.cat_id, ps.parsed_breed
    FROM _parsed_scrape_2892 ps
    JOIN sot.cat_identifiers ci
        ON ci.id_type = 'microchip'
        AND ci.id_value = ps.extracted_microchip
    WHERE ps.extracted_microchip IS NOT NULL
      AND ps.parsed_breed IS NOT NULL AND ps.parsed_breed != ''
    ORDER BY ci.cat_id, ps.appointment_date DESC
)
UPDATE sot.cats c
SET breed = bfs.parsed_breed, updated_at = NOW()
FROM breed_from_scrape bfs
WHERE bfs.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NULL
  AND c.breed IS NULL;

-- 4c: Coat length via extracted_microchip
WITH coat_from_scrape AS (
    SELECT DISTINCT ON (ci.cat_id)
        ci.cat_id, ps.parsed_coat_length
    FROM _parsed_scrape_2892 ps
    JOIN sot.cat_identifiers ci
        ON ci.id_type = 'microchip'
        AND ci.id_value = ps.extracted_microchip
    WHERE ps.extracted_microchip IS NOT NULL
      AND ps.parsed_coat_length IS NOT NULL
    ORDER BY ci.cat_id, ps.appointment_date DESC
)
UPDATE sot.cats c
SET coat_length = cfs.parsed_coat_length, updated_at = NOW()
FROM coat_from_scrape cfs
WHERE cfs.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NULL
  AND c.coat_length IS NULL;

DROP TABLE IF EXISTS _parsed_scrape_2892;

-- =============================================================================
-- Step 5: Backfill primary_color / secondary_color (MIG_2889 logic)
-- =============================================================================

WITH color_from_scrape AS (
    SELECT DISTINCT ON (ci.cat_id)
        ci.cat_id,
        BTRIM((regexp_match(s.animal_colors, 'P:([^/]+)'))[1]) AS parsed_primary,
        BTRIM((regexp_match(s.animal_colors, 'S:(.+)$'))[1]) AS parsed_secondary
    FROM source.clinichq_scrape s
    JOIN sot.cat_identifiers ci
        ON ci.id_type = 'microchip'
        AND ci.id_value = s.extracted_microchip
    JOIN sot.cats c
        ON c.cat_id = ci.cat_id
        AND c.merged_into_cat_id IS NULL
    WHERE s.extracted_microchip IS NOT NULL
      AND s.animal_colors IS NOT NULL
      AND s.animal_colors ~ '^P:'
      AND (s.checkout_status = 'Checked Out'
           OR (s.checkout_status = 'Canceled' AND s.extracted_clinichq_id IS NOT NULL))
    ORDER BY ci.cat_id, s.appointment_date DESC
)
UPDATE sot.cats c
SET primary_color = COALESCE(
        CASE WHEN c.primary_color IS NULL THEN cfs.parsed_primary ELSE c.primary_color END,
        c.primary_color
    ),
    secondary_color = COALESCE(
        CASE WHEN c.secondary_color IS NULL THEN cfs.parsed_secondary ELSE c.secondary_color END,
        c.secondary_color
    ),
    updated_at = NOW()
FROM color_from_scrape cfs
WHERE cfs.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NULL
  AND (c.primary_color IS NULL OR c.secondary_color IS NULL)
  AND cfs.parsed_primary IS NOT NULL;

-- =============================================================================
-- Verification
-- =============================================================================

DO $$
DECLARE
    v_total INTEGER;
    v_has_altered INTEGER;
    v_has_altered_by INTEGER;
    v_has_ownership INTEGER;
    v_has_sex INTEGER;
    v_has_breed INTEGER;
    v_has_color INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total FROM sot.cats WHERE merged_into_cat_id IS NULL;
    SELECT COUNT(*) INTO v_has_altered FROM sot.cats WHERE merged_into_cat_id IS NULL AND altered_status IS NOT NULL AND altered_status != 'unknown';
    SELECT COUNT(*) INTO v_has_altered_by FROM sot.cats WHERE merged_into_cat_id IS NULL AND altered_by IS NOT NULL;
    SELECT COUNT(*) INTO v_has_ownership FROM sot.cats WHERE merged_into_cat_id IS NULL AND ownership_type IS NOT NULL AND ownership_type != 'unknown';
    SELECT COUNT(*) INTO v_has_sex FROM sot.cats WHERE merged_into_cat_id IS NULL AND sex IS NOT NULL;
    SELECT COUNT(*) INTO v_has_breed FROM sot.cats WHERE merged_into_cat_id IS NULL AND breed IS NOT NULL;
    SELECT COUNT(*) INTO v_has_color FROM sot.cats WHERE merged_into_cat_id IS NULL AND primary_color IS NOT NULL;

    RAISE NOTICE 'MIG_2892: Re-applied enrichments with extracted_microchip';
    RAISE NOTICE '  Total cats: %', v_total;
    RAISE NOTICE '  Has altered_status: % (%.1f%%)', v_has_altered, (v_has_altered::numeric / v_total * 100);
    RAISE NOTICE '  Has altered_by: % (%.1f%%)', v_has_altered_by, (v_has_altered_by::numeric / v_total * 100);
    RAISE NOTICE '  Has ownership_type: % (%.1f%%)', v_has_ownership, (v_has_ownership::numeric / v_total * 100);
    RAISE NOTICE '  Has sex: % (%.1f%%)', v_has_sex, (v_has_sex::numeric / v_total * 100);
    RAISE NOTICE '  Has breed: % (%.1f%%)', v_has_breed, (v_has_breed::numeric / v_total * 100);
    RAISE NOTICE '  Has primary_color: % (%.1f%%)', v_has_color, (v_has_color::numeric / v_total * 100);
END $$;

COMMIT;
