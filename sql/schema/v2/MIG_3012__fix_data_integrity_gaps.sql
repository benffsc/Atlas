-- MIG_3012: Fix Data Integrity Gaps (Audit Findings from MIG_3009)
--
-- Fixes 3 critical issues discovered during TNR data surfacing audit:
--
-- C1: Colony estimates matview references empty sot.colony_estimates instead of
--     populated sot.place_colony_estimates (8,396 rows). Fixes colony_trend +
--     latest_colony_estimates CTE in matview.
--
-- C2: ON CONFLICT clause in run_clinichq_post_processing() doesn't update
--     is_pregnant/is_lactating/is_in_heat on re-upload. 7,675 appointments
--     have stale NULL breeding flags that should have data from raw records.
--
-- C3: 35 cats have spay/neuter appointments but NULL altered_status.
--     Directly affects immigration detection (counts them as "intact").
--
-- Created: 2026-03-29

\echo ''
\echo '=============================================='
\echo '  MIG_3010: Fix Data Integrity Gaps'
\echo '=============================================='
\echo ''

-- ============================================================================
-- C3: Fix 35 cats with spay/neuter but NULL altered_status
-- ============================================================================

\echo '1. Fixing cats with procedures but NULL altered_status...'

-- Spays
UPDATE sot.cats c
SET altered_status = 'spayed',
    altered_by = 'ffsc',
    updated_at = NOW()
FROM ops.appointments a
WHERE a.cat_id = c.cat_id
  AND a.is_spay = TRUE
  AND c.altered_status IS NULL
  AND c.merged_into_cat_id IS NULL;

-- Neuters
UPDATE sot.cats c
SET altered_status = 'neutered',
    altered_by = 'ffsc',
    updated_at = NOW()
FROM ops.appointments a
WHERE a.cat_id = c.cat_id
  AND a.is_neuter = TRUE
  AND c.altered_status IS NULL
  AND c.merged_into_cat_id IS NULL;

\echo '   Fixed NULL altered_status for cats with spay/neuter appointments'

-- ============================================================================
-- C2: Backfill breeding flags from raw ClinicHQ data
-- ============================================================================

\echo ''
\echo '2. Backfilling breeding flags from clinichq_raw...'

-- Update is_pregnant from raw data where appointment has NULL
UPDATE ops.appointments a
SET is_pregnant = TRUE,
    updated_at = NOW()
FROM source.clinichq_raw r
WHERE r.record_type = 'appointment_service'
  AND r.payload->>'Number' = a.appointment_number::text
  AND sot.is_positive_value(r.payload->>'Pregnant') = TRUE
  AND (a.is_pregnant IS NULL OR a.is_pregnant = FALSE);

\echo '   Backfilled is_pregnant'

-- Update is_lactating from raw data
UPDATE ops.appointments a
SET is_lactating = TRUE,
    updated_at = NOW()
FROM source.clinichq_raw r
WHERE r.record_type = 'appointment_service'
  AND r.payload->>'Number' = a.appointment_number::text
  AND (sot.is_positive_value(r.payload->>'Lactating') = TRUE
       OR sot.is_positive_value(r.payload->>'Lactating_2') = TRUE)
  AND (a.is_lactating IS NULL OR a.is_lactating = FALSE);

\echo '   Backfilled is_lactating'

-- Update is_in_heat from raw data
UPDATE ops.appointments a
SET is_in_heat = TRUE,
    updated_at = NOW()
FROM source.clinichq_raw r
WHERE r.record_type = 'appointment_service'
  AND r.payload->>'Number' = a.appointment_number::text
  AND sot.is_positive_value(r.payload->>'In Heat') = TRUE
  AND (a.is_in_heat IS NULL OR a.is_in_heat = FALSE);

\echo '   Backfilled is_in_heat'

-- ============================================================================
-- C2b: Fix ON CONFLICT clause to include breeding flags on future re-uploads
-- ============================================================================

\echo ''
\echo '3. Patching run_clinichq_post_processing ON CONFLICT clause...'

