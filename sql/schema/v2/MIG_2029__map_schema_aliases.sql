-- MIG_2029: Map Schema Aliases
--
-- Purpose: Create schema aliases for map functionality
-- - ops.v_map_atlas_pins → trapper.v_map_atlas_pins
-- - sot.person_place_relationships → sot.person_place
-- - sot.cat_place_relationships → sot.cat_place
--
-- These are needed because the beacon/map-data route queries ops.* and sot.*_relationships
-- but V2 creates views in trapper.* and uses shorter names in sot.*
--
-- Created: 2026-02-13

\echo ''
\echo '=============================================='
\echo '  MIG_2029: Map Schema Aliases'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. ops.v_map_atlas_pins → trapper.v_map_atlas_pins
-- ============================================================================

\echo '1. Creating ops.v_map_atlas_pins alias...'

CREATE OR REPLACE VIEW ops.v_map_atlas_pins AS
SELECT * FROM trapper.v_map_atlas_pins;

COMMENT ON VIEW ops.v_map_atlas_pins IS 'Alias for trapper.v_map_atlas_pins for API compatibility.';

\echo '   Created ops.v_map_atlas_pins'

-- ============================================================================
-- 2. sot.person_place_relationships → sot.person_place
-- ============================================================================

\echo ''
\echo '2. Creating sot.person_place_relationships alias...'

CREATE OR REPLACE VIEW sot.person_place_relationships AS
SELECT
  id as relationship_id,
  person_id,
  place_id,
  role as relationship_type,  -- V2 uses 'role' instead of 'relationship_type'
  confidence,
  evidence_type,
  source_system,
  source_table,
  source_row_id,
  valid_from,
  valid_to,
  note,
  created_at,
  created_by,
  -- V1 expected columns
  FALSE as is_primary  -- V2 doesn't have is_primary, default FALSE
FROM sot.person_place;

COMMENT ON VIEW sot.person_place_relationships IS 'Alias for sot.person_place for V1 API compatibility.';

\echo '   Created sot.person_place_relationships'

-- ============================================================================
-- 3. sot.cat_place_relationships → sot.cat_place
-- ============================================================================

\echo ''
\echo '3. Creating sot.cat_place_relationships alias...'

CREATE OR REPLACE VIEW sot.cat_place_relationships AS
SELECT
  id as relationship_id,
  cat_id,
  place_id,
  relationship_type,
  confidence,
  evidence_type,
  source_system,
  created_at
FROM sot.cat_place;

COMMENT ON VIEW sot.cat_place_relationships IS 'Alias for sot.cat_place for V1 API compatibility.';

\echo '   Created sot.cat_place_relationships'

-- ============================================================================
-- 4. sot.place_colony_estimates (if not exists)
-- ============================================================================

\echo ''
\echo '4. Checking sot.place_colony_estimates...'

-- Create table if needed
CREATE TABLE IF NOT EXISTS sot.place_colony_estimates (
  estimate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id UUID NOT NULL REFERENCES sot.places(place_id),
  observed_date DATE,
  total_count_observed INTEGER,
  eartip_count_observed INTEGER DEFAULT 0,
  unmarked_count_observed INTEGER DEFAULT 0,
  estimate_method TEXT DEFAULT 'direct_count',
  chapman_estimate NUMERIC,
  observer_notes TEXT,
  source_system TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_place_colony_estimates_place
  ON sot.place_colony_estimates(place_id);

\echo '   Verified sot.place_colony_estimates exists'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Alias views created:'
SELECT schemaname, viewname
FROM pg_views
WHERE viewname IN ('v_map_atlas_pins', 'person_place_relationships', 'cat_place_relationships')
  AND schemaname IN ('ops', 'sot')
ORDER BY schemaname, viewname;

\echo ''
\echo 'Testing ops.v_map_atlas_pins:'
SELECT COUNT(*) as pin_count FROM ops.v_map_atlas_pins;

\echo ''
\echo '=============================================='
\echo '  MIG_2029 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created aliases:'
\echo '  - ops.v_map_atlas_pins → trapper.v_map_atlas_pins'
\echo '  - sot.person_place_relationships → sot.person_place'
\echo '  - sot.cat_place_relationships → sot.cat_place'
\echo ''
