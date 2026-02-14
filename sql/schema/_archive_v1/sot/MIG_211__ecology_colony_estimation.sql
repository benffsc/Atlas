-- MIG_211: Ecology-Based Colony Size Estimation
--
-- Implements wildlife ecology best practices for colony size estimation:
-- 1. A_known = verified altered cats from clinic data (ground truth)
-- 2. N_recent_max = max reported total within 180 days (avoids double-counting)
-- 3. p_lower = A_known / max(A_known, N_recent_max) (lower-bound alteration rate)
-- 4. Mark-resight estimation when ear-tip observations available (Chapman estimator)
--
-- Reference: Standard capture/mark-recapture theory applied to ear-tipped cats

-- ============================================================================
-- PHASE 1: Add ecology columns to place_colony_estimates
-- ============================================================================

-- Peak observation (reduces undercount bias)
ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS peak_count INTEGER;

COMMENT ON COLUMN trapper.place_colony_estimates.peak_count IS
'Highest number of cats seen at one time (last 7 days) - more accurate than total estimate';

ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS peak_observation_window TEXT DEFAULT '7_days';

COMMENT ON COLUMN trapper.place_colony_estimates.peak_observation_window IS
'Time window for peak count observation (default 7_days)';

-- Ear-tip observation (enables mark-resight calculation)
ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS eartip_count_observed INTEGER;

COMMENT ON COLUMN trapper.place_colony_estimates.eartip_count_observed IS
'Number of ear-tipped cats observed during this observation (for mark-resight)';

ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS total_cats_observed INTEGER;

COMMENT ON COLUMN trapper.place_colony_estimates.total_cats_observed IS
'Total cats observed during this observation session (for mark-resight denominator)';

-- Observation context (controls noise in estimates)
ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS observation_time_of_day TEXT;

COMMENT ON COLUMN trapper.place_colony_estimates.observation_time_of_day IS
'Time of day for observation: dawn, midday, dusk, evening, night, various';

ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS is_at_feeding_station BOOLEAN;

COMMENT ON COLUMN trapper.place_colony_estimates.is_at_feeding_station IS
'Whether cats were observed at a regular feeding station (affects count accuracy)';

ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS reporter_confidence TEXT;

COMMENT ON COLUMN trapper.place_colony_estimates.reporter_confidence IS
'Self-reported confidence in count: high, medium, low';

-- ============================================================================
-- PHASE 2: Create ecology estimation method enum
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ecology_estimation_method') THEN
    CREATE TYPE trapper.ecology_estimation_method AS ENUM (
      'weighted_average',  -- Current method (confidence-weighted mean)
      'max_recent',        -- Ecology lower-bound (max within 180 days)
      'mark_resight',      -- Chapman estimator when ear-tip data available
      'verified_only',     -- Only have clinic data, no survey reports
      'no_data'           -- No data available
    );
  END IF;
END$$;

-- ============================================================================
-- PHASE 3: Create v_place_ecology_stats view
-- ============================================================================

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
-- Uses MAX to avoid double-counting the same colony from multiple reports
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

