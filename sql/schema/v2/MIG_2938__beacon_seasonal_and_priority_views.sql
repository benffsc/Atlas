-- MIG_2938: Replace Beacon Stub Views with Real Implementations
-- FFS-538: Beacon seasonal analytics, breeding indicators, YoY comparison,
--          and observation priority views.
--
-- Replaces stubs created in MIG_2045 that returned empty/placeholder data.
-- All views query real appointment, cat, and place data.

BEGIN;

\echo 'MIG_2938: Replacing beacon stub views with real implementations'

-- Drop all stub views first (column sets changed)
DROP VIEW IF EXISTS ops.v_seasonal_dashboard CASCADE;
DROP VIEW IF EXISTS ops.v_breeding_season_indicators CASCADE;
DROP VIEW IF EXISTS ops.v_kitten_surge_prediction CASCADE;
DROP VIEW IF EXISTS ops.v_yoy_activity_comparison CASCADE;
DROP VIEW IF EXISTS ops.v_zone_observation_priority CASCADE;
DROP VIEW IF EXISTS ops.v_zip_observation_priority CASCADE;
DROP VIEW IF EXISTS sot.v_place_observation_priority CASCADE;

-- ============================================================================
-- 1. ops.v_seasonal_dashboard — Monthly clinic activity with seasonal context
-- ============================================================================

\echo '1. Creating ops.v_seasonal_dashboard...'

CREATE VIEW ops.v_seasonal_dashboard AS
WITH monthly AS (
  SELECT
    EXTRACT(YEAR FROM a.appointment_date)::INT AS year,
    EXTRACT(MONTH FROM a.appointment_date)::INT AS month_num,
    COUNT(*) AS total_appointments,
    COUNT(*) FILTER (WHERE a.is_spay = true OR a.is_neuter = true) AS alterations
  FROM ops.appointments a
  WHERE a.appointment_date IS NOT NULL
    AND a.cat_id IS NOT NULL
  GROUP BY 1, 2
)
SELECT
  m.year,
  m.month_num,
  TO_CHAR(MAKE_DATE(m.year, m.month_num, 1), 'Mon YYYY') AS month_label,
  CASE
    WHEN m.month_num IN (3, 4, 5) THEN 'spring'
    WHEN m.month_num IN (6, 7, 8) THEN 'summer'
    WHEN m.month_num IN (9, 10, 11) THEN 'fall'
    ELSE 'winter'
  END AS season,
  m.total_appointments::INT,
  m.alterations::INT,
  -- Cat breeding season: Feb through Nov in Northern California
  (m.month_num >= 2 AND m.month_num <= 11) AS is_breeding_season
FROM monthly m
ORDER BY m.year, m.month_num;

-- ============================================================================
-- 2. ops.v_breeding_season_indicators — Monthly pregnancy/lactation rates
-- ============================================================================

\echo '2. Creating ops.v_breeding_season_indicators...'

CREATE VIEW ops.v_breeding_season_indicators AS
WITH monthly_female AS (
  SELECT
    DATE_TRUNC('month', a.appointment_date)::DATE AS month,
    COUNT(*) AS total_female_appts,
    COUNT(*) FILTER (WHERE a.is_pregnant = true) AS pregnant_count,
    COUNT(*) FILTER (WHERE a.is_lactating = true) AS lactating_count
  FROM ops.appointments a
  JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
  WHERE a.appointment_date IS NOT NULL
    AND c.sex = 'female'
  GROUP BY 1
)
SELECT
  mf.month,
  mf.pregnant_count::INT,
  mf.lactating_count::INT,
  CASE
    WHEN mf.total_female_appts > 0
      THEN ROUND(100.0 * mf.pregnant_count / mf.total_female_appts, 1)
    ELSE 0
  END AS pregnancy_rate_pct,
  CASE
    WHEN mf.total_female_appts > 0
      THEN ROUND(100.0 * mf.lactating_count / mf.total_female_appts, 1)
    ELSE 0
  END AS lactation_rate_pct,
  -- Breeding intensity: combined pregnancy + lactation count as a signal
  (mf.pregnant_count + mf.lactating_count)::INT AS breeding_intensity,
  -- Breeding phase classification
  CASE
    WHEN EXTRACT(MONTH FROM mf.month) IN (12, 1) THEN 'dormant'
    WHEN EXTRACT(MONTH FROM mf.month) = 2 THEN 'pre_breeding'
    WHEN EXTRACT(MONTH FROM mf.month) IN (3, 4, 5) THEN 'peak_spring'
    WHEN EXTRACT(MONTH FROM mf.month) IN (6, 7) THEN 'summer_plateau'
    WHEN EXTRACT(MONTH FROM mf.month) IN (8, 9, 10) THEN 'peak_fall'
    WHEN EXTRACT(MONTH FROM mf.month) = 11 THEN 'winding_down'
  END AS breeding_phase,
  mf.total_female_appts::INT
