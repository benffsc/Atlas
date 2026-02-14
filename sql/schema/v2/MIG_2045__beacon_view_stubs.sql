-- MIG_2045: Create stub beacon views to prevent API errors
-- Date: 2026-02-13
-- Issue: Beacon routes query ops.v_beacon_* views that don't exist
-- Note: These are STUBS - they return empty/placeholder data.
--       Full implementation requires porting V1 beacon logic.

-- =========================================================================
-- ops.v_beacon_summary - Overview statistics for beacon dashboard
-- =========================================================================
CREATE OR REPLACE VIEW ops.v_beacon_summary AS
SELECT
  (SELECT COUNT(*) FROM sot.places WHERE merged_into_place_id IS NULL)::int AS total_places,
  (SELECT COUNT(*) FROM sot.places WHERE location IS NOT NULL AND merged_into_place_id IS NULL)::int AS geocoded_places,
  (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL)::int AS total_cats,
  (SELECT COUNT(*) FROM sot.cats WHERE altered_status = 'altered' AND merged_into_cat_id IS NULL)::int AS altered_cats,
  (SELECT COUNT(*) FROM ops.appointments)::int AS total_appointments,
  (SELECT COUNT(*) FROM ops.requests)::int AS total_requests,
  0::int AS estimated_unfixed_cats,
  0::int AS high_priority_zones,
  NOW() AS last_updated;

-- =========================================================================
-- ops.v_beacon_cluster_summary - Cluster statistics
-- =========================================================================
CREATE OR REPLACE VIEW ops.v_beacon_cluster_summary AS
SELECT
  'No clusters yet'::text AS cluster_name,
  0::int AS place_count,
  0::int AS cat_count,
  0::numeric AS alteration_rate,
  NULL::geometry AS cluster_centroid
WHERE FALSE; -- Empty for now

-- =========================================================================
-- ops.v_beacon_place_metrics - Per-place metrics
-- =========================================================================
CREATE OR REPLACE VIEW ops.v_beacon_place_metrics AS
SELECT
  p.place_id,
  p.display_name,
  p.formatted_address,
  CASE WHEN p.location IS NOT NULL THEN ST_Y(p.location::geometry) ELSE NULL END AS latitude,
  CASE WHEN p.location IS NOT NULL THEN ST_X(p.location::geometry) ELSE NULL END AS longitude,
  (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = p.place_id)::int AS cat_count,
  (SELECT COUNT(*) FROM sot.cat_place cp
   JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.altered_status = 'altered'
   WHERE cp.place_id = p.place_id)::int AS altered_count,
  0::numeric AS alteration_rate,
  (SELECT pce.total_count_observed FROM sot.place_colony_estimates pce
   WHERE pce.place_id = p.place_id ORDER BY pce.observed_date DESC LIMIT 1) AS colony_estimate,
  NULL::int AS priority_score
FROM sot.places p
WHERE p.merged_into_place_id IS NULL;

-- =========================================================================
-- ops.v_seasonal_dashboard - Seasonal breeding analysis
-- =========================================================================
CREATE OR REPLACE VIEW ops.v_seasonal_dashboard AS
SELECT
  EXTRACT(YEAR FROM NOW())::int AS year,
  EXTRACT(MONTH FROM NOW())::int AS month,
  'current'::text AS season,
  0::int AS kittens_this_month,
  0::int AS kittens_ytd,
  0::numeric AS kitten_rate_change,
  FALSE AS is_breeding_season,
  NOW() AS last_updated
WHERE FALSE; -- Empty for now

-- =========================================================================
-- ops.v_breeding_season_indicators - Breeding season metrics
-- =========================================================================
CREATE OR REPLACE VIEW ops.v_breeding_season_indicators AS
SELECT
  EXTRACT(YEAR FROM NOW())::int AS year,
  'spring'::text AS season,
  0::int AS pregnant_cats,
  0::int AS lactating_cats,
  0::int AS kittens_born,
  0::numeric AS avg_litter_size,
  NOW() AS observation_date
WHERE FALSE; -- Empty for now

-- =========================================================================
-- ops.v_kitten_surge_prediction - Kitten surge forecasting
-- =========================================================================
CREATE OR REPLACE VIEW ops.v_kitten_surge_prediction AS
SELECT
  NOW()::date AS prediction_date,
  'next_month'::text AS period,
  0::int AS predicted_kittens,
  0::numeric AS confidence,
  '{}'::jsonb AS factors
WHERE FALSE; -- Empty for now

-- =========================================================================
-- ops.v_zone_observation_priority - Zone prioritization
-- =========================================================================
CREATE OR REPLACE VIEW ops.v_zone_observation_priority AS
SELECT
  oz.zone_id,
  oz.name AS zone_name,
  0::int AS places_needing_observation,
  0::int AS cats_unaltered,
  0::numeric AS priority_score,
  NULL::date AS last_observation_date
FROM sot.observation_zones oz
WHERE FALSE; -- Empty for now (no zones configured)

-- =========================================================================
-- ops.v_zip_observation_priority - ZIP code prioritization
-- =========================================================================
CREATE OR REPLACE VIEW ops.v_zip_observation_priority AS
SELECT
  '95401'::text AS zip_code,
  0::int AS places_count,
  0::int AS unaltered_estimate,
  0::numeric AS priority_score
WHERE FALSE; -- Empty for now

-- =========================================================================
-- ops.v_yoy_activity_comparison - Year-over-year comparison
-- =========================================================================
CREATE OR REPLACE VIEW ops.v_yoy_activity_comparison AS
SELECT
  EXTRACT(YEAR FROM NOW())::int AS current_year,
  EXTRACT(YEAR FROM NOW())::int - 1 AS previous_year,
  EXTRACT(MONTH FROM NOW())::int AS month,
  0::int AS current_year_alterations,
  0::int AS previous_year_alterations,
  0::numeric AS yoy_change_pct
WHERE FALSE; -- Empty for now

-- =========================================================================
-- sot.v_place_observation_priority - Place observation priority
-- =========================================================================
CREATE OR REPLACE VIEW sot.v_place_observation_priority AS
SELECT
  p.place_id,
  p.display_name,
  p.formatted_address,
  0::int AS unaltered_estimate,
  NULL::date AS last_observation,
  0::numeric AS priority_score
FROM sot.places p
WHERE p.merged_into_place_id IS NULL
  AND FALSE; -- Empty for now

-- Verify views created
SELECT 'Beacon view stubs created' as status, COUNT(*) as view_count
FROM pg_views WHERE viewname IN (
  'v_beacon_summary', 'v_beacon_cluster_summary', 'v_beacon_place_metrics',
  'v_seasonal_dashboard', 'v_breeding_season_indicators', 'v_kitten_surge_prediction',
  'v_zone_observation_priority', 'v_zip_observation_priority', 'v_yoy_activity_comparison',
  'v_place_observation_priority'
);
