-- MIG_3009: TNR Data Surfacing — Colony Health, Breeding Badges, Lifecycle Timeline
--
-- Surfaces existing data that's been collected but never aggregated:
--   1. Trap-night efficiency per trapper and per place
--   2. Place-level breeding activity (pregnant/lactating from appointments)
--   3. Colony stability trend (growing/shrinking/stable from colony_estimates)
--   4. Immigration pressure (new intact arrivals at managed colonies)
--   5. Completion readiness score (composite of alteration + breeding + stability + recency)
--   6. Place lifecycle outcome summary (adoption, mortality, transfer, etc.)
--   7. Matview rebuild with new columns
--   8. Config entries for thresholds
--
-- Sources: ops.appointments, sot.colony_estimates, sot.cat_place, sot.cats,
--          sot.cat_lifecycle_events, ops.trapper_trip_reports
--
-- Created: 2026-03-28

\echo ''
\echo '=============================================='
\echo '  MIG_3009: TNR Data Surfacing'
\echo '=============================================='
\echo ''

-- ============================================================================
-- Section 1: Trap-Night Efficiency Views
-- ============================================================================

\echo '1. Creating trap-night efficiency views...'

-- Per-trapper efficiency
CREATE OR REPLACE VIEW ops.v_trapper_efficiency AS
SELECT
  ttr.trapper_person_id,
  COUNT(*) AS total_sessions,
  SUM(ttr.cats_trapped) AS total_trapped,
  SUM(ttr.traps_set) AS total_traps_set,
  SUM(ttr.cats_seen) AS total_cats_seen,
  SUM(ttr.eartipped_seen) AS total_eartipped_seen,
  ROUND(SUM(ttr.cats_trapped)::NUMERIC / NULLIF(SUM(ttr.traps_set), 0), 2) AS catch_per_trap
FROM ops.trapper_trip_reports ttr
WHERE ttr.cats_trapped IS NOT NULL
GROUP BY ttr.trapper_person_id;

COMMENT ON VIEW ops.v_trapper_efficiency IS
'MIG_3009: Per-trapper trap-night efficiency metrics from trip reports.
catch_per_trap = total cats trapped / total traps set.';

-- Per-place efficiency (via request -> place join)
CREATE OR REPLACE VIEW ops.v_place_trap_efficiency AS
SELECT
  r.place_id,
  COUNT(*) AS total_sessions,
  SUM(ttr.cats_trapped) AS total_trapped,
  SUM(ttr.traps_set) AS total_traps_set,
  ROUND(SUM(ttr.cats_trapped)::NUMERIC / NULLIF(SUM(ttr.traps_set), 0), 2) AS catch_per_trap,
  MAX(ttr.visit_date) AS last_session_date
FROM ops.trapper_trip_reports ttr
JOIN ops.requests r ON r.request_id = ttr.request_id
WHERE ttr.cats_trapped IS NOT NULL
  AND r.place_id IS NOT NULL
GROUP BY r.place_id;

COMMENT ON VIEW ops.v_place_trap_efficiency IS
'MIG_3009: Per-place trap-night efficiency via request linkage.';

\echo '   Created ops.v_trapper_efficiency + ops.v_place_trap_efficiency'

-- ============================================================================
-- Section 2: Place-Level Breeding Activity View
-- ============================================================================

\echo ''
\echo '2. Creating place-level breeding activity view...'

CREATE OR REPLACE VIEW ops.v_place_breeding_activity AS
SELECT
  COALESCE(a.inferred_place_id, a.place_id) AS place_id,
  COUNT(*) FILTER (WHERE a.is_pregnant AND a.appointment_date >= CURRENT_DATE - INTERVAL '180 days') AS pregnant_recent,
  COUNT(*) FILTER (WHERE a.is_lactating AND a.appointment_date >= CURRENT_DATE - INTERVAL '180 days') AS lactating_recent,
  (COUNT(*) FILTER (WHERE (a.is_pregnant OR a.is_lactating)
    AND a.appointment_date >= CURRENT_DATE - INTERVAL '180 days') > 0) AS has_recent_breeding,
  MAX(a.appointment_date) FILTER (WHERE a.is_pregnant OR a.is_lactating) AS last_breeding_detected
FROM ops.appointments a
WHERE COALESCE(a.inferred_place_id, a.place_id) IS NOT NULL
  AND a.cat_id IS NOT NULL
GROUP BY COALESCE(a.inferred_place_id, a.place_id);

COMMENT ON VIEW ops.v_place_breeding_activity IS
'MIG_3009: Place-level breeding activity from appointment pregnancy/lactation flags.
has_recent_breeding = any pregnant or lactating cat in last 180 days.
Source: ops.appointments.is_pregnant, is_lactating (extracted by MIG_2320/2900).';

\echo '   Created ops.v_place_breeding_activity'

-- ============================================================================
-- Section 3: Place Lifecycle Outcome Summary View
-- ============================================================================

\echo ''
\echo '3. Creating place lifecycle outcome summary view...'

