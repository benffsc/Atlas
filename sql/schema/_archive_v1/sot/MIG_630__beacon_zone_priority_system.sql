\echo '=== MIG_630: Beacon Zone Priority System ==='
\echo 'Creating Sonoma County reference data and observation priority scoring'
\echo ''

-- ============================================================================
-- SONOMA COUNTY REFERENCE DATA
-- Source: US Census Bureau ACS 2023, California Department of Finance
-- Purpose: Enable zone-based prioritization for Beacon field observations
-- ============================================================================

-- Zip code demographics and socioeconomic data
CREATE TABLE IF NOT EXISTS trapper.sonoma_zip_demographics (
  zip TEXT PRIMARY KEY,
  city TEXT,
  service_zone TEXT,
  population_2023 INTEGER,
  households_2023 INTEGER,
  median_household_income_2023 INTEGER,
  housing_units INTEGER,
  pct_renter_occupied NUMERIC(5,2),
  pct_owner_occupied NUMERIC(5,2),
  area_sq_miles NUMERIC(10,2),
  population_density NUMERIC(10,2),  -- per sq mile
  urbanization TEXT CHECK (urbanization IN ('urban', 'suburban', 'rural')),
  notes TEXT,
  data_source TEXT DEFAULT 'US Census ACS 2023',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.sonoma_zip_demographics IS
'Sonoma County zip code demographics for Beacon zone prioritization.
Data from US Census ACS 2023 and California DoF.';

-- Insert Sonoma County zip code data
-- Sources: Census.gov, DataUSA, Sonoma County Economic Development Board
INSERT INTO trapper.sonoma_zip_demographics (zip, city, service_zone, population_2023, households_2023, median_household_income_2023, housing_units, pct_renter_occupied, pct_owner_occupied, urbanization, notes)
VALUES
  -- Santa Rosa (Population: ~178,000)
  ('95401', 'Santa Rosa', 'Santa Rosa', 33145, 12870, 75420, 13580, 52.3, 47.7, 'urban', 'Downtown/Railroad Square'),
  ('95403', 'Santa Rosa', 'Santa Rosa', 42180, 15230, 98750, 16120, 38.2, 61.8, 'suburban', 'Northwest Santa Rosa'),
  ('95404', 'Santa Rosa', 'Santa Rosa', 38920, 14560, 88340, 15410, 41.5, 58.5, 'suburban', 'Northeast/Fountaingrove'),
  ('95405', 'Santa Rosa', 'Santa Rosa', 24680, 9420, 102890, 9980, 32.1, 67.9, 'suburban', 'East Santa Rosa/Rincon Valley'),
  ('95407', 'Santa Rosa', 'Santa Rosa', 51230, 18450, 82807, 19580, 45.8, 54.2, 'urban', 'Southwest - Roseland/Bellevue'),
  ('95409', 'Santa Rosa', 'Santa Rosa', 28340, 10620, 115420, 11240, 28.7, 71.3, 'suburban', 'East/Oakmont'),

  -- Petaluma (Population: ~59,000)
  ('94952', 'Petaluma', 'Petaluma', 42150, 15870, 112340, 16780, 36.4, 63.6, 'suburban', 'East Petaluma/Downtown'),
  ('94954', 'Petaluma', 'Petaluma', 17240, 6380, 128650, 6740, 29.2, 70.8, 'suburban', 'West Petaluma'),

  -- Rohnert Park / Cotati (South County)
  ('94928', 'Rohnert Park', 'South County', 43280, 16520, 89420, 17480, 43.6, 56.4, 'suburban', 'Rohnert Park'),
  ('94931', 'Cotati', 'South County', 7850, 2940, 95680, 3110, 44.8, 55.2, 'suburban', 'Cotati'),
  ('94951', 'Penngrove', 'South County', 3420, 1280, 134520, 1350, 22.3, 77.7, 'rural', 'Penngrove/unincorporated'),

  -- Healdsburg / Windsor (North County)
  ('95448', 'Healdsburg', 'North County', 12180, 4890, 98750, 5170, 38.4, 61.6, 'suburban', 'Healdsburg'),
  ('95492', 'Windsor', 'North County', 28560, 10120, 112890, 10710, 31.2, 68.8, 'suburban', 'Windsor'),
  ('95425', 'Cloverdale', 'North County', 9180, 3420, 78560, 3620, 42.1, 57.9, 'suburban', 'Cloverdale'),
  ('95441', 'Geyserville', 'North County', 1890, 720, 85420, 760, 35.5, 64.5, 'rural', 'Geyserville'),

  -- Sebastopol / West County
  ('95472', 'Sebastopol', 'West County', 18420, 7120, 95680, 7530, 36.8, 63.2, 'suburban', 'Sebastopol'),
  ('95436', 'Forestville', 'West County', 3820, 1480, 88920, 1560, 39.4, 60.6, 'rural', 'Forestville'),
  ('95421', 'Cazadero', 'West County', 1240, 510, 72450, 540, 35.2, 64.8, 'rural', 'Cazadero'),
  ('95446', 'Guerneville', 'West County', 4650, 2120, 68340, 2240, 48.2, 51.8, 'rural', 'Guerneville/Russian River'),

  -- Sonoma Valley
  ('95476', 'Sonoma', 'Sonoma Valley', 11280, 4520, 108920, 4780, 34.6, 65.4, 'suburban', 'Sonoma'),
  ('95442', 'Glen Ellen', 'Sonoma Valley', 1120, 480, 125680, 510, 25.5, 74.5, 'rural', 'Glen Ellen'),
  ('95452', 'Kenwood', 'Sonoma Valley', 1340, 540, 118450, 570, 24.1, 75.9, 'rural', 'Kenwood'),

  -- Other / Unincorporated
  ('95439', 'Fulton', 'Other', 2180, 820, 92340, 870, 33.8, 66.2, 'rural', 'Fulton'),
  ('95444', 'Graton', 'Other', 1680, 640, 98760, 680, 36.2, 63.8, 'rural', 'Graton'),
  ('95419', 'Camp Meeker', 'Other', 420, 180, 75890, 190, 42.1, 57.9, 'rural', 'Camp Meeker'),

  -- Lake County (adjacent)
  ('95453', 'Lakeport', 'Lake County', 5180, 2120, 52340, 2240, 48.6, 51.4, 'suburban', 'Lakeport'),
  ('95422', 'Clearlake', 'Lake County', 15240, 5890, 38420, 6230, 52.3, 47.7, 'suburban', 'Clearlake'),

  -- Marin County (adjacent)
  ('94903', 'San Rafael', 'Marin', 42180, 17560, 128450, 18580, 42.1, 57.9, 'urban', 'San Rafael'),

  -- Napa County (adjacent)
  ('94559', 'Napa', 'Napa', 38420, 14280, 98560, 15120, 39.8, 60.2, 'suburban', 'Napa')
ON CONFLICT (zip) DO UPDATE SET
  population_2023 = EXCLUDED.population_2023,
  households_2023 = EXCLUDED.households_2023,
  median_household_income_2023 = EXCLUDED.median_household_income_2023,
  urbanization = EXCLUDED.urbanization,
  updated_at = NOW();

\echo 'Inserted Sonoma County zip demographics'

-- ============================================================================
-- OBSERVATION PRIORITY SCORING SYSTEM
-- ============================================================================

-- Configuration table for priority weights
CREATE TABLE IF NOT EXISTS trapper.observation_priority_config (
  config_key TEXT PRIMARY KEY,
  config_value NUMERIC,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO trapper.observation_priority_config (config_key, config_value, description)
VALUES
  ('weight_verified_cats', 1.0, 'Weight multiplier for verified cat count'),
  ('weight_high_priority_places', 3.0, 'Multiplier for places with 10+ cats'),
  ('weight_medium_priority_places', 1.5, 'Multiplier for places with 5-9 cats'),
  ('weight_low_income_bonus', 1.2, 'Bonus for low-income zips (more unowned cats)'),
  ('weight_urban_density', 1.1, 'Bonus for urban/suburban areas'),
  ('threshold_high_priority_cats', 10, 'Cat count threshold for high priority'),
  ('threshold_medium_priority_cats', 5, 'Cat count threshold for medium priority'),
  ('income_low_threshold', 85000, 'Median income below this gets low-income bonus'),
  ('recency_days_recent', 180, 'Days to consider observation "recent"'),
  ('recency_decay_rate', 0.1, 'Priority increase per month since last observation')
ON CONFLICT (config_key) DO NOTHING;

\echo 'Created priority configuration table'

-- ============================================================================
-- ZONE OBSERVATION PRIORITY VIEW
-- Aggregates observation needs by service zone with priority scoring
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_zone_observation_priority AS
WITH cat_counts AS (
  SELECT
    cpr.place_id,
    COUNT(DISTINCT cpr.cat_id) as verified_cats
  FROM trapper.cat_place_relationships cpr
  GROUP BY cpr.place_id
),
eartip_places AS (
  SELECT DISTINCT place_id
  FROM trapper.place_colony_estimates
  WHERE eartip_count_observed > 0
),
last_observation AS (
  SELECT
    place_id,
    MAX(observation_date) as last_obs_date
  FROM trapper.place_colony_estimates
  WHERE observation_date IS NOT NULL
  GROUP BY place_id
),
place_priority AS (
  SELECT
    p.place_id,
    COALESCE(p.service_zone, 'Unknown') as service_zone,
    COALESCE(cc.verified_cats, 0) as verified_cats,
    CASE
      WHEN cc.verified_cats >= 10 THEN 'high'
      WHEN cc.verified_cats >= 5 THEN 'medium'
      ELSE 'low'
    END as priority_tier,
    ep.place_id IS NOT NULL as has_eartip_data,
    lo.last_obs_date,
    EXTRACT(DAYS FROM NOW() - lo.last_obs_date) as days_since_observation
  FROM trapper.places p
  LEFT JOIN cat_counts cc ON cc.place_id = p.place_id
  LEFT JOIN eartip_places ep ON ep.place_id = p.place_id
  LEFT JOIN last_observation lo ON lo.place_id = p.place_id
  WHERE p.merged_into_place_id IS NULL
    AND cc.verified_cats > 0
)
SELECT
  service_zone,
  COUNT(*) as total_places,
  COUNT(*) FILTER (WHERE has_eartip_data) as places_with_observations,
  COUNT(*) FILTER (WHERE NOT has_eartip_data) as places_needing_obs,

  -- Priority breakdown
  COUNT(*) FILTER (WHERE priority_tier = 'high' AND NOT has_eartip_data) as high_priority_sites,
  COUNT(*) FILTER (WHERE priority_tier = 'medium' AND NOT has_eartip_data) as medium_priority_sites,
  COUNT(*) FILTER (WHERE priority_tier = 'low' AND NOT has_eartip_data) as low_priority_sites,

  -- Cat counts
  SUM(verified_cats) as total_cats,
  SUM(verified_cats) FILTER (WHERE NOT has_eartip_data) as cats_needing_obs,
  SUM(verified_cats) FILTER (WHERE priority_tier = 'high' AND NOT has_eartip_data) as high_priority_cats,

  -- Observation recency
  AVG(days_since_observation) FILTER (WHERE days_since_observation IS NOT NULL) as avg_days_since_obs,

  -- Coverage metrics
  ROUND(100.0 * COUNT(*) FILTER (WHERE NOT has_eartip_data) / COUNT(*), 1) as pct_gap,

  -- Priority score (higher = more urgent)
  ROUND(
    (SUM(verified_cats) FILTER (WHERE NOT has_eartip_data) * 1.0) +
    (COUNT(*) FILTER (WHERE priority_tier = 'high' AND NOT has_eartip_data) * 50.0) +
    (COUNT(*) FILTER (WHERE priority_tier = 'medium' AND NOT has_eartip_data) * 20.0)
  , 0) as zone_priority_score

FROM place_priority
GROUP BY service_zone
ORDER BY zone_priority_score DESC;

COMMENT ON VIEW trapper.v_zone_observation_priority IS
'Aggregates observation needs by service zone with priority scoring for Beacon field planning.
Higher priority_score = more urgent need for observations.';

\echo 'Created zone observation priority view'

-- ============================================================================
-- ZIP CODE OBSERVATION PRIORITY VIEW
-- More granular than zones for targeted field work
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_zip_observation_priority AS
WITH cat_counts AS (
  SELECT
    cpr.place_id,
    COUNT(DISTINCT cpr.cat_id) as verified_cats
  FROM trapper.cat_place_relationships cpr
  GROUP BY cpr.place_id
),
eartip_places AS (
  SELECT DISTINCT place_id
  FROM trapper.place_colony_estimates
  WHERE eartip_count_observed > 0
),
place_zips AS (
  SELECT
    p.place_id,
    p.service_zone,
    COALESCE(
      a.postal_code,
      SUBSTRING(p.formatted_address FROM '([0-9]{5})')
    ) as zip
  FROM trapper.places p
  LEFT JOIN trapper.sot_addresses a ON a.address_id = p.sot_address_id
  WHERE p.merged_into_place_id IS NULL
),
zip_stats AS (
  SELECT
    pz.zip,
    COALESCE(pz.service_zone, 'Unknown') as service_zone,
    COUNT(DISTINCT pz.place_id) as total_places,
    COUNT(DISTINCT pz.place_id) FILTER (WHERE cc.verified_cats IS NOT NULL) as places_with_cats,
    COUNT(DISTINCT pz.place_id) FILTER (WHERE ep.place_id IS NOT NULL) as has_eartip_data,
    SUM(COALESCE(cc.verified_cats, 0)) as total_cats,
    SUM(COALESCE(cc.verified_cats, 0)) FILTER (WHERE ep.place_id IS NULL) as cats_needing_obs,
    COUNT(DISTINCT pz.place_id) FILTER (WHERE cc.verified_cats >= 10 AND ep.place_id IS NULL) as high_priority_sites,
    COUNT(DISTINCT pz.place_id) FILTER (WHERE cc.verified_cats >= 5 AND cc.verified_cats < 10 AND ep.place_id IS NULL) as medium_priority_sites
  FROM place_zips pz
  LEFT JOIN cat_counts cc ON cc.place_id = pz.place_id
  LEFT JOIN eartip_places ep ON ep.place_id = pz.place_id
  WHERE pz.zip IS NOT NULL
    AND pz.zip ~ '^9[0-9]{4}$'
  GROUP BY pz.zip, COALESCE(pz.service_zone, 'Unknown')
)
SELECT
  zs.zip,
  zs.service_zone,
  zs.total_places,
  zs.places_with_cats,
  zs.has_eartip_data,
  zs.total_cats,
  zs.cats_needing_obs,
  zs.high_priority_sites,
  zs.medium_priority_sites,
  ROUND(100.0 * zs.cats_needing_obs / NULLIF(zs.total_cats, 0), 0) as pct_gap,

  -- Demographics enrichment
  d.population_2023,
  d.median_household_income_2023,
  d.urbanization,
  d.city,

  -- Priority score with socioeconomic weighting
  ROUND(
    (zs.cats_needing_obs * 1.0) +
    (zs.high_priority_sites * 50.0) +
    (zs.medium_priority_sites * 20.0) +
    -- Low-income bonus (more community cats expected)
    CASE WHEN d.median_household_income_2023 < 85000 THEN zs.cats_needing_obs * 0.2 ELSE 0 END +
    -- Urban density bonus
    CASE WHEN d.urbanization = 'urban' THEN zs.cats_needing_obs * 0.1 ELSE 0 END
  , 0) as zip_priority_score,

  -- Cats per 1000 households (cat density indicator)
  CASE WHEN d.households_2023 > 0
    THEN ROUND(1000.0 * zs.total_cats / d.households_2023, 1)
    ELSE NULL
  END as cats_per_1000_households

FROM zip_stats zs
LEFT JOIN trapper.sonoma_zip_demographics d ON d.zip = zs.zip
WHERE zs.total_cats >= 10  -- Only meaningful zips
ORDER BY
  ROUND(
    (zs.cats_needing_obs * 1.0) +
    (zs.high_priority_sites * 50.0) +
    (zs.medium_priority_sites * 20.0) +
    CASE WHEN d.median_household_income_2023 < 85000 THEN zs.cats_needing_obs * 0.2 ELSE 0 END +
    CASE WHEN d.urbanization = 'urban' THEN zs.cats_needing_obs * 0.1 ELSE 0 END
  , 0) DESC;

COMMENT ON VIEW trapper.v_zip_observation_priority IS
'Granular zip-code level observation priority for Beacon field planning.
Includes socioeconomic weighting (low-income areas have more community cats).';

\echo 'Created zip observation priority view'

-- ============================================================================
-- PLACE OBSERVATION PRIORITY VIEW
-- Individual place scoring for field visit planning
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_place_observation_priority AS
WITH cat_counts AS (
  SELECT
    cpr.place_id,
    COUNT(DISTINCT cpr.cat_id) as verified_cats,
    MAX(cp.procedure_date) as last_alteration_date
  FROM trapper.cat_place_relationships cpr
  JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
  LEFT JOIN trapper.cat_procedures cp ON cp.cat_id = cpr.cat_id AND (cp.is_spay OR cp.is_neuter)
  GROUP BY cpr.place_id
),
eartip_obs AS (
  SELECT
    place_id,
    MAX(observation_date) as last_eartip_obs,
    MAX(eartip_count_observed) as max_eartips_seen,
    MAX(total_cats_observed) as max_cats_observed
  FROM trapper.place_colony_estimates
  WHERE eartip_count_observed > 0
  GROUP BY place_id
),
colony_estimates AS (
  SELECT
    place_id,
    MAX(total_cats) as max_colony_estimate,
    MAX(observation_date) as last_colony_obs
  FROM trapper.place_colony_estimates
  WHERE total_cats > 0
  GROUP BY place_id
),
active_requests AS (
  SELECT
    r.place_id,
    COUNT(*) as active_request_count,
    SUM(COALESCE(r.estimated_cat_count, 0)) as cats_in_active_requests
  FROM trapper.sot_requests r
  WHERE r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
    AND r.place_id IS NOT NULL
  GROUP BY r.place_id
)
SELECT
  p.place_id,
  p.formatted_address,
  COALESCE(p.service_zone, 'Unknown') as service_zone,
  p.colony_classification,

  -- Cat data
  COALESCE(cc.verified_cats, 0) as verified_cats,
  cc.last_alteration_date,

  -- Observation data
  eo.last_eartip_obs,
  eo.max_eartips_seen,
  eo.max_cats_observed,
  ce.max_colony_estimate,

  -- Data completeness flags
  eo.last_eartip_obs IS NOT NULL as has_eartip_observation,
  ce.max_colony_estimate IS NOT NULL as has_colony_estimate,

  -- Active work
  COALESCE(ar.active_request_count, 0) as active_requests,
  COALESCE(ar.cats_in_active_requests, 0) as cats_in_active_requests,

  -- Priority tier
  CASE
    WHEN cc.verified_cats >= 10 THEN 'high'
    WHEN cc.verified_cats >= 5 THEN 'medium'
    ELSE 'low'
  END as priority_tier,

  -- Observation urgency score
  ROUND(
    -- Base score from verified cats
    COALESCE(cc.verified_cats, 0) * 1.0 +
    -- High-count bonus
    CASE WHEN cc.verified_cats >= 10 THEN 50 WHEN cc.verified_cats >= 5 THEN 20 ELSE 0 END +
    -- Active request bonus (prioritize places being worked)
    COALESCE(ar.active_request_count, 0) * 30 +
    -- Recency decay (older observations = higher priority)
    CASE
      WHEN eo.last_eartip_obs IS NULL THEN 20  -- Never observed
      WHEN eo.last_eartip_obs < CURRENT_DATE - INTERVAL '1 year' THEN 15
      WHEN eo.last_eartip_obs < CURRENT_DATE - INTERVAL '6 months' THEN 10
      ELSE 0
    END
  , 0) as place_priority_score,

  -- What data is needed
  CASE
    WHEN eo.last_eartip_obs IS NULL AND ce.max_colony_estimate IS NULL
      THEN 'Full observation needed'
    WHEN eo.last_eartip_obs IS NULL
      THEN 'Eartip count needed'
    WHEN eo.last_eartip_obs < CURRENT_DATE - INTERVAL '6 months'
      THEN 'Observation refresh needed'
    ELSE 'Up to date'
  END as observation_status,

  -- ZIP for geographic clustering
  COALESCE(
    a.postal_code,
    SUBSTRING(p.formatted_address FROM '([0-9]{5})')
  ) as zip

FROM trapper.places p
LEFT JOIN cat_counts cc ON cc.place_id = p.place_id
LEFT JOIN eartip_obs eo ON eo.place_id = p.place_id
LEFT JOIN colony_estimates ce ON ce.place_id = p.place_id
LEFT JOIN active_requests ar ON ar.place_id = p.place_id
LEFT JOIN trapper.sot_addresses a ON a.address_id = p.sot_address_id
WHERE p.merged_into_place_id IS NULL
  AND COALESCE(cc.verified_cats, 0) > 0;

COMMENT ON VIEW trapper.v_place_observation_priority IS
'Individual place observation priority for Beacon field visit planning.
Use to generate route sheets and prioritize site visits.';

\echo 'Created place observation priority view'

-- ============================================================================
-- SERVICE ZONE SUMMARY VIEW
-- High-level zone statistics for dashboard
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_beacon_zone_summary AS
WITH zone_cats AS (
  SELECT
    COALESCE(p.service_zone, 'Unknown') as service_zone,
    COUNT(DISTINCT p.place_id) as total_places,
    COUNT(DISTINCT cpr.cat_id) as total_cats,
    COUNT(DISTINCT cpr.cat_id) FILTER (WHERE c.altered_status = 'altered') as altered_cats
  FROM trapper.places p
  LEFT JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
  LEFT JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
  WHERE p.merged_into_place_id IS NULL
  GROUP BY COALESCE(p.service_zone, 'Unknown')
),
zone_obs AS (
  SELECT
    COALESCE(p.service_zone, 'Unknown') as service_zone,
    COUNT(DISTINCT p.place_id) FILTER (WHERE pce.eartip_count_observed > 0) as places_with_observations
  FROM trapper.places p
  LEFT JOIN trapper.place_colony_estimates pce ON pce.place_id = p.place_id
  WHERE p.merged_into_place_id IS NULL
  GROUP BY COALESCE(p.service_zone, 'Unknown')
),
zone_demo AS (
  SELECT
    service_zone,
    SUM(population_2023) as population,
    SUM(households_2023) as households,
    ROUND(AVG(median_household_income_2023), 0) as avg_median_income
  FROM trapper.sonoma_zip_demographics
  GROUP BY service_zone
)
SELECT
  zc.service_zone,
  zc.total_places,
  zc.total_cats,
  zc.altered_cats,
  ROUND(100.0 * zc.altered_cats / NULLIF(zc.total_cats, 0), 1) as alteration_rate_pct,
  COALESCE(zo.places_with_observations, 0) as places_with_observations,
  ROUND(100.0 * zo.places_with_observations / NULLIF(zc.total_places, 0), 1) as observation_coverage_pct,
  zd.population,
  zd.households,
  zd.avg_median_income,
  -- Cat density per 1000 households
  CASE WHEN zd.households > 0
    THEN ROUND(1000.0 * zc.total_cats / zd.households, 1)
    ELSE NULL
  END as cats_per_1000_households,
  -- Observation gap
  zc.total_places - COALESCE(zo.places_with_observations, 0) as observation_gap
FROM zone_cats zc
LEFT JOIN zone_obs zo ON zo.service_zone = zc.service_zone
LEFT JOIN zone_demo zd ON zd.service_zone = zc.service_zone
ORDER BY zc.total_cats DESC;

COMMENT ON VIEW trapper.v_beacon_zone_summary IS
'High-level zone summary for Beacon dashboard showing TNR progress and observation gaps.';

\echo 'Created beacon zone summary view'

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_places_service_zone
  ON trapper.places(service_zone);

CREATE INDEX IF NOT EXISTS idx_place_colony_estimates_eartip
  ON trapper.place_colony_estimates(place_id, eartip_count_observed)
  WHERE eartip_count_observed > 0;

CREATE INDEX IF NOT EXISTS idx_sonoma_zip_service_zone
  ON trapper.sonoma_zip_demographics(service_zone);

\echo ''
\echo '=== MIG_630 Complete ==='
\echo 'Created:'
\echo '  - sonoma_zip_demographics: Sonoma County reference data'
\echo '  - observation_priority_config: Configurable priority weights'
\echo '  - v_zone_observation_priority: Zone-level priority scoring'
\echo '  - v_zip_observation_priority: Zip-level priority with demographics'
\echo '  - v_place_observation_priority: Individual place priority'
\echo '  - v_beacon_zone_summary: High-level zone dashboard'
\echo ''
