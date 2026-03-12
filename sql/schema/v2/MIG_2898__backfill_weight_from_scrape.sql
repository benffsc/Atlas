-- MIG_2898: Backfill weight from scrape data (FFS-380)
--
-- 27,727 Checked Out records have weight in format "X.YY lbs" or "X lbs".
-- Weight format is ambiguous (could be lbs.oz or decimal lbs) — store as decimal lbs.
-- For Beacon population modeling, the precision difference is negligible.
--
-- Adds: weight_lbs (numeric) to sot.cats
-- Uses most recent appointment weight per cat.
--
-- Safety: Only fills NULLs. Merge-aware.
-- Depends on: MIG_2891 (extracted_microchip)

BEGIN;

-- =============================================================================
-- Step 1: Add weight column
-- =============================================================================

ALTER TABLE sot.cats ADD COLUMN IF NOT EXISTS weight_lbs NUMERIC(6,2);

-- =============================================================================
-- Step 2: Parse weight and assign to cats (most recent appointment)
-- =============================================================================

CREATE TEMP TABLE _weight_data AS
SELECT DISTINCT ON (COALESCE(ci_chip.cat_id, ci_id.cat_id))
    COALESCE(ci_chip.cat_id, ci_id.cat_id) AS cat_id,
    (regexp_match(s.weight, '^(\d+(?:\.\d+)?)\s*lbs?$'))[1]::numeric AS weight_lbs
FROM source.clinichq_scrape s
LEFT JOIN sot.cat_identifiers ci_chip
    ON ci_chip.id_type = 'microchip' AND ci_chip.id_value = s.extracted_microchip
    AND s.extracted_microchip IS NOT NULL
LEFT JOIN sot.cat_identifiers ci_id
    ON ci_id.id_type = 'clinichq_animal_id'
    AND ci_id.id_value = COALESCE(s.extracted_clinichq_id,
        CASE WHEN s.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN s.animal_id END)
    AND ci_chip.cat_id IS NULL
WHERE COALESCE(ci_chip.cat_id, ci_id.cat_id) IS NOT NULL
  AND s.weight IS NOT NULL AND s.weight != '' AND s.weight != '---'
  AND s.weight ~ '^\d+(?:\.\d+)?\s*lbs?$'
  AND s.checkout_status = 'Checked Out'
ORDER BY COALESCE(ci_chip.cat_id, ci_id.cat_id), s.appointment_date DESC;

-- =============================================================================
-- Step 3: Update sot.cats
-- =============================================================================

UPDATE sot.cats c
SET weight_lbs = wd.weight_lbs, updated_at = NOW()
FROM _weight_data wd
WHERE wd.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NULL
  AND c.weight_lbs IS NULL
  AND wd.weight_lbs > 0
  AND wd.weight_lbs <= 30;  -- Cat weight sanity cap (data entry errors exist)

-- =============================================================================
-- Cleanup + Verification
-- =============================================================================

DROP TABLE IF EXISTS _weight_data;

DO $$
DECLARE
    v_total INTEGER;
    v_has_weight INTEGER;
    v_avg_weight NUMERIC;
    v_min_weight NUMERIC;
    v_max_weight NUMERIC;
BEGIN
    SELECT COUNT(*) INTO v_total FROM sot.cats WHERE merged_into_cat_id IS NULL;
    SELECT COUNT(*) INTO v_has_weight FROM sot.cats WHERE merged_into_cat_id IS NULL AND weight_lbs IS NOT NULL;
    SELECT AVG(weight_lbs), MIN(weight_lbs), MAX(weight_lbs)
    INTO v_avg_weight, v_min_weight, v_max_weight
    FROM sot.cats WHERE merged_into_cat_id IS NULL AND weight_lbs IS NOT NULL;

    RAISE NOTICE 'MIG_2898: Weight backfill from scrape';
    RAISE NOTICE '  Total cats: %', v_total;
    RAISE NOTICE '  Has weight: % (%.1f%%)', v_has_weight, (v_has_weight::numeric / v_total * 100);
    RAISE NOTICE '  Avg weight: %.1f lbs', v_avg_weight;
    RAISE NOTICE '  Min: %.1f lbs, Max: %.1f lbs', v_min_weight, v_max_weight;
END $$;

COMMIT;
