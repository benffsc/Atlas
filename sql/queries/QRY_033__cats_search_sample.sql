-- QRY_033__cats_search_sample.sql
-- Cat search and list examples
--
-- Demonstrates how to query cats for the UI.
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_033__cats_search_sample.sql

\echo ''
\echo '============================================'
\echo 'Cat Search Examples'
\echo '============================================'

\echo ''
\echo 'Cat list sample (first 15):'
SELECT
    LEFT(display_name, 25) AS name,
    sex,
    altered_status,
    LEFT(microchip, 15) AS microchip,
    owner_count,
    LEFT(primary_place_label, 30) AS primary_place,
    place_kind
FROM trapper.v_cat_list
ORDER BY display_name
LIMIT 15;

\echo ''
\echo 'Cats with microchips:'
SELECT
    display_name,
    microchip,
    owner_names
FROM trapper.v_cat_list
WHERE microchip IS NOT NULL
LIMIT 10;

\echo ''
\echo 'Cats with places (by place_kind):'
SELECT
    place_kind,
    COUNT(*) AS cats_with_place
FROM trapper.v_cat_list
WHERE has_place = true
GROUP BY place_kind
ORDER BY cats_with_place DESC;

\echo ''
\echo 'Cats by sex and altered status:'
SELECT
    COALESCE(sex, 'Unknown') AS sex,
    COALESCE(altered_status, 'Unknown') AS altered_status,
    COUNT(*) AS count
FROM trapper.v_cat_list
GROUP BY sex, altered_status
ORDER BY count DESC;

\echo ''
\echo 'Search example - cats matching "fluffy":'
SELECT entity_type, display, subtitle
FROM trapper.v_search_unified_v3
WHERE entity_type = 'cat'
  AND (search_text ILIKE '%fluffy%' OR search_text_extra ILIKE '%fluffy%')
LIMIT 5;

\echo ''
\echo 'Unified search example - all entities matching "santa rosa":'
SELECT entity_type, display, subtitle
FROM trapper.v_search_unified_v3
WHERE search_text ILIKE '%santa rosa%' OR search_text_extra ILIKE '%santa rosa%'
ORDER BY entity_type, display
LIMIT 15;
