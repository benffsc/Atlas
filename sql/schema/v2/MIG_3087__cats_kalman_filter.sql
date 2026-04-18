-- MIG_3087: CATS — Credibility-Weighted Kalman Filter for Colony Population Estimation
--
-- Purpose: Unified population model that fuses 9 observation sources into a single
-- credibility-weighted estimate per place, using a 1D Kalman filter.
--
-- Why: 95% of places show only floor counts from clinic records or nothing at all.
-- Observations from different sources (intake forms, site visits, clinic records)
-- have wildly different reliability and don't feed into a unified estimate.
--
-- Architecture:
--   sot.place_population_state  — one row per place (current Kalman state)
--   sot.population_observations — audit log of every Kalman update
--   sot.get_altered_cat_count_at_place() — floor count helper
--   sot.update_population_estimate() — core Kalman function
--   trigger on sot.cat_place INSERT — auto-update on new clinic links
--   backfill — replays historical observations chronologically
--   v_place_colony_status replaced — prefers Kalman when available

-- ============================================================
-- PART A: State Table — sot.place_population_state
-- ============================================================

CREATE TABLE IF NOT EXISTS sot.place_population_state (
  place_id          UUID PRIMARY KEY REFERENCES sot.places(place_id),
  estimate          NUMERIC NOT NULL DEFAULT 0,
  variance          NUMERIC NOT NULL DEFAULT 100,  -- initial high uncertainty
  last_observation_date DATE,
  last_source_type  TEXT,
  observation_count INTEGER NOT NULL DEFAULT 0,
  floor_count       INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_place_population_state_estimate
  ON sot.place_population_state(estimate DESC);

COMMENT ON TABLE sot.place_population_state IS
  'Current Kalman filter state for colony population estimation. One row per place.';

-- ============================================================
-- PART B: Observation Audit Log — sot.population_observations
-- ============================================================

CREATE TABLE IF NOT EXISTS sot.population_observations (
  observation_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id            UUID NOT NULL REFERENCES sot.places(place_id),
  observed_count      INTEGER NOT NULL,
  source_type         TEXT NOT NULL,
  observation_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  source_record_id    TEXT,
  -- Kalman state snapshot
  estimate_before     NUMERIC,
  estimate_after      NUMERIC NOT NULL,
  variance_after      NUMERIC NOT NULL,
  floor_count         INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_population_obs_place
  ON sot.population_observations(place_id, observation_date DESC);

CREATE INDEX IF NOT EXISTS idx_population_obs_source
  ON sot.population_observations(source_type);

COMMENT ON TABLE sot.population_observations IS
  'Audit log of every Kalman filter update. Each row = one observation processed.';

-- ============================================================
-- PART C: Floor Count Helper
-- ============================================================

CREATE OR REPLACE FUNCTION sot.get_altered_cat_count_at_place(p_place_id UUID)
RETURNS INTEGER
LANGUAGE sql STABLE
AS $$
  SELECT COUNT(DISTINCT cp.cat_id)::INTEGER
  FROM sot.cat_place cp
  JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
  WHERE cp.place_id = p_place_id
    AND cp.relationship_type IN ('home', 'residence', 'colony_member', 'fed_at', 'trapped_at')
    -- TODO(FFS-1280): Add AND (cp.presence_status IS NULL OR cp.presence_status != 'departed')
    -- 86.6% of bridged cats have departed but still count as 'home'. See cats-kalman-presence-dependency.md
    AND EXISTS(
      SELECT 1 FROM ops.cat_procedures proc
      WHERE proc.cat_id = cp.cat_id AND (proc.is_spay OR proc.is_neuter)
    )
$$;

COMMENT ON FUNCTION sot.get_altered_cat_count_at_place IS
  'Count distinct altered cats linked to a place (clinic ground truth floor).';

-- ============================================================
-- PART D: Core Kalman Function
-- ============================================================

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
  v_Q               NUMERIC := 1.0;  -- process noise per month
  v_months_elapsed  NUMERIC;
  v_predicted_var   NUMERIC;
  v_K               NUMERIC;  -- Kalman gain
  v_new_estimate    NUMERIC;
  v_new_variance    NUMERIC;
  v_floor           INTEGER;
  v_estimate_before NUMERIC;
  v_ci_width        NUMERIC;
BEGIN
  -- Source credibility (R values — lower = more trusted)
  v_R_base := CASE p_source_type
    WHEN 'clinic_records'      THEN 1.0
    WHEN 'chapman_estimate'    THEN 3.0
    WHEN 'trapper_site_visit'  THEN 4.0
    WHEN 'staff_observation'   THEN 5.0
    WHEN 'trapping_request'    THEN 12.0
    WHEN 'intake_form'         THEN 15.0
    WHEN 'ai_parsed'           THEN 18.0
    ELSE 10.0  -- unknown source
  END;

  -- R scales with count magnitude: bigger counts = more uncertain
  v_R := v_R_base * (1.0 + p_observed_count::NUMERIC / 10.0);

  -- Get floor count (verified altered cats)
  v_floor := sot.get_altered_cat_count_at_place(p_place_id);

  -- Get or initialize state
  SELECT * INTO v_state
  FROM sot.place_population_state
  WHERE place_id = p_place_id;

  IF NOT FOUND THEN
    -- Initialize: first observation becomes the estimate
    v_new_estimate := GREATEST(p_observed_count, v_floor)::NUMERIC;
    v_new_variance := v_R;

    INSERT INTO sot.place_population_state (
      place_id, estimate, variance, last_observation_date,
      last_source_type, observation_count, floor_count
    ) VALUES (
      p_place_id, v_new_estimate, v_new_variance, p_observation_date,
      p_source_type, 1, v_floor
    );

    -- Log observation
    INSERT INTO sot.population_observations (
      place_id, observed_count, source_type, observation_date,
      source_record_id, estimate_before, estimate_after, variance_after, floor_count
    ) VALUES (
      p_place_id, p_observed_count, p_source_type, p_observation_date,
      p_source_record_id, NULL, v_new_estimate, v_new_variance, v_floor
    );

    -- Return
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

  -- PREDICTION STEP: uncertainty grows Q=1.0/month between observations
  v_estimate_before := v_state.estimate;

  IF v_state.last_observation_date IS NOT NULL AND p_observation_date > v_state.last_observation_date THEN
    v_months_elapsed := EXTRACT(EPOCH FROM (p_observation_date::TIMESTAMP - v_state.last_observation_date::TIMESTAMP))
                        / (30.44 * 86400);  -- avg days per month
    v_predicted_var := v_state.variance + v_Q * v_months_elapsed;
  ELSE
    v_predicted_var := v_state.variance;
  END IF;

  -- UPDATE STEP: Kalman gain and new estimate
  v_K := v_predicted_var / (v_predicted_var + v_R);
  v_new_estimate := v_state.estimate + v_K * (p_observed_count - v_state.estimate);
  v_new_variance := (1.0 - v_K) * v_predicted_var;

  -- FLOOR CONSTRAINT: never below verified altered count
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

  -- Return result
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

COMMENT ON FUNCTION sot.update_population_estimate IS
  'Core Kalman filter: fuses an observation into the running population estimate for a place.';

-- ============================================================
-- PART E: Trigger on sot.cat_place INSERT
-- ============================================================

CREATE OR REPLACE FUNCTION sot.trg_cat_place_kalman_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_altered BOOLEAN;
  v_floor INTEGER;
BEGIN
  -- Only fire for residential relationship types
  IF NEW.relationship_type NOT IN ('home', 'residence', 'colony_member', 'fed_at', 'trapped_at') THEN
    RETURN NEW;
  END IF;

  -- TODO(FFS-1280): Also skip if NEW.presence_status = 'departed'

  -- Check if this cat is altered
  SELECT EXISTS(
    SELECT 1 FROM ops.cat_procedures proc
    WHERE proc.cat_id = NEW.cat_id AND (proc.is_spay OR proc.is_neuter)
  ) INTO v_is_altered;

  IF NOT v_is_altered THEN
    RETURN NEW;
  END IF;

  -- Get floor count (will include this newly linked cat)
  v_floor := sot.get_altered_cat_count_at_place(NEW.place_id);

  -- Feed floor count as a clinic_records observation
  PERFORM sot.update_population_estimate(
    NEW.place_id,
    v_floor,
    'clinic_records',
    CURRENT_DATE,
    'cat_place_trigger:' || NEW.cat_id::TEXT
  );

  RETURN NEW;
END;
$$;

-- Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS trg_cat_place_kalman ON sot.cat_place;

CREATE TRIGGER trg_cat_place_kalman
  AFTER INSERT ON sot.cat_place
  FOR EACH ROW
  EXECUTE FUNCTION sot.trg_cat_place_kalman_update();

-- ============================================================
-- PART F: Backfill — replay historical observations chronologically
-- ============================================================

DO $$
DECLARE
  v_obs RECORD;
  v_count INTEGER := 0;
  v_skipped INTEGER := 0;
BEGIN
  RAISE NOTICE 'MIG_3087: Starting Kalman backfill...';

  -- Process all historical observations in chronological order
  -- Source 1: place_colony_estimates (legacy colony data)
  -- Source 2: site_observations (field visits)
  -- Source 3: requests with total_cats_reported
  -- Source 4: clinic records (altered cat count per place)

  FOR v_obs IN (
    -- Legacy colony estimates
    SELECT
      pce.place_id,
      COALESCE(pce.chapman_estimate::INTEGER, pce.total_count_observed) AS observed_count,
      CASE
        WHEN pce.chapman_estimate IS NOT NULL THEN 'chapman_estimate'
        ELSE 'staff_observation'
      END AS source_type,
      COALESCE(pce.observed_date, pce.created_at::DATE) AS obs_date,
      'legacy_colony_estimate:' || pce.estimate_id::TEXT AS source_record_id
    FROM sot.place_colony_estimates pce
    JOIN sot.places p ON p.place_id = pce.place_id AND p.merged_into_place_id IS NULL
    WHERE COALESCE(pce.chapman_estimate::INTEGER, pce.total_count_observed) IS NOT NULL
      AND COALESCE(pce.chapman_estimate::INTEGER, pce.total_count_observed) > 0

    UNION ALL

    -- Site observations with cat counts
    SELECT
      so.place_id,
      so.cats_seen_total AS observed_count,
      CASE so.observer_type
        WHEN 'trapper_field' THEN 'trapper_site_visit'
        WHEN 'staff_phone_call' THEN 'staff_observation'
        WHEN 'client_report' THEN 'intake_form'
        WHEN 'requester_update' THEN 'intake_form'
        WHEN 'admin_entry' THEN 'staff_observation'
        ELSE 'staff_observation'
      END AS source_type,
      so.observation_date AS obs_date,
      'site_observation:' || so.observation_id::TEXT AS source_record_id
    FROM ops.site_observations so
    JOIN sot.places p ON p.place_id = so.place_id AND p.merged_into_place_id IS NULL
    WHERE so.cats_seen_total IS NOT NULL
      AND so.cats_seen_total > 0
      AND so.place_id IS NOT NULL

    UNION ALL

    -- Requests with total_cats_reported
    SELECT
      r.place_id,
      r.total_cats_reported AS observed_count,
      'trapping_request' AS source_type,
      COALESCE(r.source_created_at::DATE, r.created_at::DATE) AS obs_date,
      'request:' || r.request_id::TEXT AS source_record_id
    FROM ops.requests r
    JOIN sot.places p ON p.place_id = r.place_id AND p.merged_into_place_id IS NULL
    WHERE r.total_cats_reported IS NOT NULL
      AND r.total_cats_reported > 0
      AND r.place_id IS NOT NULL

    ORDER BY obs_date ASC NULLS LAST
  )
  LOOP
    BEGIN
      PERFORM sot.update_population_estimate(
        v_obs.place_id,
        v_obs.observed_count,
        v_obs.source_type,
        COALESCE(v_obs.obs_date, CURRENT_DATE),
        v_obs.source_record_id
      );
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      -- Continue on individual failures
    END;
  END LOOP;

  -- Now backfill clinic floor counts for places with altered cats but no observations yet
  FOR v_obs IN (
    SELECT
      cp.place_id,
      COUNT(DISTINCT cp.cat_id)::INTEGER AS floor_count
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    JOIN sot.places p ON p.place_id = cp.place_id AND p.merged_into_place_id IS NULL
    WHERE cp.relationship_type IN ('home', 'residence', 'colony_member', 'fed_at', 'trapped_at')
      AND EXISTS(
        SELECT 1 FROM ops.cat_procedures proc
        WHERE proc.cat_id = cp.cat_id AND (proc.is_spay OR proc.is_neuter)
      )
      AND NOT EXISTS(
        SELECT 1 FROM sot.place_population_state pps WHERE pps.place_id = cp.place_id
      )
    GROUP BY cp.place_id
    HAVING COUNT(DISTINCT cp.cat_id) > 0
  )
  LOOP
    BEGIN
      PERFORM sot.update_population_estimate(
        v_obs.place_id,
        v_obs.floor_count,
        'clinic_records',
        CURRENT_DATE,
        'backfill_clinic_floor'
      );
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RAISE NOTICE 'MIG_3087: Kalman backfill complete. % observations processed, % skipped.', v_count, v_skipped;
END;
$$;

-- ============================================================
-- PART G: Replace v_place_colony_status view
-- ============================================================

-- Drop and recreate with Kalman columns
DROP VIEW IF EXISTS sot.v_place_colony_status CASCADE;

CREATE OR REPLACE VIEW sot.v_place_colony_status AS
SELECT
  p.place_id,
  p.display_name,
  p.formatted_address,
  -- Prefer Kalman estimate when available, fall back to legacy
  COALESCE(
    ROUND(pps.estimate)::INTEGER,
    COALESCE(pce.chapman_estimate::INTEGER, pce.total_count_observed),
    cc.total_cats
  ) AS colony_size_estimate,
  COALESCE(pce.estimate_method, 'unknown') AS estimation_method,
  CASE
    WHEN pps.place_id IS NOT NULL THEN
      CASE
        WHEN pps.variance <= 5 THEN 1.0
        WHEN pps.variance <= 20 THEN 0.7
        ELSE 0.4
      END
    ELSE COALESCE(1.0, NULL)
  END::NUMERIC AS estimate_confidence,
  COALESCE(pps.last_observation_date, pce.observed_date) AS estimated_at,
  -- Cat counts from relationships
  COALESCE(cc.total_cats, 0) AS total_cats,
  COALESCE(cc.altered_cats, 0) AS verified_altered_count,
  -- Work remaining
  GREATEST(0,
    COALESCE(
      ROUND(pps.estimate)::INTEGER,
      COALESCE(pce.chapman_estimate::INTEGER, pce.total_count_observed),
      cc.total_cats,
      0
    ) - COALESCE(cc.altered_cats, 0)
  ) AS estimated_work_remaining,
  -- Alteration rate
  CASE
    WHEN COALESCE(cc.total_cats, 0) > 0
    THEN ROUND((COALESCE(cc.altered_cats, 0)::NUMERIC / cc.total_cats) * 100, 1)
    ELSE 0
  END AS alteration_rate_pct,
  -- Override tracking
  COALESCE(pce.has_override, FALSE) AS has_override,
  pce.override_note AS colony_override_note,
  -- Active request count
  COALESCE(req.active_count, 0) AS active_request_count,
  -- Colony site flag
  EXISTS(
    SELECT 1 FROM sot.place_contexts pc
    WHERE pc.place_id = p.place_id
      AND pc.context_type IN ('colony', 'colony_site', 'feeding_station')
      AND pc.valid_to IS NULL
  ) AS is_colony_site,
  -- NEW Kalman columns
  CASE WHEN pps.place_id IS NOT NULL THEN
    GREATEST(COALESCE(pps.floor_count, 0), FLOOR(pps.estimate - 1.96 * SQRT(pps.variance)))::INTEGER
  END AS ci_lower,
  CASE WHEN pps.place_id IS NOT NULL THEN
    CEIL(pps.estimate + 1.96 * SQRT(pps.variance))::INTEGER
  END AS ci_upper,
  CASE
    WHEN pps.place_id IS NULL THEN NULL
    WHEN pps.variance <= 5 THEN 'high'
    WHEN pps.variance <= 20 THEN 'medium'
    ELSE 'low'
  END AS confidence_level,
  pps.observation_count AS kalman_observation_count,
  pps.variance AS kalman_variance
FROM sot.places p
LEFT JOIN sot.place_population_state pps ON pps.place_id = p.place_id
LEFT JOIN LATERAL (
  SELECT
    pce_inner.total_count_observed,
    pce_inner.chapman_estimate,
    pce_inner.estimate_method,
    pce_inner.observed_date,
    FALSE AS has_override,
    pce_inner.observer_notes AS override_note
  FROM sot.place_colony_estimates pce_inner
  WHERE pce_inner.place_id = p.place_id
  ORDER BY pce_inner.observed_date DESC NULLS LAST
  LIMIT 1
) pce ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COUNT(DISTINCT cp.cat_id) AS total_cats,
    COUNT(DISTINCT cp.cat_id) FILTER (
      WHERE EXISTS(
        SELECT 1 FROM ops.cat_procedures proc
        WHERE proc.cat_id = cp.cat_id AND (proc.is_spay OR proc.is_neuter)
      )
    ) AS altered_cats
  FROM sot.cat_place cp
  JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
  WHERE cp.place_id = p.place_id
  -- TODO(FFS-1280): Add AND (cp.presence_status IS NULL OR cp.presence_status != 'departed')
) cc ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS active_count
  FROM ops.requests r
  WHERE r.place_id = p.place_id
    AND r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
) req ON TRUE
WHERE p.merged_into_place_id IS NULL;

