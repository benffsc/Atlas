-- MIG_3137: Beacon-facing city impact rollup views
--
-- Thin wrappers over the ops.v_economic_impact_by_city and
-- ops.city_impact_timeseries() functions (MIG_3136) to provide
-- Beacon-friendly views used by /api/beacon/impact/* routes.
--
-- Depends: MIG_3136 (impact functions), MIG_3133 (city_boundaries)

-- ============================================================================
-- 1. City impact rollup — moderate tier only, for ranking/dashboard
-- ============================================================================

CREATE OR REPLACE VIEW beacon.v_city_impact_rollup AS
SELECT
  city_name,
  cats_altered,
  female_count,
  male_count,
  places_served,
  kittens_prevented,
  shelter_cost,
  animal_control_cost,
  property_damage_cost,
  disease_cost,
  placement_cost,
  indirect_cost,
  total_cost,
  -- Rank by total impact
  ROW_NUMBER() OVER (ORDER BY total_cost DESC) AS impact_rank
FROM ops.v_economic_impact_by_city
WHERE tier = 'moderate';

COMMENT ON VIEW beacon.v_city_impact_rollup IS
  'Per-city economic impact rollup (moderate tier). Used by Beacon city impact dashboard. '
  'Ranked by total_cost descending.';

-- ============================================================================
-- 2. City impact with all 3 tiers — for confidence toggle
-- ============================================================================

CREATE OR REPLACE VIEW beacon.v_city_impact_all_tiers AS
SELECT
  city_name,
  cats_altered,
  female_count,
  male_count,
  places_served,
  tier,
  kittens_prevented,
  shelter_cost,
  animal_control_cost,
  property_damage_cost,
  disease_cost,
  placement_cost,
  indirect_cost,
  total_cost
FROM ops.v_economic_impact_by_city
ORDER BY cats_altered DESC, tier;

COMMENT ON VIEW beacon.v_city_impact_all_tiers IS
  'Per-city economic impact with all 3 confidence tiers. Used for confidence toggle UI.';

-- ============================================================================
-- Verify
-- ============================================================================
-- SELECT * FROM beacon.v_city_impact_rollup;
-- SELECT * FROM beacon.v_city_impact_all_tiers WHERE city_name = 'Petaluma';
-- SELECT * FROM ops.city_impact_timeseries('Petaluma');
