-- ============================================================================
-- MIG_610: Staff-Verified Colony Management System
-- ============================================================================
--
-- Purpose: Allow trapping coordinators to create "verified colonies" that
-- link related places/requests into a single colony entity with staff
-- observations. This provides ground truth on top of AI-derived estimates.
--
-- Key Features:
-- 1. colonies table - Named colony entities with status
-- 2. colony_places - Links colonies to multiple places
-- 3. colony_requests - Links colonies to related requests
-- 4. colony_observations - Staff-entered estimates with per-field confidence
-- 5. Views for aggregating cats and detecting discrepancies
-- 6. Beacon integration - Verified colonies override DBSCAN clustering
-- ============================================================================

\echo ''
\echo '=== MIG_610: Staff-Verified Colony Management System ==='
\echo ''

-- ============================================================================
-- Step 1: Create core tables
-- ============================================================================

\echo 'Creating colonies table...'

CREATE TABLE IF NOT EXISTS trapper.colonies (
  colony_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colony_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'monitored', 'resolved', 'inactive')),
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_colonies_status ON trapper.colonies(status);
CREATE INDEX IF NOT EXISTS idx_colonies_name ON trapper.colonies(colony_name);

COMMENT ON TABLE trapper.colonies IS
'Staff-verified colony entities that group related places and requests.
Provides ground truth on top of AI-derived colony estimates.';

\echo 'Creating colony_places table...'

CREATE TABLE IF NOT EXISTS trapper.colony_places (
  colony_id UUID NOT NULL REFERENCES trapper.colonies(colony_id) ON DELETE CASCADE,
  place_id UUID NOT NULL REFERENCES trapper.places(place_id),
  relationship_type TEXT NOT NULL DEFAULT 'colony_site' CHECK (relationship_type IN ('colony_site', 'feeding_station', 'adjacent', 'overflow')),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  added_by TEXT NOT NULL,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (colony_id, place_id)
);

CREATE INDEX IF NOT EXISTS idx_colony_places_place ON trapper.colony_places(place_id);

COMMENT ON TABLE trapper.colony_places IS
'Links colonies to places. A colony can span multiple places (e.g., adjacent properties).
One place should be marked as is_primary for the colony centroid.';

\echo 'Creating colony_requests table...'

