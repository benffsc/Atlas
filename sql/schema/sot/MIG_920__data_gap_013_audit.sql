-- ============================================================================
-- MIG_920: DATA_GAP_013 Audit - Find People Who Would Be Rejected by New Gate
-- ============================================================================
-- This audit finds people in sot_people who would be rejected by the consolidated
-- gate in MIG_919. These are records that slipped through BEFORE the gate existed.
--
-- Categories:
-- 1. Org email holders (would be rejected by should_be_person)
-- 2. Location-like names (would be rejected by classify_owner_name)
-- 3. No contact info (would be rejected by should_be_person)
--
-- This is a READ-ONLY audit. No changes are made.
-- Run this before deciding whether to clean up data.
-- ============================================================================

\echo '=== MIG_920: DATA_GAP_013 Audit ==='
\echo ''

-- ============================================================================
-- Audit 1: People with FFSC Org Emails
-- ============================================================================

\echo 'Audit 1: People with FFSC organizational emails...'

SELECT 'People with @forgottenfelines.com emails:' as category;
SELECT
  p.person_id,
  p.display_name,
  pi.id_value_norm as email,
  (SELECT COUNT(DISTINCT cat_id) FROM trapper.person_cat_relationships WHERE person_id = p.person_id) as cat_count
FROM trapper.sot_people p
JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id AND pi.id_type = 'email'
WHERE p.merged_into_person_id IS NULL
  AND (pi.id_value_norm LIKE '%@forgottenfelines.com' OR pi.id_value_norm LIKE '%@forgottenfelines.org')
ORDER BY cat_count DESC
LIMIT 20;

-- ============================================================================
-- Audit 2: People with Generic Org Email Prefixes
-- ============================================================================

\echo ''
\echo 'Audit 2: People with generic org email prefixes...'

SELECT 'People with info@, office@, contact@, admin@ emails:' as category;
SELECT
  p.person_id,
  p.display_name,
  pi.id_value_norm as email,
  (SELECT COUNT(DISTINCT cat_id) FROM trapper.person_cat_relationships WHERE person_id = p.person_id) as cat_count
FROM trapper.sot_people p
JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id AND pi.id_type = 'email'
WHERE p.merged_into_person_id IS NULL
  AND (
    pi.id_value_norm LIKE 'info@%'
    OR pi.id_value_norm LIKE 'office@%'
    OR pi.id_value_norm LIKE 'contact@%'
    OR pi.id_value_norm LIKE 'admin@%'
    OR pi.id_value_norm LIKE 'help@%'
    OR pi.id_value_norm LIKE 'support@%'
  )
  -- Exclude already-cleaned FFSC emails
  AND pi.id_value_norm NOT LIKE '%@forgottenfelines.%'
ORDER BY cat_count DESC
LIMIT 20;

-- ============================================================================
-- Audit 3: People with Location-Like Names
-- ============================================================================

\echo ''
\echo 'Audit 3: People with location-like names...'

SELECT 'People classified as organizations or addresses:' as category;
SELECT
  p.person_id,
  p.display_name,
  trapper.classify_owner_name(p.display_name) as classification,
  (SELECT COUNT(DISTINCT cat_id) FROM trapper.person_cat_relationships WHERE person_id = p.person_id) as cat_count
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND trapper.classify_owner_name(p.display_name) IN ('organization', 'address', 'apartment_complex')
ORDER BY cat_count DESC
LIMIT 30;

-- ============================================================================
-- Audit 4: People with NO Contact Info
-- ============================================================================

\echo ''
\echo 'Audit 4: People with no contact info...'

SELECT 'People without any email or phone:' as category;
SELECT COUNT(*) as count
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi
    WHERE pi.person_id = p.person_id
    AND pi.id_type IN ('email', 'phone')
  );

-- Show sample
SELECT
  p.person_id,
  p.display_name,
  p.data_source,
  (SELECT COUNT(DISTINCT cat_id) FROM trapper.person_cat_relationships WHERE person_id = p.person_id) as cat_count
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi
    WHERE pi.person_id = p.person_id
    AND pi.id_type IN ('email', 'phone')
  )
ORDER BY cat_count DESC
LIMIT 10;

-- ============================================================================
-- Audit 5: Summary Statistics
-- ============================================================================

\echo ''
\echo 'Summary Statistics:'

SELECT
  'Total unmerged people' as metric,
  COUNT(*) as count
FROM trapper.sot_people WHERE merged_into_person_id IS NULL
UNION ALL
SELECT
  'People with FFSC org emails',
  COUNT(DISTINCT p.person_id)
FROM trapper.sot_people p
JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id AND pi.id_type = 'email'
WHERE p.merged_into_person_id IS NULL
  AND (pi.id_value_norm LIKE '%@forgottenfelines.com' OR pi.id_value_norm LIKE '%@forgottenfelines.org')
UNION ALL
SELECT
  'People with generic org prefixes',
  COUNT(DISTINCT p.person_id)
FROM trapper.sot_people p
JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id AND pi.id_type = 'email'
WHERE p.merged_into_person_id IS NULL
  AND (
    pi.id_value_norm LIKE 'info@%' OR pi.id_value_norm LIKE 'office@%'
    OR pi.id_value_norm LIKE 'contact@%' OR pi.id_value_norm LIKE 'admin@%'
  )
  AND pi.id_value_norm NOT LIKE '%@forgottenfelines.%'
UNION ALL
SELECT
  'People with location-like names',
  COUNT(*)
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND trapper.classify_owner_name(p.display_name) IN ('organization', 'address', 'apartment_complex')
UNION ALL
SELECT
  'People with no contact info',
  COUNT(*)
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi
    WHERE pi.person_id = p.person_id
    AND pi.id_type IN ('email', 'phone')
  );

-- ============================================================================
-- Audit 6: Cat Relationships That Would Need Cleanup
-- ============================================================================

\echo ''
\echo 'Audit 6: Cats linked to problematic people...'

SELECT 'Total cats linked to people with org emails:' as category;
SELECT COUNT(DISTINCT pcr.cat_id) as cat_count
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_people p ON p.person_id = pcr.person_id
JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id AND pi.id_type = 'email'
WHERE p.merged_into_person_id IS NULL
  AND (
    pi.id_value_norm LIKE '%@forgottenfelines.com'
    OR pi.id_value_norm LIKE '%@forgottenfelines.org'
    OR pi.id_value_norm LIKE 'info@%'
    OR pi.id_value_norm LIKE 'office@%'
  );

SELECT 'Total cats linked to location-name people:' as category;
SELECT COUNT(DISTINCT pcr.cat_id) as cat_count
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_people p ON p.person_id = pcr.person_id
WHERE p.merged_into_person_id IS NULL
  AND trapper.classify_owner_name(p.display_name) IN ('organization', 'address', 'apartment_complex');

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_920 Audit Complete!'
\echo '=============================================='
\echo ''
\echo 'This audit identifies records that would be rejected by MIG_919.'
\echo 'Review the results above and decide on cleanup actions:'
\echo ''
\echo 'If cleanup is needed, options are:'
\echo '  1. Delete org email identifiers from sot_people (keeps person, removes link)'
\echo '  2. Merge location-name records into real people (like Linda Price pattern)'
\echo '  3. Create cleanup migration based on results'
\echo ''
\echo 'Note: Many of these may have already been cleaned by DATA_GAP_009/010/011/012.'
\echo ''
