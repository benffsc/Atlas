-- MIG_2934: Beacon P0 Analytics — SQL views & functions
-- FFS-538: Date-range filtering, zone rollups, temporal trends, location comparison
--
-- Beacon MVP demo is May 30, 2026. This migration creates the SQL data layer
-- for the 5 P0 analytics features identified in the spec.

BEGIN;

\echo 'MIG_2934: Creating Beacon P0 analytics layer'

-- ============================================================================
-- 1. Zone Alteration Rollup View
-- ============================================================================
-- Aggregates TNR stats per observation zone: cat counts, alteration rates,
-- request activity, and trend indicators.

\echo '1. Creating beacon.v_zone_alteration_rollup...'

CREATE OR REPLACE VIEW beacon.v_zone_alteration_rollup AS
WITH zone_places AS (
  -- Places assigned to each zone
  SELECT
    oz.zone_id,
    oz.zone_code,
    oz.zone_name,
    oz.service_zone,
    ST_Y(oz.centroid::geometry) AS centroid_lat,
    ST_X(oz.centroid::geometry) AS centroid_lng,
    poz.place_id
  FROM sot.observation_zones oz
  JOIN sot.place_observation_zone poz ON poz.zone_id = oz.zone_id
  WHERE oz.status = 'active'
    AND oz.merged_into_zone_id IS NULL
),
zone_cat_stats AS (
  -- Cat counts per zone
  SELECT
    zp.zone_id,
    COUNT(DISTINCT cp.cat_id) AS total_cats,
    COUNT(DISTINCT cp.cat_id) FILTER (
      WHERE c.altered_status IN ('spayed', 'neutered')
    ) AS altered_cats,
    COUNT(DISTINCT cp.cat_id) FILTER (
      WHERE c.altered_status = 'intact'
    ) AS intact_cats,
    COUNT(DISTINCT cp.cat_id) FILTER (
      WHERE c.altered_status = 'unknown' OR c.altered_status IS NULL
    ) AS unknown_status_cats
  FROM zone_places zp
  JOIN sot.cat_place cp ON cp.place_id = zp.place_id
  JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
  GROUP BY zp.zone_id
),
zone_activity AS (
  -- Request and appointment activity per zone
  SELECT
    zp.zone_id,
    COUNT(DISTINCT zp.place_id) AS place_count,
    COUNT(DISTINCT r.request_id) AS total_requests,
    COUNT(DISTINCT r.request_id) FILTER (
      WHERE r.status NOT IN ('completed', 'cancelled', 'closed')
    ) AS active_requests,
    COUNT(DISTINCT a.appointment_id) AS total_appointments,
    MAX(a.appointment_date) AS last_appointment_date,
    -- Activity in last 90 days
    COUNT(DISTINCT a.appointment_id) FILTER (
      WHERE a.appointment_date >= CURRENT_DATE - INTERVAL '90 days'
    ) AS appointments_last_90d,
    -- Alterations in last 90 days
    COUNT(DISTINCT a.appointment_id) FILTER (
      WHERE a.appointment_date >= CURRENT_DATE - INTERVAL '90 days'
        AND (a.is_spay = true OR a.is_neuter = true)
    ) AS alterations_last_90d
  FROM zone_places zp
  LEFT JOIN ops.requests r ON r.place_id = zp.place_id
    AND r.merged_into_request_id IS NULL
  LEFT JOIN ops.appointments a ON (a.place_id = zp.place_id OR a.inferred_place_id = zp.place_id)
    AND a.cat_id IS NOT NULL
  GROUP BY zp.zone_id
),
zone_estimates AS (
  -- Colony estimates per zone (from beacon.place_chapman_estimates)
  SELECT
    zp.zone_id,
    SUM(pce.estimated_population) AS estimated_population,
    COUNT(*) FILTER (WHERE pce.sample_adequate = true) AS adequate_estimates,
    COUNT(*) AS total_estimates
  FROM zone_places zp
  JOIN beacon.place_chapman_estimates pce ON pce.place_id = zp.place_id
  GROUP BY zp.zone_id
)
SELECT
  zp_agg.zone_id,
  zp_agg.zone_code,
  zp_agg.zone_name,
  zp_agg.service_zone,
  zp_agg.centroid_lat,
  zp_agg.centroid_lng,
  COALESCE(za.place_count, 0)::INT AS place_count,
  COALESCE(zcs.total_cats, 0)::INT AS total_cats,
  COALESCE(zcs.altered_cats, 0)::INT AS altered_cats,
  COALESCE(zcs.intact_cats, 0)::INT AS intact_cats,
  COALESCE(zcs.unknown_status_cats, 0)::INT AS unknown_status_cats,
  -- Alteration rate (known-status denominator per MIG_2861)
  CASE
    WHEN COALESCE(zcs.altered_cats, 0) + COALESCE(zcs.intact_cats, 0) > 0 THEN
      ROUND(100.0 * zcs.altered_cats / (zcs.altered_cats + zcs.intact_cats), 1)
    ELSE NULL
  END AS alteration_rate_pct,
  -- TNR status thresholds (Levy et al. 2005)
  CASE
    WHEN COALESCE(zcs.altered_cats, 0) + COALESCE(zcs.intact_cats, 0) = 0 THEN 'no_data'
    WHEN 100.0 * zcs.altered_cats / (zcs.altered_cats + zcs.intact_cats) >= 75 THEN 'managed'
    WHEN 100.0 * zcs.altered_cats / (zcs.altered_cats + zcs.intact_cats) >= 50 THEN 'in_progress'
    WHEN 100.0 * zcs.altered_cats / (zcs.altered_cats + zcs.intact_cats) >= 25 THEN 'needs_work'
    ELSE 'needs_attention'
  END AS zone_status,
  COALESCE(za.total_requests, 0)::INT AS total_requests,
  COALESCE(za.active_requests, 0)::INT AS active_requests,
  COALESCE(za.total_appointments, 0)::INT AS total_appointments,
  za.last_appointment_date,
  COALESCE(za.appointments_last_90d, 0)::INT AS appointments_last_90d,
  COALESCE(za.alterations_last_90d, 0)::INT AS alterations_last_90d,
  -- Population estimate (Chapman)
  ze.estimated_population,
  COALESCE(ze.adequate_estimates, 0)::INT AS adequate_estimates,
  COALESCE(ze.total_estimates, 0)::INT AS total_estimates