CREATE TABLE IF NOT EXISTS trapper.colony_requests (
  colony_id UUID NOT NULL REFERENCES trapper.colonies(colony_id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES trapper.sot_requests(request_id),
  added_by TEXT NOT NULL,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (colony_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_colony_requests_request ON trapper.colony_requests(request_id);

COMMENT ON TABLE trapper.colony_requests IS
'Links colonies to related requests. Multiple requests may belong to one colony
(e.g., requests from different callers about the same colony).';

\echo 'Creating colony_observations table...'

CREATE TABLE IF NOT EXISTS trapper.colony_observations (
  observation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colony_id UUID NOT NULL REFERENCES trapper.colonies(colony_id) ON DELETE CASCADE,
  observation_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Cat counts with separate confidence per field
  total_cats INT CHECK (total_cats IS NULL OR total_cats >= 0),
  total_cats_confidence TEXT DEFAULT 'medium' CHECK (total_cats_confidence IN ('verified', 'high', 'medium', 'low')),
  fixed_cats INT CHECK (fixed_cats IS NULL OR fixed_cats >= 0),
  fixed_cats_confidence TEXT DEFAULT 'medium' CHECK (fixed_cats_confidence IN ('verified', 'high', 'medium', 'low')),
  unfixed_cats INT CHECK (unfixed_cats IS NULL OR unfixed_cats >= 0),

  notes TEXT,
  observed_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_colony_observations_colony ON trapper.colony_observations(colony_id);
CREATE INDEX IF NOT EXISTS idx_colony_observations_date ON trapper.colony_observations(observation_date DESC);

COMMENT ON TABLE trapper.colony_observations IS
'Staff-entered observations about colony size. Each field can have its own
confidence level (verified, high, medium, low).

Confidence Levels:
- verified: Direct count (e.g., counted during trapping session)
- high: Strong estimate from reliable feeder
- medium: Reasonable estimate with some uncertainty
- low: Rough guess or old information';

-- ============================================================================
-- Step 2: Create helper function for ownership type lookup
-- ============================================================================

\echo 'Creating ownership type lookup function...'

CREATE OR REPLACE FUNCTION trapper.get_cat_ownership_type(p_cat_id UUID)
RETURNS TEXT AS $$
  -- Returns the ownership_type for a cat from sot_cats
  SELECT ownership_type FROM trapper.sot_cats WHERE cat_id = p_cat_id;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION trapper.get_cat_ownership_type IS
'Returns the ownership_type for a cat from sot_cats.
Used to exclude "Owned" (pet) cats from community colony counts.';

-- ============================================================================
-- Step 3: Create view for cats linked to colony places
-- ============================================================================

\echo 'Creating v_colony_linked_cats view...'

CREATE OR REPLACE VIEW trapper.v_colony_linked_cats AS
SELECT
  c.colony_id,
  c.colony_name,
  cp.place_id,
  cpr.cat_id,
  cat.display_name as cat_name,
  -- Get microchip from cat_identifiers
  (SELECT id_value FROM trapper.cat_identifiers ci
   WHERE ci.cat_id = cpr.cat_id AND ci.id_type = 'microchip'
   LIMIT 1) as microchip,
  cat.sex,
  -- Use ownership_type directly from sot_cats
  COALESCE(cat.ownership_type, 'unknown') as ownership_type,
  CASE
    WHEN cat.ownership_type = 'Owned' THEN TRUE
    ELSE FALSE
  END as is_owned_cat,
  -- Check if cat has been altered
  EXISTS (
    SELECT 1 FROM trapper.sot_appointments a
    WHERE a.cat_id = cpr.cat_id
      AND (a.is_spay OR a.is_neuter OR a.service_is_spay OR a.service_is_neuter)
  ) as is_altered,
  cpr.relationship_type as place_relationship_type,
  cpr.created_at as linked_at
FROM trapper.colonies c
JOIN trapper.colony_places cp ON cp.colony_id = c.colony_id
JOIN trapper.cat_place_relationships cpr ON cpr.place_id = cp.place_id
JOIN trapper.sot_cats cat ON cat.cat_id = cpr.cat_id;

COMMENT ON VIEW trapper.v_colony_linked_cats IS
'All cats linked to colony places via cat_place_relationships.
Includes ownership_type to distinguish "Owned" (pet) cats from community cats.';

-- ============================================================================
-- Step 4: Create view for colony stats
-- ============================================================================

\echo 'Creating v_colony_stats view...'

CREATE OR REPLACE VIEW trapper.v_colony_stats AS
WITH cat_counts AS (
  SELECT
    colony_id,
    COUNT(DISTINCT cat_id) as total_linked_cats,
    COUNT(DISTINCT cat_id) FILTER (WHERE NOT is_owned_cat) as community_cats,
    COUNT(DISTINCT cat_id) FILTER (WHERE is_owned_cat) as owned_cats,
    COUNT(DISTINCT cat_id) FILTER (WHERE is_altered AND NOT is_owned_cat) as community_altered,
    COUNT(DISTINCT cat_id) FILTER (WHERE NOT is_altered AND NOT is_owned_cat) as community_unaltered
  FROM trapper.v_colony_linked_cats
  GROUP BY colony_id
),
latest_observation AS (
  SELECT DISTINCT ON (colony_id)
    colony_id,
    observation_id,
    observation_date,
    total_cats,
    total_cats_confidence,
    fixed_cats,
    fixed_cats_confidence,
    unfixed_cats,
    notes,
    observed_by
  FROM trapper.colony_observations
  ORDER BY colony_id, observation_date DESC, created_at DESC
),
place_counts AS (
  SELECT
    colony_id,
    COUNT(*) as place_count,
    COUNT(*) FILTER (WHERE is_primary) as primary_place_count
  FROM trapper.colony_places
  GROUP BY colony_id
),
request_counts AS (
  SELECT
    colony_id,
    COUNT(*) as request_count
  FROM trapper.colony_requests
  GROUP BY colony_id
)
SELECT
  c.colony_id,
  c.colony_name,
  c.status,
  c.notes as colony_notes,
  c.created_by,
  c.created_at,
  c.updated_at,

  -- Place stats
  COALESCE(pc.place_count, 0) as place_count,
  COALESCE(pc.primary_place_count, 0) as primary_place_count,

  -- Request stats
  COALESCE(rc.request_count, 0) as request_count,

  -- Linked cat stats (from system data)
  COALESCE(cc.total_linked_cats, 0) as total_linked_cats,
  COALESCE(cc.community_cats, 0) as linked_community_cats,
  COALESCE(cc.owned_cats, 0) as linked_owned_cats,
  COALESCE(cc.community_altered, 0) as linked_community_altered,
  COALESCE(cc.community_unaltered, 0) as linked_community_unaltered,

  -- Latest staff observation
  lo.observation_id as latest_observation_id,
  lo.observation_date as latest_observation_date,
  lo.total_cats as observation_total_cats,
  lo.total_cats_confidence,
  lo.fixed_cats as observation_fixed_cats,
  lo.fixed_cats_confidence,
  lo.unfixed_cats as observation_unfixed_cats,
  lo.notes as observation_notes,
  lo.observed_by,

  -- Discrepancy detection
  -- Flag if staff observation is LESS than linked community cats
  -- (Can't have fewer cats than we've clinically seen!)
  CASE
    WHEN lo.total_cats IS NOT NULL
      AND COALESCE(cc.community_cats, 0) > 0
      AND lo.total_cats < COALESCE(cc.community_cats, 0)
    THEN TRUE
    ELSE FALSE
  END as has_count_discrepancy,

  -- Calculate the gap
  CASE
    WHEN lo.total_cats IS NOT NULL AND COALESCE(cc.community_cats, 0) > 0
    THEN COALESCE(cc.community_cats, 0) - lo.total_cats
    ELSE NULL
  END as discrepancy_amount

FROM trapper.colonies c
LEFT JOIN cat_counts cc ON cc.colony_id = c.colony_id
LEFT JOIN latest_observation lo ON lo.colony_id = c.colony_id
LEFT JOIN place_counts pc ON pc.colony_id = c.colony_id
LEFT JOIN request_counts rc ON rc.colony_id = c.colony_id;

COMMENT ON VIEW trapper.v_colony_stats IS
'Aggregated statistics for each colony including linked cats, staff observations,
and discrepancy detection. Excludes "Owned" cats from community counts.';

-- ============================================================================
-- Step 5: Create view for colonies with discrepancies
-- ============================================================================

\echo 'Creating v_colony_discrepancies view...'

CREATE OR REPLACE VIEW trapper.v_colony_discrepancies AS
SELECT
  colony_id,
  colony_name,
  status,
  place_count,
  linked_community_cats,
  linked_owned_cats,
  observation_total_cats,
  total_cats_confidence,
  discrepancy_amount,
  latest_observation_date,
  observed_by,
  observation_notes
FROM trapper.v_colony_stats
WHERE has_count_discrepancy = TRUE
ORDER BY discrepancy_amount DESC;

COMMENT ON VIEW trapper.v_colony_discrepancies IS
'Colonies where staff observation is less than linked community cats.
These need review - staff may have missed cats or data may be stale.';

-- ============================================================================
-- Step 6: Create view for Beacon integration
-- ============================================================================

\echo 'Creating v_beacon_verified_colonies view...'

CREATE OR REPLACE VIEW trapper.v_beacon_verified_colonies AS
SELECT
  c.colony_id,
  c.colony_name,
  c.status,
  array_agg(DISTINCT cp.place_id) as place_ids,
  COUNT(DISTINCT cp.place_id) as place_count,

  -- Calculate centroid from linked places (using PostGIS)
  AVG(ST_Y(p.location::geometry)) as centroid_lat,
  AVG(ST_X(p.location::geometry)) as centroid_lng,

  -- Get primary place coordinates if available
  (SELECT ST_Y(p2.location::geometry) FROM trapper.colony_places cp2
   JOIN trapper.places p2 ON p2.place_id = cp2.place_id
   WHERE cp2.colony_id = c.colony_id AND cp2.is_primary
   LIMIT 1) as primary_lat,
  (SELECT ST_X(p2.location::geometry) FROM trapper.colony_places cp2
   JOIN trapper.places p2 ON p2.place_id = cp2.place_id
   WHERE cp2.colony_id = c.colony_id AND cp2.is_primary
   LIMIT 1) as primary_lng,

  -- Stats from linked data
  vcs.linked_community_cats,
  vcs.linked_community_altered,

  -- Latest observation
  vcs.observation_total_cats,
  vcs.total_cats_confidence,
  vcs.observation_fixed_cats,
  vcs.fixed_cats_confidence,
  vcs.latest_observation_date,

  -- Calculate alteration rate
  CASE
    WHEN COALESCE(vcs.observation_total_cats, vcs.linked_community_cats, 0) > 0
    THEN ROUND(
      100.0 * COALESCE(vcs.observation_fixed_cats, vcs.linked_community_altered, 0) /
      COALESCE(vcs.observation_total_cats, vcs.linked_community_cats),
      1
    )
    ELSE NULL
  END as alteration_rate_pct,

  -- Colony status for map display
  CASE
    WHEN COALESCE(vcs.observation_total_cats, vcs.linked_community_cats, 0) = 0 THEN 'no_data'
    WHEN COALESCE(vcs.observation_fixed_cats, vcs.linked_community_altered, 0)::FLOAT /
         NULLIF(COALESCE(vcs.observation_total_cats, vcs.linked_community_cats, 0), 0) >= 0.75 THEN 'managed'
    WHEN COALESCE(vcs.observation_fixed_cats, vcs.linked_community_altered, 0)::FLOAT /
         NULLIF(COALESCE(vcs.observation_total_cats, vcs.linked_community_cats, 0), 0) >= 0.50 THEN 'in_progress'
    WHEN COALESCE(vcs.observation_fixed_cats, vcs.linked_community_altered, 0)::FLOAT /
         NULLIF(COALESCE(vcs.observation_total_cats, vcs.linked_community_cats, 0), 0) >= 0.25 THEN 'needs_work'
    ELSE 'needs_attention'
  END as colony_status,

  -- Flag discrepancy
  vcs.has_count_discrepancy,

  -- Source indicator for map
  'verified' as cluster_source,

  c.created_at,
  c.updated_at

FROM trapper.colonies c
JOIN trapper.colony_places cp ON cp.colony_id = c.colony_id
JOIN trapper.places p ON p.place_id = cp.place_id
LEFT JOIN trapper.v_colony_stats vcs ON vcs.colony_id = c.colony_id
WHERE c.status = 'active'
GROUP BY c.colony_id, c.colony_name, c.status, c.created_at, c.updated_at,
         vcs.linked_community_cats, vcs.linked_community_altered,
         vcs.observation_total_cats, vcs.total_cats_confidence,
         vcs.observation_fixed_cats, vcs.fixed_cats_confidence,
         vcs.latest_observation_date, vcs.has_count_discrepancy;

COMMENT ON VIEW trapper.v_beacon_verified_colonies IS
'Active verified colonies formatted for Beacon map display.
These should override DBSCAN auto-clustering for their places.';

-- ============================================================================
-- Step 7: Create helper function to check if place is in verified colony
-- ============================================================================

\echo 'Creating is_place_in_verified_colony function...'

CREATE OR REPLACE FUNCTION trapper.is_place_in_verified_colony(p_place_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM trapper.colony_places cp
    JOIN trapper.colonies c ON c.colony_id = cp.colony_id
    WHERE cp.place_id = p_place_id
      AND c.status = 'active'
  );
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION trapper.is_place_in_verified_colony IS
'Returns TRUE if the place is part of an active verified colony.
Used by Beacon to exclude these places from DBSCAN auto-clustering.';

-- ============================================================================
-- Step 8: Create function to get colony for a place
-- ============================================================================

\echo 'Creating get_place_verified_colony function...'

CREATE OR REPLACE FUNCTION trapper.get_place_verified_colony(p_place_id UUID)
RETURNS TABLE (
  colony_id UUID,
  colony_name TEXT,
  is_primary BOOLEAN
) AS $$
  SELECT c.colony_id, c.colony_name, cp.is_primary
  FROM trapper.colony_places cp
  JOIN trapper.colonies c ON c.colony_id = cp.colony_id
  WHERE cp.place_id = p_place_id
    AND c.status = 'active';
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION trapper.get_place_verified_colony IS
'Returns the verified colony(s) that a place belongs to.
A place can belong to multiple colonies (rare but possible).';

-- ============================================================================
-- Step 9: Add updated_at trigger
-- ============================================================================

\echo 'Creating updated_at trigger for colonies...'

CREATE OR REPLACE FUNCTION trapper.update_colony_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_colonies_updated_at ON trapper.colonies;
CREATE TRIGGER trg_colonies_updated_at
  BEFORE UPDATE ON trapper.colonies
  FOR EACH ROW
  EXECUTE FUNCTION trapper.update_colony_timestamp();

-- ============================================================================
-- Verification
-- ============================================================================

\echo ''
\echo '=== Verification ==='
\echo ''

\echo 'Tables created:'
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'trapper'
  AND table_name IN ('colonies', 'colony_places', 'colony_requests', 'colony_observations')
ORDER BY table_name;

\echo ''
\echo 'Views created:'
SELECT table_name FROM information_schema.views
WHERE table_schema = 'trapper'
  AND table_name LIKE '%colony%'
ORDER BY table_name;

\echo ''
\echo 'Functions created:'
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'trapper'
  AND routine_name IN ('get_cat_ownership_type', 'is_place_in_verified_colony', 'get_place_verified_colony', 'update_colony_timestamp')
ORDER BY routine_name;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=== MIG_610 Complete ==='
\echo ''
\echo 'Created tables:'
\echo '  - colonies: Named colony entities with status'
\echo '  - colony_places: Links colonies to places (many-to-many)'
\echo '  - colony_requests: Links colonies to requests'
\echo '  - colony_observations: Staff-entered observations with per-field confidence'
\echo ''
\echo 'Created views:'
\echo '  - v_colony_linked_cats: All cats from colony places (with ownership type)'
\echo '  - v_colony_stats: Aggregated stats with discrepancy detection'
\echo '  - v_colony_discrepancies: Colonies needing attention'
\echo '  - v_beacon_verified_colonies: For Beacon map integration'
\echo ''
\echo 'Created functions:'
\echo '  - get_cat_ownership_type(cat_id): Get ownership type from clinic visits'
\echo '  - is_place_in_verified_colony(place_id): Check if place is in verified colony'
\echo '  - get_place_verified_colony(place_id): Get colony info for a place'
\echo ''
\echo 'Next steps:'
\echo '  1. Create API endpoints for colony management'
\echo '  2. Create admin UI pages'
\echo '  3. Modify beacon_cluster_colonies() to exclude verified colony places'
\echo ''
