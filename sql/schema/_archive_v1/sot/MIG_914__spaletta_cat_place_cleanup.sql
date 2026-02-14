-- ============================================================================
-- MIG_914: Spaletta Cat-Place Pollution Cleanup (DATA_GAP_008b)
-- ============================================================================
-- Problem: Spaletta's 71 cats are linked to ALL THREE addresses:
--   - 949 Chileno Valley Road (correct - where recent appointments happen)
--   - 1054 Walker Rd (wrong - via person-place chain)
--   - 1170 Walker Rd (wrong - via person-place chain)
--
-- Each cat is counted 3x on the map, violating INV-6 (Place Individuality).
--
-- Root Cause:
--   link_cats_to_places() creates links via person_place → person_cat chain.
--   Spaletta had `resident` role at all 3 addresses (INV-12 violation).
--
-- Solution:
--   1. Remove Spaletta cats from Walker Rd addresses (except Buddy)
--   2. Reclassify Spaletta's Walker Rd roles from 'resident' to 'contact'
--   3. Tag Chileno Valley as colony_site via detect_colony_caretakers()
--
-- Related: DATA_GAP_008 (Buddy Walker Rd fix)
-- ============================================================================

\echo '=== MIG_914: Spaletta Cat-Place Pollution Cleanup ==='
\echo ''

-- ============================================================================
-- Phase 1: Capture current state
-- ============================================================================

\echo 'Phase 1: Capturing current state...'

SELECT 'Spaletta cats by location BEFORE:' as info;
SELECT
    pl.formatted_address,
    COUNT(DISTINCT cpr.cat_id) as cat_count
FROM trapper.cat_place_relationships cpr
JOIN trapper.places pl ON pl.place_id = cpr.place_id
JOIN trapper.person_cat_relationships pcr ON pcr.cat_id = cpr.cat_id
WHERE pcr.person_id = '2cf52aff-492e-4ad2-9912-1de2269836b2'  -- Spaletta
GROUP BY pl.formatted_address
ORDER BY cat_count DESC;

-- ============================================================================
-- Phase 2: Remove Spaletta cats from Walker Rd (except Buddy)
-- ============================================================================

\echo ''
\echo 'Phase 2: Removing Spaletta cats from Walker Rd addresses...'

WITH spaletta_cats AS (
    SELECT DISTINCT pcr.cat_id
    FROM trapper.person_cat_relationships pcr
    WHERE pcr.person_id = '2cf52aff-492e-4ad2-9912-1de2269836b2'  -- Spaletta
),
walker_places AS (
    SELECT place_id FROM trapper.places
    WHERE formatted_address ILIKE '%Walker%'
    AND merged_into_place_id IS NULL
),
buddy_cat AS (
    SELECT cat_id FROM trapper.cat_identifiers
    WHERE id_value = '981020053734908' AND id_type = 'microchip'
),
deleted AS (
    DELETE FROM trapper.cat_place_relationships cpr
    WHERE cpr.cat_id IN (SELECT cat_id FROM spaletta_cats)
    AND cpr.cat_id NOT IN (SELECT cat_id FROM buddy_cat)
    AND cpr.place_id IN (SELECT place_id FROM walker_places)
    RETURNING cpr.cat_place_id, cpr.cat_id, cpr.place_id
)
SELECT
    COUNT(*) as links_deleted,
    COUNT(DISTINCT cat_id) as cats_affected
FROM deleted;

-- ============================================================================
-- Phase 3: Reclassify Spaletta's Walker Rd roles
-- ============================================================================

\echo ''
\echo 'Phase 3: Reclassifying Spaletta Walker Rd roles from resident to contact...'

WITH walker_places AS (
    SELECT place_id FROM trapper.places
    WHERE formatted_address ILIKE '%Walker%'
    AND merged_into_place_id IS NULL
),
updated AS (
    UPDATE trapper.person_place_relationships ppr
    SET role = 'contact'
    FROM walker_places wp
    WHERE ppr.person_id = '2cf52aff-492e-4ad2-9912-1de2269836b2'  -- Spaletta
    AND ppr.place_id = wp.place_id
    AND ppr.role = 'resident'
    RETURNING ppr.person_place_id, wp.place_id
)
SELECT COUNT(*) as roles_updated FROM updated;

-- ============================================================================
-- Phase 4: Verify final state
-- ============================================================================

\echo ''
\echo 'Phase 4: Verifying final state...'

SELECT 'Spaletta cats by location AFTER:' as info;
SELECT
    pl.formatted_address,
    COUNT(DISTINCT cpr.cat_id) as cat_count
FROM trapper.cat_place_relationships cpr
JOIN trapper.places pl ON pl.place_id = cpr.place_id
JOIN trapper.person_cat_relationships pcr ON pcr.cat_id = cpr.cat_id
WHERE pcr.person_id = '2cf52aff-492e-4ad2-9912-1de2269836b2'  -- Spaletta
GROUP BY pl.formatted_address
ORDER BY cat_count DESC;

SELECT 'Spaletta person-place roles at Walker Rd:' as info;
SELECT
    pl.formatted_address,
    ppr.role
FROM trapper.person_place_relationships ppr
JOIN trapper.places pl ON pl.place_id = ppr.place_id
WHERE ppr.person_id = '2cf52aff-492e-4ad2-9912-1de2269836b2'  -- Spaletta
AND pl.formatted_address ILIKE '%Walker%';

SELECT 'Buddy location (should be 1170 Walker only):' as info;
SELECT pl.formatted_address
FROM trapper.cat_place_relationships cpr
JOIN trapper.places pl ON pl.place_id = cpr.place_id
JOIN trapper.cat_identifiers ci ON ci.cat_id = cpr.cat_id
WHERE ci.id_value = '981020053734908' AND ci.id_type = 'microchip';

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_914 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Removed Spaletta cat links from Walker Rd addresses'
\echo '  2. Kept Buddy at 1170 Walker Rd (owned by Tresch)'
\echo '  3. Reclassified Spaletta Walker Rd roles: resident -> contact'
\echo '  4. Spaletta cats now only at 949 Chileno Valley Road'
\echo ''
\echo 'DATA_GAP_008b: Spaletta Cat-Place Pollution - RESOLVED'
\echo ''
\echo 'Note: Run detect_colony_caretakers() to tag Chileno Valley as colony_site'
\echo ''
