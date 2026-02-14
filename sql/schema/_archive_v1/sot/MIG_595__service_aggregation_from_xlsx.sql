-- ============================================================================
-- MIG_595: Service Aggregation for Multi-Row ClinicHQ Exports
-- ============================================================================
-- ClinicHQ exports now use a multi-row format where each service is a separate
-- row. This migration adds functions to aggregate services per appointment.
--
-- Usage:
--   1. Stage XLSX via clinichq_appointment_info_xlsx.mjs
--   2. Run: SELECT * FROM trapper.aggregate_staged_appointment_services();
--   3. Continue with normal processing
--
-- The update_appointment_services.mjs script handles bulk XLSX imports directly.
-- This SQL function handles cases where data was staged but not aggregated.
-- ============================================================================

\echo '=== MIG_595: Service Aggregation for Multi-Row ClinicHQ Exports ==='
\echo ''

-- ============================================================================
-- Function to aggregate services from staged records into existing appointments
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.aggregate_staged_appointment_services(
  p_ingest_run_id UUID DEFAULT NULL
)
RETURNS TABLE (
  appointments_updated INT,
  services_aggregated INT
) AS $$
DECLARE
  v_updated INT := 0;
  v_services INT := 0;
  v_rec RECORD;
BEGIN
  -- Find appointments with multiple staged service rows
  FOR v_rec IN
    WITH staged_services AS (
      SELECT
        sr.payload->>'Number' AS appointment_number,
        ARRAY_AGG(DISTINCT sr.payload->>'Service / Subsidy'
          ORDER BY sr.payload->>'Service / Subsidy')
          FILTER (WHERE NULLIF(TRIM(sr.payload->>'Service / Subsidy'), '') IS NOT NULL
                    AND sr.payload->>'Service / Subsidy' != '---') AS services
      FROM trapper.staged_records sr
      WHERE sr.source_system = 'clinichq'
        AND sr.source_table = 'appointment_info'
        AND sr.payload->>'Number' IS NOT NULL
        AND (p_ingest_run_id IS NULL OR sr.ingest_run_id = p_ingest_run_id)
      GROUP BY sr.payload->>'Number'
      HAVING COUNT(*) > 1  -- Multiple rows = multi-row format
    )
    SELECT
      a.appointment_id,
      a.appointment_number,
      a.service_type AS current_service,
      ARRAY_TO_STRING(ss.services, ' /; ') AS aggregated_service,
      ARRAY_LENGTH(ss.services, 1) AS service_count
    FROM staged_services ss
    JOIN trapper.sot_appointments a ON a.appointment_number = ss.appointment_number
    WHERE a.service_type IS DISTINCT FROM ARRAY_TO_STRING(ss.services, ' /; ')
      AND ARRAY_LENGTH(ss.services, 1) > 1
  LOOP
    -- Update appointment with aggregated services
    UPDATE trapper.sot_appointments
    SET service_type = v_rec.aggregated_service,
        updated_at = NOW()
    WHERE appointment_id = v_rec.appointment_id;

    v_updated := v_updated + 1;
    v_services := v_services + v_rec.service_count;
  END LOOP;

  RETURN QUERY SELECT v_updated, v_services;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.aggregate_staged_appointment_services IS
'Aggregates services from multi-row staged ClinicHQ exports into sot_appointments.
Multi-row format: Each service for an appointment is a separate row.
This function combines them into a single service_type string.

Usage after staging XLSX:
  SELECT * FROM trapper.aggregate_staged_appointment_services();

Or for specific ingest run:
  SELECT * FROM trapper.aggregate_staged_appointment_services(''uuid-here'');';

-- ============================================================================
-- View to check service data coverage
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_appointment_service_coverage AS
SELECT
  EXTRACT(YEAR FROM appointment_date) AS year,
  COUNT(*) AS total_appointments,
  COUNT(*) FILTER (WHERE service_type ILIKE '%Rabies%') AS has_rabies,
  ROUND(100.0 * COUNT(*) FILTER (WHERE service_type ILIKE '%Rabies%') / NULLIF(COUNT(*), 0), 1) AS rabies_pct,
  COUNT(*) FILTER (WHERE service_type ILIKE '%FVRCP%') AS has_fvrcp,
  ROUND(100.0 * COUNT(*) FILTER (WHERE service_type ILIKE '%FVRCP%') / NULLIF(COUNT(*), 0), 1) AS fvrcp_pct,
  COUNT(*) FILTER (WHERE service_type ILIKE '%Revolution%') AS has_revolution,
  ROUND(100.0 * COUNT(*) FILTER (WHERE service_type ILIKE '%Revolution%') / NULLIF(COUNT(*), 0), 1) AS revolution_pct,
  COUNT(*) FILTER (WHERE service_type IS NULL OR service_type = '') AS no_service_data,
  COUNT(*) FILTER (WHERE service_type LIKE '%/%' AND service_type NOT LIKE '% /; %') AS single_service_only
FROM trapper.sot_appointments
WHERE cat_id IS NOT NULL
  AND appointment_date >= '2014-01-01'
GROUP BY EXTRACT(YEAR FROM appointment_date)
ORDER BY year;

COMMENT ON VIEW trapper.v_appointment_service_coverage IS
'Shows vaccination and treatment data coverage by year.
Use this to identify years that need service data backfill.
single_service_only > 0 indicates incomplete multi-row aggregation.';

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=== MIG_595 Complete ==='
\echo ''
\echo 'Created:'
\echo '  - aggregate_staged_appointment_services(run_id) - Aggregate multi-row services'
\echo '  - v_appointment_service_coverage - Monitor vaccination data coverage'
\echo ''
\echo 'For bulk XLSX updates, use the Node.js script:'
\echo '  node scripts/ingest/update_appointment_services.mjs /path/to/export.xlsx'
\echo ''
\echo 'After staging multi-row ClinicHQ exports, run:'
\echo '  SELECT * FROM trapper.aggregate_staged_appointment_services();'
\echo ''
