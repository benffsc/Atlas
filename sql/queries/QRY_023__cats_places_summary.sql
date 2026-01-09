-- QRY_023__cats_places_summary.sql
-- Cat-to-Place linking summary
--
-- Shows overall stats and sample data for cat-place relationships.
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_023__cats_places_summary.sql

\echo ''
\echo 'Cat-Place Linking Summary'
\echo '═══════════════════════════════════════════'

SELECT * FROM trapper.v_cat_place_stats;

\echo ''
\echo 'Relationship type breakdown:'
SELECT
    relationship_type,
    confidence,
    COUNT(*) AS count
FROM trapper.cat_place_relationships
GROUP BY 1, 2
ORDER BY 1, 2;

\echo ''
\echo 'Coverage:'
SELECT
    (SELECT COUNT(*) FROM trapper.sot_cats) AS total_cats,
    (SELECT COUNT(DISTINCT cat_id) FROM trapper.cat_place_relationships) AS cats_with_place,
    ROUND(100.0 * (SELECT COUNT(DISTINCT cat_id) FROM trapper.cat_place_relationships) /
        NULLIF((SELECT COUNT(*) FROM trapper.sot_cats), 0), 1) AS pct_linked;

\echo ''
\echo 'Sample cats with places (top 15):'
SELECT
    cat_name,
    place_name,
    LEFT(formatted_address, 40) AS address,
    relationship_type AS rel_type,
    confidence
FROM trapper.v_cat_primary_place
WHERE place_id IS NOT NULL
ORDER BY cat_name
LIMIT 15;

\echo ''
\echo 'Sample cats without places (top 10):'
SELECT
    cat_id,
    cat_name
FROM trapper.v_cat_primary_place
WHERE place_id IS NULL
ORDER BY cat_name
LIMIT 10;
