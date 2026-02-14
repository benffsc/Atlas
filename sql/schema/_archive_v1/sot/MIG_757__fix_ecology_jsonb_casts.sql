\echo '=== MIG_757: Fix JSONB Casting in Ecology Stats View ==='
\echo 'Fixes "cannot cast jsonb null to type integer" errors in v_place_ecology_stats'

-- ============================================================================
-- FIX JSONB CASTING ERRORS IN v_place_ecology_stats
-- ============================================================================
-- Problem: attribute_value is JSONB. Direct casting like (attribute_value)::int
-- fails when the value is JSON null (the literal null, not SQL NULL).
--
-- Solution: Use NULLIF to filter out 'null' strings after text cast, then cast to target type.
-- For booleans: Use text comparison since JSONB true = 'true' as text.

CREATE OR REPLACE VIEW trapper.v_place_ecology_stats AS
WITH
-- A_known: verified altered cats from clinic data (ground truth)
verified_altered AS (
  SELECT
    cpr.place_id,
    COUNT(DISTINCT cp.cat_id) AS a_known,
    MAX(cp.procedure_date) AS last_altered_at
  FROM trapper.cat_procedures cp
  JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = cp.cat_id
  WHERE cp.is_spay OR cp.is_neuter
  GROUP BY cpr.place_id
),

-- N_recent_max: max reported total within 180 days
recent_reports AS (
  SELECT
    place_id,
    MAX(COALESCE(peak_count, total_cats)) AS n_recent_max,
    COUNT(*) AS report_count,
    MAX(observation_date) AS latest_observation
  FROM trapper.place_colony_estimates
  WHERE (observation_date >= CURRENT_DATE - INTERVAL '180 days')
     OR (observation_date IS NULL AND reported_at >= NOW() - INTERVAL '180 days')
  GROUP BY place_id
),

-- Manual ear-tip observations (from place_colony_estimates)
manual_eartip_observations AS (
  SELECT
    place_id,
    SUM(eartip_count_observed) AS manual_eartips_seen,
    SUM(total_cats_observed) AS manual_total_seen,
    COUNT(*) AS manual_observation_count
  FROM trapper.place_colony_estimates
  WHERE eartip_count_observed IS NOT NULL
    AND total_cats_observed IS NOT NULL
    AND total_cats_observed > 0
    AND (observation_date >= CURRENT_DATE - INTERVAL '90 days'
         OR (observation_date IS NULL AND reported_at >= NOW() - INTERVAL '90 days'))
  GROUP BY place_id
),

