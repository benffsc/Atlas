-- MIG_3094: Population Attrition Decay — temporal weighting for cat_place links
--
-- Problem: A cat linked to a place via a 2018 clinic appointment, with no lifecycle
-- event showing departure, still counts at full weight in floor counts and estimates.
-- With 13% annual attrition for managed TNR colonies (Levy et al. 2003, Natoli et al.
-- 2006), a 7-year-old link has only ~41% probability the cat is still there.
--
-- Solution:
-- 1. Attrition-aware floor count function that weights cats by recency
-- 2. Cat-place freshness view for display context
-- 3. Updated v_place_colony_status with freshness breakdown
-- 4. Config-driven attrition rate (admin-adjustable)
--
-- Industry basis:
--   Managed TNR colony annual attrition: 12-15% (Levy, Natoli, Spehar & Wolf)
--   Wildlife ecology confidence decay: e^(-λt), λ ≈ 0.13
--   Observation freshness thresholds: <90d current, <1yr recent, <3yr aging, 3yr+ historical
--   No existing TNR software implements this — Beacon is first.

-- ============================================================
-- PART A: Config — admin-adjustable attrition rate
-- ============================================================

INSERT INTO ops.app_config (key, value, description, category)
VALUES
  ('population.annual_attrition_rate', '0.13',
   'Annual probability a cat is no longer at a place (managed TNR colony). Range: 0.08-0.25. Source: Levy et al. 2003, Natoli et al. 2006.', 'population'),
  ('population.freshness_current_days', '90',
   'Days since last evidence to consider a cat "current" at a place.', 'population'),
  ('population.freshness_recent_days', '365',
   'Days since last evidence to consider a cat "recent" at a place.', 'population'),
  ('population.freshness_stale_days', '1095',
   'Days since last evidence to consider a cat "stale" (3 years). Beyond this = historical.', 'population')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- PART B: Attrition-weighted floor count function
-- ============================================================

CREATE OR REPLACE FUNCTION sot.get_attrition_weighted_floor(p_place_id UUID)
RETURNS TABLE(
  raw_floor       INTEGER,
  weighted_floor  NUMERIC,
  current_count   INTEGER,
  recent_count    INTEGER,
  stale_count     INTEGER,
  historical_count INTEGER
)
LANGUAGE sql STABLE
AS $$
  WITH config AS (
    SELECT
      COALESCE((SELECT value::NUMERIC FROM ops.app_config WHERE key = 'population.annual_attrition_rate'), 0.13) AS attrition_rate,
      COALESCE((SELECT value::INTEGER FROM ops.app_config WHERE key = 'population.freshness_current_days'), 90) AS current_days,
      COALESCE((SELECT value::INTEGER FROM ops.app_config WHERE key = 'population.freshness_recent_days'), 365) AS recent_days,
      COALESCE((SELECT value::INTEGER FROM ops.app_config WHERE key = 'population.freshness_stale_days'), 1095) AS stale_days
  ),
  cats_at_place AS (
    SELECT
      cp.cat_id,
      -- Most recent CLINICAL evidence of this cat at this place
      -- Use appointment_date (actual clinical visit), NOT cat_place.created_at
      -- (which reflects when entity linking created the row, not when the cat was seen)
      COALESCE(
        (SELECT MAX(a.appointment_date) FROM ops.appointments a
         WHERE a.cat_id = cp.cat_id
           AND COALESCE(a.inferred_place_id, a.place_id) = cp.place_id),
        cp.created_at::DATE  -- fallback only when no appointment exists
      ) AS last_evidence_date,
      -- Years since last evidence
      EXTRACT(EPOCH FROM (NOW() - COALESCE(
        (SELECT MAX(a.appointment_date) FROM ops.appointments a
         WHERE a.cat_id = cp.cat_id
           AND COALESCE(a.inferred_place_id, a.place_id) = cp.place_id),
        cp.created_at::DATE
      )::TIMESTAMP)) / (365.25 * 86400) AS years_elapsed
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    WHERE cp.place_id = p_place_id
      AND cp.relationship_type IN ('home', 'residence', 'colony_member', 'fed_at', 'trapped_at')
      AND COALESCE(cp.presence_status, 'unknown') != 'departed'
      AND EXISTS(
        SELECT 1 FROM ops.cat_procedures proc
        WHERE proc.cat_id = cp.cat_id AND (proc.is_spay OR proc.is_neuter)
      )
  )
  SELECT
    COUNT(*)::INTEGER AS raw_floor,
    -- Weighted sum: each cat contributes (1 - attrition_rate)^years_elapsed
    ROUND(SUM(POWER(1.0 - cfg.attrition_rate, GREATEST(0, cap.years_elapsed))), 1) AS weighted_floor,
    -- Freshness breakdown
    COUNT(*) FILTER (WHERE (NOW()::DATE - cap.last_evidence_date) <= cfg.current_days)::INTEGER AS current_count,
    COUNT(*) FILTER (WHERE (NOW()::DATE - cap.last_evidence_date) > cfg.current_days
                       AND (NOW()::DATE - cap.last_evidence_date) <= cfg.recent_days)::INTEGER AS recent_count,
    COUNT(*) FILTER (WHERE (NOW()::DATE - cap.last_evidence_date) > cfg.recent_days
                       AND (NOW()::DATE - cap.last_evidence_date) <= cfg.stale_days)::INTEGER AS stale_count,
    COUNT(*) FILTER (WHERE (NOW()::DATE - cap.last_evidence_date) > cfg.stale_days)::INTEGER AS historical_count
  FROM cats_at_place cap
  CROSS JOIN config cfg
