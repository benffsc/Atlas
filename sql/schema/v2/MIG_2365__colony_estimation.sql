-- MIG_2365: Colony Estimation using Chapman Mark-Recapture
-- Purpose: Estimate colony populations at places using mark-recapture methodology
--
-- Chapman estimator formula: N = ((M+1)(C+1)/(R+1)) - 1
-- Where:
--   M = Number of cats marked (fixed) in first capture period
--   C = Total cats in second capture period
--   R = Marked cats recaptured in second capture period
--   N = Estimated population
--
-- FFSC is the ONLY dedicated spay/neuter clinic for community cats in Sonoma County.
-- This means FFSC clinic data = verified alterations (ground truth).

-- Note: beacon.colony_estimates already exists with different schema
-- Create place_chapman_estimates for mark-recapture specific data
CREATE TABLE IF NOT EXISTS beacon.place_chapman_estimates (
  place_id UUID PRIMARY KEY REFERENCES sot.places(place_id),

  -- Population estimates
  estimated_population INT,
  ci_lower INT,           -- 95% confidence interval lower bound
  ci_upper INT,           -- 95% confidence interval upper bound

  -- Chapman parameters
  marked_count INT,       -- M: cats marked (fixed) in first capture
  capture_count INT,      -- C: total cats in second capture
  recapture_count INT,    -- R: marked cats recaptured

  -- Quality indicators
  estimation_method TEXT DEFAULT 'chapman',
  sample_adequate BOOLEAN DEFAULT false,  -- True if R >= 7 (rule of thumb)
  confidence_level TEXT,   -- 'high', 'medium', 'low'

  -- Temporal
  observation_start DATE,
  observation_end DATE,
  last_calculated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Metadata
  notes TEXT
);

COMMENT ON TABLE beacon.colony_estimates IS
'Colony population estimates using Chapman mark-recapture methodology.
FFSC is the ONLY dedicated spay/neuter clinic for community cats in Sonoma County,
so FFSC clinic data represents verified alterations (ground truth).';

-- Chapman estimator function
CREATE OR REPLACE FUNCTION beacon.calculate_chapman_estimate(
  p_marked INT,       -- M: cats marked in first period
  p_captured INT,     -- C: total cats in second period
  p_recaptured INT    -- R: marked cats recaptured
) RETURNS TABLE (
  estimated_population INT,
  ci_lower INT,
  ci_upper INT,
  sample_adequate BOOLEAN
) AS $$
DECLARE
  v_n NUMERIC;
  v_variance NUMERIC;
  v_se NUMERIC;
BEGIN
  -- Validate inputs
  IF p_marked < 1 OR p_captured < 1 OR p_recaptured < 1 THEN
    RETURN QUERY SELECT NULL::INT, NULL::INT, NULL::INT, false;
    RETURN;
  END IF;

  -- Chapman estimator: N = ((M+1)(C+1)/(R+1)) - 1
  v_n := ((p_marked + 1.0) * (p_captured + 1.0) / (p_recaptured + 1.0)) - 1;

  -- Variance estimate (Seber 1982)
  v_variance := ((p_marked + 1.0) * (p_captured + 1.0) *
                 (p_marked - p_recaptured) * (p_captured - p_recaptured)) /
                ((p_recaptured + 1.0)^2 * (p_recaptured + 2.0));

  v_se := sqrt(v_variance);

  -- Return estimates with 95% CI (±1.96 SE)
  RETURN QUERY SELECT
    ROUND(v_n)::INT as estimated_population,
    GREATEST(p_marked, ROUND(v_n - 1.96 * v_se))::INT as ci_lower,
    ROUND(v_n + 1.96 * v_se)::INT as ci_upper,
    (p_recaptured >= 7) as sample_adequate;  -- Rule of thumb for adequate recaptures
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION beacon.calculate_chapman_estimate IS
'Chapman mark-recapture population estimator.
Returns estimated population, 95% CI bounds, and sample adequacy flag.
Rule of thumb: R >= 7 for adequate sample size.';

-- Estimate colony population for a specific place
CREATE OR REPLACE FUNCTION beacon.estimate_colony_population(
  p_place_id UUID,
  p_observation_days INT DEFAULT 365
) RETURNS beacon.colony_estimates AS $$
DECLARE
  v_result beacon.colony_estimates;
  v_marked INT;
  v_captured INT;
  v_recaptured INT;
  v_estimate RECORD;
  v_start_date DATE;
  v_end_date DATE;
  v_midpoint DATE;
