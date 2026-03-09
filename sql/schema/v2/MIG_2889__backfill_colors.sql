-- MIG_2889: Backfill primary_color from scrape animal_colors (FFS-382)
--
-- Data source: source.clinichq_scrape.animal_colors
-- Format: "P:Black/S:White" or "P:Orange Tabby" (326 unique patterns)
-- Parse primary color from P: prefix, secondary from S: prefix.
--
-- Safety: Only fills NULLs. Never overwrites existing values. Merge-aware.
-- Depends on: MIG_2879 (clinichq_scrape), MIG_2885 (registered IDs)

BEGIN;

-- =============================================================================
-- Step 1: Backfill primary_color via microchip match
-- =============================================================================

WITH color_from_scrape AS (
    SELECT DISTINCT ON (ci.cat_id)
        ci.cat_id,
        -- Extract primary color: everything after "P:" until "/" or end
        BTRIM((regexp_match(s.animal_colors, 'P:([^/]+)'))[1]) AS parsed_primary,
        -- Extract secondary color: everything after "S:"
        BTRIM((regexp_match(s.animal_colors, 'S:(.+)$'))[1]) AS parsed_secondary
    FROM source.clinichq_scrape s
    JOIN sot.cat_identifiers ci
        ON ci.id_type = 'microchip'
        AND ci.id_value = s.microchip
    JOIN sot.cats c
        ON c.cat_id = ci.cat_id
        AND c.merged_into_cat_id IS NULL
    WHERE s.microchip IS NOT NULL AND s.microchip != '' AND s.microchip != '---'
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
-- Step 2: Backfill via clinichq_animal_id match
-- =============================================================================

WITH color_from_scrape_id AS (
    SELECT DISTINCT ON (ci.cat_id)
        ci.cat_id,
        BTRIM((regexp_match(s.animal_colors, 'P:([^/]+)'))[1]) AS parsed_primary,
        BTRIM((regexp_match(s.animal_colors, 'S:(.+)$'))[1]) AS parsed_secondary
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
      AND s.animal_colors IS NOT NULL
      AND s.animal_colors ~ '^P:'
      AND (s.checkout_status = 'Checked Out'
           OR (s.checkout_status = 'Canceled' AND s.extracted_clinichq_id IS NOT NULL))
    ORDER BY ci.cat_id, s.appointment_date DESC
)
UPDATE sot.cats c
SET primary_color = COALESCE(
        CASE WHEN c.primary_color IS NULL THEN cfsi.parsed_primary ELSE c.primary_color END,
        c.primary_color
    ),
    secondary_color = COALESCE(
        CASE WHEN c.secondary_color IS NULL THEN cfsi.parsed_secondary ELSE c.secondary_color END,
        c.secondary_color
    ),
    updated_at = NOW()
FROM color_from_scrape_id cfsi
WHERE cfsi.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NULL
  AND (c.primary_color IS NULL OR c.secondary_color IS NULL)
  AND cfsi.parsed_primary IS NOT NULL;

-- =============================================================================
-- Verification
-- =============================================================================

DO $$
DECLARE
    v_total INTEGER;
    v_has_primary INTEGER;
    v_has_secondary INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total FROM sot.cats WHERE merged_into_cat_id IS NULL;
    SELECT COUNT(*) INTO v_has_primary FROM sot.cats WHERE merged_into_cat_id IS NULL AND primary_color IS NOT NULL;
    SELECT COUNT(*) INTO v_has_secondary FROM sot.cats WHERE merged_into_cat_id IS NULL AND secondary_color IS NOT NULL;

    RAISE NOTICE 'MIG_2889: color backfill complete';
    RAISE NOTICE '  Total cats: %', v_total;
    RAISE NOTICE '  Has primary_color: % (%.1f%%)', v_has_primary, (v_has_primary::numeric / v_total * 100);
    RAISE NOTICE '  Has secondary_color: % (%.1f%%)', v_has_secondary, (v_has_secondary::numeric / v_total * 100);
END $$;

COMMIT;
