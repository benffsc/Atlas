-- QRY_022__cats_missing_owner_links.sql
-- Cats that don't have linked owners
--
-- Identifies cats where we have the cat record but couldn't
-- match the owner to an existing person. Useful for:
-- - Data quality investigation
-- - Finding gaps in identity resolution
-- - Prioritizing manual review
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_022__cats_missing_owner_links.sql

\echo ''
\echo 'Cats Without Linked Owners'
\echo '═══════════════════════════════════════════'

\echo ''
\echo 'Summary:'
SELECT
    COUNT(*) AS total_cats,
    COUNT(*) FILTER (WHERE owner_count = 0) AS without_owner,
    COUNT(*) FILTER (WHERE owner_count > 0) AS with_owner,
    ROUND(100.0 * COUNT(*) FILTER (WHERE owner_count > 0) / NULLIF(COUNT(*), 0), 1) AS pct_linked
FROM trapper.v_cats_unified;

\echo ''
\echo 'Cats missing owner links (sample 20):'
SELECT
    c.cat_id,
    c.display_name AS cat_name,
    c.sex,
    c.breed,
    ci.id_value AS animal_id
FROM trapper.sot_cats c
JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'clinichq_animal_id'
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.person_cat_relationships pcr
    WHERE pcr.cat_id = c.cat_id
)
ORDER BY c.created_at DESC
LIMIT 20;

\echo ''
\echo 'Why cats might be missing owner links:'
\echo '  1. Owner not in sot_people (no email/phone match during identity resolution)'
\echo '  2. Owner email/phone in owner_info doesn''t match staged record identifiers'
\echo '  3. Cat only exists in cat_info, not owner_info'
\echo ''

\echo 'Potential linkable cats (have owner_info but no relationship):'
SELECT COUNT(DISTINCT sr.payload->>'Number') AS cats_with_owner_info_but_no_link
FROM trapper.staged_records sr
WHERE sr.source_table = 'owner_info'
  AND sr.payload->>'Number' IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM trapper.cat_identifiers ci
      WHERE ci.id_type = 'clinichq_animal_id'
        AND ci.id_value = sr.payload->>'Number'
  )
  AND NOT EXISTS (
      SELECT 1 FROM trapper.person_cat_relationships pcr
      JOIN trapper.cat_identifiers ci ON ci.cat_id = pcr.cat_id
      WHERE ci.id_type = 'clinichq_animal_id'
        AND ci.id_value = sr.payload->>'Number'
  );
