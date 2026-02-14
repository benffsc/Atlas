-- MIG_502: Fix Place List Performance
--
-- Problem:
--   /api/places is slow or errors due to:
--   1. v_place_list uses correlated subqueries for cat_count/person_count (O(n²))
--   2. Missing indexes on relationship tables
--   3. No filtering for merged places
--
-- Solution:
--   1. Add indexes on relationship tables for fast aggregation
--   2. Create CTE-based view for O(n) performance
--   3. Filter out merged places
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_502__fix_place_list_performance.sql

\echo ''
\echo '=============================================='
\echo 'MIG_502: Fix Place List Performance'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Add indexes for relationship aggregation
-- ============================================================

\echo '1. Adding indexes for relationship aggregation...'

-- Index for fast cat_place aggregation
CREATE INDEX IF NOT EXISTS idx_cat_place_rel_place_id
  ON trapper.cat_place_relationships(place_id);

-- Index for fast person_place aggregation
CREATE INDEX IF NOT EXISTS idx_person_place_rel_place_id
  ON trapper.person_place_relationships(place_id);

-- Index for place merge lookups
CREATE INDEX IF NOT EXISTS idx_places_merged_into
  ON trapper.places(merged_into_place_id)
  WHERE merged_into_place_id IS NOT NULL;

-- Index for address-backed filter
CREATE INDEX IF NOT EXISTS idx_places_is_address_backed
  ON trapper.places(is_address_backed)
  WHERE is_address_backed = true;

-- ============================================================
-- 2. Recreate v_place_list with CTE-based aggregation
-- ============================================================

\echo '2. Recreating v_place_list view with CTE-based aggregation...'

DROP VIEW IF EXISTS trapper.v_place_list CASCADE;

CREATE VIEW trapper.v_place_list AS
WITH place_cat_counts AS (
  SELECT
    place_id,
    COUNT(DISTINCT cat_id) AS cat_count
  FROM trapper.cat_place_relationships
  GROUP BY place_id
),
place_person_counts AS (
  SELECT
    place_id,
    COUNT(DISTINCT person_id) AS person_count
  FROM trapper.person_place_relationships
  GROUP BY place_id
)
SELECT
    pl.place_id,
    pl.display_name,
    pl.formatted_address,
    pl.place_kind::TEXT,
    sa.locality,
    sa.postal_code,
    COALESCE(pcc.cat_count, 0)::INT AS cat_count,
    COALESCE(ppc.person_count, 0)::INT AS person_count,
    COALESCE(pl.has_cat_activity, pcc.cat_count > 0) AS has_cat_activity,
    pl.created_at
FROM trapper.places pl
LEFT JOIN trapper.sot_addresses sa ON sa.address_id = pl.sot_address_id
LEFT JOIN place_cat_counts pcc ON pcc.place_id = pl.place_id
LEFT JOIN place_person_counts ppc ON ppc.place_id = pl.place_id
WHERE pl.merged_into_place_id IS NULL  -- Filter merged places
  AND (pl.is_address_backed = true OR pl.formatted_address IS NOT NULL);

COMMENT ON VIEW trapper.v_place_list IS
'Place list view for API/UI with cat and person counts.
Uses CTE-based aggregation for O(n) performance (vs O(n²) with correlated subqueries).
Filters out merged places.';

-- ============================================================
-- 3. Create stats check view for monitoring
-- ============================================================

\echo '3. Creating v_place_list_stats for monitoring...'

CREATE OR REPLACE VIEW trapper.v_place_list_stats AS
SELECT
  COUNT(*) AS total_places,
  COUNT(*) FILTER (WHERE cat_count > 0) AS places_with_cats,
  COUNT(*) FILTER (WHERE person_count > 0) AS places_with_people,
  COUNT(*) FILTER (WHERE has_cat_activity) AS places_with_activity,
  SUM(cat_count) AS total_cat_links,
  SUM(person_count) AS total_person_links,
  AVG(cat_count)::NUMERIC(5,2) AS avg_cats_per_place,
  MAX(cat_count) AS max_cats_at_place
FROM trapper.v_place_list;

COMMENT ON VIEW trapper.v_place_list_stats IS
'Aggregate statistics for place list monitoring';

-- ============================================================
-- Summary
-- ============================================================

\echo ''
\echo '=============================================='
\echo 'MIG_502 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  - Added indexes on cat_place_relationships and person_place_relationships'
\echo '  - Recreated v_place_list with CTE-based aggregation (O(n) vs O(n²))'
\echo '  - Added merged place filtering'
\echo '  - Created v_place_list_stats monitoring view'
\echo ''
\echo 'Performance improvement:'
\echo '  - /api/places should now respond in < 2 seconds'
\echo ''

-- Show stats
SELECT * FROM trapper.v_place_list_stats;

-- Record migration
SELECT trapper.record_migration(502, 'MIG_502__fix_place_list_performance');
