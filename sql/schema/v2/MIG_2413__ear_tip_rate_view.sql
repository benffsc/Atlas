-- MIG_2413: Ear Tip Rate Monitoring View
-- Fixes: DATA_GAP_036 - Ear tip rate tracking
--
-- Provides historical and current ear tip rate metrics

CREATE OR REPLACE VIEW ops.v_ear_tip_rate_by_period AS
SELECT
  DATE_TRUNC('month', appointment_date)::date as period,
  COUNT(*) FILTER (WHERE is_spay OR is_neuter) as surgeries,
  COUNT(*) FILTER (WHERE has_ear_tip = true) as ear_tipped,
  COUNT(*) FILTER (WHERE has_ear_tip = false) as not_ear_tipped,
  COUNT(*) FILTER (WHERE has_ear_tip IS NULL AND (is_spay OR is_neuter)) as unknown,
  ROUND(
    COUNT(*) FILTER (WHERE has_ear_tip = true)::numeric /
    NULLIF(COUNT(*) FILTER (WHERE (is_spay OR is_neuter) AND has_ear_tip IS NOT NULL), 0) * 100,
  1) as ear_tip_rate
FROM ops.appointments
WHERE appointment_date >= '2019-01-01'
GROUP BY 1
ORDER BY 1 DESC;

COMMENT ON VIEW ops.v_ear_tip_rate_by_period IS
'Ear tip rate by month. Historical rate was ~80% (2019), declined to ~53% (2025).
Rate for known appointments only (excludes NULL where export was broken).
See DATA_GAP_036 for analysis.';

-- Ear tip rate by year for trending
CREATE OR REPLACE VIEW ops.v_ear_tip_rate_by_year AS
SELECT
  EXTRACT(YEAR FROM appointment_date)::integer as year,
  COUNT(*) FILTER (WHERE is_spay OR is_neuter) as surgeries,
  COUNT(*) FILTER (WHERE has_ear_tip = true) as ear_tipped,
  COUNT(*) FILTER (WHERE has_ear_tip IS NOT NULL AND (is_spay OR is_neuter)) as known_status,
  ROUND(
    COUNT(*) FILTER (WHERE has_ear_tip = true)::numeric /
    NULLIF(COUNT(*) FILTER (WHERE (is_spay OR is_neuter) AND has_ear_tip IS NOT NULL), 0) * 100,
  1) as ear_tip_rate
FROM ops.appointments
WHERE appointment_date >= '2013-01-01'
GROUP BY 1
ORDER BY 1;

COMMENT ON VIEW ops.v_ear_tip_rate_by_year IS
'Ear tip rate by year for long-term trending. Shows decline from 80% to 53% over 2019-2025.';

-- Recent ear tip rate (for dashboard)
CREATE OR REPLACE VIEW ops.v_ear_tip_rate_recent AS
SELECT
  'Last 30 days' as period,
  COUNT(*) FILTER (WHERE is_spay OR is_neuter) as surgeries,
  COUNT(*) FILTER (WHERE has_ear_tip = true) as ear_tipped,
  ROUND(
    COUNT(*) FILTER (WHERE has_ear_tip = true)::numeric /
    NULLIF(COUNT(*) FILTER (WHERE (is_spay OR is_neuter) AND has_ear_tip IS NOT NULL), 0) * 100,
  1) as ear_tip_rate
FROM ops.appointments
WHERE appointment_date >= CURRENT_DATE - INTERVAL '30 days'
UNION ALL
SELECT
  'Last 90 days',
  COUNT(*) FILTER (WHERE is_spay OR is_neuter),
  COUNT(*) FILTER (WHERE has_ear_tip = true),
  ROUND(
    COUNT(*) FILTER (WHERE has_ear_tip = true)::numeric /
    NULLIF(COUNT(*) FILTER (WHERE (is_spay OR is_neuter) AND has_ear_tip IS NOT NULL), 0) * 100,
  1)
FROM ops.appointments
WHERE appointment_date >= CURRENT_DATE - INTERVAL '90 days'
UNION ALL
SELECT
  'YTD',
  COUNT(*) FILTER (WHERE is_spay OR is_neuter),
  COUNT(*) FILTER (WHERE has_ear_tip = true),
  ROUND(
    COUNT(*) FILTER (WHERE has_ear_tip = true)::numeric /
    NULLIF(COUNT(*) FILTER (WHERE (is_spay OR is_neuter) AND has_ear_tip IS NOT NULL), 0) * 100,
  1)
FROM ops.appointments
WHERE appointment_date >= DATE_TRUNC('year', CURRENT_DATE);

COMMENT ON VIEW ops.v_ear_tip_rate_recent IS
'Recent ear tip rates for dashboard display.';
