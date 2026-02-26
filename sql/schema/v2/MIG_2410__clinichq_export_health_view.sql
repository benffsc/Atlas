-- MIG_2410: ClinicHQ Export Health Monitoring View
-- Fixes: DATA_GAP_037 - Service lines missing since Jan 12, 2026
--
-- This view monitors the health of ClinicHQ exports by tracking:
-- - Services per appointment (should be ~8-12)
-- - Key service line counts (ear tips, microchips, revolution, etc.)
-- - Alerts when export appears broken

CREATE OR REPLACE VIEW ops.v_clinichq_export_health AS
WITH appt_dates AS (
  -- Get the date for each appointment (handling merged cell format)
  SELECT DISTINCT
    payload->>'Number' as appt_num,
    MAX(CASE WHEN payload->>'Date' ~ '^\d{1,2}/\d{1,2}/\d{4}$'
             THEN (payload->>'Date')::date END) as appt_date
  FROM source.clinichq_raw
  WHERE record_type = 'appointment_service'
    AND payload->>'Date' IS NOT NULL
    AND payload->>'Date' <> ''
  GROUP BY payload->>'Number'
),
weekly_stats AS (
  SELECT
    DATE_TRUNC('week', ad.appt_date) as week,
    COUNT(DISTINCT r.payload->>'Number') as appointments,
    COUNT(*) as service_rows,
    COUNT(*) FILTER (WHERE r.payload->>'Service / Subsidy' ILIKE '%microchip%') as microchips,
    COUNT(*) FILTER (WHERE r.payload->>'Service / Subsidy' ILIKE '%ear tip%') as ear_tips,
    COUNT(*) FILTER (WHERE r.payload->>'Service / Subsidy' ILIKE '%revolution%') as revolution,
    COUNT(*) FILTER (WHERE r.payload->>'Service / Subsidy' ILIKE '%fvrcp%') as fvrcp,
    COUNT(*) FILTER (WHERE r.payload->>'Service / Subsidy' ILIKE '%ttd%') as ttd,
    COUNT(*) FILTER (WHERE r.payload->>'Service / Subsidy' ILIKE '%buprenorphine%') as buprenorphine
  FROM source.clinichq_raw r
  JOIN appt_dates ad ON r.payload->>'Number' = ad.appt_num
  WHERE r.record_type = 'appointment_service'
    AND ad.appt_date >= CURRENT_DATE - INTERVAL '12 weeks'
  GROUP BY 1
)
SELECT
  week,
  appointments,
  service_rows,
  ROUND(service_rows::numeric / NULLIF(appointments, 0), 1) as services_per_appt,
  microchips,
  ROUND(microchips::numeric / NULLIF(appointments, 0) * 100, 0) as microchip_pct,
  ear_tips,
  ROUND(ear_tips::numeric / NULLIF(appointments, 0) * 100, 0) as ear_tip_pct,
  revolution,
  fvrcp,
  ttd,
  buprenorphine,
  CASE
    -- CRITICAL: Export is broken if services per appointment drops significantly
    WHEN service_rows::numeric / NULLIF(appointments, 0) < 6 THEN 'CRITICAL'
    -- CRITICAL: Missing microchips entirely indicates broken export
    WHEN microchips = 0 AND appointments > 30 THEN 'CRITICAL'
    -- WARNING: Ear tip rate below 20% is suspicious
    WHEN ear_tips::numeric / NULLIF(appointments, 0) < 0.2 THEN 'WARNING'
    ELSE 'OK'
  END as health_status
FROM weekly_stats
WHERE week IS NOT NULL
ORDER BY week DESC;

COMMENT ON VIEW ops.v_clinichq_export_health IS
'Monitors ClinicHQ export health. CRITICAL status indicates export configuration is broken.
Normal: ~8-12 services per appointment.
Broken (DATA_GAP_037): ~4-5 services per appointment, missing microchips/ear tips/vaccines.
Use this to detect export issues before they accumulate.';

-- Also create a function to check current health
CREATE OR REPLACE FUNCTION ops.check_clinichq_export_health()
RETURNS TABLE (
  latest_week DATE,
  services_per_appt NUMERIC,
  health_status TEXT,
  message TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    v.week::date as latest_week,
    v.services_per_appt,
    v.health_status,
    CASE v.health_status
      WHEN 'CRITICAL' THEN
        'ClinicHQ export is BROKEN: ' || v.services_per_appt || ' services/appt (expected ~10). ' ||
        'Missing: ' ||
        CASE WHEN v.microchips = 0 THEN 'Microchips, ' ELSE '' END ||
        CASE WHEN v.ear_tips < v.appointments * 0.2 THEN 'Ear Tips, ' ELSE '' END ||
        'Check ClinicHQ export settings.'
      WHEN 'WARNING' THEN
        'Low ear tip rate: ' || ROUND(v.ear_tips::numeric / NULLIF(v.appointments, 0) * 100, 0) || '%'
      ELSE 'Export healthy: ' || v.services_per_appt || ' services/appt'
    END as message
  FROM ops.v_clinichq_export_health v
  WHERE v.week >= CURRENT_DATE - INTERVAL '14 days'
  ORDER BY v.week DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;
