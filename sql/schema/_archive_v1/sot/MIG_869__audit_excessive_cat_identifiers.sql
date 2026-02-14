\echo ''
\echo '=================================================='
\echo 'MIG_869: Audit Excessive Cat Identifiers (DQ_002b)'
\echo '=================================================='
\echo ''
\echo 'Investigates cats with many identifiers (some showing 10+).'
\echo 'Identifies junk, duplicate, and low-confidence entries that'
\echo 'inflate identifier counts without adding real value.'
\echo ''

-- ============================================================
-- PHASE 1: DIAGNOSTIC — What does the data look like?
-- ============================================================
\echo 'PHASE 1: DIAGNOSTIC'
\echo ''

-- 1a. Distribution of identifier counts per cat
\echo '1a. How many identifiers do cats have?'
SELECT
  CASE
    WHEN id_count > 20 THEN '20+'
    WHEN id_count > 10 THEN '11-20'
    WHEN id_count > 5 THEN '6-10'
    WHEN id_count > 3 THEN '4-5'
    WHEN id_count > 1 THEN '2-3'
    ELSE '1'
  END as identifier_count_bucket,
  COUNT(*) as cat_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as pct
FROM (
  SELECT cat_id, COUNT(*) as id_count
  FROM trapper.cat_identifiers
  GROUP BY cat_id
) x
GROUP BY 1
ORDER BY MIN(id_count) DESC;

-- 1b. Top 30 cats by identifier count
\echo ''
\echo '1b. Top 30 cats with most identifiers:'
SELECT
  c.cat_id,
  c.display_name,
  c.merged_into_cat_id IS NOT NULL as is_merged,
  COUNT(*) as identifier_count,
  array_agg(DISTINCT ci.id_type ORDER BY ci.id_type) as id_types,
  COUNT(*) FILTER (WHERE ci.id_type = 'microchip') as microchip_count,
  COUNT(*) FILTER (WHERE ci.id_type LIKE 'microchip_%') as microchip_variant_count,
  COUNT(*) FILTER (WHERE ci.id_type = 'clinichq_animal_id') as clinichq_id_count,
  COUNT(*) FILTER (WHERE ci.id_type = 'shelterluv_animal_id') as shelterluv_id_count
FROM trapper.cat_identifiers ci
JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
GROUP BY c.cat_id, c.display_name, c.merged_into_cat_id
ORDER BY COUNT(*) DESC
LIMIT 30;

-- 1c. Breakdown by id_type across all cats
\echo ''
\echo '1c. Identifier type breakdown:'
SELECT
  ci.id_type,
  COUNT(*) as total_identifiers,
  COUNT(DISTINCT ci.cat_id) as distinct_cats,
  ROUND(COUNT(*)::NUMERIC / NULLIF(COUNT(DISTINCT ci.cat_id), 0), 2) as avg_per_cat,
  COUNT(*) FILTER (WHERE ci.format_confidence = 'low') as low_confidence_count
FROM trapper.cat_identifiers ci
GROUP BY ci.id_type
ORDER BY COUNT(*) DESC;

-- 1d. Merged cats that still have identifiers
\echo ''
\echo '1d. Merged cats with identifiers (should point to canonical cat):'
SELECT
  COUNT(DISTINCT ci.cat_id) as merged_cats_with_identifiers,
  COUNT(*) as total_orphaned_identifiers,
  COUNT(*) FILTER (WHERE ci.id_type = 'microchip') as orphaned_microchips
FROM trapper.cat_identifiers ci
JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
WHERE c.merged_into_cat_id IS NOT NULL;

-- 1e. Duplicate microchip values (same value, different cats)
\echo ''
\echo '1e. Same microchip value pointing to multiple cats:'
SELECT
  ci.id_value,
  ci.id_type,
  COUNT(DISTINCT ci.cat_id) as cat_count,
  array_agg(DISTINCT c.display_name) as cat_names,
  array_agg(DISTINCT
    CASE WHEN c.merged_into_cat_id IS NOT NULL THEN 'MERGED' ELSE 'ACTIVE' END
  ) as statuses
FROM trapper.cat_identifiers ci
JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
WHERE ci.id_type IN ('microchip', 'microchip_avid', 'microchip_10digit')
GROUP BY ci.id_value, ci.id_type
HAVING COUNT(DISTINCT ci.cat_id) > 1
ORDER BY COUNT(DISTINCT ci.cat_id) DESC
LIMIT 20;