-- ============================================================
-- VERIFICATION
-- ============================================================

DO $$
DECLARE
  v_state_count INTEGER;
  v_obs_count INTEGER;
  v_view_cols TEXT[];
BEGIN
  SELECT COUNT(*) INTO v_state_count FROM sot.place_population_state;
  SELECT COUNT(*) INTO v_obs_count FROM sot.population_observations;

  -- Verify view has expected columns
  SELECT array_agg(column_name ORDER BY ordinal_position) INTO v_view_cols
  FROM information_schema.columns
  WHERE table_schema = 'sot' AND table_name = 'v_place_colony_status';

  ASSERT 'colony_size_estimate' = ANY(v_view_cols), 'Missing colony_size_estimate in view';
  ASSERT 'ci_lower' = ANY(v_view_cols), 'Missing ci_lower in view';
  ASSERT 'ci_upper' = ANY(v_view_cols), 'Missing ci_upper in view';
  ASSERT 'confidence_level' = ANY(v_view_cols), 'Missing confidence_level in view';
  ASSERT 'kalman_observation_count' = ANY(v_view_cols), 'Missing kalman_observation_count in view';

  RAISE NOTICE 'MIG_3087: CATS Kalman filter deployed successfully';
  RAISE NOTICE 'MIG_3087: % places with population state, % observations logged', v_state_count, v_obs_count;
  RAISE NOTICE 'MIG_3087: v_place_colony_status view recreated with Kalman + CI columns';
END;
$$;
