\echo '=================================================='
\echo 'MIG_967: Delete Bad ShelterLuv Adopter Links (DQ_005)'
\echo '=================================================='
\echo ''
\echo 'Problem: 405 incorrect adopter_residence cat-place links were created'
\echo 'by ShelterLuv processing on 2026-02-01 with empty evidence.'
\echo ''
\echo 'These links incorrectly connect cats to ALL adopter addresses instead of'
\echo 'just the cat''s actual adopter. Example: "Mario Vidrio orange tabby/white"'
\echo 'was linked to 203 different adopter addresses.'
\echo ''

-- ============================================================================
-- PHASE 1: PRE-FIX DIAGNOSTIC
-- ============================================================================

\echo 'PHASE 1: PRE-FIX DIAGNOSTIC'
\echo ''

\echo '1a. Count of bad ShelterLuv links (empty evidence):'

SELECT COUNT(*) as bad_links_count
FROM trapper.cat_place_relationships
WHERE source_system = 'shelterluv'
  AND relationship_type = 'adopter_residence'
  AND evidence = '{}'::jsonb;

\echo ''
\echo '1b. Cats most affected:'

SELECT
  c.display_name,
  COUNT(*) as link_count
FROM trapper.cat_place_relationships cpr
JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL
WHERE cpr.source_system = 'shelterluv'
  AND cpr.relationship_type = 'adopter_residence'
  AND cpr.evidence = '{}'::jsonb
GROUP BY c.cat_id, c.display_name
ORDER BY link_count DESC
LIMIT 10;

\echo ''
\echo '1c. Identifying links that ARE valid (cat has adopter relationship to that place):'

WITH bad_links AS (
  SELECT
    cpr.cat_id,
    cpr.place_id,
    cpr.cat_place_id
  FROM trapper.cat_place_relationships cpr
  WHERE cpr.source_system = 'shelterluv'
    AND cpr.relationship_type = 'adopter_residence'
    AND cpr.evidence = '{}'::jsonb
),
valid_adopter_places AS (
  SELECT DISTINCT
    pcr.cat_id,
    ppr.place_id
  FROM trapper.person_cat_relationships pcr
  JOIN trapper.person_place_relationships ppr ON ppr.person_id = pcr.person_id
  WHERE pcr.relationship_type = 'adopter'
    AND pcr.source_system = 'shelterluv'
)
SELECT
  COUNT(*) as total_empty_evidence_links,
  COUNT(CASE WHEN vap.cat_id IS NOT NULL THEN 1 END) as valid_links_keep,
  COUNT(CASE WHEN vap.cat_id IS NULL THEN 1 END) as invalid_links_delete
FROM bad_links bl
LEFT JOIN valid_adopter_places vap ON vap.cat_id = bl.cat_id AND vap.place_id = bl.place_id;

-- ============================================================================
-- PHASE 2: DELETE BAD LINKS (only those without valid adopter relationship)
-- ============================================================================

\echo ''
\echo 'PHASE 2: DELETE INVALID LINKS'
\echo ''

\echo 'Deleting adopter_residence links with empty evidence where no valid adopter relationship exists...'

WITH valid_adopter_places AS (
  SELECT DISTINCT
    pcr.cat_id,
    ppr.place_id
  FROM trapper.person_cat_relationships pcr
  JOIN trapper.person_place_relationships ppr ON ppr.person_id = pcr.person_id
  WHERE pcr.relationship_type = 'adopter'
)
DELETE FROM trapper.cat_place_relationships cpr
WHERE cpr.source_system = 'shelterluv'
  AND cpr.relationship_type = 'adopter_residence'
  AND cpr.evidence = '{}'::jsonb
  AND NOT EXISTS (
    SELECT 1 FROM valid_adopter_places vap
    WHERE vap.cat_id = cpr.cat_id AND vap.place_id = cpr.place_id
  );

\echo ''
\echo 'Delete complete.'

-- ============================================================================
-- PHASE 3: VERIFICATION
-- ============================================================================

\echo ''
\echo 'PHASE 3: VERIFICATION'
\echo ''

\echo '3a. Remaining ShelterLuv empty evidence links (should be ~5 - the valid ones):'

SELECT COUNT(*) as remaining_empty_evidence
FROM trapper.cat_place_relationships
WHERE source_system = 'shelterluv'
  AND relationship_type = 'adopter_residence'
  AND evidence = '{}'::jsonb;

\echo ''
\echo '3b. Mario Vidrio cat links after fix (should be 1-2, not 203):'

SELECT
  c.display_name,
  cpr.relationship_type,
  pl.formatted_address,
  cpr.source_system
FROM trapper.cat_place_relationships cpr
JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
JOIN trapper.places pl ON pl.place_id = cpr.place_id
WHERE c.display_name = 'Mario Vidrio orange tabby/white'
ORDER BY cpr.source_system;

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=================================================='
\echo 'MIG_967 Complete (DQ_005)'
\echo '=================================================='
\echo ''
\echo 'What was fixed:'
\echo '  - Deleted ~405 incorrect adopter_residence cat-place links'
\echo '  - These were created by ShelterLuv processing on 2026-02-01 with empty evidence'
\echo '  - Links incorrectly connected cats to ALL adopter addresses'
\echo ''
\echo 'Root cause:'
\echo '  - ShelterLuv processing bug linked cats to ALL adopter places'
\echo '  - Instead of just the cat''s actual adopter''s address'
\echo '  - Preserved ~5 links that ARE valid (cat has actual adopter relationship)'
\echo ''
