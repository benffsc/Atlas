-- MIG_3034: Colony Population Regression for Beacon Blank Spots
--
-- Problem: 65.5% of places show `insufficient_data` colony trends on Beacon map.
-- Industry approach (Best Friends Animal Society): use demographic regression to
-- estimate colony size from known variables when direct observation is unavailable.
--
-- This migration creates:
-- 1. sot.estimate_colony_population_regression(place_id) — per-place estimator
-- 2. sot.backfill_colony_regression_estimates() — batch runner
-- 3. Config keys for admin-tunable regression coefficients
--
-- Estimates stored as source_type='demographic_regression' with confidence 0.3-0.5.
-- Goal: insufficient_data drops from 65.5% to <40%.
--
-- Created: 2026-03-31

\echo ''
\echo '=============================================='
\echo '  MIG_3034: Colony Population Regression'
\echo '=============================================='
\echo ''

-- ============================================================================
-- Step 1: Seed default regression coefficients in app_config
-- ============================================================================

\echo 'Seeding regression coefficient defaults...'

INSERT INTO ops.app_config (key, value, description, category)
VALUES
  ('beacon.regression_base_colony_size', '3',
   'Base colony size estimate when no data available (median observed colony size for residential)',
   'beacon'),
  ('beacon.regression_coeff_place_kind', '{"house": 1.0, "apartment": 0.6, "mobile_home": 0.8, "business": 1.5, "farm": 2.5, "park": 2.0, "industrial": 1.8, "vacant_lot": 1.5, "other": 1.0}',
   'Place-kind multipliers for colony size regression',
   'beacon'),
  ('beacon.regression_coeff_prior_tnr', '0.15',
   'Per-historical-TNR-appointment adjustment factor (more TNR history = smaller remaining colony)',
   'beacon'),
  ('beacon.regression_coeff_intake_boost', '1.5',
   'Multiplier when place has intake submission (community reported = likely larger colony)',
   'beacon'),
  ('beacon.regression_min_confidence', '0.3',
   'Minimum confidence for regression estimates',
   'beacon'),
  ('beacon.regression_max_confidence', '0.5',
   'Maximum confidence for regression estimates (never higher than direct observation)',
   'beacon')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- Step 2: Colony regression estimate function
-- ============================================================================

\echo 'Creating colony regression function...'

