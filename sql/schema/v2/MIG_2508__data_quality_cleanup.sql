-- MIG_2508: Data Quality Cleanup
--
-- Problem: Various data quality issues identified in audit:
-- - 9 org emails not in soft blacklist (creating phantom people)
-- - 5+ misclassified organizations (marked as people)
-- - 13 garbage cats (test cats, unknown)
-- - 7 needs_review cats
-- - 9 address-as-people records
--
-- Solution:
-- 1. Add org emails to soft blacklist
-- 2. Mark misclassified orgs with is_organization = TRUE
-- 3. Flag garbage and needs_review cats
-- 4. Flag address-as-people records for manual review
--
-- Created: 2026-02-26

\echo ''
\echo '=============================================='
\echo '  MIG_2508: Data Quality Cleanup'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Add org emails to soft blacklist
-- ============================================================================

\echo '1. Adding organization emails to soft blacklist...'

INSERT INTO sot.data_engine_soft_blacklist (identifier_type, identifier_norm, reason, created_by)
VALUES
  -- Humane societies and shelters
  ('email', 'kfennell@marinhumanesociety.org', 'Marin Humane Society org email - creates phantom people', 'MIG_2508'),
  ('email', 'aharrison@humanesocietysoco.org', 'Humane Society SoCo org email - creates phantom people', 'MIG_2508'),

  -- Rescue organizations
  ('email', 'rescuedcritters@sbcglobal.net', 'Rescue org email - creates phantom people', 'MIG_2508'),
  ('email', 'hasanimals@yahoo.com', 'Rescue org email - creates phantom people', 'MIG_2508'),
  ('email', 'littlebigpawspetrescue@gmail.com', 'Little Big Paws Pet Rescue org email', 'MIG_2508'),
  ('email', 'kate@dogwoodanimalrescue.org', 'Dogwood Animal Rescue org email', 'MIG_2508'),
  ('email', 'stylesrescue@gmail.com', 'Rescue org email - creates phantom people', 'MIG_2508'),
  ('email', 'becominganimals@gmail.com', 'Rescue org email - creates phantom people', 'MIG_2508'),
  ('email', 'countrysiderescuesr@gmail.com', 'Countryside Rescue org email', 'MIG_2508')
ON CONFLICT (identifier_type, identifier_norm) DO NOTHING;

SELECT 'soft_blacklist_emails' as result, COUNT(*) as count
FROM sot.data_engine_soft_blacklist
WHERE identifier_type = 'email'
  AND created_by = 'MIG_2508';

-- ============================================================================
-- 2. Mark misclassified organizations
-- ============================================================================

\echo ''
\echo '2. Marking misclassified organizations...'

-- First, find them dynamically using business name patterns
UPDATE sot.people
SET is_organization = TRUE
WHERE merged_into_person_id IS NULL
  AND is_organization IS NOT TRUE
  AND (
    -- Explicit list from audit
    display_name ILIKE '%Atlas Tree Surgery%'
    OR display_name ILIKE '%McBride Apartments%'
    OR display_name ILIKE '%Balletto Winery%'
    OR display_name ILIKE '%Woodcreek Village Apartments%'
    OR display_name ILIKE '%Amanda Vineyard%'
    OR display_name ILIKE '%Golden State Lumber%'
    OR display_name ILIKE '%Pace Supply Company%'
    -- Pattern-based detection
    OR display_name ~* '\m(winery|vineyard|apartments?|surgery|lumber|supply)\M'
    OR display_name ~* '^(U-Haul|UHaul)'
  );

SELECT 'organizations_marked' as result, COUNT(*) as count
FROM sot.people
WHERE is_organization = TRUE
  AND merged_into_person_id IS NULL;

-- ============================================================================
-- 3. Flag garbage cats (set data_quality = 'garbage')
-- ============================================================================

\echo ''
\echo '3. Flagging garbage cats...'

-- Add data_quality column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sot' AND table_name = 'cats' AND column_name = 'data_quality'
  ) THEN
    ALTER TABLE sot.cats ADD COLUMN data_quality TEXT DEFAULT 'normal'
      CHECK (data_quality IN ('normal', 'garbage', 'needs_review'));
    CREATE INDEX IF NOT EXISTS idx_cats_data_quality ON sot.cats(data_quality)
      WHERE data_quality != 'normal';
    RAISE NOTICE 'Added data_quality column to sot.cats';
  END IF;
END;
$$;