-- 1f. Junk identifiers (short values, suspicious patterns)
\echo ''
\echo '1f. Suspicious identifier values:'
SELECT
  ci.id_type,
  ci.id_value,
  ci.format_confidence,
  c.display_name,
  LENGTH(ci.id_value) as value_length,
  CASE
    WHEN LENGTH(ci.id_value) < 5 THEN 'TOO_SHORT'
    WHEN ci.id_value ~ '^[A-Za-z]+$' THEN 'ALL_LETTERS'
    WHEN ci.id_value ~ '^\d{1,4}$' THEN 'TOO_FEW_DIGITS'
    WHEN ci.id_value ~ '^0+$' THEN 'ALL_ZEROS'
    WHEN ci.id_value ILIKE '%test%' THEN 'TEST_DATA'
    WHEN ci.id_value ILIKE '%unknown%' THEN 'UNKNOWN_PLACEHOLDER'
    ELSE 'REVIEW'
  END as issue_type
FROM trapper.cat_identifiers ci
JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
WHERE ci.id_type IN ('microchip', 'microchip_avid', 'microchip_10digit', 'microchip_truncated')
  AND (
    LENGTH(ci.id_value) < 8
    OR ci.id_value ~ '^[A-Za-z]+$'
    OR ci.id_value ~ '^\d{1,4}$'
    OR ci.id_value ~ '^0+$'
    OR ci.id_value ILIKE '%test%'
    OR ci.id_value ILIKE '%unknown%'
    OR ci.format_confidence = 'low'
  )
ORDER BY ci.id_type, LENGTH(ci.id_value);

-- 1g. Cats whose microchip appears in display_name (MIG_551 remnant)
\echo ''
\echo '1g. Cats where display_name IS a microchip (name cleanup needed):'
SELECT
  c.cat_id,
  c.display_name,
  COUNT(*) as identifier_count
FROM trapper.sot_cats c
JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id
WHERE c.display_name ~ '^\d{9,15}$'
  AND c.merged_into_cat_id IS NULL
GROUP BY c.cat_id, c.display_name
ORDER BY COUNT(*) DESC
LIMIT 20;


-- ============================================================
-- PHASE 2: REMEDIATION — Clean up junk and duplicates
-- ============================================================
\echo ''
\echo 'PHASE 2: REMEDIATION'
\echo ''

-- 2a. Move identifiers from merged cats to their canonical cat
-- (rather than just deleting, re-point to the surviving cat)
\echo '2a. Re-pointing identifiers from merged cats to canonical cats...'
WITH merged_identifiers AS (
  SELECT
    ci.cat_identifier_id,
    ci.cat_id as old_cat_id,
    ci.id_type,
    ci.id_value,
    c.merged_into_cat_id as canonical_cat_id
  FROM trapper.cat_identifiers ci
  JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
  WHERE c.merged_into_cat_id IS NOT NULL
),
-- Check which would be duplicates on the canonical cat
already_exists AS (
  SELECT mi.cat_identifier_id
  FROM merged_identifiers mi
  JOIN trapper.cat_identifiers ci2
    ON ci2.id_type = mi.id_type
    AND ci2.id_value = mi.id_value
    AND ci2.cat_id = mi.canonical_cat_id
),
-- Re-point non-duplicate ones
updated AS (
  UPDATE trapper.cat_identifiers ci
  SET cat_id = mi.canonical_cat_id
  FROM merged_identifiers mi
  WHERE ci.cat_identifier_id = mi.cat_identifier_id
    AND mi.cat_identifier_id NOT IN (SELECT cat_identifier_id FROM already_exists)
  RETURNING ci.cat_identifier_id
),
-- Delete ones that already exist on canonical
deleted AS (
  DELETE FROM trapper.cat_identifiers
  WHERE cat_identifier_id IN (SELECT cat_identifier_id FROM already_exists)
  RETURNING cat_identifier_id
)
SELECT
  (SELECT COUNT(*) FROM updated) as identifiers_repointed,
  (SELECT COUNT(*) FROM deleted) as duplicates_removed,
  (SELECT COUNT(*) FROM merged_identifiers) as total_merged_identifiers;