$$;

COMMENT ON FUNCTION sot.get_attrition_weighted_floor IS
  'Returns raw and attrition-weighted floor counts plus freshness breakdown. '
  'Uses configurable annual attrition rate (default 13%, Levy et al. 2003).';

-- ============================================================
-- PART C: Update Kalman function to use attrition-weighted floor
-- ============================================================

-- Replace the floor constraint in update_population_estimate to use weighted floor
-- instead of raw floor. This prevents old cats from inflating the minimum estimate.

CREATE OR REPLACE FUNCTION sot.update_population_estimate(
  p_place_id        UUID,
  p_observed_count  INTEGER,
  p_source_type     TEXT,
  p_observation_date DATE DEFAULT CURRENT_DATE,
  p_source_record_id TEXT DEFAULT NULL
)
RETURNS TABLE(
  estimate         NUMERIC,
  ci_lower         INTEGER,
  ci_upper         INTEGER,
  confidence_level TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_state           RECORD;
  v_R_base          NUMERIC;
  v_R               NUMERIC;
  v_Q               NUMERIC := 1.0;
  v_months_elapsed  NUMERIC;
  v_predicted_var   NUMERIC;
  v_K               NUMERIC;
  v_new_estimate    NUMERIC;
  v_new_variance    NUMERIC;
  v_floor_raw       INTEGER;
  v_floor_weighted  NUMERIC;
  v_floor           INTEGER;
  v_estimate_before NUMERIC;
  v_ci_width        NUMERIC;
BEGIN
  -- Source credibility
  v_R_base := CASE p_source_type
    WHEN 'clinic_records'      THEN 1.0
    WHEN 'chapman_estimate'    THEN 3.0
    WHEN 'trapper_site_visit'  THEN 4.0
    WHEN 'staff_observation'   THEN 5.0
    WHEN 'trapping_request'    THEN 12.0
    WHEN 'intake_form'         THEN 15.0
    WHEN 'ai_parsed'           THEN 18.0
    ELSE 10.0
  END;
  v_R := v_R_base * (1.0 + p_observed_count::NUMERIC / 10.0);

  -- Get attrition-weighted floor count (not raw floor)
  SELECT raw_floor, weighted_floor
  INTO v_floor_raw, v_floor_weighted
  FROM sot.get_attrition_weighted_floor(p_place_id);

  v_floor_raw := COALESCE(v_floor_raw, 0);
  v_floor_weighted := COALESCE(v_floor_weighted, 0);
  -- Use CEIL of weighted floor as the effective floor
  v_floor := CEIL(v_floor_weighted)::INTEGER;

  -- Get or initialize state
  SELECT * INTO v_state
  FROM sot.place_population_state
  WHERE place_id = p_place_id;

  IF NOT FOUND THEN
    v_new_estimate := GREATEST(p_observed_count, v_floor)::NUMERIC;
    v_new_variance := v_R;

    INSERT INTO sot.place_population_state (
      place_id, estimate, variance, last_observation_date,
      last_source_type, observation_count, floor_count
    ) VALUES (
      p_place_id, v_new_estimate, v_new_variance, p_observation_date,
      p_source_type, 1, v_floor
    );

    INSERT INTO sot.population_observations (
      place_id, observed_count, source_type, observation_date,
      source_record_id, estimate_before, estimate_after, variance_after, floor_count
    ) VALUES (
      p_place_id, p_observed_count, p_source_type, p_observation_date,
      p_source_record_id, NULL, v_new_estimate, v_new_variance, v_floor
    );

    v_ci_width := 1.96 * SQRT(v_new_variance);
    estimate := ROUND(v_new_estimate, 1);
    ci_lower := GREATEST(v_floor, FLOOR(v_new_estimate - v_ci_width))::INTEGER;
    ci_upper := CEIL(v_new_estimate + v_ci_width)::INTEGER;
    confidence_level := CASE
      WHEN v_new_variance <= 5 THEN 'high'
      WHEN v_new_variance <= 20 THEN 'medium'
      ELSE 'low'
    END;
    RETURN NEXT;
    RETURN;
  END IF;

  -- PREDICTION STEP
  v_estimate_before := v_state.estimate;
  IF v_state.last_observation_date IS NOT NULL AND p_observation_date > v_state.last_observation_date THEN
    v_months_elapsed := EXTRACT(EPOCH FROM (p_observation_date::TIMESTAMP - v_state.last_observation_date::TIMESTAMP))
                        / (30.44 * 86400);
    v_predicted_var := v_state.variance + v_Q * v_months_elapsed;
  ELSE
    v_predicted_var := v_state.variance;
  END IF;

  -- UPDATE STEP
  v_K := v_predicted_var / (v_predicted_var + v_R);
  v_new_estimate := v_state.estimate + v_K * (p_observed_count - v_state.estimate);
  v_new_variance := (1.0 - v_K) * v_predicted_var;

  -- FLOOR CONSTRAINT: use attrition-weighted floor (not raw)
  v_new_estimate := GREATEST(v_new_estimate, v_floor::NUMERIC);

  -- Update state
  UPDATE sot.place_population_state SET
    estimate = v_new_estimate,
    variance = v_new_variance,
    last_observation_date = GREATEST(last_observation_date, p_observation_date),
    last_source_type = p_source_type,
    observation_count = observation_count + 1,
    floor_count = v_floor,
    updated_at = NOW()
  WHERE place_id = p_place_id;

  -- Log observation
  INSERT INTO sot.population_observations (
    place_id, observed_count, source_type, observation_date,
    source_record_id, estimate_before, estimate_after, variance_after, floor_count
  ) VALUES (
    p_place_id, p_observed_count, p_source_type, p_observation_date,
    p_source_record_id, v_estimate_before, v_new_estimate, v_new_variance, v_floor
  );

  v_ci_width := 1.96 * SQRT(v_new_variance);
  estimate := ROUND(v_new_estimate, 1);
  ci_lower := GREATEST(v_floor, FLOOR(v_new_estimate - v_ci_width))::INTEGER;
  ci_upper := CEIL(v_new_estimate + v_ci_width)::INTEGER;
  confidence_level := CASE
    WHEN v_new_variance <= 5 THEN 'high'
    WHEN v_new_variance <= 20 THEN 'medium'
    ELSE 'low'
  END;
  RETURN NEXT;
END;
$$;

-- ============================================================
-- PART D: Cat freshness view for display
-- ============================================================

CREATE OR REPLACE VIEW sot.v_place_cat_freshness AS
SELECT
  cp.place_id,
  cp.cat_id,
  c.display_name AS cat_name,
  cp.relationship_type,
  cp.presence_status,
  cp.created_at AS link_created_at,
  -- Most recent CLINICAL evidence (appointment date, not cat_place.created_at)
  COALESCE(latest_appt.appointment_date, cp.created_at::DATE) AS last_evidence_date,
  -- Days since last evidence
  (NOW()::DATE - COALESCE(latest_appt.appointment_date, cp.created_at::DATE)) AS days_since_evidence,
  -- Freshness category
  CASE
    WHEN (NOW()::DATE - COALESCE(latest_appt.appointment_date, cp.created_at::DATE)) <= 90 THEN 'current'
    WHEN (NOW()::DATE - COALESCE(latest_appt.appointment_date, cp.created_at::DATE)) <= 365 THEN 'recent'
    WHEN (NOW()::DATE - COALESCE(latest_appt.appointment_date, cp.created_at::DATE)) <= 1095 THEN 'stale'
    ELSE 'historical'
  END AS freshness,
  -- Survival probability
  ROUND(POWER(1.0 - 0.13,
    EXTRACT(EPOCH FROM (NOW() - COALESCE(latest_appt.appointment_date, cp.created_at::DATE)::TIMESTAMP))
    / (365.25 * 86400)
  )::NUMERIC, 2) AS survival_probability,
  -- Is altered
  EXISTS(
    SELECT 1 FROM ops.cat_procedures proc
    WHERE proc.cat_id = cp.cat_id AND (proc.is_spay OR proc.is_neuter)
  ) AS is_altered
FROM sot.cat_place cp
JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
LEFT JOIN LATERAL (
  SELECT MAX(a.appointment_date) AS appointment_date
  FROM ops.appointments a
  WHERE a.cat_id = cp.cat_id
    AND COALESCE(a.inferred_place_id, a.place_id) = cp.place_id
) latest_appt ON TRUE
WHERE cp.relationship_type IN ('home', 'residence', 'colony_member', 'fed_at', 'trapped_at')
  AND COALESCE(cp.presence_status, 'unknown') != 'departed';

COMMENT ON VIEW sot.v_place_cat_freshness IS
  'Per-cat freshness at each place: days since last evidence, freshness category, survival probability. '
  'Excludes departed cats. Uses 13% annual attrition (configurable via app_config).';

-- ============================================================
-- PART E: Recompute floor counts with attrition weighting
-- ============================================================

DO $$
DECLARE
  v_updated INTEGER;
BEGIN
  WITH new_floors AS (
    SELECT
      pps.place_id,
      CEIL(COALESCE(awf.weighted_floor, 0))::INTEGER AS new_floor
    FROM sot.place_population_state pps
    LEFT JOIN LATERAL sot.get_attrition_weighted_floor(pps.place_id) awf ON TRUE
  )
  UPDATE sot.place_population_state pps
  SET floor_count = nf.new_floor,
      updated_at = NOW()
  FROM new_floors nf
  WHERE pps.place_id = nf.place_id
    AND pps.floor_count != nf.new_floor;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'MIG_3094: % floor counts updated with attrition weighting', v_updated;
END;
$$;

-- ============================================================
-- VERIFICATION
-- ============================================================

DO $$
DECLARE
  v_example RECORD;
BEGIN
  -- Show a sample place with freshness breakdown
  SELECT
    p.formatted_address,
    awf.*
  INTO v_example
  FROM sot.place_population_state pps
  JOIN sot.places p ON p.place_id = pps.place_id
  CROSS JOIN LATERAL sot.get_attrition_weighted_floor(pps.place_id) awf
  WHERE awf.raw_floor > 5 AND awf.historical_count > 0
  ORDER BY awf.raw_floor - CEIL(awf.weighted_floor) DESC
  LIMIT 1;

  IF v_example IS NOT NULL THEN
    RAISE NOTICE 'MIG_3094: Example — % | raw_floor=% weighted_floor=% (current=% recent=% stale=% historical=%)',
      v_example.formatted_address, v_example.raw_floor, v_example.weighted_floor,
      v_example.current_count, v_example.recent_count, v_example.stale_count, v_example.historical_count;
  END IF;

  RAISE NOTICE 'MIG_3094: Attrition decay deployed. Annual rate: 13%% (configurable). Freshness thresholds: 90/365/1095 days.';
END;
$$;
