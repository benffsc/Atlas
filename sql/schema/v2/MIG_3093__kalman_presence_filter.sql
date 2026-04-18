-- MIG_3093: Filter departed cats from Kalman colony estimation (FFS-1280 follow-up)
--
-- MIG_3087 left TODO(FFS-1280) markers in 3 places. Now that MIG_3091 has
-- populated presence_status, this migration resolves them:
--   1. sot.get_altered_cat_count_at_place() — floor count excludes departed
--   2. trg_cat_place_kalman_update() — trigger skips departed cats
--   3. sot.v_place_colony_status — cc lateral join excludes departed
--
-- Without this, Kalman floor counts are still inflated by cats that have left.

\echo ''
\echo '=============================================='
\echo '  MIG_3093: Kalman presence filter'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Update floor count helper
-- ============================================================================

\echo '1. Updating get_altered_cat_count_at_place() to filter departed...'

CREATE OR REPLACE FUNCTION sot.get_altered_cat_count_at_place(p_place_id UUID)
RETURNS INTEGER
LANGUAGE sql STABLE
AS $$
  SELECT COUNT(DISTINCT cp.cat_id)::INTEGER
  FROM sot.cat_place cp
  JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
  WHERE cp.place_id = p_place_id
    AND cp.relationship_type IN ('home', 'residence', 'colony_member', 'fed_at', 'trapped_at')
    AND COALESCE(cp.presence_status, 'unknown') != 'departed'
    AND EXISTS(
      SELECT 1 FROM ops.cat_procedures proc
      WHERE proc.cat_id = cp.cat_id AND (proc.is_spay OR proc.is_neuter)
    )
$$;

-- ============================================================================
-- 2. Update trigger to skip departed cats
-- ============================================================================

\echo '2. Updating trg_cat_place_kalman trigger function...'

CREATE OR REPLACE FUNCTION sot.trg_cat_place_kalman_update()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_is_altered BOOLEAN;
  v_floor INTEGER;
BEGIN
  -- Only fire for residential relationship types
  IF NEW.relationship_type NOT IN ('home', 'residence', 'colony_member', 'fed_at', 'trapped_at') THEN
    RETURN NEW;
  END IF;

  -- Skip departed cats — they shouldn't inflate estimates
  IF NEW.presence_status = 'departed' THEN
    RETURN NEW;
  END IF;

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

-- ============================================================================
-- 3. Rebuild v_place_colony_status with presence filter
-- ============================================================================

\echo '3. Rebuilding v_place_colony_status with departed filter...'

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
  -- Cat counts from relationships (excluding departed)
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
  -- Kalman columns
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
    AND COALESCE(cp.presence_status, 'unknown') != 'departed'
) cc ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS active_count
  FROM ops.requests r
  WHERE r.place_id = p.place_id
    AND r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
) req ON TRUE
WHERE p.merged_into_place_id IS NULL;

COMMENT ON VIEW sot.v_place_colony_status IS
  'Colony status per place: Kalman estimate, floor count, alteration rate. '
  'MIG_3093: excludes departed cats from counts.';

-- ============================================================================
-- 4. Recompute Kalman floor counts with departed cats removed
-- ============================================================================

\echo '4. Recomputing Kalman floor counts...'

UPDATE sot.place_population_state pps
SET floor_count = sot.get_altered_cat_count_at_place(pps.place_id)
WHERE floor_count != sot.get_altered_cat_count_at_place(pps.place_id);

\echo ''
\echo '✓ MIG_3093 complete — Kalman estimation now excludes departed cats'
\echo ''
\echo '  Verify: SELECT formatted_address, total_cats, colony_size_estimate, ci_lower, ci_upper'
\echo '  FROM sot.v_place_colony_status WHERE total_cats > 0 ORDER BY total_cats DESC LIMIT 10;'
\echo ''