-- AI-extracted ear-tip counts (from entity_attributes)
-- Fixed: Properly handle JSONB null values with NULLIF
ai_eartip_observations AS (
  SELECT
    entity_id AS place_id,
    SUM(NULLIF(attribute_value #>> '{}', 'null')::int) AS ai_eartips_seen
  FROM trapper.entity_attributes
  WHERE entity_type = 'place'
    AND attribute_key = 'eartip_count_observed'
    AND superseded_at IS NULL
    AND confidence >= 0.6
    AND attribute_value IS NOT NULL
    AND attribute_value != 'null'::jsonb
  GROUP BY entity_id
),

-- AI-extracted unfixed counts (from entity_attributes)
-- Fixed: Properly handle JSONB null values with NULLIF
ai_unfixed_observations AS (
  SELECT
    entity_id AS place_id,
    SUM(NULLIF(attribute_value #>> '{}', 'null')::int) AS ai_unfixed_seen
  FROM trapper.entity_attributes
  WHERE entity_type = 'place'
    AND attribute_key = 'unfixed_count_observed'
    AND superseded_at IS NULL
    AND confidence >= 0.6
    AND attribute_value IS NOT NULL
    AND attribute_value != 'null'::jsonb
  GROUP BY entity_id
),

-- Recapture counts by place (from cat attributes where is_recapture = true)
-- Fixed: Use text comparison for JSONB boolean
recapture_counts AS (
  SELECT
    cpr.place_id,
    COUNT(DISTINCT ea.entity_id) AS recapture_count
  FROM trapper.entity_attributes ea
  JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = ea.entity_id
  WHERE ea.entity_type = 'cat'
    AND ea.attribute_key = 'is_recapture'
    AND (ea.attribute_value #>> '{}') = 'true'
    AND ea.superseded_at IS NULL
  GROUP BY cpr.place_id
),

-- Combined ear-tip observations (manual + AI)
combined_eartip AS (
  SELECT
    COALESCE(m.place_id, a.place_id) AS place_id,
    COALESCE(m.manual_eartips_seen, 0) + COALESCE(a.ai_eartips_seen, 0) AS total_eartips_seen,
    COALESCE(m.manual_total_seen, 0) +
      COALESCE(a.ai_eartips_seen, 0) +
      COALESCE(u.ai_unfixed_seen, 0) AS total_cats_seen,
    COALESCE(m.manual_observation_count, 0) +
      CASE WHEN a.ai_eartips_seen > 0 THEN 1 ELSE 0 END +
      CASE WHEN u.ai_unfixed_seen > 0 THEN 1 ELSE 0 END AS observation_count,
    CASE WHEN a.ai_eartips_seen > 0 OR u.ai_unfixed_seen > 0 THEN TRUE ELSE FALSE END AS has_ai_data
  FROM manual_eartip_observations m
  FULL OUTER JOIN ai_eartip_observations a ON a.place_id = m.place_id
  FULL OUTER JOIN ai_unfixed_observations u ON u.place_id = COALESCE(m.place_id, a.place_id)
)

SELECT
  p.place_id,
  p.display_name,
  p.formatted_address,
  p.service_zone,

  -- Verified ground truth (from clinic data)
  COALESCE(va.a_known, 0) AS a_known,
  va.last_altered_at,

  -- Survey-based estimate (max to avoid double-counting)
  COALESCE(rr.n_recent_max, 0) AS n_recent_max,
  COALESCE(rr.report_count, 0) AS report_count,
  rr.latest_observation,

  -- Recapture data (from AI extraction)
  COALESCE(rc.recapture_count, 0) AS recapture_count,

  -- Lower-bound alteration rate
  CASE
    WHEN COALESCE(rr.n_recent_max, 0) > 0 OR COALESCE(va.a_known, 0) > 0
    THEN ROUND(
      COALESCE(va.a_known, 0)::NUMERIC /
      GREATEST(COALESCE(va.a_known, 0), COALESCE(rr.n_recent_max, 1))::NUMERIC,
      3
    )
    ELSE NULL
  END AS p_lower,

  -- Lower-bound percentage
  CASE
    WHEN COALESCE(rr.n_recent_max, 0) > 0 OR COALESCE(va.a_known, 0) > 0
    THEN ROUND(
      100.0 * COALESCE(va.a_known, 0)::NUMERIC /
      GREATEST(COALESCE(va.a_known, 0), COALESCE(rr.n_recent_max, 1))::NUMERIC,
      1
    )
    ELSE NULL
  END AS p_lower_pct,

  -- Mark-resight readiness (now includes AI data)
  ce.observation_count IS NOT NULL AND ce.observation_count > 0 AS has_eartip_data,
  COALESCE(ce.has_ai_data, FALSE) AS has_ai_population_data,
  COALESCE(ce.total_eartips_seen, 0) AS total_eartips_seen,
  COALESCE(ce.total_cats_seen, 0) AS total_cats_seen,
  COALESCE(ce.observation_count, 0) AS eartip_observation_count,

  -- Chapman estimator for mark-resight (uses combined manual + AI data)
  CASE
    WHEN ce.total_eartips_seen > 0
     AND ce.total_cats_seen > 0
     AND va.a_known > 0
     AND ce.total_eartips_seen <= ce.total_cats_seen
    THEN ROUND(
      ((va.a_known + 1) * (ce.total_cats_seen + 1)::NUMERIC /
       (ce.total_eartips_seen + 1)) - 1,
      1
    )
    ELSE NULL
  END AS n_hat_chapman,

  -- Mark-resight alteration rate
  CASE
    WHEN ce.total_eartips_seen > 0
     AND ce.total_cats_seen > 0
     AND va.a_known > 0
     AND ce.total_eartips_seen <= ce.total_cats_seen
    THEN ROUND(
      100.0 * va.a_known::NUMERIC /
      NULLIF(((va.a_known + 1) * (ce.total_cats_seen + 1)::NUMERIC /
              (ce.total_eartips_seen + 1)) - 1, 0),
      1
    )
    ELSE NULL
  END AS p_hat_chapman_pct,

  -- Estimation method (shows ai_enhanced when AI data present)
  CASE
    WHEN ce.total_eartips_seen > 0 AND va.a_known > 0 AND ce.has_ai_data THEN 'mark_resight_ai_enhanced'::TEXT
    WHEN ce.total_eartips_seen > 0 AND va.a_known > 0 THEN 'mark_resight'::TEXT
    WHEN rr.n_recent_max > 0 THEN 'max_recent'::TEXT
    WHEN va.a_known > 0 THEN 'verified_only'::TEXT
    ELSE 'no_data'::TEXT
  END AS estimation_method,

  -- Best colony size estimate
  CASE
    WHEN ce.total_eartips_seen > 0
     AND ce.total_cats_seen > 0
     AND va.a_known > 0
     AND ce.total_eartips_seen <= ce.total_cats_seen
    THEN ROUND(
      ((va.a_known + 1) * (ce.total_cats_seen + 1)::NUMERIC /
       (ce.total_eartips_seen + 1)) - 1,
      0
    )::INTEGER
    WHEN rr.n_recent_max > 0 THEN rr.n_recent_max
    WHEN va.a_known > 0 THEN va.a_known
    ELSE NULL
  END AS best_colony_estimate,

  -- Work remaining estimate
  CASE
    WHEN ce.total_eartips_seen > 0
     AND ce.total_cats_seen > 0
     AND va.a_known > 0
    THEN GREATEST(0, ROUND(
      ((va.a_known + 1) * (ce.total_cats_seen + 1)::NUMERIC /
       (ce.total_eartips_seen + 1)) - 1 - va.a_known,
      0
    )::INTEGER)
    WHEN rr.n_recent_max > 0 THEN GREATEST(0, rr.n_recent_max - va.a_known)
    ELSE NULL
  END AS estimated_work_remaining

FROM trapper.places p
LEFT JOIN verified_altered va ON va.place_id = p.place_id
LEFT JOIN recent_reports rr ON rr.place_id = p.place_id
LEFT JOIN combined_eartip ce ON ce.place_id = p.place_id
LEFT JOIN recapture_counts rc ON rc.place_id = p.place_id
WHERE COALESCE(va.a_known, 0) > 0 OR COALESCE(rr.n_recent_max, 0) > 0;

COMMENT ON VIEW trapper.v_place_ecology_stats IS
'Ecology-based colony estimation view with fixed JSONB casting. Implements:
- A_known: verified altered cats from clinic (ground truth)
- N_recent_max: max reported total within 180 days
- p_lower: lower-bound alteration rate = A_known / max(A_known, N_recent_max)
- Chapman mark-resight estimator using combined manual + AI-extracted observation data
- Incorporates eartip_count_observed and unfixed_count_observed from entity_attributes
- recapture_count from is_recapture cat attribute
Fixed in MIG_757: Proper JSONB null handling with NULLIF and #>> operator';

-- Also fix the summary view that references boolean JSONB
CREATE OR REPLACE VIEW trapper.v_ai_population_data_summary AS
SELECT
  'Places with AI eartip data' AS metric,
  COUNT(DISTINCT entity_id) AS count
FROM trapper.entity_attributes
WHERE entity_type = 'place'
  AND attribute_key = 'eartip_count_observed'
  AND superseded_at IS NULL

UNION ALL

SELECT
  'Places with AI unfixed data' AS metric,
  COUNT(DISTINCT entity_id) AS count
FROM trapper.entity_attributes
WHERE entity_type = 'place'
  AND attribute_key = 'unfixed_count_observed'
  AND superseded_at IS NULL

UNION ALL

SELECT
  'Cats marked as recapture' AS metric,
  COUNT(DISTINCT entity_id) AS count
FROM trapper.entity_attributes
WHERE entity_type = 'cat'
  AND attribute_key = 'is_recapture'
  AND (attribute_value #>> '{}') = 'true'
  AND superseded_at IS NULL

UNION ALL

SELECT
  'Places with mark_resight_ai_enhanced' AS metric,
  COUNT(*) AS count
FROM trapper.v_place_ecology_stats
WHERE estimation_method = 'mark_resight_ai_enhanced'

UNION ALL

SELECT
  'Places with any mark_resight' AS metric,
  COUNT(*) AS count
FROM trapper.v_place_ecology_stats
WHERE estimation_method LIKE 'mark_resight%';

COMMENT ON VIEW trapper.v_ai_population_data_summary IS
'Quick summary of AI-extracted population modeling data coverage for Beacon';

\echo ''
\echo '=== MIG_757 Complete ==='
\echo 'Fixed JSONB casting in v_place_ecology_stats:'
\echo '  - Changed (attribute_value)::int to NULLIF(attribute_value #>> '{}', ''null'')::int'
\echo '  - Changed attribute_value::boolean = true to (attribute_value #>> '{}') = ''true'''
\echo '  - Added attribute_value != ''null''::jsonb filter for extra safety'
\echo ''
