-- ============================================================================
-- MIG_932: First-Name-Only Record Cleanup (DATA_GAP_017)
-- ============================================================================
-- Problem: 590 person records with first-name-only display names
--          Including 19 "Scas" duplicates (likely SCAS = Sonoma County Animal Services)
--
-- Root Cause: ClinicHQ or intake form allowed entries without last names
--
-- Solution:
--   1. Investigate "Scas" pattern - if SCAS org, consolidate
--   2. Create review view for first-name-only records
--   3. Add validation to prevent future first-name-only entries
-- ============================================================================

\echo '=== MIG_932: First-Name-Only Record Cleanup ==='
\echo ''

-- ============================================================================
-- Phase 1: Investigate common first-name-only patterns
-- ============================================================================

\echo 'Phase 1: Investigating first-name-only patterns...'

SELECT 'Most common first-name-only display names:' as header;

SELECT
  display_name,
  COUNT(*) as count,
  array_agg(DISTINCT source_system) as source_systems
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
  AND display_name !~ '\s'  -- No space = no last name
GROUP BY display_name
HAVING COUNT(*) > 2
ORDER BY count DESC
LIMIT 20;

-- ============================================================================
-- Phase 2: Check if "Scas" is SCAS organization
-- ============================================================================

\echo ''
\echo 'Phase 2: Investigating "Scas" pattern...'

SELECT 'Scas records details:' as header;

SELECT
  p.person_id,
  p.display_name,
  p.data_source,
  p.created_at,
  COUNT(DISTINCT pcr.cat_id) as cat_count,
  array_agg(DISTINCT pi.id_value_norm) FILTER (WHERE pi.id_value_norm IS NOT NULL) as identifiers
FROM trapper.sot_people p
LEFT JOIN trapper.person_cat_relationships pcr ON pcr.person_id = p.person_id
LEFT JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
WHERE p.merged_into_person_id IS NULL
  AND p.display_name ILIKE 'scas%'
GROUP BY p.person_id, p.display_name, p.data_source, p.created_at
ORDER BY cat_count DESC;

-- ============================================================================
-- Phase 3: Create review view for first-name-only records
-- ============================================================================

\echo ''
\echo 'Phase 3: Creating first-name-only review view...'

CREATE OR REPLACE VIEW trapper.v_firstname_only_review AS
SELECT
  p.person_id,
  p.display_name,
  p.data_source,
  p.created_at,
  COUNT(DISTINCT pcr.cat_id) as cat_count,
  COUNT(DISTINCT a.appointment_id) as appointment_count,
  array_agg(DISTINCT pi.id_value_norm) FILTER (WHERE pi.id_value_norm IS NOT NULL) as identifiers,
  array_agg(DISTINCT pi.id_type) FILTER (WHERE pi.id_type IS NOT NULL) as identifier_types,
  CASE
    WHEN UPPER(p.display_name) = 'SCAS' OR p.display_name ILIKE 'scas%' THEN 'scas_pattern'
    WHEN p.display_name ~ '^[A-Z][a-z]+$' THEN 'single_proper_name'
    WHEN p.display_name ~ '^[A-Z]+$' THEN 'all_caps_single'
    WHEN LENGTH(p.display_name) <= 2 THEN 'very_short'
    ELSE 'other'
  END as pattern_type
FROM trapper.sot_people p
LEFT JOIN trapper.person_cat_relationships pcr ON pcr.person_id = p.person_id
LEFT JOIN trapper.sot_appointments a ON a.person_id = p.person_id
LEFT JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
WHERE p.merged_into_person_id IS NULL
  AND (
    -- No space in display name (no last name)
    p.display_name !~ '\s'
    -- Or very short name
    OR LENGTH(TRIM(p.display_name)) < 3
  )
GROUP BY p.person_id, p.display_name, p.data_source, p.created_at
ORDER BY cat_count DESC, appointment_count DESC;

COMMENT ON VIEW trapper.v_firstname_only_review IS
'Person records with first-name-only or incomplete names that need staff review.
Part of DATA_GAP_017 fix (MIG_932).

Pattern types:
- scas_pattern: Likely SCAS organization abbreviation
- single_proper_name: Normal capitalized name without last name
- all_caps_single: Likely abbreviation or code
- very_short: 1-2 character name
- other: Other incomplete name patterns

Staff should:
1. Check if "SCAS" records should be linked to SCAS partner org
2. Try to find full names via linked cats or appointments
3. Merge duplicates where possible';

-- ============================================================================
-- Phase 4: Count affected records by pattern
-- ============================================================================

\echo ''
\echo 'Phase 4: Counting first-name-only records by pattern...'

SELECT 'Total first-name-only records:' as info,
       COUNT(*) as count
FROM trapper.v_firstname_only_review;

SELECT 'Records by pattern type:' as header;
SELECT pattern_type, COUNT(*) as count
FROM trapper.v_firstname_only_review
GROUP BY pattern_type
ORDER BY count DESC;

SELECT 'Records by source system:' as header;
SELECT source_system, COUNT(*) as count
FROM trapper.v_firstname_only_review
GROUP BY source_system
ORDER BY count DESC;

-- ============================================================================
-- Phase 5: Handle SCAS abbreviation if confirmed
-- ============================================================================

\echo ''
\echo 'Phase 5: Checking for SCAS partner organization...'

-- Check if SCAS is in partner_orgs
SELECT 'SCAS in partner_orgs:' as header;
SELECT org_id, name, short_name, org_type
FROM trapper.partner_orgs
WHERE name ILIKE '%scas%'
   OR short_name ILIKE '%scas%'
   OR name ILIKE '%sonoma county animal%';

-- If SCAS exists as partner org, create function to link SCAS person records
DO $$
DECLARE
  v_scas_org_id UUID;
BEGIN
  -- Find SCAS org
  SELECT org_id INTO v_scas_org_id
  FROM trapper.partner_orgs
  WHERE name ILIKE '%scas%'
     OR short_name ILIKE '%scas%'
     OR name ILIKE '%sonoma county animal%'
  LIMIT 1;

  IF v_scas_org_id IS NOT NULL THEN
    RAISE NOTICE 'SCAS partner org found: %', v_scas_org_id;
    -- Could merge SCAS person records into org contact here
  ELSE
    RAISE NOTICE 'SCAS partner org not found - manual setup needed';
  END IF;
END $$;

-- ============================================================================
-- Phase 6: Create summary of review queue
-- ============================================================================

\echo ''
\echo 'Phase 6: Summary of review queue...'

SELECT 'Top 20 first-name-only records by cat count:' as header;
SELECT
  person_id,
  display_name,
  pattern_type,
  cat_count,
  appointment_count,
  identifiers
FROM trapper.v_firstname_only_review
ORDER BY cat_count DESC
LIMIT 20;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_932 Complete!'
\echo '=============================================='
\echo ''
\echo 'DATA_GAP_017: First-Name-Only Records - REVIEW VIEW CREATED'
\echo ''
\echo 'Changes made:'
\echo '  1. Investigated "Scas" pattern (likely SCAS abbreviation)'
\echo '  2. Created v_firstname_only_review view for staff review'
\echo '  3. Categorized records by pattern type'
\echo ''
\echo 'Staff action required:'
\echo '  1. Review "scas_pattern" records - link to SCAS partner org if confirmed'
\echo '  2. Try to find full names for other first-name-only records'
\echo '  3. Consider adding intake form validation to require last names'
\echo ''
