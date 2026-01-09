-- QRY_024__top_places_by_cat_count.sql
-- Places ranked by number of cats
--
-- Shows locations with the most cats, useful for identifying
-- colony sites, high-activity addresses, or potential data issues.
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_024__top_places_by_cat_count.sql

\echo ''
\echo 'Top Places by Cat Count'
\echo '═══════════════════════════════════════════'

SELECT
    place_name,
    LEFT(formatted_address, 45) AS address,
    total_cats,
    cats_home,
    cats_appointment,
    effective_type,
    has_trapping_activity AS trapping,
    has_appointment_activity AS appts
FROM trapper.v_places_with_cat_activity
ORDER BY total_cats DESC
LIMIT 25;

\echo ''
\echo 'Cat count distribution by place:'
SELECT
    CASE
        WHEN total_cats = 1 THEN '1 cat'
        WHEN total_cats BETWEEN 2 AND 5 THEN '2-5 cats'
        WHEN total_cats BETWEEN 6 AND 10 THEN '6-10 cats'
        WHEN total_cats > 10 THEN '10+ cats'
    END AS cat_range,
    COUNT(*) AS places
FROM trapper.v_places_with_cat_activity
GROUP BY 1
ORDER BY MIN(total_cats);

\echo ''
\echo 'Summary:'
SELECT
    COUNT(*) AS total_places_with_cats,
    SUM(total_cats) AS total_cat_links,
    ROUND(AVG(total_cats), 2) AS avg_cats_per_place,
    MAX(total_cats) AS max_cats_per_place
FROM trapper.v_places_with_cat_activity;

\echo ''
\echo 'Places with both trapping and cat activity:'
SELECT
    place_name,
    formatted_address,
    total_cats,
    effective_type
FROM trapper.v_places_with_cat_activity
WHERE has_trapping_activity = TRUE
ORDER BY total_cats DESC
LIMIT 10;
