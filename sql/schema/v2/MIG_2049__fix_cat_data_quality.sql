-- MIG_2049: Fix cat data quality issues
-- Date: 2026-02-13
-- Issues:
--   1. 34,249 cats (95.5%) missing altered_status
--   2. 34,257 cats (95.5%) missing primary_color (data in 'color' field instead)
--   3. Raw ClinicHQ data has Spay Neuter Status but it wasn't migrated
--
-- Fix:
--   1. Backfill altered_status from source.clinichq_raw via microchip
--   2. Copy 'color' to 'primary_color' where missing

-- =========================================================================
-- Step 1: Check before state
-- =========================================================================
SELECT 'BEFORE: Missing altered_status' as context, COUNT(*)
FROM sot.cats WHERE altered_status IS NULL AND merged_into_cat_id IS NULL;

SELECT 'BEFORE: Missing primary_color' as context, COUNT(*)
FROM sot.cats WHERE primary_color IS NULL AND merged_into_cat_id IS NULL;

SELECT 'BEFORE: Has color but not primary_color' as context, COUNT(*)
FROM sot.cats WHERE primary_color IS NULL AND color IS NOT NULL AND merged_into_cat_id IS NULL;

-- =========================================================================
-- Step 2: Backfill altered_status from ClinicHQ raw data
-- Match via microchip
-- =========================================================================

UPDATE sot.cats c
SET altered_status = CASE
  WHEN r.status = 'Yes' AND c.sex IN ('Female', 'female', 'F', 'f') THEN 'spayed'
  WHEN r.status = 'Yes' AND c.sex IN ('Male', 'male', 'M', 'm') THEN 'neutered'
  WHEN r.status = 'Yes' THEN 'altered'  -- Unknown sex but still altered
  WHEN r.status = 'No' THEN 'intact'
  ELSE NULL
END
FROM (
  SELECT
    payload->>'Microchip Number' as microchip,
    payload->>'Spay Neuter Status' as status
  FROM source.clinichq_raw
  WHERE record_type = 'cat'
    AND payload->>'Microchip Number' IS NOT NULL
    AND payload->>'Spay Neuter Status' IS NOT NULL
    AND payload->>'Spay Neuter Status' IN ('Yes', 'No')
) r
WHERE c.microchip = r.microchip
  AND c.altered_status IS NULL
  AND c.merged_into_cat_id IS NULL;

-- =========================================================================
-- Step 3: Copy 'color' to 'primary_color' where missing
-- =========================================================================

UPDATE sot.cats
SET primary_color = color
WHERE primary_color IS NULL
  AND color IS NOT NULL
  AND merged_into_cat_id IS NULL;

-- =========================================================================
-- Step 4: Check after state
-- =========================================================================
SELECT 'AFTER: Missing altered_status' as context, COUNT(*)
FROM sot.cats WHERE altered_status IS NULL AND merged_into_cat_id IS NULL;

SELECT 'AFTER: Missing primary_color' as context, COUNT(*)
FROM sot.cats WHERE primary_color IS NULL AND merged_into_cat_id IS NULL;

-- =========================================================================
-- Step 5: Show altered_status distribution
-- =========================================================================
SELECT altered_status, COUNT(*) as count
FROM sot.cats
WHERE merged_into_cat_id IS NULL
GROUP BY 1
ORDER BY 2 DESC;

-- =========================================================================
-- Step 6: Show color distribution (top 15)
-- =========================================================================
SELECT primary_color, COUNT(*) as count
FROM sot.cats
WHERE merged_into_cat_id IS NULL
  AND primary_color IS NOT NULL
GROUP BY 1
ORDER BY 2 DESC
LIMIT 15;
