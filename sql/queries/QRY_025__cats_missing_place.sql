-- QRY_025__cats_missing_place.sql
-- Cats that don't have a linked place
--
-- Identifies cats where we couldn't establish a location.
-- Useful for:
-- - Finding gaps in address resolution
-- - Prioritizing geocoding work
-- - Identifying cats with owners who need address data
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_025__cats_missing_place.sql

\echo ''
\echo 'Cats Without Linked Places'
\echo '═══════════════════════════════════════════'

\echo ''
\echo 'Summary:'
SELECT
    (SELECT COUNT(*) FROM trapper.sot_cats) AS total_cats,
    (SELECT COUNT(*) FROM trapper.v_cat_primary_place WHERE place_id IS NULL) AS without_place,
    (SELECT COUNT(*) FROM trapper.v_cat_primary_place WHERE place_id IS NOT NULL) AS with_place,
    ROUND(100.0 * (SELECT COUNT(*) FROM trapper.v_cat_primary_place WHERE place_id IS NOT NULL) /
        NULLIF((SELECT COUNT(*) FROM trapper.sot_cats), 0), 1) AS pct_linked;

\echo ''
\echo 'Breakdown by reason:'
\echo '  - Cats with owners who have places should be linked'
\echo '  - Cats without owners cannot be linked via owner address'
\echo '  - Cats with owners but no place: owner address not geocoded'
\echo ''

SELECT
    CASE
        WHEN pcr.person_id IS NULL THEN 'No owner'
        WHEN ppr.place_id IS NULL THEN 'Owner has no place'
        ELSE 'Should have place'
    END AS reason,
    COUNT(DISTINCT c.cat_id) AS cats
FROM trapper.sot_cats c
LEFT JOIN trapper.person_cat_relationships pcr ON pcr.cat_id = c.cat_id AND pcr.relationship_type = 'owner'
LEFT JOIN trapper.person_place_relationships ppr ON ppr.person_id = trapper.canonical_person_id(pcr.person_id)
LEFT JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = c.cat_id
WHERE cpr.cat_id IS NULL
GROUP BY 1
ORDER BY 2 DESC;

\echo ''
\echo 'Sample cats missing places (with owners):'
SELECT
    c.cat_id,
    c.display_name AS cat_name,
    p.display_name AS owner_name
FROM trapper.sot_cats c
JOIN trapper.person_cat_relationships pcr ON pcr.cat_id = c.cat_id AND pcr.relationship_type = 'owner'
JOIN trapper.sot_people p ON p.person_id = trapper.canonical_person_id(pcr.person_id)
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.cat_place_relationships cpr
    WHERE cpr.cat_id = c.cat_id
)
ORDER BY c.display_name
LIMIT 15;

\echo ''
\echo 'Why cats might be missing places:'
\echo '  1. Cat has no owner link (person_cat_relationships empty)'
\echo '  2. Owner exists but has no geocoded address (person_place_relationships empty)'
\echo '  3. Owner address exists but hasn'"'"'t been linked to a place yet'
\echo ''
\echo 'To improve coverage:'
\echo '  - Geocode more owner addresses (ATLAS_003 pipeline)'
\echo '  - Run link_cats_to_places() after new addresses are resolved'