-- Ear-tip observations for mark-resight calculation
-- Aggregate recent observations where we have both ear-tip and total counts
eartip_observations AS (
  SELECT
    place_id,
    SUM(eartip_count_observed) AS total_eartips_seen,
    SUM(total_cats_observed) AS total_cats_seen,
    COUNT(*) AS observation_count
  FROM trapper.place_colony_estimates
  WHERE eartip_count_observed IS NOT NULL
    AND total_cats_observed IS NOT NULL
    AND total_cats_observed > 0
    AND (observation_date >= CURRENT_DATE - INTERVAL '90 days'
         OR (observation_date IS NULL AND reported_at >= NOW() - INTERVAL '90 days'))
  GROUP BY place_id
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

  -- Lower-bound alteration rate (p_lower = A_known / max(A_known, N_recent_max))
  -- This never over-claims - always a defensible minimum
  CASE
    WHEN COALESCE(rr.n_recent_max, 0) > 0 OR COALESCE(va.a_known, 0) > 0
    THEN ROUND(
      COALESCE(va.a_known, 0)::NUMERIC /
      GREATEST(COALESCE(va.a_known, 0), COALESCE(rr.n_recent_max, 1))::NUMERIC,
      3
    )
    ELSE NULL
  END AS p_lower,

  -- Lower-bound percentage for display
  CASE
    WHEN COALESCE(rr.n_recent_max, 0) > 0 OR COALESCE(va.a_known, 0) > 0
    THEN ROUND(
      100.0 * COALESCE(va.a_known, 0)::NUMERIC /
      GREATEST(COALESCE(va.a_known, 0), COALESCE(rr.n_recent_max, 1))::NUMERIC,
      1
    )
    ELSE NULL
  END AS p_lower_pct,

  -- Mark-resight readiness
  eo.observation_count IS NOT NULL AND eo.observation_count > 0 AS has_eartip_data,
  COALESCE(eo.total_eartips_seen, 0) AS total_eartips_seen,
  COALESCE(eo.total_cats_seen, 0) AS total_cats_seen,
  COALESCE(eo.observation_count, 0) AS eartip_observation_count,

  -- Chapman estimator for mark-resight
  -- N_hat = ((M+1)(C+1)/(R+1)) - 1
  -- Where: M = known marked (a_known), C = total seen, R = marked seen
  CASE
    WHEN eo.total_eartips_seen > 0
     AND eo.total_cats_seen > 0
     AND va.a_known > 0
     AND eo.total_eartips_seen <= eo.total_cats_seen  -- Sanity check
    THEN ROUND(
      ((va.a_known + 1) * (eo.total_cats_seen + 1)::NUMERIC /
       (eo.total_eartips_seen + 1)) - 1,
      1
    )
    ELSE NULL
  END AS n_hat_chapman,

  -- Mark-resight alteration rate (when Chapman estimate available)
  CASE
    WHEN eo.total_eartips_seen > 0
     AND eo.total_cats_seen > 0
     AND va.a_known > 0
     AND eo.total_eartips_seen <= eo.total_cats_seen
    THEN ROUND(
      100.0 * va.a_known::NUMERIC /
      NULLIF(((va.a_known + 1) * (eo.total_cats_seen + 1)::NUMERIC /
              (eo.total_eartips_seen + 1)) - 1, 0),
      1
    )
    ELSE NULL
  END AS p_hat_chapman_pct,

  -- Estimation method being used
  CASE
    WHEN eo.total_eartips_seen > 0 AND va.a_known > 0 THEN 'mark_resight'::TEXT
    WHEN rr.n_recent_max > 0 THEN 'max_recent'::TEXT
    WHEN va.a_known > 0 THEN 'verified_only'::TEXT
    ELSE 'no_data'::TEXT
  END AS estimation_method,

  -- Best colony size estimate (prefer Chapman, fallback to max_recent)
  CASE
    WHEN eo.total_eartips_seen > 0
     AND eo.total_cats_seen > 0
     AND va.a_known > 0
     AND eo.total_eartips_seen <= eo.total_cats_seen
    THEN ROUND(
      ((va.a_known + 1) * (eo.total_cats_seen + 1)::NUMERIC /
       (eo.total_eartips_seen + 1)) - 1,
      0
    )::INTEGER
    WHEN rr.n_recent_max > 0 THEN rr.n_recent_max
    WHEN va.a_known > 0 THEN va.a_known
    ELSE NULL
  END AS best_colony_estimate,

  -- Work remaining estimate
  CASE
    WHEN eo.total_eartips_seen > 0
     AND eo.total_cats_seen > 0
     AND va.a_known > 0
    THEN GREATEST(0, ROUND(
      ((va.a_known + 1) * (eo.total_cats_seen + 1)::NUMERIC /
       (eo.total_eartips_seen + 1)) - 1 - va.a_known,
      0
    )::INTEGER)
    WHEN rr.n_recent_max > 0 THEN GREATEST(0, rr.n_recent_max - va.a_known)
    ELSE NULL
  END AS estimated_work_remaining

FROM trapper.places p
LEFT JOIN verified_altered va ON va.place_id = p.place_id
LEFT JOIN recent_reports rr ON rr.place_id = p.place_id
LEFT JOIN eartip_observations eo ON eo.place_id = p.place_id
WHERE COALESCE(va.a_known, 0) > 0 OR COALESCE(rr.n_recent_max, 0) > 0;

-- Add helpful comment
COMMENT ON VIEW trapper.v_place_ecology_stats IS
'Ecology-based colony estimation view implementing:
- A_known: verified altered cats from clinic (ground truth)
- N_recent_max: max reported total within 180 days (avoids double-counting)
- p_lower: lower-bound alteration rate = A_known / max(A_known, N_recent_max)
- Chapman mark-resight estimator when ear-tip observation data available';

-- ============================================================================
-- PHASE 4: Add columns to web_intake_submissions for ecology fields
-- ============================================================================

-- Check if table exists before altering
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'trapper' AND table_name = 'web_intake_submissions') THEN

    ALTER TABLE trapper.web_intake_submissions
    ADD COLUMN IF NOT EXISTS peak_count INTEGER;

    ALTER TABLE trapper.web_intake_submissions
    ADD COLUMN IF NOT EXISTS eartip_count_observed INTEGER;

    ALTER TABLE trapper.web_intake_submissions
    ADD COLUMN IF NOT EXISTS observation_time_of_day TEXT;

    ALTER TABLE trapper.web_intake_submissions
    ADD COLUMN IF NOT EXISTS is_at_feeding_station BOOLEAN;

    ALTER TABLE trapper.web_intake_submissions
    ADD COLUMN IF NOT EXISTS reporter_confidence TEXT;

  END IF;