FROM monthly_female mf
ORDER BY mf.month;

-- ============================================================================
-- 3. ops.v_kitten_surge_prediction — Forecast based on recent breeding data
-- ============================================================================

\echo '3. Creating ops.v_kitten_surge_prediction...'

CREATE VIEW ops.v_kitten_surge_prediction AS
WITH recent_breeding AS (
  -- Last 60 days of female appointments (gestation ~63 days)
  SELECT
    COUNT(*) FILTER (WHERE a.is_pregnant = true) AS current_pregnant,
    COUNT(*) FILTER (WHERE a.is_lactating = true) AS current_lactating,
    COUNT(*) AS total_female_appts
  FROM ops.appointments a
  JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
  WHERE a.appointment_date >= CURRENT_DATE - INTERVAL '60 days'
    AND c.sex = 'female'
)
SELECT
  CURRENT_DATE AS prediction_date,
  rb.current_pregnant::INT,
  rb.current_lactating::INT,
  -- Estimate: each pregnant cat ≈ 4 kittens (average feral litter size)
  (rb.current_pregnant * 4)::INT AS estimated_kittens_2mo,
  CASE
    WHEN rb.total_female_appts = 0 THEN 'unknown'
    WHEN 100.0 * (rb.current_pregnant + rb.current_lactating) / rb.total_female_appts > 40 THEN 'high'
    WHEN 100.0 * (rb.current_pregnant + rb.current_lactating) / rb.total_female_appts > 20 THEN 'medium'
    WHEN EXTRACT(MONTH FROM CURRENT_DATE) IN (3, 4, 5, 8, 9, 10) THEN 'medium'
    ELSE 'low'
  END AS surge_risk_level,
  (EXTRACT(MONTH FROM CURRENT_DATE) >= 2 AND EXTRACT(MONTH FROM CURRENT_DATE) <= 11) AS is_breeding_season
FROM recent_breeding rb;

-- ============================================================================
-- 4. ops.v_yoy_activity_comparison — Year-over-year monthly alterations
-- ============================================================================

\echo '4. Creating ops.v_yoy_activity_comparison...'

CREATE VIEW ops.v_yoy_activity_comparison AS
WITH yearly_monthly AS (
  SELECT
    EXTRACT(YEAR FROM a.appointment_date)::INT AS year,
    EXTRACT(MONTH FROM a.appointment_date)::INT AS month,
    COUNT(*) FILTER (WHERE a.is_spay = true OR a.is_neuter = true) AS alterations
  FROM ops.appointments a
  WHERE a.appointment_date IS NOT NULL
    AND a.cat_id IS NOT NULL
    AND a.appointment_date >= (DATE_TRUNC('year', CURRENT_DATE) - INTERVAL '1 year')
  GROUP BY 1, 2
)
SELECT
  cy.year AS current_year,
  cy.year - 1 AS previous_year,
  cy.month,
  cy.alterations::INT AS current_year_alterations,
  COALESCE(py.alterations, 0)::INT AS previous_year_alterations,
  CASE
    WHEN COALESCE(py.alterations, 0) > 0
      THEN ROUND(100.0 * (cy.alterations - py.alterations) / py.alterations, 1)
    ELSE NULL
  END AS yoy_change_pct
FROM yearly_monthly cy
LEFT JOIN yearly_monthly py
  ON py.year = cy.year - 1
  AND py.month = cy.month
WHERE cy.year = EXTRACT(YEAR FROM CURRENT_DATE)::INT
ORDER BY cy.month;

-- ============================================================================
-- 5. ops.v_zone_observation_priority — Service zone observation priorities
-- ============================================================================

\echo '5. Creating ops.v_zone_observation_priority...'