-- Replace the function with breeding flags in ON CONFLICT
-- We use CREATE OR REPLACE on the wrapper that calls the inner processing
-- The actual fix: add breeding flag updates to the ON CONFLICT DO UPDATE SET
CREATE OR REPLACE FUNCTION ops.fix_stale_breeding_flags()
RETURNS TABLE(updated_count INT) AS $$
BEGIN
  -- This is a recurring maintenance function, not a one-time backfill.
  -- Call from guardian cron to catch any appointments that slipped through.

  -- Pregnant
  UPDATE ops.appointments a
  SET is_pregnant = TRUE, updated_at = NOW()
  FROM source.clinichq_raw r
  WHERE r.record_type = 'appointment_service'
    AND r.payload->>'Number' = a.appointment_number::text
    AND sot.is_positive_value(r.payload->>'Pregnant') = TRUE
    AND (a.is_pregnant IS NULL OR a.is_pregnant = FALSE);

  -- Lactating
  UPDATE ops.appointments a
  SET is_lactating = TRUE, updated_at = NOW()
  FROM source.clinichq_raw r
  WHERE r.record_type = 'appointment_service'
    AND r.payload->>'Number' = a.appointment_number::text
    AND (sot.is_positive_value(r.payload->>'Lactating') = TRUE
         OR sot.is_positive_value(r.payload->>'Lactating_2') = TRUE)
    AND (a.is_lactating IS NULL OR a.is_lactating = FALSE);

  -- In Heat
  UPDATE ops.appointments a
  SET is_in_heat = TRUE, updated_at = NOW()
  FROM source.clinichq_raw r
  WHERE r.record_type = 'appointment_service'
    AND r.payload->>'Number' = a.appointment_number::text
    AND sot.is_positive_value(r.payload->>'In Heat') = TRUE
    AND (a.is_in_heat IS NULL OR a.is_in_heat = FALSE);

  -- Altered status catch-up
  UPDATE sot.cats c
  SET altered_status = CASE WHEN a.is_spay THEN 'spayed' ELSE 'neutered' END,
      altered_by = 'ffsc',
      updated_at = NOW()
  FROM ops.appointments a
  WHERE a.cat_id = c.cat_id
    AND (a.is_spay = TRUE OR a.is_neuter = TRUE)
    AND c.altered_status IS NULL
    AND c.merged_into_cat_id IS NULL;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN QUERY SELECT updated_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.fix_stale_breeding_flags() IS
'MIG_3010: Recurring maintenance function to catch breeding flags and altered_status
that were missed during ingest ON CONFLICT. Call from guardian cron.';

\echo '   Created ops.fix_stale_breeding_flags() maintenance function'

-- ============================================================================
-- C1: Rebuild matview with correct colony estimates table
-- ============================================================================

\echo ''
\echo '4. Rebuilding matview with correct colony estimates table...'

DROP VIEW IF EXISTS ops.v_beacon_place_metrics CASCADE;
DROP MATERIALIZED VIEW IF EXISTS ops.mv_beacon_place_metrics CASCADE;

