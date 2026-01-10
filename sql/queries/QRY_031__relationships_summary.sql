-- QRY_031__relationships_summary.sql
-- Relationship graph summary statistics
--
-- Shows counts by domain, type, and status for all relationships.
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_031__relationships_summary.sql

\echo ''
\echo '============================================'
\echo 'Relationship Graph Summary'
\echo '============================================'

\echo ''
\echo 'Relationship types by domain:'
SELECT
    domain,
    COUNT(*) AS types,
    COUNT(*) FILTER (WHERE active) AS active_types
FROM trapper.relationship_types
GROUP BY domain
ORDER BY domain;

\echo ''
\echo 'Manual edges by domain:'
SELECT 'person_person' AS domain, COUNT(*) AS edges FROM trapper.person_person_edges
UNION ALL
SELECT 'place_place', COUNT(*) FROM trapper.place_place_edges
UNION ALL
SELECT 'cat_cat', COUNT(*) FROM trapper.cat_cat_edges
ORDER BY domain;

\echo ''
\echo 'Person-person edges by type:'
SELECT
    rt.label AS relationship_type,
    COUNT(*) AS count
FROM trapper.person_person_edges ppe
JOIN trapper.relationship_types rt ON rt.id = ppe.relationship_type_id
GROUP BY rt.label
ORDER BY count DESC;

\echo ''
\echo 'Place-place edges by type:'
SELECT
    rt.label AS relationship_type,
    COUNT(*) AS count
FROM trapper.place_place_edges ppe
JOIN trapper.relationship_types rt ON rt.id = ppe.relationship_type_id
GROUP BY rt.label
ORDER BY count DESC;

\echo ''
\echo 'Cat-cat edges by type:'
SELECT
    rt.label AS relationship_type,
    COUNT(*) AS count
FROM trapper.cat_cat_edges cce
JOIN trapper.relationship_types rt ON rt.id = cce.relationship_type_id
GROUP BY rt.label
ORDER BY count DESC;

\echo ''
\echo 'Relationship suggestions by status:'
SELECT
    status,
    domain,
    COUNT(*) AS count
FROM trapper.relationship_suggestions
GROUP BY status, domain
ORDER BY status, domain;

\echo ''
\echo 'Existing relationships (pre-MIG_024) still working:'
SELECT
    'person_place_relationships' AS table_name,
    COUNT(*) AS count
FROM trapper.person_place_relationships
UNION ALL
SELECT 'person_cat_relationships', COUNT(*) FROM trapper.person_cat_relationships
UNION ALL
SELECT 'cat_place_relationships', COUNT(*) FROM trapper.cat_place_relationships
UNION ALL
SELECT 'person_relationships (old)', COUNT(*) FROM trapper.person_relationships
ORDER BY table_name;

\echo ''
\echo 'Rollup view totals:'
SELECT
    'v_person_relationships_rollup' AS view_name,
    COUNT(*) AS rows
FROM trapper.v_person_relationships_rollup
UNION ALL
SELECT 'v_place_relationships_rollup', COUNT(*) FROM trapper.v_place_relationships_rollup
UNION ALL
SELECT 'v_cat_relationships_rollup', COUNT(*) FROM trapper.v_cat_relationships_rollup
ORDER BY view_name;