-- 2b. Remove junk microchip identifiers (too short, all letters, etc.)
\echo ''
\echo '2b. Removing junk microchip identifiers...'
WITH deleted AS (
  DELETE FROM trapper.cat_identifiers
  WHERE id_type IN ('microchip', 'microchip_avid', 'microchip_10digit', 'microchip_truncated')
    AND (
      LENGTH(id_value) < 5
      OR id_value ~ '^[A-Za-z]+$'
      OR id_value ~ '^\d{1,4}$'
      OR id_value ~ '^0+$'
      OR id_value ILIKE '%test%'
      OR id_value ILIKE '%unknown%'
    )
  RETURNING cat_identifier_id, id_type, id_value
)
SELECT COUNT(*) as junk_identifiers_removed FROM deleted;

-- 2c. Remove low-confidence identifiers where the cat already has a
-- high-confidence microchip (keep the good ones, drop the guesses)
\echo ''
\echo '2c. Removing low-confidence identifiers where high-confidence exists...'
WITH cats_with_good_microchip AS (
  SELECT DISTINCT cat_id
  FROM trapper.cat_identifiers
  WHERE id_type = 'microchip'
    AND (format_confidence IS NULL OR format_confidence IN ('high', 'medium'))
    AND LENGTH(id_value) >= 9
),
deleted AS (
  DELETE FROM trapper.cat_identifiers
  WHERE format_confidence = 'low'
    AND id_type LIKE 'microchip%'
    AND cat_id IN (SELECT cat_id FROM cats_with_good_microchip)
  RETURNING cat_identifier_id
)
SELECT COUNT(*) as low_confidence_removed FROM deleted;


-- ============================================================
-- PHASE 3: VERIFICATION
-- ============================================================
\echo ''
\echo 'PHASE 3: VERIFICATION'
\echo ''

-- 3a. Post-cleanup distribution
\echo '3a. Post-cleanup identifier distribution:'
SELECT
  CASE
    WHEN id_count > 20 THEN '20+'
    WHEN id_count > 10 THEN '11-20'
    WHEN id_count > 5 THEN '6-10'
    WHEN id_count > 3 THEN '4-5'
    WHEN id_count > 1 THEN '2-3'
    ELSE '1'
  END as identifier_count_bucket,
  COUNT(*) as cat_count
FROM (
  SELECT cat_id, COUNT(*) as id_count
  FROM trapper.cat_identifiers
  GROUP BY cat_id
) x
GROUP BY 1
ORDER BY MIN(id_count) DESC;

-- 3b. Any remaining merged cats with identifiers?
\echo ''
\echo '3b. Remaining merged cats with identifiers (should be 0):'
SELECT COUNT(*) as remaining_merged_cat_identifiers
FROM trapper.cat_identifiers ci
JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
WHERE c.merged_into_cat_id IS NOT NULL;

-- 3c. Top 10 cats by identifier count (post-cleanup)
\echo ''
\echo '3c. Top 10 cats by identifier count (post-cleanup):'
SELECT
  c.display_name,
  COUNT(*) as identifier_count,
  array_agg(ci.id_type || '=' || LEFT(ci.id_value, 20) ORDER BY ci.id_type) as identifiers
FROM trapper.cat_identifiers ci
JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
WHERE c.merged_into_cat_id IS NULL
GROUP BY c.cat_id, c.display_name
ORDER BY COUNT(*) DESC
LIMIT 10;


-- ============================================================
-- SUMMARY
-- ============================================================
\echo ''
\echo '=================================================='
\echo 'MIG_869 Complete (DQ_002b)'
\echo '=================================================='
\echo ''
\echo 'Audit and remediation for excessive cat identifiers:'
\echo '  1. Re-pointed identifiers from merged cats to canonical cats'
\echo '  2. Removed junk microchip identifiers (short, letters, zeros)'
\echo '  3. Removed low-confidence guesses where good microchip exists'
\echo ''
\echo 'Root causes found:'
\echo '  - Merged cats retained orphaned identifiers'
\echo '  - Multi-format detection created multiple entries per cat'
\echo '  - Low-confidence format guesses accumulated alongside real chips'
\echo '  - Source system IDs (clinichq_animal_id, shelterluv_animal_id) add up'
\echo ''
\echo 'Note: Having 3-5 identifiers per cat is EXPECTED and by design:'
\echo '  microchip + clinichq_animal_id + shelterluv_animal_id = 3 minimum'
\echo '  Cats with >10 should be investigated individually.'
\echo ''