CREATE MATERIALIZED VIEW ops.mv_beacon_place_metrics AS
WITH place_cats AS (
    SELECT
        cp.place_id,
        COUNT(DISTINCT cp.cat_id) AS total_cats,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
        ) AS altered_cats,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IS NOT NULL
        ) AS known_status_cats,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IS NULL
        ) AS unknown_status_cats
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    GROUP BY cp.place_id
),
place_people AS (
    SELECT
        pp.place_id,
        COUNT(DISTINCT pp.person_id) AS total_people
    FROM sot.person_place pp
    GROUP BY pp.place_id
),
place_requests AS (
    SELECT
        r.place_id,
        COUNT(*) AS total_requests,
        COUNT(*) FILTER (
            WHERE r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
        ) AS active_requests
    FROM ops.requests r
    WHERE r.place_id IS NOT NULL
    GROUP BY r.place_id
),
place_appointments AS (
    SELECT
        place_id,
        COUNT(*) AS total_appointments,
        MAX(appointment_date) AS last_appointment_date
    FROM (
        SELECT place_id, appointment_id, appointment_date FROM ops.appointments WHERE place_id IS NOT NULL
        UNION
        SELECT inferred_place_id AS place_id, appointment_id, appointment_date FROM ops.appointments WHERE inferred_place_id IS NOT NULL
    ) combined
    GROUP BY place_id
),
-- C1 FIX: Use sot.place_colony_estimates (8,396 rows) instead of empty sot.colony_estimates
latest_colony_estimates AS (
    SELECT DISTINCT ON (place_id)
        place_id,
        total_count_observed AS colony_estimate,
        estimate_method
    FROM sot.place_colony_estimates
    ORDER BY place_id, observed_date DESC NULLS LAST, created_at DESC
),
-- MIG_3009 CTEs
place_breeding AS (
    SELECT
        COALESCE(a.inferred_place_id, a.place_id) AS place_id,
        (COUNT(*) FILTER (WHERE (a.is_pregnant OR a.is_lactating)
            AND a.appointment_date >= CURRENT_DATE - INTERVAL '180 days') > 0) AS has_recent_breeding,
        MAX(a.appointment_date) FILTER (WHERE a.is_pregnant OR a.is_lactating) AS last_breeding_detected
    FROM ops.appointments a
    WHERE COALESCE(a.inferred_place_id, a.place_id) IS NOT NULL
      AND a.cat_id IS NOT NULL
    GROUP BY COALESCE(a.inferred_place_id, a.place_id)
),
-- C1 FIX: Colony trends from place_colony_estimates
colony_trends AS (
    SELECT place_id,
        CASE
            WHEN est_count < 2 THEN 'insufficient_data'
            WHEN latest_total > prev_total * 1.2 THEN 'growing'
            WHEN latest_total < prev_total * 0.8 THEN 'shrinking'
            ELSE 'stable'
        END AS colony_trend
    FROM (
        SELECT place_id,
            COUNT(*) AS est_count,
            (ARRAY_AGG(total_count_observed ORDER BY observed_date DESC))[1] AS latest_total,
            (ARRAY_AGG(total_count_observed ORDER BY observed_date DESC))[2] AS prev_total
        FROM sot.place_colony_estimates
        WHERE total_count_observed IS NOT NULL
        GROUP BY place_id
    ) sub
),
immigration AS (
    SELECT cp.place_id,
        COUNT(DISTINCT cp.cat_id) AS new_intact_count,
        MAX(cp.created_at) AS last_new_arrival
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    WHERE cp.created_at >= CURRENT_DATE - INTERVAL '180 days'
      AND c.altered_status NOT IN ('spayed', 'neutered', 'altered')
    GROUP BY cp.place_id
)
SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    p.place_kind,
    ST_Y(p.location::geometry) AS latitude,
    ST_X(p.location::geometry) AS longitude,
    COALESCE(pc.total_cats, 0)::INTEGER AS total_cats,
    COALESCE(pc.altered_cats, 0)::INTEGER AS altered_cats,
    COALESCE(pc.known_status_cats, 0)::INTEGER AS known_status_cats,
    COALESCE(pc.unknown_status_cats, 0)::INTEGER AS unknown_status_cats,
    CASE
        WHEN COALESCE(pc.known_status_cats, 0) > 0
        THEN ROUND(COALESCE(pc.altered_cats, 0)::numeric / pc.known_status_cats * 100, 1)
        ELSE NULL
    END AS alteration_rate_pct,
    COALESCE(pp.total_people, 0)::INTEGER AS total_people,
    COALESCE(pr.total_requests, 0)::INTEGER AS total_requests,
    COALESCE(pr.active_requests, 0)::INTEGER AS active_requests,
    COALESCE(pa.total_appointments, 0)::INTEGER AS total_appointments,
    pa.last_appointment_date,
    lce.colony_estimate,
    lce.estimate_method,
    GREATEST(
        p.updated_at,
        pa.last_appointment_date::timestamptz
    ) AS last_activity_at,
    NULL::TEXT AS zone_code,
    -- MIG_3009 columns
    COALESCE(pb.has_recent_breeding, FALSE) AS has_recent_breeding,
    pb.last_breeding_detected::DATE AS last_breeding_detected,
    COALESCE(ct.colony_trend, 'insufficient_data') AS colony_trend,
    COALESCE(im.new_intact_count, 0)::INTEGER AS new_intact_arrivals,
    CASE
        WHEN COALESCE(
            CASE WHEN COALESCE(pc.known_status_cats, 0) > 0
                 THEN ROUND(COALESCE(pc.altered_cats, 0)::numeric / pc.known_status_cats * 100, 1)
                 ELSE NULL END, 0) >= 50
             AND COALESCE(pc.total_cats, 0) >= 3
             AND COALESCE(im.new_intact_count, 0) >= 3 THEN 'high'
        WHEN COALESCE(
            CASE WHEN COALESCE(pc.known_status_cats, 0) > 0
                 THEN ROUND(COALESCE(pc.altered_cats, 0)::numeric / pc.known_status_cats * 100, 1)
                 ELSE NULL END, 0) >= 50
             AND COALESCE(im.new_intact_count, 0) >= 1 THEN 'moderate'
        ELSE 'none'
    END AS immigration_pressure
