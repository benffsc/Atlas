-- QRY_021__top_owners_by_cat_count.sql
-- People ranked by number of cats they own
--
-- Shows people with the most cats, useful for identifying
-- colony caretakers, frequent trappers, or data quality issues.
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_021__top_owners_by_cat_count.sql

\echo ''
\echo 'Top Owners by Cat Count'
\echo '═══════════════════════════════════════════'

SELECT
    display_name AS owner,
    cat_count,
    LEFT(cat_names, 60) AS cats_preview
FROM trapper.v_people_with_cats
WHERE cat_count > 0
ORDER BY cat_count DESC
LIMIT 25;

\echo ''
\echo 'Cat count distribution:'
SELECT
    CASE
        WHEN cat_count = 1 THEN '1 cat'
        WHEN cat_count BETWEEN 2 AND 5 THEN '2-5 cats'
        WHEN cat_count BETWEEN 6 AND 10 THEN '6-10 cats'
        WHEN cat_count > 10 THEN '10+ cats'
    END AS cat_range,
    COUNT(*) AS owners
FROM trapper.v_people_with_cats
WHERE cat_count > 0
GROUP BY 1
ORDER BY MIN(cat_count);

\echo ''
\echo 'Summary:'
SELECT
    COUNT(*) AS total_owners,
    SUM(cat_count) AS total_cats_linked,
    ROUND(AVG(cat_count), 2) AS avg_cats_per_owner,
    MAX(cat_count) AS max_cats_per_owner
FROM trapper.v_people_with_cats
WHERE cat_count > 0;