CREATE OR REPLACE FUNCTION sot.estimate_colony_population_regression(
  p_place_id UUID
)
RETURNS TABLE(
  estimated_size NUMERIC,
  confidence NUMERIC,
  factors JSONB
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_place RECORD;
  v_base NUMERIC;
  v_kind_multiplier NUMERIC;
  v_kind_coeffs JSONB;
  v_prior_tnr_count INT;
  v_tnr_coeff NUMERIC;
  v_has_intake BOOLEAN;
  v_intake_boost NUMERIC;
  v_cats_at_place INT;
  v_zip_avg NUMERIC;
  v_min_conf NUMERIC;
  v_max_conf NUMERIC;
  v_confidence NUMERIC;
  v_estimate NUMERIC;
  v_factors JSONB;
BEGIN
  -- Get place info
  SELECT pl.place_id, pl.place_kind, pl.formatted_address, pl.latitude, pl.longitude,
         SUBSTRING(pl.formatted_address FROM '[0-9]{5}') as zip_code
  INTO v_place
  FROM sot.places pl
  WHERE pl.place_id = p_place_id
    AND pl.merged_into_place_id IS NULL;

  IF v_place IS NULL THEN
    RETURN;
  END IF;

  -- Read config values
  SELECT COALESCE((SELECT value::numeric FROM ops.app_config WHERE key = 'beacon.regression_base_colony_size'), 3) INTO v_base;
  SELECT COALESCE((SELECT value::jsonb FROM ops.app_config WHERE key = 'beacon.regression_coeff_place_kind'), '{}') INTO v_kind_coeffs;
  SELECT COALESCE((SELECT value::numeric FROM ops.app_config WHERE key = 'beacon.regression_coeff_prior_tnr'), 0.15) INTO v_tnr_coeff;
  SELECT COALESCE((SELECT value::numeric FROM ops.app_config WHERE key = 'beacon.regression_coeff_intake_boost'), 1.5) INTO v_intake_boost;
  SELECT COALESCE((SELECT value::numeric FROM ops.app_config WHERE key = 'beacon.regression_min_confidence'), 0.3) INTO v_min_conf;
  SELECT COALESCE((SELECT value::numeric FROM ops.app_config WHERE key = 'beacon.regression_max_confidence'), 0.5) INTO v_max_conf;

  -- Factor 1: Place kind multiplier
  v_kind_multiplier := COALESCE(
    (v_kind_coeffs->>COALESCE(v_place.place_kind, 'other'))::numeric,
    1.0
  );

  -- Factor 2: Count of prior TNR appointments in place family
  SELECT COUNT(*)::int INTO v_prior_tnr_count
  FROM ops.appointments a
  WHERE a.inferred_place_id = ANY(sot.get_place_family(p_place_id));

  -- Factor 3: Does this place have an intake submission?
  SELECT EXISTS(
    SELECT 1 FROM ops.requests r
    WHERE r.place_id = ANY(sot.get_place_family(p_place_id))
      AND r.merged_into_request_id IS NULL
  ) INTO v_has_intake;

  -- Factor 4: Known cats at this place (direct observation)
  SELECT COUNT(*)::int INTO v_cats_at_place
  FROM sot.cat_place cp
  WHERE cp.place_id = ANY(sot.get_place_family(p_place_id));

  -- Factor 5: Average colony size for same place_kind in same zip code
  IF v_place.zip_code IS NOT NULL THEN
    SELECT AVG(sub.cat_count)
    INTO v_zip_avg
    FROM (
      SELECT cp.place_id, COUNT(*) as cat_count
      FROM sot.cat_place cp
      JOIN sot.places pl ON pl.place_id = cp.place_id
      WHERE pl.merged_into_place_id IS NULL
        AND pl.place_kind = v_place.place_kind
        AND pl.formatted_address LIKE '%' || v_place.zip_code || '%'
        AND pl.place_id != p_place_id
      GROUP BY cp.place_id
      HAVING COUNT(*) >= 2  -- Only places with real colony data
    ) sub;
  END IF;

  -- If we already have direct cat observations, use that as base
  IF v_cats_at_place > 0 THEN
    v_estimate := v_cats_at_place;
    v_confidence := v_max_conf;  -- Still regression confidence, not direct observation
  ELSE
    -- Regression estimate
    v_estimate := v_base * v_kind_multiplier;

    -- Adjust for zip code average if available
    IF v_zip_avg IS NOT NULL AND v_zip_avg > 0 THEN
      v_estimate := (v_estimate + v_zip_avg) / 2.0;  -- Blend with local data
      v_confidence := v_max_conf;
    ELSE
      v_confidence := v_min_conf;
    END IF;

    -- Intake boost: community-reported places likely have larger colonies
    IF v_has_intake THEN
      v_estimate := v_estimate * v_intake_boost;
      v_confidence := LEAST(v_confidence + 0.1, v_max_conf);
    END IF;

    -- Prior TNR adjustment: each past TNR reduces remaining colony
    IF v_prior_tnr_count > 0 THEN
      v_estimate := GREATEST(v_estimate - (v_prior_tnr_count * v_tnr_coeff * v_estimate), 1);
    END IF;
  END IF;

  -- Round to nearest integer, minimum 1
  v_estimate := GREATEST(ROUND(v_estimate), 1);

  -- Build factors JSONB for transparency
  v_factors := jsonb_build_object(
    'base', v_base,
    'place_kind', COALESCE(v_place.place_kind, 'unknown'),
    'kind_multiplier', v_kind_multiplier,
    'prior_tnr_count', v_prior_tnr_count,
    'has_intake', v_has_intake,
    'cats_at_place', v_cats_at_place,
    'zip_avg', v_zip_avg,
    'zip_code', v_place.zip_code
  );

  RETURN QUERY SELECT v_estimate, v_confidence, v_factors;
END;
$$;

COMMENT ON FUNCTION sot.estimate_colony_population_regression(UUID) IS
'Estimates colony population using demographic regression when direct observation unavailable.
Uses place kind, zip code averages, prior TNR history, and intake submissions as factors.
Coefficients admin-configurable via ops.app_config beacon.regression_* keys.';

-- ============================================================================
-- Step 3: Batch backfill function
-- ============================================================================

\echo 'Creating batch backfill function...'

CREATE OR REPLACE FUNCTION sot.backfill_colony_regression_estimates(
  p_batch_size INT DEFAULT 1000
)
RETURNS TABLE(
  places_estimated INT,
  places_skipped INT,
  avg_estimate NUMERIC
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_place RECORD;
  v_result RECORD;
  v_estimated INT := 0;
  v_skipped INT := 0;
  v_sum NUMERIC := 0;
BEGIN
  FOR v_place IN
    SELECT pl.place_id
    FROM sot.places pl
    WHERE pl.merged_into_place_id IS NULL
      AND pl.latitude IS NOT NULL  -- Only geocoded places
      -- Skip places that already have colony trend data
      AND NOT EXISTS (
        SELECT 1 FROM sot.place_colony_trends pct
        WHERE pct.place_id = pl.place_id
          AND pct.source_type != 'demographic_regression'
          AND pct.trend_status != 'insufficient_data'
      )
      -- Skip places that already have a regression estimate
      AND NOT EXISTS (
        SELECT 1 FROM sot.place_colony_trends pct
        WHERE pct.place_id = pl.place_id
          AND pct.source_type = 'demographic_regression'
      )
    LIMIT p_batch_size
  LOOP
    SELECT * INTO v_result
    FROM sot.estimate_colony_population_regression(v_place.place_id);

    IF v_result IS NULL OR v_result.estimated_size IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Insert regression estimate into colony trends
    INSERT INTO sot.place_colony_trends (
      place_id,
      estimated_population,
      confidence,
      source_type,
      trend_status,
      factors,
      computed_at
    ) VALUES (
      v_place.place_id,
      v_result.estimated_size,
      v_result.confidence,
      'demographic_regression',
      'estimated',
      v_result.factors,
      NOW()
    )
    ON CONFLICT (place_id) WHERE source_type = 'demographic_regression'
    DO UPDATE SET
      estimated_population = EXCLUDED.estimated_population,
      confidence = EXCLUDED.confidence,
      factors = EXCLUDED.factors,
      computed_at = NOW();

    v_estimated := v_estimated + 1;
    v_sum := v_sum + v_result.estimated_size;
  END LOOP;

  RETURN QUERY SELECT
    v_estimated,
    v_skipped,
    CASE WHEN v_estimated > 0 THEN ROUND(v_sum / v_estimated, 1) ELSE 0 END;
END;
$$;

COMMENT ON FUNCTION sot.backfill_colony_regression_estimates(INT) IS
'Batch estimates colony populations using demographic regression for places with insufficient_data.
Run after entity linking to fill Beacon map blank spots.';

-- ============================================================================
-- Verification
-- ============================================================================

\echo ''
\echo 'Colony trend coverage BEFORE backfill:'

SELECT
  COUNT(*) as total_places,
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM sot.place_colony_trends pct
    WHERE pct.place_id = pl.place_id
      AND pct.trend_status != 'insufficient_data'
  )) as has_trend_data,
  COUNT(*) FILTER (WHERE NOT EXISTS (
    SELECT 1 FROM sot.place_colony_trends pct
    WHERE pct.place_id = pl.place_id
      AND pct.trend_status != 'insufficient_data'
  )) as insufficient_data
FROM sot.places pl
WHERE pl.merged_into_place_id IS NULL
  AND pl.latitude IS NOT NULL;

\echo ''
\echo 'Run sot.backfill_colony_regression_estimates() to fill blank spots.'
\echo 'MIG_3034 complete — Colony population regression function created'
\echo ''