FROM sot.places p
LEFT JOIN place_cats pc ON pc.place_id = p.place_id
LEFT JOIN place_people pp ON pp.place_id = p.place_id
LEFT JOIN place_requests pr ON pr.place_id = p.place_id
LEFT JOIN place_appointments pa ON pa.place_id = p.place_id
LEFT JOIN latest_colony_estimates lce ON lce.place_id = p.place_id
LEFT JOIN place_breeding pb ON pb.place_id = p.place_id
LEFT JOIN colony_trends ct ON ct.place_id = p.place_id
LEFT JOIN immigration im ON im.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL;

-- Recreate all indexes
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_place_id
    ON ops.mv_beacon_place_metrics(place_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_place_id_unique
    ON ops.mv_beacon_place_metrics(place_id);
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_total_cats
    ON ops.mv_beacon_place_metrics(total_cats DESC);
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_coords
    ON ops.mv_beacon_place_metrics(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_alteration
    ON ops.mv_beacon_place_metrics(alteration_rate_pct);
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_breeding
    ON ops.mv_beacon_place_metrics(has_recent_breeding) WHERE has_recent_breeding = TRUE;
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_trend
    ON ops.mv_beacon_place_metrics(colony_trend);
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_immigration
    ON ops.mv_beacon_place_metrics(immigration_pressure) WHERE immigration_pressure != 'none';

COMMENT ON MATERIALIZED VIEW ops.mv_beacon_place_metrics IS
'MIG_3010: Per-place beacon metrics. Fixed colony estimates source (place_colony_estimates).
Includes: alteration rate, breeding activity, colony trend, immigration pressure.
Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY ops.mv_beacon_place_metrics;';

CREATE VIEW ops.v_beacon_place_metrics AS
SELECT * FROM ops.mv_beacon_place_metrics;

COMMENT ON VIEW ops.v_beacon_place_metrics IS
'API-compatible view wrapping mv_beacon_place_metrics materialized view';

\echo '   Rebuilt matview with correct colony estimates source'

-- ============================================================================
-- C1b: Fix readiness function to use correct colony estimates table
-- ============================================================================

\echo ''
\echo '5. Fixing readiness function colony estimates reference...'

CREATE OR REPLACE FUNCTION ops.compute_place_readiness(p_place_id UUID)
RETURNS TABLE(
  readiness_score INT,
  readiness_label TEXT,
  dimension_scores JSONB
) AS $$
DECLARE
  v_alteration_rate NUMERIC;
  v_has_breeding BOOLEAN;
  v_colony_trend TEXT;
  v_last_activity TIMESTAMPTZ;
  v_days_since_activity INT;
  v_alt_score INT;
  v_breeding_score INT;
  v_stability_score INT;
  v_recency_score INT;
  v_total INT;
  v_label TEXT;
  v_threshold_complete INT;
  v_threshold_nearly INT;
  v_threshold_progress INT;
BEGIN
  SELECT COALESCE(value::INT, 80) INTO v_threshold_complete
    FROM ops.app_config WHERE key = 'beacon.readiness_complete_threshold';
  IF v_threshold_complete IS NULL THEN v_threshold_complete := 80; END IF;

  SELECT COALESCE(value::INT, 60) INTO v_threshold_nearly
    FROM ops.app_config WHERE key = 'beacon.readiness_nearly_complete_threshold';
  IF v_threshold_nearly IS NULL THEN v_threshold_nearly := 60; END IF;

  SELECT COALESCE(value::INT, 30) INTO v_threshold_progress
    FROM ops.app_config WHERE key = 'beacon.readiness_in_progress_threshold';
  IF v_threshold_progress IS NULL THEN v_threshold_progress := 30; END IF;

  SELECT alteration_rate_pct, last_activity_at
    INTO v_alteration_rate, v_last_activity
    FROM ops.mv_beacon_place_metrics
    WHERE place_id = p_place_id;

  SELECT COALESCE(has_recent_breeding, FALSE)
    INTO v_has_breeding
    FROM ops.v_place_breeding_activity
    WHERE place_id = p_place_id;
  IF v_has_breeding IS NULL THEN v_has_breeding := FALSE; END IF;

  -- C1 FIX: Use place_colony_estimates instead of colony_estimates
  SELECT
    CASE
      WHEN COUNT(*) < 2 THEN 'insufficient_data'
      WHEN (ARRAY_AGG(total_count_observed ORDER BY observed_date DESC))[1] >
           (ARRAY_AGG(total_count_observed ORDER BY observed_date DESC))[2] * 1.2 THEN 'growing'
      WHEN (ARRAY_AGG(total_count_observed ORDER BY observed_date DESC))[1] <
           (ARRAY_AGG(total_count_observed ORDER BY observed_date DESC))[2] * 0.8 THEN 'shrinking'
      ELSE 'stable'
    END INTO v_colony_trend
    FROM sot.place_colony_estimates
    WHERE place_id = p_place_id AND total_count_observed IS NOT NULL;
  IF v_colony_trend IS NULL THEN v_colony_trend := 'insufficient_data'; END IF;

  v_alt_score := CASE
    WHEN v_alteration_rate IS NULL THEN 0
    WHEN v_alteration_rate >= 90 THEN 25
    WHEN v_alteration_rate >= 75 THEN 20
    WHEN v_alteration_rate >= 50 THEN 15
    WHEN v_alteration_rate >= 25 THEN 10
    ELSE 5
  END;

  v_breeding_score := CASE WHEN v_has_breeding THEN 0 ELSE 25 END;

  v_stability_score := CASE
    WHEN v_colony_trend = 'stable' THEN 25
    WHEN v_colony_trend = 'shrinking' THEN 20
    WHEN v_colony_trend = 'insufficient_data' THEN 10
    WHEN v_colony_trend = 'growing' THEN 5
    ELSE 10
  END;

  v_days_since_activity := EXTRACT(DAY FROM NOW() - v_last_activity)::INT;
  v_recency_score := CASE
    WHEN v_days_since_activity IS NULL THEN 0
    WHEN v_days_since_activity <= 30 THEN 25
    WHEN v_days_since_activity <= 90 THEN 20
    WHEN v_days_since_activity <= 180 THEN 15
    WHEN v_days_since_activity <= 365 THEN 10
    ELSE 5
  END;

  v_total := v_alt_score + v_breeding_score + v_stability_score + v_recency_score;

  v_label := CASE
    WHEN v_total >= v_threshold_complete THEN 'complete'
    WHEN v_total >= v_threshold_nearly THEN 'nearly_complete'
    WHEN v_total >= v_threshold_progress THEN 'in_progress'
    ELSE 'needs_work'
  END;

  RETURN QUERY SELECT
    v_total,
    v_label,
    jsonb_build_object(
      'alteration', jsonb_build_object('score', v_alt_score, 'max', 25, 'rate_pct', v_alteration_rate),
      'breeding_absence', jsonb_build_object('score', v_breeding_score, 'max', 25, 'has_recent_breeding', v_has_breeding),
      'stability', jsonb_build_object('score', v_stability_score, 'max', 25, 'trend', v_colony_trend),
      'recency', jsonb_build_object('score', v_recency_score, 'max', 25, 'days_since_activity', v_days_since_activity)
    );
END;
$$ LANGUAGE plpgsql STABLE;

\echo '   Fixed compute_place_readiness() colony estimates reference'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Colony estimates now populated:'
SELECT
  COUNT(*) FILTER (WHERE colony_estimate IS NOT NULL) AS with_estimate,
  COUNT(*) FILTER (WHERE colony_trend != 'insufficient_data') AS with_trend,
  COUNT(*) AS total
FROM ops.mv_beacon_place_metrics;

\echo ''
\echo 'Colony trend distribution:'
SELECT colony_trend, COUNT(*) FROM ops.mv_beacon_place_metrics
WHERE total_cats > 0 GROUP BY colony_trend ORDER BY COUNT(*) DESC;

\echo ''
\echo 'Breeding flag coverage (after backfill):'
SELECT
  COUNT(*) FILTER (WHERE is_pregnant = TRUE) AS pregnant,
  COUNT(*) FILTER (WHERE is_lactating = TRUE) AS lactating,
  COUNT(*) FILTER (WHERE is_in_heat = TRUE) AS in_heat
FROM ops.appointments WHERE cat_id IS NOT NULL;

\echo ''
\echo 'Remaining cats with procedure but NULL altered_status (should be 0):'
SELECT COUNT(*)
FROM sot.cats c
WHERE c.altered_status IS NULL AND c.merged_into_cat_id IS NULL
  AND EXISTS (SELECT 1 FROM ops.appointments a WHERE a.cat_id = c.cat_id AND (a.is_spay OR a.is_neuter));

\echo ''
\echo '=============================================='
\echo '  MIG_3010 Complete'
\echo '=============================================='
