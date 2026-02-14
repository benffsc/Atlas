-- MIG_626: Colony Entities (Clustering System)
--
-- A "colony" is a geographic entity that can encompass multiple places.
-- Example: "Fisher Lane Colony" includes 101, 103, and 105 Fisher Lane.
--
-- This migration creates:
-- 1. colonies table - Named colony entities
-- 2. place.colony_id - Links places to their parent colony
-- 3. Functions to create/manage colonies
-- 4. View to aggregate stats across a colony
--
-- Key concept: A feeding_station place becomes the primary_place_id,
-- and nearby places with cat activity can be linked to the same colony.

\echo ''
\echo '========================================================'
\echo 'MIG_626: Colony Entities (Clustering System)'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Create colonies table
-- ============================================================

\echo 'Creating colonies table...'

CREATE TABLE IF NOT EXISTS trapper.colonies (
  colony_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  colony_name TEXT NOT NULL,
  colony_code TEXT UNIQUE,  -- Short code for reference (e.g., "FISHER-01")

  -- Geographic center and bounds
  primary_place_id UUID REFERENCES trapper.places(place_id),
  center_lat NUMERIC(10, 7),
  center_lng NUMERIC(10, 7),
  boundary_geom GEOMETRY(Polygon, 4326),  -- For Beacon visualization
  clustering_radius_meters INT DEFAULT 200,

  -- Status
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'managed', 'resolved', 'archived')),
  status_reason TEXT,
  status_updated_at TIMESTAMPTZ,

  -- Estimated population (aggregated from places)
  estimated_population INT,
  estimated_altered INT,
  population_updated_at TIMESTAMPTZ,

  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.colonies IS
'Named colony entities that can span multiple places.
A colony is a geographic cluster of places with cat activity.
The primary_place_id is typically the main feeding station.';

COMMENT ON COLUMN trapper.colonies.status IS
'active: Ongoing TNR work needed
managed: Regular maintenance (mostly altered)
resolved: No longer active colony (cats dispersed/relocated)
archived: Historical record only';

-- Index for geographic queries
CREATE INDEX IF NOT EXISTS idx_colonies_center
ON trapper.colonies USING GIST (
  ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326)
);

-- ============================================================
-- PART 2: Add colony_id to places
-- ============================================================

\echo 'Adding colony_id to places...'

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS colony_id UUID REFERENCES trapper.colonies(colony_id);

COMMENT ON COLUMN trapper.places.colony_id IS
'Links this place to a parent colony. Multiple places can belong to one colony.';

CREATE INDEX IF NOT EXISTS idx_places_colony_id
ON trapper.places(colony_id)
WHERE colony_id IS NOT NULL;

-- ============================================================
-- PART 3: Create colony management functions
-- ============================================================

\echo 'Creating create_colony function...'