CREATE VIEW ops.v_zone_observation_priority AS
WITH place_stats AS (
  SELECT
    p.place_id,
    p.service_zone,
    COUNT(DISTINCT cp.cat_id) AS cat_count,
    COUNT(DISTINCT cp.cat_id) FILTER (
      WHERE c.altered_status IN ('spayed', 'neutered')
    ) AS altered_count,
    COUNT(DISTINCT cp.cat_id) FILTER (
      WHERE c.altered_status = 'intact'
    ) AS intact_count,
    MAX(a.appointment_date) AS last_appointment_date,
    -- Has recent observation (appointment or colony estimate in last 180 days)
    EXISTS (
      SELECT 1 FROM ops.appointments a2
      WHERE (a2.place_id = p.place_id OR a2.inferred_place_id = p.place_id)
        AND a2.appointment_date >= CURRENT_DATE - INTERVAL '180 days'
    ) OR EXISTS (
      SELECT 1 FROM sot.colony_estimates ce
      WHERE ce.place_id = p.place_id
        AND ce.observation_date >= CURRENT_DATE - INTERVAL '180 days'
    ) AS has_recent_observation
  FROM sot.places p
  JOIN sot.cat_place cp ON cp.place_id = p.place_id
  JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
  LEFT JOIN ops.appointments a ON (a.place_id = p.place_id OR a.inferred_place_id = p.place_id)
  WHERE p.merged_into_place_id IS NULL
    AND p.service_zone IS NOT NULL
  GROUP BY p.place_id, p.service_zone
),
place_priority AS (
  SELECT
    ps.*,
    -- Priority score: intact cats weight + recency penalty
    CASE
      WHEN ps.intact_count >= 5 AND NOT ps.has_recent_observation THEN 'high'
      WHEN ps.intact_count >= 2 OR (ps.cat_count >= 5 AND NOT ps.has_recent_observation) THEN 'medium'
      ELSE 'low'
    END AS priority_tier
  FROM place_stats ps
)
SELECT
  pp.service_zone,
  COUNT(*)::INT AS total_places,
  COUNT(*) FILTER (WHERE pp.has_recent_observation)::INT AS places_with_observations,
  COUNT(*) FILTER (WHERE NOT pp.has_recent_observation)::INT AS places_needing_obs,
  COUNT(*) FILTER (WHERE pp.priority_tier = 'high')::INT AS high_priority_sites,
  COUNT(*) FILTER (WHERE pp.priority_tier = 'medium')::INT AS medium_priority_sites,
  COUNT(*) FILTER (WHERE pp.priority_tier = 'low')::INT AS low_priority_sites,
  SUM(pp.cat_count)::INT AS total_cats,
  SUM(pp.intact_count)::INT AS cats_needing_obs,
  SUM(pp.intact_count) FILTER (WHERE pp.priority_tier = 'high')::INT AS high_priority_cats,
  CASE
    WHEN COUNT(*) > 0
      THEN ROUND(100.0 * COUNT(*) FILTER (WHERE NOT pp.has_recent_observation) / COUNT(*), 1)
    ELSE 0
  END AS pct_gap,
  -- Zone priority score: weighted sum of intact cats and observation gaps
  (
    SUM(pp.intact_count) * 2 +
    COUNT(*) FILTER (WHERE NOT pp.has_recent_observation) * 3 +
    COUNT(*) FILTER (WHERE pp.priority_tier = 'high') * 5
  )::NUMERIC AS zone_priority_score
FROM place_priority pp
GROUP BY pp.service_zone
ORDER BY zone_priority_score DESC;

-- ============================================================================
-- 6. ops.v_zip_observation_priority — ZIP-level observation priorities
-- ============================================================================

\echo '6. Creating ops.v_zip_observation_priority...'

