\echo '=== MIG_631: Observation Zones - Explicit Auditable Entities ==='
\echo ''
\echo 'Scientific Basis: Stratified sampling for mark-recapture surveys'
\echo 'Reference: Krebs (1999) Ecological Methodology, Chapter 5'
\echo ''

-- ============================================================================
-- OBSERVATION ZONES TABLE
-- Explicit entities for field survey planning
-- Places remain completely independent for workflow purposes
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.observation_zones (
  zone_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Zone identification
  zone_code TEXT UNIQUE NOT NULL,  -- e.g., 'SR-001', 'PET-015'
  zone_name TEXT,                   -- Optional friendly name
  service_zone TEXT,

  -- Geographic definition
  boundary_geom GEOMETRY(Polygon, 4326),  -- Explicit boundary polygon
  centroid GEOGRAPHY(Point, 4326),        -- Center point for mapping
  area_sq_km NUMERIC(10,4),

  -- Methodology documentation (auditable)
  creation_method TEXT NOT NULL CHECK (creation_method IN (
    'grid_based',           -- Systematic grid sampling
    'cluster_based',        -- DBSCAN or similar clustering
    'manual_definition',    -- Staff-defined based on local knowledge
    'colony_based',         -- Based on known colony boundaries
    'feeding_station'       -- Centered on known feeding stations
  )),
  creation_parameters JSONB,  -- Store exact parameters used
  methodology_notes TEXT,

  -- Anchor point (primary observation location)
  anchor_place_id UUID REFERENCES trapper.places(place_id),
  anchor_selection_reason TEXT,

  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'merged', 'archived')),
  merged_into_zone_id UUID REFERENCES trapper.observation_zones(zone_id),

  -- Audit trail
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT
);

COMMENT ON TABLE trapper.observation_zones IS
'Explicit observation zones for field survey planning.
Each zone is a defined sampling unit for mark-recapture surveys.
Places remain independent entities - this table creates a survey overlay.

Scientific basis: Stratified sampling design (Krebs 1999).
Zones should be ecologically meaningful units, not arbitrary grids.';

-- ============================================================================
-- PLACE-ZONE RELATIONSHIPS
-- Links places to observation zones without modifying places
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.place_observation_zone (
  place_id UUID NOT NULL REFERENCES trapper.places(place_id),
  zone_id UUID NOT NULL REFERENCES trapper.observation_zones(zone_id),

  -- Why this place is in this zone
  assignment_method TEXT NOT NULL CHECK (assignment_method IN (
    'automatic_proximity',   -- Within zone boundary
    'automatic_clustering',  -- Statistical clustering
    'manual_assignment',     -- Staff assigned
    'feeding_station_anchor' -- This is the anchor point
  )),
  distance_to_anchor_m NUMERIC(10,2),

  -- Audit
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by TEXT,

  PRIMARY KEY (place_id, zone_id)
);

COMMENT ON TABLE trapper.place_observation_zone IS
'Links places to observation zones for survey purposes.
A place can belong to multiple zones (overlapping survey designs).
Places remain fully independent for workflow - this is just survey metadata.';

CREATE INDEX IF NOT EXISTS idx_place_obs_zone_zone ON trapper.place_observation_zone(zone_id);
CREATE INDEX IF NOT EXISTS idx_place_obs_zone_place ON trapper.place_observation_zone(place_id);

-- ============================================================================
-- ZONE OBSERVATIONS TABLE
-- Records of actual field observations at zones
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.zone_observations (
  observation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id UUID NOT NULL REFERENCES trapper.observation_zones(zone_id),

  -- Observation data (for Chapman estimation)
  observation_date DATE NOT NULL,
  observation_time TIME,
  duration_minutes INT,

  -- Counts
  total_cats_observed INT NOT NULL,
  eartipped_cats_observed INT NOT NULL,
  non_eartipped_cats_observed INT GENERATED ALWAYS AS (total_cats_observed - eartipped_cats_observed) STORED,

  -- Conditions (affects detection probability)
  weather_conditions TEXT,
  observation_conditions TEXT,  -- 'feeding_time', 'random_visit', etc.
  observer_notes TEXT,

  -- Observer
  observer_person_id UUID REFERENCES trapper.sot_people(person_id),
  observer_name TEXT,

  -- Quality indicators
  confidence_level TEXT CHECK (confidence_level IN ('high', 'medium', 'low')),
  is_complete_count BOOLEAN DEFAULT false,  -- Did observer see all cats in zone?

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,

  -- Validation
  CONSTRAINT valid_eartip_count CHECK (eartipped_cats_observed <= total_cats_observed)
);