FROM (
  SELECT DISTINCT zone_id, zone_code, zone_name, service_zone, centroid_lat, centroid_lng
  FROM zone_places
) zp_agg
LEFT JOIN zone_cat_stats zcs ON zcs.zone_id = zp_agg.zone_id
LEFT JOIN zone_activity za ON za.zone_id = zp_agg.zone_id
LEFT JOIN zone_estimates ze ON ze.zone_id = zp_agg.zone_id
ORDER BY COALESCE(zcs.total_cats, 0) DESC;

COMMENT ON VIEW beacon.v_zone_alteration_rollup IS
'Zone-level TNR statistics rollup. Aggregates cat counts, alteration rates,
request activity, and Chapman population estimates per observation zone.
Alteration rate uses known-status denominator (spayed+neutered / spayed+neutered+intact).';


-- ============================================================================
-- 2. Per-Place Temporal Trends Function
-- ============================================================================
-- Returns monthly time-series data for a specific place: new cats seen,
-- alterations performed, and cumulative totals.

\echo '2. Creating beacon.place_temporal_trends()...'

CREATE OR REPLACE FUNCTION beacon.place_temporal_trends(
  p_place_id UUID,
  p_months_back INT DEFAULT 24
)
RETURNS TABLE (
  month DATE,
  month_label TEXT,
  new_cats_seen INT,
  alterations INT,
  cumulative_cats INT,
  cumulative_altered INT,
  alteration_rate_pct NUMERIC
)
LANGUAGE sql STABLE
AS $$
  WITH months AS (
    -- Generate month series
    SELECT generate_series(
      date_trunc('month', CURRENT_DATE - (p_months_back || ' months')::INTERVAL)::DATE,
      date_trunc('month', CURRENT_DATE)::DATE,
      '1 month'::INTERVAL
    )::DATE AS month
  ),
  monthly_cats AS (
    -- Cats first seen at this place each month (via appointments)
    SELECT
      date_trunc('month', MIN(a.appointment_date))::DATE AS first_seen_month,
      a.cat_id
    FROM ops.appointments a
    WHERE (a.place_id = p_place_id OR a.inferred_place_id = p_place_id)
      AND a.cat_id IS NOT NULL
      AND a.appointment_date >= date_trunc('month', CURRENT_DATE - (p_months_back || ' months')::INTERVAL)
    GROUP BY a.cat_id
  ),
  monthly_alterations AS (
    -- Alterations performed at this place each month
    SELECT
      date_trunc('month', a.appointment_date)::DATE AS alt_month,
      COUNT(DISTINCT a.cat_id) AS alt_count
    FROM ops.appointments a
    WHERE (a.place_id = p_place_id OR a.inferred_place_id = p_place_id)
      AND a.cat_id IS NOT NULL
      AND (a.is_spay = true OR a.is_neuter = true)
      AND a.appointment_date >= date_trunc('month', CURRENT_DATE - (p_months_back || ' months')::INTERVAL)
    GROUP BY date_trunc('month', a.appointment_date)::DATE
  ),
  monthly_stats AS (
    SELECT
      m.month,
      COALESCE(COUNT(mc.cat_id), 0)::INT AS new_cats_seen,
      COALESCE(ma.alt_count, 0)::INT AS alterations
    FROM months m
    LEFT JOIN monthly_cats mc ON mc.first_seen_month = m.month
    LEFT JOIN monthly_alterations ma ON ma.alt_month = m.month
    GROUP BY m.month, ma.alt_count
  )
  SELECT
    ms.month,
    TO_CHAR(ms.month, 'Mon YYYY') AS month_label,
    ms.new_cats_seen,
    ms.alterations,
    SUM(ms.new_cats_seen) OVER (ORDER BY ms.month)::INT AS cumulative_cats,
    SUM(ms.alterations) OVER (ORDER BY ms.month)::INT AS cumulative_altered,
    CASE
      WHEN SUM(ms.new_cats_seen) OVER (ORDER BY ms.month) > 0 THEN
        ROUND(100.0 * SUM(ms.alterations) OVER (ORDER BY ms.month)
              / SUM(ms.new_cats_seen) OVER (ORDER BY ms.month), 1)
      ELSE NULL
    END AS alteration_rate_pct
  FROM monthly_stats ms
  ORDER BY ms.month;
