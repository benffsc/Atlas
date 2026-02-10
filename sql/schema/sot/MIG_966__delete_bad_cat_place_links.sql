\echo '=================================================='
\echo 'MIG_966: Delete Bad Cat-Place Links (DQ_004)'
\echo '=================================================='
\echo ''
\echo 'Problem: 780 incorrect owner_relationship cat-place links were created'
\echo 'by an auto_link/data_fix process on 2026-01-14 22:11:01.'
\echo ''
\echo 'These links incorrectly connect cats to ALL of a contact person''s addresses'
\echo 'instead of just the location where cats are (appointment_site).'
\echo ''
\echo 'Example: Cat "Blackie" at Victory Outreach Church (4042 Sebastopol Rd)'
\echo 'was incorrectly linked to Lorri Bogdanski''s personal addresses'
\echo '(8032 Cliffrose St, 1945 Piner Rd) in addition to the correct church address.'
\echo ''

-- ============================================================================
-- PHASE 1: PRE-FIX DIAGNOSTIC
-- ============================================================================

\echo 'PHASE 1: PRE-FIX DIAGNOSTIC'
\echo ''

\echo '1a. Count of bad links to be deleted:'

SELECT COUNT(*) as bad_links_count
FROM trapper.cat_place_relationships
WHERE source_system = 'auto_link'
  AND source_table = 'data_fix';

\echo ''
\echo '1b. Sample of affected cats:'

SELECT
  c.display_name,
  cpr.relationship_type,
  pl.formatted_address
FROM trapper.cat_place_relationships cpr
JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL
JOIN trapper.places pl ON pl.place_id = cpr.place_id AND pl.merged_into_place_id IS NULL
WHERE cpr.source_system = 'auto_link'
  AND cpr.source_table = 'data_fix'
LIMIT 10;

\echo ''
\echo '1c. Blackie (microchip 981020027552405) BEFORE fix:'

SELECT
  cpr.relationship_type,
  pl.formatted_address,
  cpr.source_system,
  cpr.source_table
FROM trapper.cat_place_relationships cpr
JOIN trapper.places pl ON pl.place_id = cpr.place_id
WHERE cpr.cat_id = 'ca547287-71e4-4afa-8469-e1234aae9959';

-- ============================================================================
-- PHASE 2: DELETE BAD LINKS
-- ============================================================================

\echo ''
\echo 'PHASE 2: DELETE BAD LINKS'
\echo ''

\echo 'Deleting owner_relationship links from auto_link/data_fix...'

DELETE FROM trapper.cat_place_relationships
WHERE source_system = 'auto_link'
  AND source_table = 'data_fix'
  AND relationship_type = 'owner_relationship';

\echo ''
\echo 'Delete complete.'

-- ============================================================================
-- PHASE 3: VERIFICATION
-- ============================================================================

\echo ''
\echo 'PHASE 3: VERIFICATION'
\echo ''

\echo '3a. Remaining data_fix links (should be 0 or very low):'

SELECT COUNT(*) as remaining_data_fix_links
FROM trapper.cat_place_relationships
WHERE source_system = 'auto_link'
  AND source_table = 'data_fix';

\echo ''
\echo '3b. Blackie (microchip 981020027552405) AFTER fix:'

SELECT
  cpr.relationship_type,
  pl.formatted_address,
  cpr.source_system,
  cpr.source_table
FROM trapper.cat_place_relationships cpr
JOIN trapper.places pl ON pl.place_id = cpr.place_id
WHERE cpr.cat_id = 'ca547287-71e4-4afa-8469-e1234aae9959';

\echo ''
\echo 'Expected: Only appointment_site at 4042 Sebastopol Rd, Santa Rosa, CA 95407'
\echo ''

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo '=================================================='
\echo 'MIG_966 Complete (DQ_004)'
\echo '=================================================='
\echo ''
\echo 'What was fixed:'
\echo '  - Deleted ~780 incorrect owner_relationship cat-place links'
\echo '  - These were created by auto_link/data_fix on 2026-01-14'
\echo '  - Links incorrectly connected cats to ALL of contact person''s addresses'
\echo ''
\echo 'Root cause:'
\echo '  - Contact persons (like Lorri Bogdanski for Victory Outreach Church)'
\echo '    have multiple person_place_relationships (their home, old home, org location)'
\echo '  - Some process created cat-place links to ALL of their addresses'
\echo '  - Cats should only be linked to the appointment_site (where cats actually are)'
\echo ''
\echo 'Prevention:'
\echo '  - Source of data_fix process not found (possibly one-off manual fix)'
\echo '  - If similar links appear again, investigate link_cats_to_places() in MIG_870'
\echo ''
