-- QRY_020__cats_summary.sql
-- Cats layer summary and sample data
--
-- Shows cat counts, identifier breakdown, and sample cats with owners.
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_020__cats_summary.sql

\echo ''
\echo 'Cat Layer Summary'
\echo '═══════════════════════════════════════════'

SELECT * FROM trapper.v_cats_stats;

\echo ''
\echo 'Identifier types:'
SELECT id_type, COUNT(*) AS count
FROM trapper.cat_identifiers
GROUP BY 1
ORDER BY 2 DESC;

\echo ''
\echo 'Cats by source:'
SELECT
    ci.source_system,
    COUNT(DISTINCT ci.cat_id) AS cats
FROM trapper.cat_identifiers ci
GROUP BY 1
ORDER BY 2 DESC;

\echo ''
\echo 'Sample cats with owners (top 15):'
SELECT
    display_name AS cat_name,
    sex,
    altered_status AS altered,
    breed,
    owner_names,
    primary_source AS source
FROM trapper.v_cats_unified
WHERE owner_names IS NOT NULL
ORDER BY created_at DESC
LIMIT 15;

\echo ''
\echo 'Sample cats without owners (top 10):'
SELECT
    display_name AS cat_name,
    sex,
    altered_status AS altered,
    breed,
    identifiers->>0 AS first_identifier,
    primary_source AS source
FROM trapper.v_cats_unified
WHERE owner_count = 0
ORDER BY created_at DESC
LIMIT 10;