CREATE OR REPLACE VIEW ops.v_place_lifecycle_summary AS
SELECT
  COALESCE(le.place_id, cp.place_id) AS place_id,
  COUNT(*) FILTER (WHERE le.event_type = 'tnr_procedure') AS tnr_count,
  COUNT(*) FILTER (WHERE le.event_type = 'adoption') AS adoption_count,
  COUNT(*) FILTER (WHERE le.event_type = 'mortality') AS mortality_count,
  COUNT(*) FILTER (WHERE le.event_type = 'return_to_field') AS rtf_count,
  COUNT(*) FILTER (WHERE le.event_type = 'transfer') AS transfer_count,
  COUNT(*) FILTER (WHERE le.event_type = 'foster_start') AS foster_count,
  COUNT(*) FILTER (WHERE le.event_type = 'intake') AS intake_count,
  COUNT(*) AS total_events
FROM sot.cat_lifecycle_events le
LEFT JOIN sot.cat_place cp ON cp.cat_id = le.cat_id AND le.place_id IS NULL
WHERE COALESCE(le.place_id, cp.place_id) IS NOT NULL
GROUP BY COALESCE(le.place_id, cp.place_id);

COMMENT ON VIEW ops.v_place_lifecycle_summary IS
'MIG_3009: Per-place lifecycle event outcome counts.
Falls back to cat_place linkage when lifecycle event has no direct place_id.
Source: sot.cat_lifecycle_events (populated by MIG_2364 + MIG_3005).';

\echo '   Created ops.v_place_lifecycle_summary'

-- ============================================================================
-- Section 4: Completion Readiness Function
-- ============================================================================

\echo ''
\echo '4. Creating completion readiness function...'

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
  -- Fetch thresholds from app_config (with defaults)
  SELECT COALESCE(value::INT, 80) INTO v_threshold_complete
    FROM ops.app_config WHERE key = 'beacon.readiness_complete_threshold';
  IF v_threshold_complete IS NULL THEN v_threshold_complete := 80; END IF;

  SELECT COALESCE(value::INT, 60) INTO v_threshold_nearly
    FROM ops.app_config WHERE key = 'beacon.readiness_nearly_complete_threshold';
  IF v_threshold_nearly IS NULL THEN v_threshold_nearly := 60; END IF;

  SELECT COALESCE(value::INT, 30) INTO v_threshold_progress
    FROM ops.app_config WHERE key = 'beacon.readiness_in_progress_threshold';
  IF v_threshold_progress IS NULL THEN v_threshold_progress := 30; END IF;

  -- 1. Alteration rate from matview
  SELECT alteration_rate_pct, last_activity_at
    INTO v_alteration_rate, v_last_activity
    FROM ops.mv_beacon_place_metrics
    WHERE place_id = p_place_id;

  -- 2. Breeding activity
  SELECT COALESCE(has_recent_breeding, FALSE)
    INTO v_has_breeding
    FROM ops.v_place_breeding_activity
    WHERE place_id = p_place_id;
  IF v_has_breeding IS NULL THEN v_has_breeding := FALSE; END IF;

  -- 3. Colony trend (compute inline)
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

  -- Dimension 1: Alteration (0-25)
  v_alt_score := CASE
    WHEN v_alteration_rate IS NULL THEN 0
    WHEN v_alteration_rate >= 90 THEN 25
    WHEN v_alteration_rate >= 75 THEN 20
    WHEN v_alteration_rate >= 50 THEN 15
    WHEN v_alteration_rate >= 25 THEN 10
    ELSE 5
  END;

  -- Dimension 2: Breeding absence (0-25) — no breeding = good
  v_breeding_score := CASE
    WHEN v_has_breeding THEN 0
    ELSE 25
  END;

  -- Dimension 3: Stability (0-25)
  v_stability_score := CASE
    WHEN v_colony_trend = 'stable' THEN 25
    WHEN v_colony_trend = 'shrinking' THEN 20
    WHEN v_colony_trend = 'insufficient_data' THEN 10
    WHEN v_colony_trend = 'growing' THEN 5
    ELSE 10
  END;

  -- Dimension 4: Recency (0-25) — recent activity is better
  v_days_since_activity := EXTRACT(DAY FROM NOW() - v_last_activity)::INT;
  v_recency_score := CASE
    WHEN v_days_since_activity IS NULL THEN 0
    WHEN v_days_since_activity <= 30 THEN 25
    WHEN v_days_since_activity <= 90 THEN 20
    WHEN v_days_since_activity <= 180 THEN 15
    WHEN v_days_since_activity <= 365 THEN 10
    ELSE 5
  END;

  -- Total
  v_total := v_alt_score + v_breeding_score + v_stability_score + v_recency_score;

  -- Label
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

COMMENT ON FUNCTION ops.compute_place_readiness(UUID) IS
'MIG_3009: Compute TNR completion readiness score (0-100) for a place.
4 dimensions: alteration (0-25), breeding absence (0-25), stability (0-25), recency (0-25).
Thresholds from ops.app_config beacon.readiness_* keys.';