$$;

COMMENT ON FUNCTION beacon.place_temporal_trends IS
'Returns monthly time-series data for a place: new cats seen, alterations performed,
cumulative totals, and rolling alteration rate. Used for trend charts in Beacon.';


-- ============================================================================
-- 3. Location Comparison Function
-- ============================================================================
-- Returns side-by-side metrics for multiple places.

\echo '3. Creating beacon.compare_places()...'

CREATE OR REPLACE FUNCTION beacon.compare_places(
  p_place_ids UUID[]
)
RETURNS TABLE (
  place_id UUID,
  display_name TEXT,
  formatted_address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  service_zone TEXT,
  total_cats INT,
  altered_cats INT,
  intact_cats INT,
  unknown_status_cats INT,
  alteration_rate_pct NUMERIC,
  colony_status TEXT,
  total_requests INT,
  active_requests INT,
  total_appointments INT,
  last_appointment_date DATE,
  first_appointment_date DATE,
  estimated_population INT,
  ci_lower INT,
  ci_upper INT,
  sample_adequate BOOLEAN,
  people_count INT,
  days_since_last_activity INT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    ST_Y(p.location::geometry) AS lat,
    ST_X(p.location::geometry) AS lng,
    p.service_zone,
    -- Cat stats
    COALESCE(cs.total_cats, 0)::INT,
    COALESCE(cs.altered_cats, 0)::INT,
    COALESCE(cs.intact_cats, 0)::INT,
    COALESCE(cs.unknown_cats, 0)::INT,
    -- Alteration rate
    CASE
      WHEN COALESCE(cs.altered_cats, 0) + COALESCE(cs.intact_cats, 0) > 0 THEN
        ROUND(100.0 * cs.altered_cats / (cs.altered_cats + cs.intact_cats), 1)
      ELSE NULL
    END,
    -- Colony status
    CASE
      WHEN COALESCE(cs.altered_cats, 0) + COALESCE(cs.intact_cats, 0) = 0 THEN 'no_data'
      WHEN 100.0 * cs.altered_cats / (cs.altered_cats + cs.intact_cats) >= 75 THEN 'managed'
      WHEN 100.0 * cs.altered_cats / (cs.altered_cats + cs.intact_cats) >= 50 THEN 'in_progress'
      WHEN 100.0 * cs.altered_cats / (cs.altered_cats + cs.intact_cats) >= 25 THEN 'needs_work'
      ELSE 'needs_attention'
    END,
    -- Request stats
    COALESCE(rs.total_requests, 0)::INT,
    COALESCE(rs.active_requests, 0)::INT,
    -- Appointment stats
    COALESCE(apt.total_appointments, 0)::INT,
    apt.last_appointment_date,
    apt.first_appointment_date,
    -- Population estimate
    pce.estimated_population,
    pce.ci_lower,
    pce.ci_upper,
    pce.sample_adequate,
    -- People
    COALESCE(pp_count.cnt, 0)::INT,
    -- Days since last activity
    CASE
      WHEN apt.last_appointment_date IS NOT NULL THEN
        (CURRENT_DATE - apt.last_appointment_date)::INT
      ELSE NULL
    END
  FROM sot.places p
  LEFT JOIN (
    SELECT
      cp.place_id,
      COUNT(DISTINCT cp.cat_id) AS total_cats,
      COUNT(DISTINCT cp.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered')) AS altered_cats,
      COUNT(DISTINCT cp.cat_id) FILTER (WHERE c.altered_status = 'intact') AS intact_cats,
      COUNT(DISTINCT cp.cat_id) FILTER (WHERE c.altered_status = 'unknown' OR c.altered_status IS NULL) AS unknown_cats
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    WHERE cp.place_id = ANY(p_place_ids)
    GROUP BY cp.place_id
  ) cs ON cs.place_id = p.place_id
  LEFT JOIN (
    SELECT
      r.place_id,
      COUNT(*) AS total_requests,
      COUNT(*) FILTER (WHERE r.status NOT IN ('completed', 'cancelled', 'closed')) AS active_requests
    FROM ops.requests r
    WHERE r.place_id = ANY(p_place_ids) AND r.merged_into_request_id IS NULL
    GROUP BY r.place_id
  ) rs ON rs.place_id = p.place_id
  LEFT JOIN (
    SELECT
      COALESCE(a.place_id, a.inferred_place_id) AS place_id,
      COUNT(DISTINCT a.appointment_id) AS total_appointments,
      MAX(a.appointment_date) AS last_appointment_date,
      MIN(a.appointment_date) AS first_appointment_date
    FROM ops.appointments a
    WHERE COALESCE(a.place_id, a.inferred_place_id) = ANY(p_place_ids)
      AND a.cat_id IS NOT NULL
    GROUP BY COALESCE(a.place_id, a.inferred_place_id)
  ) apt ON apt.place_id = p.place_id
  LEFT JOIN beacon.place_chapman_estimates pce ON pce.place_id = p.place_id
  LEFT JOIN (
    SELECT pp.place_id, COUNT(DISTINCT pp.person_id) AS cnt
    FROM sot.person_place pp
    WHERE pp.place_id = ANY(p_place_ids)
    GROUP BY pp.place_id
  ) pp_count ON pp_count.place_id = p.place_id
  WHERE p.place_id = ANY(p_place_ids)
    AND p.merged_into_place_id IS NULL
  ORDER BY COALESCE(cs.total_cats, 0) DESC;
$$;

COMMENT ON FUNCTION beacon.compare_places IS
'Returns side-by-side metrics for multiple places. Used by the Beacon location
comparison panel. Includes cat stats, alteration rates, requests, appointments,
Chapman estimates, and people counts.';


-- ============================================================================
-- 4. Date-Filtered Map Data Function
-- ============================================================================
-- Returns place-level cat stats filtered by appointment date range.
-- Used by the map date-range slider.

\echo '4. Creating beacon.map_data_filtered()...'

CREATE OR REPLACE FUNCTION beacon.map_data_filtered(
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_service_zone TEXT DEFAULT NULL
)
RETURNS TABLE (
  place_id UUID,
  formatted_address TEXT,
  display_name TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  service_zone TEXT,
  place_kind TEXT,
  cat_count INT,
  altered_count INT,
  intact_count INT,
  alteration_rate_pct NUMERIC,
  appointment_count INT,
  request_count INT,
  last_activity_date DATE,
  colony_status TEXT
)
LANGUAGE sql STABLE
AS $$
  WITH date_filtered_cats AS (
    -- Cats seen at each place within the date range
    SELECT
      COALESCE(a.place_id, a.inferred_place_id) AS place_id,
      a.cat_id,
      bool_or(a.is_spay = true OR a.is_neuter = true) AS was_altered_in_window
    FROM ops.appointments a
    WHERE a.cat_id IS NOT NULL
      AND COALESCE(a.place_id, a.inferred_place_id) IS NOT NULL
      AND (p_date_from IS NULL OR a.appointment_date >= p_date_from)
      AND (p_date_to IS NULL OR a.appointment_date <= p_date_to)
    GROUP BY COALESCE(a.place_id, a.inferred_place_id), a.cat_id
  ),
  place_stats AS (
    SELECT
      dfc.place_id,
      COUNT(DISTINCT dfc.cat_id) AS cat_count,
      COUNT(DISTINCT dfc.cat_id) FILTER (
        WHERE c.altered_status IN ('spayed', 'neutered') OR dfc.was_altered_in_window
      ) AS altered_count,
      COUNT(DISTINCT dfc.cat_id) FILTER (
        WHERE c.altered_status = 'intact' AND NOT dfc.was_altered_in_window
      ) AS intact_count,
      COUNT(DISTINCT a2.appointment_id) AS appointment_count,
      MAX(a2.appointment_date) AS last_activity_date
    FROM date_filtered_cats dfc
    JOIN sot.cats c ON c.cat_id = dfc.cat_id AND c.merged_into_cat_id IS NULL
    LEFT JOIN ops.appointments a2
      ON (a2.place_id = dfc.place_id OR a2.inferred_place_id = dfc.place_id)
      AND a2.cat_id = dfc.cat_id
      AND (p_date_from IS NULL OR a2.appointment_date >= p_date_from)
      AND (p_date_to IS NULL OR a2.appointment_date <= p_date_to)
    GROUP BY dfc.place_id
  )
  SELECT
    p.place_id,
    p.formatted_address,
    p.display_name,
    ST_Y(p.location::geometry) AS lat,
    ST_X(p.location::geometry) AS lng,
    p.service_zone,
    p.place_kind,
    COALESCE(ps.cat_count, 0)::INT,
    COALESCE(ps.altered_count, 0)::INT,
    COALESCE(ps.intact_count, 0)::INT,
    CASE
      WHEN COALESCE(ps.altered_count, 0) + COALESCE(ps.intact_count, 0) > 0 THEN
        ROUND(100.0 * ps.altered_count / (ps.altered_count + ps.intact_count), 1)
      ELSE NULL
    END,
    COALESCE(ps.appointment_count, 0)::INT,
    COALESCE(rc.request_count, 0)::INT,
    ps.last_activity_date,
    CASE
      WHEN COALESCE(ps.altered_count, 0) + COALESCE(ps.intact_count, 0) = 0 THEN 'no_data'
      WHEN 100.0 * ps.altered_count / (ps.altered_count + ps.intact_count) >= 75 THEN 'managed'
      WHEN 100.0 * ps.altered_count / (ps.altered_count + ps.intact_count) >= 50 THEN 'in_progress'
      WHEN 100.0 * ps.altered_count / (ps.altered_count + ps.intact_count) >= 25 THEN 'needs_work'
      ELSE 'needs_attention'
    END
  FROM sot.places p
  JOIN place_stats ps ON ps.place_id = p.place_id
  LEFT JOIN (
    SELECT r.place_id, COUNT(*) AS request_count
    FROM ops.requests r
    WHERE r.merged_into_request_id IS NULL
      AND (p_date_from IS NULL OR r.created_at >= p_date_from)
      AND (p_date_to IS NULL OR r.created_at <= p_date_to)
    GROUP BY r.place_id
  ) rc ON rc.place_id = p.place_id
  WHERE p.merged_into_place_id IS NULL
    AND p.location IS NOT NULL
    AND (p_service_zone IS NULL OR p.service_zone = p_service_zone)
  ORDER BY ps.cat_count DESC;
$$;

COMMENT ON FUNCTION beacon.map_data_filtered IS
'Returns place-level cat/alteration stats filtered by appointment date range.
Used by the Beacon map date-range slider. NULL dates mean no filter on that bound.';


-- ============================================================================
-- Done
-- ============================================================================

\echo ''
\echo 'MIG_2934: Beacon P0 analytics layer created'
\echo '  View: beacon.v_zone_alteration_rollup'
\echo '  Function: beacon.place_temporal_trends(place_id, months_back)'
\echo '  Function: beacon.compare_places(place_ids UUID[])'
\echo '  Function: beacon.map_data_filtered(date_from, date_to, zone)'

COMMIT;