-- Flag garbage cats
UPDATE sot.cats
SET data_quality = 'garbage'
WHERE merged_into_cat_id IS NULL
  AND data_quality IS DISTINCT FROM 'garbage'
  AND (
    -- Test cats
    name ~* '^test\s*cat'
    OR name ~* '^testing\b'
    -- Unknown with no microchip
    OR (name ILIKE '%unknown%' AND microchip IS NULL)
    -- Placeholder names
    OR name ~* '^placeholder\b'
    OR name ~* '^temp\b'
    OR name = 'x'
    OR name = 'XX'
  );

SELECT 'garbage_cats' as result, COUNT(*) as count
FROM sot.cats WHERE data_quality = 'garbage' AND merged_into_cat_id IS NULL;

-- ============================================================================
-- 4. Flag needs_review cats
-- ============================================================================

\echo ''
\echo '4. Flagging needs_review cats...'

UPDATE sot.cats
SET data_quality = 'needs_review'
WHERE merged_into_cat_id IS NULL
  AND data_quality = 'normal'
  AND (
    -- ID-prefixed names that look like data entry errors
    name ~ '^[A-Z][0-9]{5,}'
    -- Quoted names in otherwise ID-like strings
    OR name ~ '^[A-Z][0-9]+.*[''"]'
    -- Names that are just numbers
    OR name ~ '^[0-9]+$'
  );

SELECT 'needs_review_cats' as result, COUNT(*) as count
FROM sot.cats WHERE data_quality = 'needs_review' AND merged_into_cat_id IS NULL;

-- ============================================================================
-- 5. Flag address-as-people records for review
-- ============================================================================

\echo ''
\echo '5. Identifying address-as-people records (for manual review)...'

-- These need manual review because:
-- 1. They may have cat relationships that need to be transferred
-- 2. The "duplicate" suffix suggests they might be data entry errors
-- 3. Converting to places requires creating new place records + linking

-- Just identify them - don't auto-convert
SELECT
  p.person_id,
  p.display_name,
  COUNT(DISTINCT pc.cat_id) as cat_count,
  'MANUAL_REVIEW: Convert to place or mark as organization' as action
FROM sot.people p
LEFT JOIN sot.person_cat pc ON pc.person_id = p.person_id
WHERE p.merged_into_person_id IS NULL
  AND (
    -- Address patterns
    p.display_name ~* '^\d+\s+(n|s|e|w|north|south|east|west)?\s*[A-Za-z]+(st|street|rd|road|ave|avenue|blvd|boulevard|ln|lane|dr|drive|ct|court|way|pl|place)\b'
    OR p.display_name ~* '\b(coast guard|station)\b'
    OR p.display_name ~* '(duplicated)$'
    -- Specific known addresses from audit
    OR p.display_name ILIKE '%Coast Guard Station Tomales%'
    OR p.display_name ILIKE '%111 Sebastopol Road%'
    OR p.display_name ILIKE '%757 Acacia Lane%'
    OR p.display_name ILIKE '%1162 Dutton Ave%'
    OR p.display_name ILIKE '%833 Russell Ave%'
    OR p.display_name ILIKE '%1320 Commerce St%'
    OR p.display_name ILIKE '%500 Kawana Springs%'
    OR p.display_name ILIKE '%4828 Lagner%'
  )
GROUP BY p.person_id, p.display_name
ORDER BY cat_count DESC;

-- ============================================================================
-- 6. Summary
-- ============================================================================

\echo ''
\echo '6. Data quality summary...'

SELECT 'soft_blacklist_total' as metric, COUNT(*) as value
FROM sot.data_engine_soft_blacklist
UNION ALL
SELECT 'organizations_total', COUNT(*)
FROM sot.people WHERE is_organization = TRUE AND merged_into_person_id IS NULL
UNION ALL
SELECT 'garbage_cats', COUNT(*)
FROM sot.cats WHERE data_quality = 'garbage' AND merged_into_cat_id IS NULL
UNION ALL
SELECT 'needs_review_cats', COUNT(*)
FROM sot.cats WHERE data_quality = 'needs_review' AND merged_into_cat_id IS NULL;

\echo ''
\echo '=============================================='
\echo '  MIG_2508 Complete'
\echo '=============================================='
\echo ''
\echo 'Added: Org emails to soft blacklist'
\echo 'Marked: Misclassified organizations'
\echo 'Flagged: Garbage and needs_review cats'
\echo 'Listed: Address-as-people records for manual review'
\echo ''
\echo 'NOTE: Address-as-people records require manual conversion.'
\echo 'Use /admin/data or direct SQL to convert them to places.'
\echo ''