BEGIN
  -- Calculate observation window
  v_end_date := CURRENT_DATE;
  v_start_date := v_end_date - (p_observation_days || ' days')::INTERVAL;
  v_midpoint := v_start_date + ((p_observation_days / 2) || ' days')::INTERVAL;

  -- M: Cats seen and marked (altered) in first half of observation window
  SELECT COUNT(DISTINCT a.cat_id) INTO v_marked
  FROM ops.appointments a
  WHERE (a.place_id = p_place_id OR a.inferred_place_id = p_place_id)
    AND a.appointment_date BETWEEN v_start_date AND v_midpoint
    AND (a.is_spay = true OR a.is_neuter = true)
    AND a.cat_id IS NOT NULL;

  -- C: Total distinct cats seen in second half
  SELECT COUNT(DISTINCT a.cat_id) INTO v_captured
  FROM ops.appointments a
  WHERE (a.place_id = p_place_id OR a.inferred_place_id = p_place_id)
    AND a.appointment_date > v_midpoint AND a.appointment_date <= v_end_date
    AND a.cat_id IS NOT NULL;

  -- R: Cats seen in both periods (recaptures)
  SELECT COUNT(DISTINCT a.cat_id) INTO v_recaptured
  FROM ops.appointments a
  WHERE (a.place_id = p_place_id OR a.inferred_place_id = p_place_id)
    AND a.appointment_date > v_midpoint AND a.appointment_date <= v_end_date
    AND a.cat_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM ops.appointments a2
      WHERE a2.cat_id = a.cat_id
        AND (a2.place_id = p_place_id OR a2.inferred_place_id = p_place_id)
        AND a2.appointment_date BETWEEN v_start_date AND v_midpoint
        AND (a2.is_spay = true OR a2.is_neuter = true)
    );

  -- Skip if no data
  IF v_marked = 0 OR v_captured = 0 THEN
    RETURN NULL;
  END IF;

  -- Calculate estimate
  SELECT * INTO v_estimate FROM beacon.calculate_chapman_estimate(v_marked, v_captured, GREATEST(v_recaptured, 1));

  -- Build result
  v_result.place_id := p_place_id;
  v_result.estimated_population := v_estimate.estimated_population;
  v_result.ci_lower := v_estimate.ci_lower;
  v_result.ci_upper := v_estimate.ci_upper;
  v_result.marked_count := v_marked;
  v_result.capture_count := v_captured;
  v_result.recapture_count := v_recaptured;
  v_result.sample_adequate := v_estimate.sample_adequate;
  v_result.observation_start := v_start_date;
  v_result.observation_end := v_end_date;
  v_result.last_calculated_at := NOW();
  v_result.confidence_level := CASE
    WHEN v_recaptured >= 10 THEN 'high'
    WHEN v_recaptured >= 5 THEN 'medium'
    ELSE 'low'
  END;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION beacon.estimate_colony_population IS
'Estimate colony population for a single place using Chapman mark-recapture.
Divides observation window into two periods and calculates M, C, R.';

-- Calculate estimates for all places with sufficient data
CREATE OR REPLACE FUNCTION beacon.calculate_all_colony_estimates(
  p_observation_days INT DEFAULT 365,
  p_min_cats INT DEFAULT 3
) RETURNS INT AS $$
DECLARE
  v_count INT := 0;
  v_place_id UUID;
  v_estimate RECORD;
BEGIN
  -- Find places with at least min_cats appointments
  FOR v_place_id IN
    SELECT DISTINCT COALESCE(a.place_id, a.inferred_place_id) as pid
    FROM ops.appointments a
    WHERE a.appointment_date >= CURRENT_DATE - (p_observation_days || ' days')::INTERVAL
      AND (a.is_spay = true OR a.is_neuter = true)
      AND a.cat_id IS NOT NULL
      AND COALESCE(a.place_id, a.inferred_place_id) IS NOT NULL
    GROUP BY COALESCE(a.place_id, a.inferred_place_id)
    HAVING COUNT(DISTINCT a.cat_id) >= p_min_cats
  LOOP
    SELECT * INTO v_estimate FROM beacon.estimate_colony_population(v_place_id, p_observation_days);

    IF v_estimate IS NOT NULL AND v_estimate.place_id IS NOT NULL THEN
      INSERT INTO beacon.colony_estimates (
        place_id, estimated_population, ci_lower, ci_upper,
        marked_count, capture_count, recapture_count,
        sample_adequate, confidence_level,
        observation_start, observation_end, last_calculated_at
      ) VALUES (
        v_estimate.place_id, v_estimate.estimated_population,
        v_estimate.ci_lower, v_estimate.ci_upper,
        v_estimate.marked_count, v_estimate.capture_count, v_estimate.recapture_count,
        v_estimate.sample_adequate, v_estimate.confidence_level,
        v_estimate.observation_start, v_estimate.observation_end, v_estimate.last_calculated_at
      )
      ON CONFLICT (place_id) DO UPDATE SET
        estimated_population = EXCLUDED.estimated_population,
        ci_lower = EXCLUDED.ci_lower,
        ci_upper = EXCLUDED.ci_upper,
        marked_count = EXCLUDED.marked_count,
        capture_count = EXCLUDED.capture_count,
        recapture_count = EXCLUDED.recapture_count,
        sample_adequate = EXCLUDED.sample_adequate,
        confidence_level = EXCLUDED.confidence_level,
        observation_start = EXCLUDED.observation_start,
        observation_end = EXCLUDED.observation_end,
        last_calculated_at = EXCLUDED.last_calculated_at;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION beacon.calculate_all_colony_estimates IS
'Calculate Chapman estimates for all places with sufficient appointment data.
Default: at least 3 distinct cats in the observation window (365 days).
Returns count of places with estimates.';

-- Report
DO $$
BEGIN
  RAISE NOTICE 'MIG_2365: Colony estimation infrastructure created';
  RAISE NOTICE '  Table: beacon.colony_estimates';
  RAISE NOTICE '  Function: beacon.calculate_chapman_estimate(m, c, r)';
  RAISE NOTICE '  Function: beacon.estimate_colony_population(place_id, days)';
  RAISE NOTICE '  Function: beacon.calculate_all_colony_estimates(days, min_cats)';
END $$;