CREATE VIEW ops.v_zip_observation_priority AS
WITH place_zip AS (
  SELECT
    p.place_id,
    p.service_zone,
    a.postal_code AS zip
  FROM sot.places p
  JOIN sot.addresses a ON a.address_id = p.sot_address_id
  WHERE p.merged_into_place_id IS NULL
    AND a.postal_code IS NOT NULL
),
zip_stats AS (
  SELECT
    pz.zip,
    pz.service_zone,
    COUNT(DISTINCT pz.place_id)::INT AS places_with_cats,
    COALESCE(SUM(cat_stats.intact_count), 0)::INT AS cats_needing_obs,
    COUNT(DISTINCT pz.place_id) FILTER (
      WHERE COALESCE(cat_stats.intact_count, 0) >= 5
        AND NOT COALESCE(cat_stats.has_recent_obs, false)
    )::INT AS high_priority_sites,
    COUNT(DISTINCT pz.place_id) FILTER (
      WHERE COALESCE(cat_stats.intact_count, 0) BETWEEN 2 AND 4
    )::INT AS medium_priority_sites,
    CASE
      WHEN COUNT(DISTINCT pz.place_id) > 0
        THEN ROUND(100.0 * COUNT(DISTINCT pz.place_id) FILTER (
          WHERE NOT COALESCE(cat_stats.has_recent_obs, false)
        ) / COUNT(DISTINCT pz.place_id), 1)
      ELSE 0
    END AS pct_gap
  FROM place_zip pz
  LEFT JOIN LATERAL (
    SELECT
      COUNT(DISTINCT cp.cat_id) FILTER (WHERE c.altered_status = 'intact') AS intact_count,
      EXISTS (
        SELECT 1 FROM ops.appointments a
        WHERE (a.place_id = pz.place_id OR a.inferred_place_id = pz.place_id)
          AND a.appointment_date >= CURRENT_DATE - INTERVAL '180 days'
      ) AS has_recent_obs
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    WHERE cp.place_id = pz.place_id
  ) cat_stats ON true
  GROUP BY pz.zip, pz.service_zone
)
SELECT
  zs.zip,
  zs.service_zone,
  zs.places_with_cats,
  zs.cats_needing_obs,
  zs.high_priority_sites,
  zs.medium_priority_sites,
  zs.pct_gap,
  d.population::INT AS population_2023,
  d.median_income::INT AS median_household_income_2023,
  d.rural_classification AS urbanization,
  d.city,
  -- ZIP priority score
  (
    zs.cats_needing_obs * 2 +
    zs.high_priority_sites * 5 +
    zs.medium_priority_sites * 2
  )::NUMERIC AS zip_priority_score,
  -- Cats per 1000 households (using housing_units as proxy)
  CASE
    WHEN d.housing_units > 0
      THEN ROUND(1000.0 * zs.places_with_cats / d.housing_units, 1)
    ELSE NULL
  END AS cats_per_1000_households
FROM zip_stats zs
LEFT JOIN ops.sonoma_zip_demographics d ON d.zip_code = zs.zip
ORDER BY zip_priority_score DESC;

-- ============================================================================
-- 7. sot.v_place_observation_priority — Place-level observation priorities
-- ============================================================================

\echo '7. Creating sot.v_place_observation_priority...'