COMMENT ON TABLE trapper.zone_observations IS
'Records of field observations at observation zones.
Used for Chapman mark-recapture estimation at zone level.
Each observation provides C (total cats) and R (eartipped cats).';

CREATE INDEX IF NOT EXISTS idx_zone_obs_zone ON trapper.zone_observations(zone_id);
CREATE INDEX IF NOT EXISTS idx_zone_obs_date ON trapper.zone_observations(observation_date DESC);

-- ============================================================================
-- ZONE METHODOLOGY REFERENCE
-- Documents the scientific basis for zone creation
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.zone_methodology_reference (
  methodology_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  scientific_basis TEXT,
  parameters_schema JSONB,  -- JSON schema for creation_parameters
  references TEXT[],        -- Scientific citations
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO trapper.zone_methodology_reference (methodology_id, name, description, scientific_basis, references)
VALUES
  ('grid_based',
   'Systematic Grid Sampling',
   'Divides area into regular grid cells. Each cell is an observation zone.',
   'Systematic sampling provides unbiased coverage and is statistically tractable. Grid size should be based on expected home range of target species.',
   ARRAY['Krebs, C.J. (1999). Ecological Methodology, 2nd ed. Chapter 5.', 'Thompson, S.K. (2012). Sampling, 3rd ed. Wiley.']
  ),
  ('cluster_based',
   'Statistical Clustering',
   'Uses DBSCAN or similar algorithms to group nearby places into zones.',
   'Clustering identifies natural aggregations in the data. Useful when cat activity is spatially clustered around resources.',
   ARRAY['Ester, M. et al. (1996). A density-based algorithm for discovering clusters.', 'Miller, H.J. (2009). Tobler''s First Law and Spatial Analysis.']
  ),
  ('manual_definition',
   'Expert-Defined Zones',
   'Zones defined by staff based on local knowledge of cat populations.',
   'Local ecological knowledge complements statistical methods. Staff can identify natural boundaries (roads, waterways) and known congregation points.',
   ARRAY['Huntington, H.P. (2000). Using traditional ecological knowledge in science.']
  ),
  ('colony_based',
   'Colony-Centered Zones',
   'Zones centered on known colony locations with buffer areas.',
   'Cats in managed colonies have defined home ranges. Zone radius based on typical feral cat home range (200-500m in urban areas).',
   ARRAY['Liberg, O. et al. (2000). Density, spatial organisation and reproductive tactics in the domestic cat.', 'Horn, J.A. et al. (2011). Home range, habitat use, and activity patterns of free-roaming domestic cats.']
  ),
  ('feeding_station',
   'Feeding Station Zones',
   'Zones centered on known feeding stations where cats congregate.',
   'Feeding stations create artificial congregation points. Observation at feeding time maximizes detection probability.',
   ARRAY['Natoli, E. et al. (1999). Temporal and spatial analysis of the cat population in Rome.']
  )
ON CONFLICT (methodology_id) DO NOTHING;

\echo 'Created methodology reference table'

-- ============================================================================
-- VIEW: Zone Summary with Observation Statistics
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_observation_zone_summary AS
WITH zone_places AS (
  SELECT
    oz.zone_id,
    COUNT(DISTINCT poz.place_id) as places_in_zone,
    SUM(cc.cat_count) as total_cats_linked
  FROM trapper.observation_zones oz
  LEFT JOIN trapper.place_observation_zone poz ON poz.zone_id = oz.zone_id
  LEFT JOIN (
    SELECT place_id, COUNT(DISTINCT cat_id) as cat_count
    FROM trapper.cat_place_relationships
    GROUP BY place_id
  ) cc ON cc.place_id = poz.place_id
  GROUP BY oz.zone_id
),
zone_obs AS (
  SELECT
    zone_id,
    COUNT(*) as observation_count,
    MAX(observation_date) as last_observation,
    AVG(total_cats_observed) as avg_cats_observed,
    AVG(eartipped_cats_observed) as avg_eartipped
  FROM trapper.zone_observations
  GROUP BY zone_id
),
verified_alterations AS (
  -- M value for Chapman: verified altered cats in zone
  SELECT
    poz.zone_id,
    COUNT(DISTINCT cpr.cat_id) as verified_altered
  FROM trapper.place_observation_zone poz
  JOIN trapper.cat_place_relationships cpr ON cpr.place_id = poz.place_id
  JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
  WHERE c.altered_status = 'altered'
  GROUP BY poz.zone_id
)
SELECT
  oz.zone_id,
  oz.zone_code,
  oz.zone_name,
  oz.service_zone,
  oz.creation_method,
  oz.status,

  -- Place/cat data
  COALESCE(zp.places_in_zone, 0) as places_in_zone,
  COALESCE(zp.total_cats_linked, 0) as total_cats_linked,
  COALESCE(va.verified_altered, 0) as verified_altered_m,

  -- Observation data
  COALESCE(zo.observation_count, 0) as observation_count,
  zo.last_observation,
  zo.avg_cats_observed,
  zo.avg_eartipped,

  -- Chapman estimate if we have observations
  CASE
    WHEN zo.observation_count > 0 AND va.verified_altered > 0 AND zo.avg_eartipped > 0
    THEN ROUND(
      (((va.verified_altered + 1) * (zo.avg_cats_observed + 1)) / (zo.avg_eartipped + 1)) - 1
    )
    ELSE NULL
  END as chapman_estimate,

  -- Observation need
  CASE
    WHEN zo.observation_count = 0 AND COALESCE(zp.total_cats_linked, 0) >= 10 THEN 'critical'
    WHEN zo.observation_count = 0 AND COALESCE(zp.total_cats_linked, 0) >= 5 THEN 'high'
    WHEN zo.observation_count = 0 THEN 'medium'
    WHEN zo.last_observation < CURRENT_DATE - INTERVAL '6 months' THEN 'refresh'
    ELSE 'current'
  END as observation_status,

  -- Anchor point
  oz.anchor_place_id,
  p.formatted_address as anchor_address

FROM trapper.observation_zones oz
LEFT JOIN zone_places zp ON zp.zone_id = oz.zone_id
LEFT JOIN zone_obs zo ON zo.zone_id = oz.zone_id
LEFT JOIN verified_alterations va ON va.zone_id = oz.zone_id
LEFT JOIN trapper.places p ON p.place_id = oz.anchor_place_id
WHERE oz.status = 'active';

COMMENT ON VIEW trapper.v_observation_zone_summary IS
'Summary of observation zones with Chapman estimates where available.
Shows observation status and identifies zones needing field visits.';

\echo 'Created zone summary view'

-- ============================================================================
-- FUNCTION: Create zones using grid-based method
-- Auditable, repeatable zone creation
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.create_grid_observation_zones(
  p_service_zone TEXT,
  p_grid_size_degrees NUMERIC DEFAULT 0.008,  -- ~0.5 miles
  p_min_cats INT DEFAULT 3,
  p_created_by TEXT DEFAULT 'system'
)
RETURNS TABLE (
  zone_id UUID,
  zone_code TEXT,
  places_assigned INT,
  total_cats INT
)
LANGUAGE plpgsql AS $$
DECLARE
  v_zone_counter INT := 1;
  v_zone_prefix TEXT;
  v_record RECORD;
BEGIN
  -- Generate zone prefix from service zone name
  v_zone_prefix := UPPER(LEFT(REPLACE(p_service_zone, ' ', ''), 3));

  -- Create zones from grid cells that have sufficient cat activity
  FOR v_record IN
    WITH place_data AS (
      SELECT
        p.place_id,
        p.location,
        COUNT(DISTINCT cpr.cat_id) as cat_count,
        FLOOR(ST_X(p.location::geometry) / p_grid_size_degrees)::int as grid_x,
        FLOOR(ST_Y(p.location::geometry) / p_grid_size_degrees)::int as grid_y
      FROM trapper.places p
      JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
      WHERE p.merged_into_place_id IS NULL
        AND p.location IS NOT NULL
        AND p.service_zone = p_service_zone
      GROUP BY p.place_id
    ),
    grid_cells AS (
      SELECT
        grid_x,
        grid_y,
        ARRAY_AGG(place_id ORDER BY cat_count DESC) as place_ids,
        SUM(cat_count) as total_cats,
        -- Best anchor: most cats
        (ARRAY_AGG(place_id ORDER BY cat_count DESC))[1] as anchor_place_id,
        -- Grid boundary as polygon
        ST_MakeEnvelope(
          grid_x * p_grid_size_degrees,
          grid_y * p_grid_size_degrees,
          (grid_x + 1) * p_grid_size_degrees,
          (grid_y + 1) * p_grid_size_degrees,
          4326
        ) as boundary
      FROM place_data
      GROUP BY grid_x, grid_y
      HAVING SUM(cat_count) >= p_min_cats
    )
    SELECT * FROM grid_cells
    ORDER BY total_cats DESC
  LOOP
    -- Create the zone
    INSERT INTO trapper.observation_zones (
      zone_code,
      service_zone,
      boundary_geom,
      centroid,
      area_sq_km,
      creation_method,
      creation_parameters,
      anchor_place_id,
      anchor_selection_reason,
      created_by
    ) VALUES (
      v_zone_prefix || '-' || LPAD(v_zone_counter::text, 3, '0'),
      p_service_zone,
      v_record.boundary,
      ST_Centroid(v_record.boundary)::geography,
      ST_Area(v_record.boundary::geography) / 1000000,
      'grid_based',
      jsonb_build_object(
        'grid_size_degrees', p_grid_size_degrees,
        'grid_x', v_record.grid_x,
        'grid_y', v_record.grid_y,
        'min_cats', p_min_cats
      ),
      v_record.anchor_place_id,
      'Highest cat count in grid cell',
      p_created_by
    )
    RETURNING observation_zones.zone_id, observation_zones.zone_code
    INTO zone_id, zone_code;

    -- Assign places to zone
    INSERT INTO trapper.place_observation_zone (place_id, zone_id, assignment_method, assigned_by)
    SELECT
      unnest(v_record.place_ids),
      zone_id,
      'automatic_proximity',
      p_created_by;

    -- Update anchor assignment
    UPDATE trapper.place_observation_zone
    SET assignment_method = 'feeding_station_anchor'
    WHERE place_observation_zone.zone_id = create_grid_observation_zones.zone_id
      AND place_observation_zone.place_id = v_record.anchor_place_id;

    places_assigned := array_length(v_record.place_ids, 1);
    total_cats := v_record.total_cats;

    v_zone_counter := v_zone_counter + 1;

    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION trapper.create_grid_observation_zones IS
'Creates observation zones using systematic grid sampling.
Parameters are stored for auditability and reproducibility.
Returns summary of zones created.

Example:
  SELECT * FROM trapper.create_grid_observation_zones(''Santa Rosa'', 0.008, 3, ''ben'');
';

\echo 'Created grid zone creation function'

-- ============================================================================
-- FUNCTION: Generate observation route
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.generate_observation_route(
  p_service_zone TEXT,
  p_max_stops INT DEFAULT 10,
  p_priority TEXT DEFAULT 'high'  -- 'critical', 'high', 'all'
)
RETURNS TABLE (
  stop_number INT,
  zone_code TEXT,
  anchor_address TEXT,
  cats_in_zone BIGINT,
  verified_altered BIGINT,
  observation_status TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION
)
LANGUAGE sql STABLE AS $$
  SELECT
    ROW_NUMBER() OVER (ORDER BY
      CASE observation_status
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        ELSE 4
      END,
      total_cats_linked DESC
    )::int as stop_number,
    v.zone_code,
    v.anchor_address,
    v.total_cats_linked as cats_in_zone,
    v.verified_altered_m as verified_altered,
    v.observation_status,
    ST_Y(oz.centroid::geometry) as latitude,
    ST_X(oz.centroid::geometry) as longitude
  FROM trapper.v_observation_zone_summary v
  JOIN trapper.observation_zones oz ON oz.zone_id = v.zone_id
  WHERE v.service_zone = p_service_zone
    AND (
      p_priority = 'all'
      OR (p_priority = 'critical' AND v.observation_status = 'critical')
      OR (p_priority = 'high' AND v.observation_status IN ('critical', 'high'))
    )
  ORDER BY
    CASE v.observation_status
      WHEN 'critical' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      ELSE 4
    END,
    v.total_cats_linked DESC
  LIMIT p_max_stops;
$$;

COMMENT ON FUNCTION trapper.generate_observation_route IS
'Generates an observation route for field volunteers.
Each stop is an observation zone anchor point.
Prioritizes zones with most cats and no observations.';

\echo ''
\echo '=== MIG_631 Complete ==='
\echo ''
\echo 'Key tables created:'
\echo '  - observation_zones: Explicit zone entities (auditable)'
\echo '  - place_observation_zone: Links places to zones'
\echo '  - zone_observations: Field observation records'
\echo '  - zone_methodology_reference: Scientific documentation'
\echo ''
\echo 'Usage:'
\echo '  -- Create zones for Santa Rosa using 0.5-mile grid:'
\echo '  SELECT * FROM trapper.create_grid_observation_zones(''Santa Rosa'');'
\echo ''
\echo '  -- Generate route for field volunteer:'
\echo '  SELECT * FROM trapper.generate_observation_route(''Santa Rosa'', 10, ''high'');'
\echo ''
