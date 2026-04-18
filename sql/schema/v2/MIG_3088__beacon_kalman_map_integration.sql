-- MIG_3088: Wire Kalman estimates into Beacon map matview
--
-- Problem: ops.mv_beacon_place_metrics gets colony_estimate from
-- sot.place_colony_estimates directly, bypassing the Kalman filter (MIG_3087).
-- The map shows legacy colony estimates instead of the unified Kalman estimates.
--
-- Fix: Replace the latest_colony_estimates CTE in the matview to prefer
-- Kalman estimates when available, falling back to legacy.

-- Drop and recreate the matview with Kalman-aware colony estimates
DROP MATERIALIZED VIEW IF EXISTS ops.mv_beacon_place_metrics CASCADE;

-- Recreate the view that wraps the matview
DROP VIEW IF EXISTS ops.v_beacon_place_metrics CASCADE;

CREATE MATERIALIZED VIEW ops.mv_beacon_place_metrics AS
WITH place_cats AS (
    SELECT
        cp.place_id,
        COUNT(DISTINCT cp.cat_id)::int AS total_cats,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
        )::int AS altered_cats,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IS NOT NULL AND c.altered_status != 'unknown'
        )::int AS known_status_cats,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IS NULL OR c.altered_status = 'unknown'
        )::int AS unknown_status_cats,
        CASE
            WHEN COUNT(DISTINCT cp.cat_id) FILTER (
                WHERE c.altered_status IS NOT NULL AND c.altered_status != 'unknown'
            ) > 0
            THEN ROUND(
                COUNT(DISTINCT cp.cat_id) FILTER (
                    WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
                )::numeric * 100.0 /
                NULLIF(COUNT(DISTINCT cp.cat_id) FILTER (
                    WHERE c.altered_status IS NOT NULL AND c.altered_status != 'unknown'
                ), 0), 1
            )
        END AS alteration_rate_pct
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    -- TODO(FFS-1280): Add AND (cp.presence_status IS NULL OR cp.presence_status != 'departed')
    GROUP BY cp.place_id
),
place_people AS (
    SELECT place_id, COUNT(DISTINCT person_id)::int AS total_people
    FROM sot.person_place
    GROUP BY place_id
),
place_requests AS (
    SELECT
        place_id,
        COUNT(*)::int AS total_requests,
        COUNT(*) FILTER (WHERE status IN ('new', 'triaged', 'scheduled', 'in_progress'))::int AS active_requests
    FROM ops.requests
    GROUP BY place_id
),
place_appointments AS (
    SELECT place_id, COUNT(*)::int AS total_appointments, MAX(appointment_date) AS last_appointment_date
    FROM (
        SELECT place_id, appointment_id, appointment_date FROM ops.appointments WHERE place_id IS NOT NULL
        UNION
        SELECT inferred_place_id AS place_id, appointment_id, appointment_date FROM ops.appointments WHERE inferred_place_id IS NOT NULL
    ) combined
    GROUP BY place_id
),
-- MIG_3088: Prefer Kalman estimate, fall back to legacy colony estimate
latest_colony_estimates AS (
    SELECT
        COALESCE(pps.place_id, pce.place_id) AS place_id,
        COALESCE(
            ROUND(pps.estimate)::INTEGER,
            pce.total_count_observed
        ) AS colony_estimate,
        CASE
            WHEN pps.place_id IS NOT NULL THEN 'kalman_filter'
            ELSE COALESCE(pce.estimate_method, 'unknown')
        END AS estimate_method
    FROM sot.place_population_state pps
    FULL OUTER JOIN (
        SELECT DISTINCT ON (place_id)
            place_id,
            total_count_observed,
            estimate_method
        FROM sot.place_colony_estimates
        ORDER BY place_id, observed_date DESC NULLS LAST, created_at DESC
    ) pce ON pce.place_id = pps.place_id
),
-- Colony breeding activity (uses is_pregnant/is_lactating boolean columns per MIG_3009)
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
-- Colony stability trend
colony_trends AS (
    SELECT place_id, trend AS colony_trend,
           CASE trend WHEN 'growing' THEN -1 WHEN 'shrinking' THEN 1 WHEN 'stable' THEN 0 ELSE 0 END AS colony_trend_score
    FROM (
        SELECT place_id,
            CASE
                WHEN est_count < 2 THEN 'insufficient_data'
                WHEN latest_total > prev_total * 1.2 THEN 'growing'
                WHEN latest_total < prev_total * 0.8 THEN 'shrinking'
                ELSE 'stable'
            END AS trend
        FROM (
            SELECT place_id,
                COUNT(*) AS est_count,
                (ARRAY_AGG(total_count_observed ORDER BY observed_date DESC))[1] AS latest_total,
                (ARRAY_AGG(total_count_observed ORDER BY observed_date DESC))[2] AS prev_total
            FROM sot.place_colony_estimates
            WHERE total_count_observed IS NOT NULL
            GROUP BY place_id
        ) sub
    ) trend_sub
),
-- Immigration pressure
immigration AS (
    SELECT
        cp.place_id,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status NOT IN ('spayed', 'neutered', 'altered')
              AND cp.created_at >= (CURRENT_DATE - INTERVAL '6 months')
        )::int AS new_intact_arrivals,
        CASE
            WHEN COUNT(DISTINCT cp.cat_id) FILTER (
                WHERE c.altered_status NOT IN ('spayed', 'neutered', 'altered')
                  AND cp.created_at >= (CURRENT_DATE - INTERVAL '6 months')
            ) >= 5 THEN 'high'
            WHEN COUNT(DISTINCT cp.cat_id) FILTER (
                WHERE c.altered_status NOT IN ('spayed', 'neutered', 'altered')
                  AND cp.created_at >= (CURRENT_DATE - INTERVAL '6 months')
            ) >= 2 THEN 'moderate'
            ELSE 'low'
        END AS immigration_pressure
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
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
    pc.alteration_rate_pct,
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
    COALESCE(pb.has_recent_breeding, FALSE) AS has_recent_breeding,
    pb.last_breeding_detected::DATE AS last_breeding_detected,
    COALESCE(ct.colony_trend, 'insufficient_data') AS colony_trend,
    COALESCE(ct.colony_trend_score, 0) AS colony_trend_score,
    COALESCE(im.new_intact_arrivals, 0) AS new_intact_arrivals,
    COALESCE(im.immigration_pressure, 'low') AS immigration_pressure
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

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_place_id
  ON ops.mv_beacon_place_metrics(place_id);

-- Recreate the wrapper view
CREATE OR REPLACE VIEW ops.v_beacon_place_metrics AS
SELECT * FROM ops.mv_beacon_place_metrics;

-- ============================================================
-- VERIFICATION
-- ============================================================

DO $$
DECLARE
  v_total INTEGER;
  v_kalman INTEGER;
  v_legacy INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total FROM ops.mv_beacon_place_metrics;
  SELECT COUNT(*) INTO v_kalman FROM ops.mv_beacon_place_metrics WHERE estimate_method = 'kalman_filter';
  SELECT COUNT(*) INTO v_legacy FROM ops.mv_beacon_place_metrics WHERE colony_estimate IS NOT NULL AND estimate_method != 'kalman_filter';

  RAISE NOTICE 'MIG_3088: Beacon matview rebuilt with Kalman integration';
  RAISE NOTICE 'MIG_3088: % total places, % with Kalman estimates, % with legacy estimates', v_total, v_kalman, v_legacy;
END;
$$;
