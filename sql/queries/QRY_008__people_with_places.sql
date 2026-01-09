-- QRY_008__people_with_places.sql
-- People with Places Query
--
-- Purpose:
--   - Show people and their associated places
--   - Display relationship roles and evidence counts
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_008__people_with_places.sql

\echo '============================================'
\echo 'People with Places'
\echo '============================================'

-- ============================================
-- 1. People Summary
-- ============================================
\echo ''
\echo '1. People summary:'

SELECT * FROM trapper.v_people_stats;

-- ============================================
-- 2. People with Most Places
-- ============================================
\echo ''
\echo '2. People with most place connections:'

SELECT
    p.person_id,
    p.display_name,
    COUNT(DISTINCT ppr.place_id) AS place_count,
    array_agg(DISTINCT ppr.role::text) AS roles,
    COUNT(DISTINCT srpl.staged_record_id) AS linked_records
FROM trapper.sot_people p
LEFT JOIN trapper.person_place_relationships ppr ON ppr.person_id = p.person_id
LEFT JOIN trapper.staged_record_person_link srpl ON srpl.person_id = p.person_id
WHERE p.merged_into_person_id IS NULL
GROUP BY p.person_id, p.display_name
HAVING COUNT(DISTINCT ppr.place_id) > 0
ORDER BY place_count DESC, linked_records DESC
LIMIT 20;

-- ============================================
-- 3. Places with Most People
-- ============================================
\echo ''
\echo '3. Places with most people:'

SELECT
    pl.place_id,
    pl.display_name AS place_name,
    pl.effective_type,
    COUNT(DISTINCT ppr.person_id) AS person_count,
    array_agg(DISTINCT ppr.role::text) AS roles
FROM trapper.places pl
LEFT JOIN trapper.person_place_relationships ppr ON ppr.place_id = pl.place_id
GROUP BY pl.place_id, pl.display_name, pl.effective_type
HAVING COUNT(DISTINCT ppr.person_id) > 0
ORDER BY person_count DESC
LIMIT 20;

-- ============================================
-- 4. Sample Person-Place Relationships
-- ============================================
\echo ''
\echo '4. Sample person-place relationships:'

SELECT
    person_name,
    place_name,
    place_type,
    role,
    ROUND(confidence::numeric, 2) AS confidence
FROM trapper.v_person_place_relationships
ORDER BY person_name, place_name
LIMIT 30;

-- ============================================
-- 5. People without Places
-- ============================================
\echo ''
\echo '5. Canonical people without place connections:'

SELECT COUNT(*) AS people_without_places
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM trapper.person_place_relationships ppr
      WHERE ppr.person_id = p.person_id
  );

\echo ''
\echo 'To derive more relationships:'
\echo '  SELECT trapper.derive_person_place_relationships();'
\echo ''
