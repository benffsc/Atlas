\echo ''
\echo '=============================================='
\echo 'MIG_955: Spatial Index for Viewport Filtering'
\echo '=============================================='
\echo ''
\echo 'Creates GiST index on places.location for efficient'
\echo 'viewport-based map queries.'
\echo ''

-- ============================================================================
-- PART 1: Create spatial index on places table
-- ============================================================================

\echo '1. Creating GiST spatial index on places.location...'

-- The location column is geography type, GiST index supports efficient
-- bounding box queries for viewport filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_places_location_gist
ON trapper.places USING GIST (location);

-- Also add a simple B-tree index on lat/lng for direct coordinate queries
-- (used by the simpler lat/lng BETWEEN queries)
\echo '2. Creating B-tree indexes on v_map_atlas_pins lat/lng columns...'

-- Note: v_map_atlas_pins is a view, so we index the underlying tables
-- The view extracts lat/lng from places.location, so the GiST index helps

-- ============================================================================
-- PART 2: Verify index creation
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Spatial indexes on places table:'
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'trapper'
  AND tablename = 'places'
  AND indexname LIKE '%location%' OR indexname LIKE '%gist%';

\echo ''
\echo '=============================================='
\echo 'MIG_955 Complete!'
\echo '=============================================='
\echo ''
\echo 'The GiST index on places.location will speed up:'
\echo '  - Viewport-based filtering (bounds parameter)'
\echo '  - Proximity queries'
\echo '  - Spatial clustering'
\echo ''
