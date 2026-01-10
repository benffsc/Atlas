-- QRY_034__search_examples.sql
-- Example queries demonstrating the Google-like search functionality
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_034__search_examples.sql

\echo '============================================'
\echo 'ATLAS_019: Search Examples'
\echo '============================================'

-- =============================================
-- 1. Basic Canonical Search
-- =============================================
\echo ''
\echo '1. Basic canonical search for "fluffy":'
SELECT
    entity_type,
    display_name,
    subtitle,
    match_strength,
    match_reason,
    score
FROM trapper.search_unified('fluffy', NULL, 10, 0)
ORDER BY score DESC;

-- =============================================
-- 2. Search with Type Filter
-- =============================================
\echo ''
\echo '2. Search for cats only matching "black":'
SELECT
    entity_type,
    display_name,
    subtitle,
    match_strength,
    match_reason,
    score
FROM trapper.search_unified('black', 'cat', 10, 0)
ORDER BY score DESC;

-- =============================================
-- 3. Place Search
-- =============================================
\echo ''
\echo '3. Search for places matching "main st":'
SELECT
    entity_type,
    display_name,
    subtitle,
    match_strength,
    match_reason,
    score
FROM trapper.search_unified('main st', 'place', 10, 0)
ORDER BY score DESC;

-- =============================================
-- 4. Person Search
-- =============================================
\echo ''
\echo '4. Search for people matching "smith":'
SELECT
    entity_type,
    display_name,
    subtitle,
    match_strength,
    match_reason,
    score
FROM trapper.search_unified('smith', 'person', 10, 0)
ORDER BY score DESC;

-- =============================================
-- 5. Microchip/Identifier Search
-- =============================================
\echo ''
\echo '5. Search for microchip fragment "985":'
SELECT
    entity_type,
    display_name,
    subtitle,
    match_strength,
    match_reason,
    score
FROM trapper.search_unified('985', 'cat', 10, 0)
ORDER BY score DESC;

-- =============================================
-- 6. Search Suggestions (Typeahead)
-- =============================================
\echo ''
\echo '6. Get suggestions for typeahead "whi":'
SELECT
    entity_type,
    display_name,
    subtitle,
    match_reason,
    score
FROM trapper.search_suggestions('whi', 8);

-- =============================================
-- 7. Search Counts by Type
-- =============================================
\echo ''
\echo '7. Get search counts by entity type for "cat":'
SELECT
    entity_type,
    count,
    strong_count,
    medium_count,
    weak_count
FROM trapper.search_unified_counts('cat', NULL);

-- =============================================
-- 8. Deep Search (Raw/Staged Data)
-- =============================================
\echo ''
\echo '8. Deep search for raw records matching "tiger":'
SELECT
    source_table,
    match_field,
    match_value,
    score
FROM trapper.search_deep('tiger', 10);

-- =============================================
-- 9. Match Strength Breakdown
-- =============================================
\echo ''
\echo '9. Match strength distribution for query "a":'
SELECT
    match_strength,
    COUNT(*) AS count
FROM trapper.search_unified('a', NULL, 100, 0)
GROUP BY match_strength
ORDER BY
    CASE match_strength
        WHEN 'strong' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'weak' THEN 3
    END;

-- =============================================
-- 10. Match Reason Distribution
-- =============================================
\echo ''
\echo '10. Most common match reasons for query "a":'
SELECT
    match_reason,
    COUNT(*) AS count
FROM trapper.search_unified('a', NULL, 100, 0)
GROUP BY match_reason
ORDER BY count DESC
LIMIT 10;

-- =============================================
-- 11. Person List View
-- =============================================
\echo ''
\echo '11. Sample from v_person_list:'
SELECT
    person_id,
    display_name,
    cat_count,
    place_count,
    primary_place
FROM trapper.v_person_list
ORDER BY cat_count DESC
LIMIT 5;

-- =============================================
-- 12. Place List View
-- =============================================
\echo ''
\echo '12. Sample from v_place_list:'
SELECT
    place_id,
    display_name,
    place_kind,
    locality,
    cat_count,
    person_count
FROM trapper.v_place_list
ORDER BY cat_count DESC
LIMIT 5;

-- =============================================
-- 13. Person Detail View
-- =============================================
\echo ''
\echo '13. Sample from v_person_detail (first person with cats):'
SELECT
    person_id,
    display_name,
    cat_count,
    place_count,
    jsonb_array_length(COALESCE(cats, '[]'::jsonb)) AS cats_array_length
FROM trapper.v_person_detail
WHERE cat_count > 0
LIMIT 1;

-- =============================================
-- 14. Place Detail View
-- =============================================
\echo ''
\echo '14. Sample from v_place_detail (first place with cats):'
SELECT
    place_id,
    display_name,
    place_kind,
    cat_count,
    person_count
FROM trapper.v_place_detail
WHERE cat_count > 0
LIMIT 1;

-- =============================================
-- 15. All Entity Types Represented
-- =============================================
\echo ''
\echo '15. Verify all entity types appear in search:'
SELECT
    entity_type,
    COUNT(*) AS count
FROM trapper.search_unified('a', NULL, 500, 0)
GROUP BY entity_type
ORDER BY entity_type;

\echo ''
\echo 'Search examples complete.'
\echo ''