CREATE VIEW sot.v_place_observation_priority AS
WITH place_cats AS (
  SELECT
    cp.place_id,
    COUNT(DISTINCT cp.cat_id) AS verified_cats,
    COUNT(DISTINCT cp.cat_id) FILTER (WHERE c.altered_status = 'intact') AS intact_cats,
    COUNT(DISTINCT cp.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered')) AS altered_cats
  FROM sot.cat_place cp
  JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
  GROUP BY cp.place_id
),
place_appts AS (
  SELECT
    COALESCE(a.inferred_place_id, a.place_id) AS place_id,
    MAX(a.appointment_date) FILTER (WHERE a.is_spay = true OR a.is_neuter = true) AS last_alteration_date,
    COUNT(DISTINCT a.appointment_id) AS total_appts
  FROM ops.appointments a
  WHERE COALESCE(a.inferred_place_id, a.place_id) IS NOT NULL
  GROUP BY 1
),
place_observations AS (
  SELECT
    ce.place_id,
    MAX(ce.observation_date) AS last_eartip_obs,
    MAX(ce.eartip_count_observed) AS max_eartips_seen,
    MAX(ce.total_cats) AS max_cats_observed,
    MAX(COALESCE(ce.total_cats, pce.total_count_observed)) AS max_colony_estimate
  FROM sot.colony_estimates ce
  FULL OUTER JOIN sot.place_colony_estimates pce ON pce.place_id = ce.place_id
  WHERE ce.place_id IS NOT NULL
  GROUP BY ce.place_id
),
active_reqs AS (
  SELECT
    r.place_id,
    COUNT(*) AS active_requests
  FROM ops.requests r
  WHERE r.merged_into_request_id IS NULL
    AND r.status NOT IN ('completed', 'cancelled', 'closed')
  GROUP BY r.place_id
)
SELECT
  p.place_id::TEXT,
  p.formatted_address,
  p.service_zone,
  -- Colony classification based on cat count and alteration rate
  CASE
    WHEN COALESCE(pc.verified_cats, 0) = 0 THEN NULL
    WHEN pc.verified_cats >= 10 THEN 'large_colony'
    WHEN pc.verified_cats >= 5 THEN 'medium_colony'
    WHEN pc.verified_cats >= 2 THEN 'small_colony'
    ELSE 'single_cat'
  END AS colony_classification,
  COALESCE(pc.verified_cats, 0)::INT AS verified_cats,
  pa.last_alteration_date::TEXT,
  po.last_eartip_obs::TEXT,
  po.max_eartips_seen::INT,
  po.max_cats_observed::INT,
  po.max_colony_estimate::INT,
  (po.max_eartips_seen IS NOT NULL AND po.max_eartips_seen > 0) AS has_eartip_observation,
  (po.max_colony_estimate IS NOT NULL) AS has_colony_estimate,
  COALESCE(ar.active_requests, 0)::INT AS active_requests,
  -- Priority tier
  CASE
    WHEN COALESCE(pc.intact_cats, 0) >= 5
      AND (pa.last_alteration_date IS NULL OR pa.last_alteration_date < CURRENT_DATE - INTERVAL '180 days')
      THEN 'high'
    WHEN COALESCE(pc.intact_cats, 0) >= 2
      OR (COALESCE(pc.verified_cats, 0) >= 5 AND (pa.last_alteration_date IS NULL OR pa.last_alteration_date < CURRENT_DATE - INTERVAL '180 days'))
      THEN 'medium'
    ELSE 'low'
  END AS priority_tier,
  -- Priority score: higher = more urgent
  (
    COALESCE(pc.intact_cats, 0) * 10 +
    CASE WHEN pa.last_alteration_date IS NULL THEN 20
         WHEN pa.last_alteration_date < CURRENT_DATE - INTERVAL '365 days' THEN 15
         WHEN pa.last_alteration_date < CURRENT_DATE - INTERVAL '180 days' THEN 10
         ELSE 0
    END +
    CASE WHEN ar.active_requests > 0 THEN 5 ELSE 0 END +
    COALESCE(pc.verified_cats, 0)
  )::NUMERIC AS place_priority_score,
  -- Observation status
  CASE
    WHEN pa.last_alteration_date >= CURRENT_DATE - INTERVAL '90 days' THEN 'recently_active'
    WHEN pa.last_alteration_date >= CURRENT_DATE - INTERVAL '180 days' THEN 'moderate'
    WHEN pa.last_alteration_date IS NOT NULL THEN 'stale'
    ELSE 'never_observed'
  END AS observation_status,
  addr.postal_code AS zip
FROM sot.places p
LEFT JOIN place_cats pc ON pc.place_id = p.place_id
LEFT JOIN place_appts pa ON pa.place_id = p.place_id
LEFT JOIN place_observations po ON po.place_id = p.place_id
LEFT JOIN active_reqs ar ON ar.place_id = p.place_id
LEFT JOIN sot.addresses addr ON addr.address_id = p.sot_address_id
WHERE p.merged_into_place_id IS NULL
  AND COALESCE(pc.verified_cats, 0) > 0;

-- ============================================================================
-- Verify
-- ============================================================================

\echo ''
\echo 'MIG_2938: Verification'

\echo 'Seasonal dashboard:'
SELECT year, month_num, season, total_appointments, alterations, is_breeding_season
FROM ops.v_seasonal_dashboard
WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)::INT
ORDER BY month_num
LIMIT 6;

\echo 'Breeding indicators (last 6 months):'
SELECT TO_CHAR(month, 'YYYY-MM') AS month, pregnant_count, lactating_count,
       pregnancy_rate_pct, lactation_rate_pct, breeding_phase
FROM ops.v_breeding_season_indicators
WHERE month >= CURRENT_DATE - INTERVAL '6 months'
ORDER BY month;

\echo 'Kitten surge prediction:'
SELECT * FROM ops.v_kitten_surge_prediction;

\echo 'YoY comparison:'
SELECT current_year, month, current_year_alterations, previous_year_alterations, yoy_change_pct
FROM ops.v_yoy_activity_comparison
LIMIT 6;

\echo 'Zone observation priority (top 5):'
SELECT service_zone, total_places, places_needing_obs, cats_needing_obs, zone_priority_score
FROM ops.v_zone_observation_priority
LIMIT 5;

\echo 'Place observation priority (top 5):'
SELECT formatted_address, verified_cats, priority_tier, place_priority_score, observation_status
FROM sot.v_place_observation_priority
ORDER BY place_priority_score DESC
LIMIT 5;

\echo ''
\echo 'MIG_2938: All beacon analytics views replaced successfully'

COMMIT;