\echo '   Created ops.compute_place_readiness()'

-- ============================================================================
-- Section 5: Matview Rebuild with New Columns
-- ============================================================================

\echo ''
\echo '5. Rebuilding ops.mv_beacon_place_metrics with new columns...'

-- Must drop wrapper view first, then matview
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
latest_colony_estimates AS (
    SELECT DISTINCT ON (place_id)
        place_id,
        total_count_observed AS colony_estimate,
        estimate_method
    FROM sot.place_colony_estimates
    ORDER BY place_id, observed_date DESC NULLS LAST, created_at DESC
),
-- MIG_3009: New CTEs for data surfacing
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
    -- Existing columns (unchanged)
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
    -- MIG_3009: New columns
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

-- Recreate all indexes (existing + new)
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
-- New indexes for filtering
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_breeding
    ON ops.mv_beacon_place_metrics(has_recent_breeding) WHERE has_recent_breeding = TRUE;
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_trend
    ON ops.mv_beacon_place_metrics(colony_trend);
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_immigration
    ON ops.mv_beacon_place_metrics(immigration_pressure) WHERE immigration_pressure != 'none';

COMMENT ON MATERIALIZED VIEW ops.mv_beacon_place_metrics IS
'MIG_3009: Per-place beacon metrics with TNR data surfacing columns.
Includes: alteration rate (MIG_2861 corrected denominator), breeding activity,
colony trend, immigration pressure.
Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY ops.mv_beacon_place_metrics;';

-- Recreate wrapper view
CREATE VIEW ops.v_beacon_place_metrics AS
SELECT * FROM ops.mv_beacon_place_metrics;

COMMENT ON VIEW ops.v_beacon_place_metrics IS
'API-compatible view wrapping mv_beacon_place_metrics materialized view';

\echo '   Rebuilt ops.mv_beacon_place_metrics + ops.v_beacon_place_metrics'

-- ============================================================================
-- Section 6: Config Entries
-- ============================================================================

\echo ''
\echo '6. Inserting config entries...'

INSERT INTO ops.app_config (key, value, category, description) VALUES
  ('beacon.readiness_complete_threshold', '80', 'beacon', 'Readiness score >= this = complete'),
  ('beacon.readiness_nearly_complete_threshold', '60', 'beacon', 'Readiness score >= this = nearly_complete'),
  ('beacon.readiness_in_progress_threshold', '30', 'beacon', 'Readiness score >= this = in_progress'),
  ('beacon.immigration_lookback_days', '180', 'beacon', 'Days to look back for new intact arrivals'),
  ('beacon.breeding_recent_days', '180', 'beacon', 'Days to look back for breeding activity')
ON CONFLICT (key) DO NOTHING;

\echo '   Inserted beacon.readiness_* config entries'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Matview column count (should be 26):'
SELECT COUNT(*) AS column_count
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'mv_beacon_place_metrics';

\echo ''
\echo 'New columns sample (top 10 places with breeding):'
SELECT
  display_name,
  total_cats,
  alteration_rate_pct,
  has_recent_breeding,
  colony_trend,
  new_intact_arrivals,
  immigration_pressure
FROM ops.mv_beacon_place_metrics
WHERE has_recent_breeding = TRUE
ORDER BY total_cats DESC
LIMIT 10;

\echo ''
\echo 'Colony trend distribution:'
SELECT colony_trend, COUNT(*) AS place_count
FROM ops.mv_beacon_place_metrics
WHERE total_cats > 0
GROUP BY colony_trend
ORDER BY place_count DESC;

\echo ''
\echo 'Trapper efficiency sample (top 5):'
SELECT * FROM ops.v_trapper_efficiency ORDER BY catch_per_trap DESC NULLS LAST LIMIT 5;

\echo ''
\echo 'Lifecycle summary sample (top 5 by events):'
SELECT * FROM ops.v_place_lifecycle_summary ORDER BY total_events DESC LIMIT 5;

\echo ''
\echo 'Config entries:'
SELECT key, value FROM ops.app_config WHERE key LIKE 'beacon.readiness_%' OR key LIKE 'beacon.immigration_%' OR key LIKE 'beacon.breeding_%';

\echo ''
\echo '=============================================='
\echo '  MIG_3009 Complete'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - ops.v_trapper_efficiency (per-trapper catch rate)'
\echo '  - ops.v_place_trap_efficiency (per-place catch rate)'
\echo '  - ops.v_place_breeding_activity (pregnancy/lactation flags)'
\echo '  - ops.v_place_lifecycle_summary (outcome counts per place)'
\echo '  - ops.compute_place_readiness() (0-100 readiness score)'
\echo '  - ops.mv_beacon_place_metrics REBUILT with 6 new columns'
\echo '  - ops.v_beacon_place_metrics wrapper view recreated'
\echo '  - 5 beacon config entries'
\echo ''
