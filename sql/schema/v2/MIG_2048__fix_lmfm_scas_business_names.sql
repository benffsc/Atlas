-- MIG_2048: Fix LMFM, SCAS, and business name data quality issues
-- Date: 2026-02-13
-- Issue: 431 records (5.2%) have data quality problems:
--   - 267 LMFM records with duplicated/mangled names
--   - 132 SCAS records that should be organizations
--   - 49 duplicated "Name Name" patterns
--   - 17 business names (hotels, ranches, nurseries)
--   - 4 transfer/system records
--
-- LMFM = Sonoma County Animal Services waiver program
-- SCAS = Sonoma County Animal Services
--
-- Root cause: ClinicHQ data import artifacts

-- =========================================================================
-- Step 1: Check before state
-- =========================================================================
SELECT 'BEFORE: LMFM records' as context, COUNT(*) as count
FROM sot.people WHERE display_name ILIKE '%LMFM%';

SELECT 'BEFORE: SCAS records' as context, COUNT(*) as count
FROM sot.people WHERE display_name ILIKE '%SCAS%';

SELECT 'BEFORE: Duplicated names' as context, COUNT(*) as count
FROM sot.people WHERE first_name = last_name AND LENGTH(first_name) > 1;

SELECT 'BEFORE: Organizations marked' as context, COUNT(*) as count
FROM sot.people WHERE is_organization = true;

-- =========================================================================
-- Step 2: Fix LMFM names (267 records)
-- These ARE real people, but with mangled names from the SCAS waiver program
-- Pattern: "LMFM Stacie Isaacs LMFM Stacie Isaacs" → "Stacie Isaacs"
-- Pattern: "LMFM SARA GONZALES" → "Sara Gonzales"
-- =========================================================================

-- First, handle the duplicated LMFM pattern: "LMFM Name LMFM Name"
UPDATE sot.people
SET
  display_name = INITCAP(TRIM(REGEXP_REPLACE(
    REGEXP_REPLACE(display_name, '\s+LMFM\s+.*$', '', 'i'),  -- Remove " LMFM ..." suffix
    '^LMFM\s+', '', 'i'  -- Remove "LMFM " prefix
  ))),
  first_name = INITCAP(TRIM(REGEXP_REPLACE(first_name, '^LMFM\s+', '', 'i'))),
  last_name = INITCAP(TRIM(REGEXP_REPLACE(last_name, '\s+LMFM\s+.*$', '', 'i')))
WHERE display_name ILIKE '%LMFM%'
  AND merged_into_person_id IS NULL;

-- =========================================================================
-- Step 3: Mark SCAS records as organizations (132 records)
-- SCAS = Sonoma County Animal Services - these are NOT people
-- =========================================================================

UPDATE sot.people
SET is_organization = true
WHERE (display_name ILIKE '%SCAS%' OR first_name ILIKE '%SCAS%')
  AND is_organization = false
  AND merged_into_person_id IS NULL;

-- =========================================================================
-- Step 4: Mark business names as organizations (17+ records)
-- Hotels, ranches, nurseries, rentals, transfer stations
-- =========================================================================

UPDATE sot.people
SET is_organization = true
WHERE (
  display_name ILIKE '%Nursery%'
  OR display_name ILIKE '%Ranch%'
  OR display_name ILIKE '%Hotel%'
  OR display_name ILIKE '%Rental%'
  OR display_name ILIKE '%Transfer%'
  OR display_name ILIKE '%Eggs%'
  OR display_name ILIKE '%Station%'
  OR display_name ILIKE '%Sheraton%'
  OR display_name ILIKE '%Duchamp%'
  OR display_name ILIKE '%Smiths Car%'
)
  AND is_organization = false
  AND merged_into_person_id IS NULL;

-- =========================================================================
-- Step 5: Fix duplicated "Name Name" patterns (49 records)
-- Pattern: "Terry Terry" → "Terry"
-- Only for organizations (after marking above)
-- =========================================================================

UPDATE sot.people
SET
  display_name = first_name,
  last_name = ''
WHERE first_name = last_name
  AND first_name IS NOT NULL
  AND LENGTH(first_name) > 1
  AND is_organization = true
  AND merged_into_person_id IS NULL;

-- =========================================================================
-- Step 6: Mark transfer/system records
-- =========================================================================

UPDATE sot.people
SET is_system_account = true
WHERE display_name ILIKE '%Transfer Cat%'
  OR display_name ILIKE '%Rpas Transfer%'
  AND merged_into_person_id IS NULL;

-- =========================================================================
-- Step 7: Title-case ALL CAPS names (for non-organizations)
-- Pattern: "LILLE NORSTAD" → "Lille Norstad"
-- =========================================================================

UPDATE sot.people
SET
  first_name = INITCAP(first_name),
  last_name = INITCAP(last_name),
  display_name = INITCAP(first_name) || ' ' || INITCAP(last_name)
WHERE first_name = UPPER(first_name)
  AND last_name = UPPER(last_name)
  AND LENGTH(first_name) > 2
  AND first_name !~ '[a-z]'
  AND is_organization = false
  AND merged_into_person_id IS NULL
  AND first_name NOT IN ('SCAS', 'LMFM', 'RPAS', 'HBG');

-- =========================================================================
-- Step 8: Check after state
-- =========================================================================
SELECT 'AFTER: LMFM records' as context, COUNT(*) as count
FROM sot.people WHERE display_name ILIKE '%LMFM%';

SELECT 'AFTER: SCAS records' as context, COUNT(*) as count
FROM sot.people WHERE display_name ILIKE '%SCAS%';

SELECT 'AFTER: Organizations marked' as context, COUNT(*) as count
FROM sot.people WHERE is_organization = true;

SELECT 'AFTER: System accounts marked' as context, COUNT(*) as count
FROM sot.people WHERE is_system_account = true;

-- =========================================================================
-- Summary by category
-- =========================================================================
SELECT
  CASE
    WHEN is_organization THEN 'Organization'
    WHEN is_system_account THEN 'System Account'
    ELSE 'Person'
  END as category,
  COUNT(*) as count
FROM sot.people
WHERE merged_into_person_id IS NULL
GROUP BY 1
ORDER BY 2 DESC;

-- Show sample of fixed LMFM records
SELECT 'Sample fixed LMFM' as context, display_name, first_name, last_name
FROM sot.people
WHERE source_system = 'clinichq'
  AND (first_name ILIKE 'Stacie%' OR first_name ILIKE 'Marranda%' OR first_name ILIKE 'Sara%')
  AND merged_into_person_id IS NULL
LIMIT 10;
