-- Scoreboard Queries
-- Cats fixed and wellness visits by time period

-- Since Last Meeting
SELECT
  'Since Last Meeting (2025-11-21 to 2026-02-19)' as period,
  COUNT(*) FILTER (WHERE is_spay = true) as spays,
  COUNT(*) FILTER (WHERE is_neuter = true) as neuters,
  COUNT(*) FILTER (WHERE is_spay = true OR is_neuter = true) as total_fixed,
  COUNT(*) FILTER (WHERE is_spay = false AND is_neuter = false) as wellness_only,
  COUNT(*) as total_appointments
FROM ops.appointments
WHERE appointment_date >= '2025-11-21'
  AND appointment_date <= '2026-02-19';

-- Year-to-Date
SELECT
  'YTD (2026-01-01 to 2026-02-19)' as period,
  COUNT(*) FILTER (WHERE is_spay = true) as spays,
  COUNT(*) FILTER (WHERE is_neuter = true) as neuters,
  COUNT(*) FILTER (WHERE is_spay = true OR is_neuter = true) as total_fixed,
  COUNT(*) FILTER (WHERE is_spay = false AND is_neuter = false) as wellness_only,
  COUNT(*) as total_appointments
FROM ops.appointments
WHERE appointment_date >= '2026-01-01'
  AND appointment_date <= '2026-02-19';

-- Requests Resolved
SELECT
  CASE
    WHEN resolved_at >= '2025-11-21' THEN 'Since Last Meeting'
    WHEN resolved_at >= '2026-01-01' THEN 'YTD'
  END as period,
  COUNT(*) as requests_resolved
FROM ops.requests
WHERE resolved_at >= '2025-11-21'
  AND resolved_at <= '2026-02-19'
GROUP BY 1;