END$$;

-- ============================================================================
-- PHASE 5: Index for efficient ecology queries
-- ============================================================================

-- Index for recent observations (without date predicate since CURRENT_DATE is not immutable)
CREATE INDEX IF NOT EXISTS idx_colony_estimates_place_date
ON trapper.place_colony_estimates(place_id, observation_date DESC NULLS LAST);

-- Index for ear-tip data queries
CREATE INDEX IF NOT EXISTS idx_colony_estimates_eartip_data
ON trapper.place_colony_estimates(place_id)
WHERE eartip_count_observed IS NOT NULL AND total_cats_observed IS NOT NULL;

-- ============================================================================
-- Summary of ecology calculations
-- ============================================================================
/*
ECOLOGY-BASED COLONY ESTIMATION SUMMARY

1. LOWER-BOUND RATE (p_lower) - Always computed when data available
   - Formula: A_known / MAX(A_known, N_recent_max)
   - Never over-claims (defensible minimum)
   - Use when: No ear-tip observation data

2. MARK-RESIGHT (Chapman) - When ear-tip counts available
   - Formula: N_hat = ((M+1)(C+1)/(R+1)) - 1
   - Where: M = A_known (ear-tipped cats from clinic)
           C = total cats observed during survey
           R = ear-tipped cats seen during survey
   - Alteration rate: p_hat = M / N_hat
   - More accurate statistical estimate

3. CONFIDENCE TIERS
   - Tier 1: Mark-resight with 3+ observations = "Ecology Grade"
   - Tier 2: Lower-bound with recent reports = "Estimated"
   - Tier 3: Verified only (no surveys) = "Minimum Known"

4. DATA COLLECTION PRIORITIES
   - Essential: Peak count, total cats observed
   - Valuable: Ear-tip count (enables mark-resight upgrade)
   - Helpful: Observation context (time, feeding station, confidence)
*/
