-- QRY_084__search_smoke.sql
-- Smoke test for unified search functionality
-- Runs representative searches and shows counts per entity_type
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/queries/QRY_084__search_smoke.sql

\pset pager off
\echo '=============================================='
\echo 'UNIFIED SEARCH SMOKE TEST'
\echo '=============================================='

-- ============================================
-- SECTION 1: Entity type counts (baseline)
-- ============================================
\echo ''
\echo '--- 1) Total Rows by Entity Type ---'

SELECT
    entity_type,
    COUNT(*) AS total_rows
FROM trapper.v_search_unified
GROUP BY entity_type
ORDER BY total_rows DESC;

-- ============================================
-- SECTION 2: Search for "Forgotten Felines" (known org)
-- ============================================
\echo ''
\echo '--- 2) Search: "Forgotten Felines" ---'

SELECT
    entity_type,
    COUNT(*) AS matches
FROM trapper.v_search_unified
WHERE search_text ILIKE '%Forgotten Felines%'
GROUP BY entity_type
ORDER BY matches DESC;

-- ============================================
-- SECTION 3: Search for phone fragment "707"
-- ============================================
\echo ''
\echo '--- 3) Search: phone fragment "707" ---'

SELECT
    entity_type,
    COUNT(*) AS matches
FROM trapper.v_search_unified
WHERE search_text ILIKE '%707%'
GROUP BY entity_type
ORDER BY matches DESC;

-- ============================================
-- SECTION 4: Search for microchip prefix "9810"
-- ============================================
\echo ''
\echo '--- 4) Search: microchip prefix "9810" ---'

SELECT
    entity_type,
    COUNT(*) AS matches
FROM trapper.v_search_unified
WHERE search_text ILIKE '%9810%'
GROUP BY entity_type
ORDER BY matches DESC;

-- ============================================
-- SECTION 5: Search for city "Santa Rosa"
-- ============================================
\echo ''
\echo '--- 5) Search: "Santa Rosa" ---'

SELECT
    entity_type,
    COUNT(*) AS matches
FROM trapper.v_search_unified
WHERE search_text ILIKE '%Santa Rosa%'
GROUP BY entity_type
ORDER BY matches DESC;

-- ============================================
-- SECTION 6: Verify historical entity types exist
-- ============================================
\echo ''
\echo '--- 6) Historical Entity Types Check ---'

SELECT
    'hist_owner' AS entity_type,
    CASE WHEN COUNT(*) > 0 THEN 'OK' ELSE 'MISSING' END AS status,
    COUNT(*) AS row_count
FROM trapper.v_search_unified
WHERE entity_type = 'hist_owner'
UNION ALL
SELECT
    'hist_cat',
    CASE WHEN COUNT(*) > 0 THEN 'OK' ELSE 'MISSING' END,
    COUNT(*)
FROM trapper.v_search_unified
WHERE entity_type = 'hist_cat';

-- ============================================
-- SECTION 7: Sample search results (5 recent hist_owner)
-- ============================================
\echo ''
\echo '--- 7) Sample hist_owner Results (5 most recent) ---'

SELECT
    display_label,
    phone_text,
    email_text,
    relevant_date::date
FROM trapper.v_search_unified
WHERE entity_type = 'hist_owner'
ORDER BY relevant_date DESC NULLS LAST
LIMIT 5;

-- ============================================
-- SECTION 8: Sample hist_cat Results (5 recent)
-- ============================================
\echo ''
\echo '--- 8) Sample hist_cat Results (5 most recent) ---'

SELECT
    display_label,
    name_text AS animal_name,
    status AS spay_neuter,
    relevant_date::date
FROM trapper.v_search_unified
WHERE entity_type = 'hist_cat'
ORDER BY relevant_date DESC NULLS LAST
LIMIT 5;

-- ============================================
-- SECTION 9: Summary
-- ============================================
\echo ''
\echo '--- 9) Search Smoke Test Summary ---'

WITH entity_check AS (
    SELECT
        COUNT(DISTINCT entity_type) AS total_entity_types,
        COUNT(*) FILTER (WHERE entity_type = 'hist_owner') AS hist_owner_count,
        COUNT(*) FILTER (WHERE entity_type = 'hist_cat') AS hist_cat_count
    FROM trapper.v_search_unified
)
SELECT
    total_entity_types,
    hist_owner_count,
    hist_cat_count,
    CASE
        WHEN total_entity_types >= 8 AND hist_owner_count > 0 AND hist_cat_count > 0
        THEN 'PASS - All entity types present'
        ELSE 'WARN - Some entity types may be missing'
    END AS smoke_status
FROM entity_check;

\echo ''
\echo '=============================================='
\echo 'SEARCH SMOKE TEST COMPLETE'
\echo '=============================================='