CREATE OR REPLACE FUNCTION trapper.create_colony(
  p_name TEXT,
  p_primary_place_id UUID,
  p_created_by TEXT DEFAULT 'system',
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_colony_id UUID;
  v_place RECORD;
  v_code TEXT;
  v_sequence INT;
BEGIN
  -- Get primary place data
  SELECT * INTO v_place
  FROM trapper.places
  WHERE place_id = p_primary_place_id;

  IF v_place IS NULL THEN
    RAISE EXCEPTION 'Primary place not found: %', p_primary_place_id;
  END IF;

  -- Generate colony code from address
  v_code := UPPER(REGEXP_REPLACE(
    SPLIT_PART(COALESCE(v_place.display_name, v_place.formatted_address), ',', 1),
    '[^A-Z0-9]', '', 'g'
  ));
  v_code := LEFT(v_code, 10);

  -- Add sequence number
  SELECT COALESCE(MAX(
    CASE
      WHEN colony_code ~ ('^' || v_code || '-[0-9]+$')
      THEN CAST(SPLIT_PART(colony_code, '-', 2) AS INT)
      ELSE 0
    END
  ), 0) + 1 INTO v_sequence
  FROM trapper.colonies
  WHERE colony_code LIKE v_code || '-%';

  v_code := v_code || '-' || LPAD(v_sequence::TEXT, 2, '0');

  -- Create colony
  INSERT INTO trapper.colonies (
    colony_name, colony_code, primary_place_id,
    center_lat, center_lng,
    created_by, notes
  ) VALUES (
    p_name, v_code, p_primary_place_id,
    v_place.latitude, v_place.longitude,
    p_created_by, p_notes
  )
  RETURNING colony_id INTO v_colony_id;

  -- Link primary place to colony
  UPDATE trapper.places
  SET colony_id = v_colony_id,
      updated_at = NOW()
  WHERE place_id = p_primary_place_id;

  -- Set place as feeding_station if not already
  IF v_place.colony_classification NOT IN ('feeding_station', 'large_colony') THEN
    PERFORM trapper.set_colony_classification(
      p_primary_place_id,
      'feeding_station',
      'Created as primary place for colony: ' || p_name,
      p_created_by,
      NULL
    );
  END IF;

  RETURN v_colony_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.create_colony IS
'Creates a new colony entity with a primary place.
Automatically links the primary place and sets it as feeding_station.';

-- ============================================================
-- PART 4: Link place to colony
-- ============================================================

\echo 'Creating link_place_to_colony function...'

CREATE OR REPLACE FUNCTION trapper.link_place_to_colony(
  p_place_id UUID,
  p_colony_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  -- Verify colony exists
  IF NOT EXISTS (SELECT 1 FROM trapper.colonies WHERE colony_id = p_colony_id) THEN
    RAISE EXCEPTION 'Colony not found: %', p_colony_id;
  END IF;

  -- Link place
  UPDATE trapper.places
  SET colony_id = p_colony_id,
      updated_at = NOW()
  WHERE place_id = p_place_id;

  -- Update colony population
  PERFORM trapper.update_colony_population(p_colony_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_place_to_colony IS
'Links a place to an existing colony and updates the colony population estimate.';

-- ============================================================
-- PART 5: Suggest colony clustering
-- ============================================================

\echo 'Creating suggest_colony_clustering function...'

CREATE OR REPLACE FUNCTION trapper.suggest_colony_clustering(
  p_place_id UUID,
  p_radius_meters INT DEFAULT 200
)
RETURNS TABLE(
  nearby_place_id UUID,
  nearby_address TEXT,
  distance_meters NUMERIC,
  has_cat_activity BOOLEAN,
  cat_count INT,
  existing_colony_id UUID,
  existing_colony_name TEXT
) AS $$
DECLARE
  v_place RECORD;
BEGIN
  -- Get source place
  SELECT * INTO v_place
  FROM trapper.places
  WHERE place_id = p_place_id;

  IF v_place.latitude IS NULL OR v_place.longitude IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.place_id AS nearby_place_id,
    p.formatted_address AS nearby_address,
    ST_Distance(
      ST_SetSRID(ST_MakePoint(v_place.longitude, v_place.latitude), 4326)::geography,
      ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography
    )::NUMERIC AS distance_meters,
    (SELECT COUNT(*) > 0 FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = p.place_id) AS has_cat_activity,
    (SELECT COUNT(*)::INT FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = p.place_id) AS cat_count,
    p.colony_id AS existing_colony_id,
    c.colony_name AS existing_colony_name
  FROM trapper.places p
  LEFT JOIN trapper.colonies c ON c.colony_id = p.colony_id
  WHERE p.place_id != p_place_id
    AND p.merged_into_place_id IS NULL
    AND p.latitude IS NOT NULL
    AND p.longitude IS NOT NULL
    AND ST_DWithin(
      ST_SetSRID(ST_MakePoint(v_place.longitude, v_place.latitude), 4326)::geography,
      ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography,
      p_radius_meters
    )
  ORDER BY distance_meters;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.suggest_colony_clustering IS
'Finds nearby places within a radius that could be clustered into a colony.
Returns places sorted by distance with their cat activity and existing colony info.';

-- ============================================================
-- PART 6: Update colony population
-- ============================================================

\echo 'Creating update_colony_population function...'

CREATE OR REPLACE FUNCTION trapper.update_colony_population(
  p_colony_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_total_cats INT;
  v_altered_cats INT;
BEGIN
  -- Sum verified cats across all places in colony
  SELECT
    COALESCE(SUM(
      CASE
        WHEN p.authoritative_cat_count IS NOT NULL THEN p.authoritative_cat_count
        ELSE (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = p.place_id)
      END
    ), 0),
    COALESCE(SUM(
      (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr
       JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
       WHERE cpr.place_id = p.place_id AND c.altered_status = 'Yes')
    ), 0)
  INTO v_total_cats, v_altered_cats
  FROM trapper.places p
  WHERE p.colony_id = p_colony_id
    AND p.merged_into_place_id IS NULL;

  -- Update colony
  UPDATE trapper.colonies
  SET estimated_population = v_total_cats,
      estimated_altered = v_altered_cats,
      population_updated_at = NOW(),
      updated_at = NOW()
  WHERE colony_id = p_colony_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.update_colony_population IS
'Recalculates the estimated population for a colony by summing across all linked places.';

-- ============================================================
-- PART 7: Colony summary view
-- ============================================================

\echo 'Creating v_colony_summary view...'

CREATE OR REPLACE VIEW trapper.v_colony_summary AS
SELECT
  c.colony_id,
  c.colony_name,
  c.colony_code,
  c.status,
  c.primary_place_id,
  pp.formatted_address AS primary_address,

  -- Place counts
  (SELECT COUNT(*) FROM trapper.places p WHERE p.colony_id = c.colony_id AND p.merged_into_place_id IS NULL) AS place_count,

  -- Population
  c.estimated_population,
  c.estimated_altered,
  c.estimated_population - COALESCE(c.estimated_altered, 0) AS work_remaining,
  CASE
    WHEN c.estimated_population > 0
    THEN ROUND((c.estimated_altered::NUMERIC / c.estimated_population) * 100, 1)
    ELSE NULL
  END AS alteration_rate,

  -- Activity
  (SELECT COUNT(*) FROM trapper.sot_requests r
   JOIN trapper.places p ON p.place_id = r.place_id
   WHERE p.colony_id = c.colony_id
     AND r.status NOT IN ('completed', 'cancelled')) AS active_requests,

  (SELECT MAX(a.appointment_date) FROM trapper.sot_appointments a
   JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
   JOIN trapper.places p ON p.place_id = cpr.place_id
   WHERE p.colony_id = c.colony_id) AS last_appointment,

  -- Metadata
  c.notes,
  c.created_at,
  c.created_by,
  c.population_updated_at

FROM trapper.colonies c
LEFT JOIN trapper.places pp ON pp.place_id = c.primary_place_id
WHERE c.status != 'archived'
ORDER BY c.colony_name;

COMMENT ON VIEW trapper.v_colony_summary IS
'Summary of all active colonies with aggregated statistics across their linked places.';

-- ============================================================
-- PART 8: Places in colony view
-- ============================================================

\echo 'Creating v_colony_places view...'

CREATE OR REPLACE VIEW trapper.v_colony_places AS
SELECT
  c.colony_id,
  c.colony_name,
  p.place_id,
  p.formatted_address,
  p.colony_classification,
  p.authoritative_cat_count,
  (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = p.place_id) AS linked_cat_count,
  (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr
   JOIN trapper.sot_cats cat ON cat.cat_id = cpr.cat_id
   WHERE cpr.place_id = p.place_id AND cat.altered_status = 'Yes') AS altered_count,
  p.place_id = c.primary_place_id AS is_primary,
  CASE
    WHEN p.location IS NOT NULL AND c.center_lat IS NOT NULL AND c.center_lng IS NOT NULL THEN
      ST_Distance(
        ST_SetSRID(ST_MakePoint(c.center_lng, c.center_lat), 4326)::geography,
        p.location::geography
      )::INT
    ELSE NULL
  END AS distance_from_center_meters
FROM trapper.colonies c
JOIN trapper.places p ON p.colony_id = c.colony_id
WHERE p.merged_into_place_id IS NULL
ORDER BY c.colony_name, is_primary DESC, distance_from_center_meters;

COMMENT ON VIEW trapper.v_colony_places IS
'All places belonging to colonies with their individual statistics.';

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Verification:'

SELECT 'colonies table' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'trapper' AND tablename = 'colonies')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'places.colony_id column' AS check_item,
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'trapper' AND table_name = 'places' AND column_name = 'colony_id'
       ) THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'create_colony function' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_colony')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'v_colony_summary view' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'trapper' AND viewname = 'v_colony_summary')
            THEN 'OK' ELSE 'MISSING' END AS status;

\echo ''
\echo '========================================================'
\echo 'MIG_626 Complete!'
\echo '========================================================'
\echo ''
\echo 'Colony Clustering System:'
\echo '  - colonies table: Named colony entities with boundaries'
\echo '  - places.colony_id: Links places to parent colony'
\echo '  - create_colony(): Create colony with primary place'
\echo '  - link_place_to_colony(): Add place to existing colony'
\echo '  - suggest_colony_clustering(): Find nearby places to cluster'
\echo '  - v_colony_summary: Aggregated colony statistics'
\echo ''
\echo 'Usage:'
\echo '  -- Create a colony from a feeding station'
\echo '  SELECT trapper.create_colony('
\echo '    ''Fisher Lane Colony'','
\echo '    ''place-uuid-here'','
\echo '    ''jane.doe'''
\echo '  );'
\echo ''
\echo '  -- Find nearby places to add'
\echo '  SELECT * FROM trapper.suggest_colony_clustering(''place-uuid'', 200);'
\echo ''
\echo '  -- Link a place to the colony'
\echo '  SELECT trapper.link_place_to_colony(''nearby-place-uuid'', ''colony-uuid'');'
\echo ''
