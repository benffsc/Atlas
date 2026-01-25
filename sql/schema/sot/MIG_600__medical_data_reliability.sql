-- ============================================================================
-- MIG_600: Medical Data Reliability for Pre-2018 Appointments
-- ============================================================================
--
-- Problem: Before 2018, FFSC used a paper-first workflow. Medical data
-- (vaccines, treatments) was not systematically entered into ClinicHQ.
-- Volunteers later backfilled some data, but coverage is incomplete:
--
--   2015-2016: ~0.1% have FVRCP data
--   2014, 2017: ~20-40% have FVRCP data
--   2018+: ~85% have FVRCP data (systematic digital recording)
--
-- Key Insight: Spay/neuter data IS complete (primary service always recorded).
-- What's missing is vaccines/treatments (FVRCP, Rabies, Revolution).
--
-- Solution: Add configurable cutoff date and reliability views so Beacon
-- can properly weight or filter medical data by era.
-- ============================================================================

\echo ''
\echo '=== MIG_600: Medical Data Reliability for Pre-2018 Appointments ==='
\echo ''

-- ============================================================================
-- Step 1: Add configuration parameter
-- ============================================================================

\echo 'Step 1: Adding medical_data_reliable_after_date config...'

INSERT INTO trapper.ecology_config (
  config_key,
  config_value,
  unit,
  description,
  min_value,
  max_value
) VALUES (
  'medical_data_reliable_after_date',
  2018,
  'year',
  'Appointments before this year have incomplete vaccine/treatment data due to paper-first workflow. Spay/neuter data is reliable across all years.',
  2010,
  2030
) ON CONFLICT (config_key) DO UPDATE SET
  description = EXCLUDED.description,
  updated_at = NOW();

\echo 'Config added: medical_data_reliable_after_date = 2018'

-- ============================================================================
-- Step 2: Create data completeness view
-- ============================================================================

\echo ''
\echo 'Step 2: Creating v_appointment_data_completeness view...'

CREATE OR REPLACE VIEW trapper.v_appointment_data_completeness AS
WITH cutoff AS (
  SELECT COALESCE(config_value, 2018)::INT as reliable_year
  FROM trapper.ecology_config
  WHERE config_key = 'medical_data_reliable_after_date'
)
SELECT
  a.appointment_id,
  a.appointment_date,
  a.appointment_number,
  a.cat_id,
  EXTRACT(YEAR FROM a.appointment_date)::INT as appt_year,

  -- Service data completeness indicators
  CASE
    WHEN a.service_type LIKE '% /; %' THEN TRUE  -- Multi-service separator = detailed
    WHEN LENGTH(COALESCE(a.service_type, '')) > 50 THEN TRUE  -- Long string = detailed
    ELSE FALSE
  END as has_detailed_services,

  -- Era-based reliability flag
  CASE
    WHEN EXTRACT(YEAR FROM a.appointment_date) >= c.reliable_year THEN 'high'
    WHEN EXTRACT(YEAR FROM a.appointment_date) >= c.reliable_year - 1 THEN 'medium'
    ELSE 'low'
  END as medical_data_reliability,

  -- Vaccine data presence
  a.service_type ILIKE '%FVRCP%' as has_fvrcp,
  a.service_type ILIKE '%Rabies%' as has_rabies,
  a.service_type ILIKE '%Revolution%' as has_revolution,
  a.service_type ILIKE '%Buprenorphine%' as has_pain_meds,
  a.service_type ILIKE '%Microchip%' as has_microchip_service,

  -- Spay/neuter is always reliable
  COALESCE(a.is_spay, a.service_is_spay, FALSE) as is_spay,
  COALESCE(a.is_neuter, a.service_is_neuter, FALSE) as is_neuter,

  -- Raw service_type for debugging
  a.service_type

FROM trapper.sot_appointments a
CROSS JOIN cutoff c
WHERE a.cat_id IS NOT NULL;

COMMENT ON VIEW trapper.v_appointment_data_completeness IS
'Appointment data with reliability flags for medical record completeness.

medical_data_reliability levels:
  - high: Systematic digital recording (2018+)
  - medium: Transition period with partial backfill (2017)
  - low: Paper-first workflow, incomplete backfill (pre-2017)

Note: Spay/neuter data (is_spay, is_neuter) is reliable across ALL years.
Only vaccine/treatment data is incomplete pre-2018.

Cutoff year is configurable via ecology_config.medical_data_reliable_after_date';

\echo 'Created v_appointment_data_completeness view'

-- ============================================================================
-- Step 3: Update vaccination coverage view with reliability
-- ============================================================================

\echo ''
\echo 'Step 3: Updating v_appointment_service_coverage view...'

DROP VIEW IF EXISTS trapper.v_appointment_service_coverage;
CREATE VIEW trapper.v_appointment_service_coverage AS
WITH cutoff AS (
  SELECT COALESCE(config_value, 2018)::INT as reliable_year
  FROM trapper.ecology_config
  WHERE config_key = 'medical_data_reliable_after_date'
)
SELECT
  EXTRACT(YEAR FROM appointment_date)::INT AS year,
  COUNT(*) AS total_appointments,

  -- Vaccine/treatment counts
  COUNT(*) FILTER (WHERE service_type ILIKE '%Rabies%') AS has_rabies,
  ROUND(100.0 * COUNT(*) FILTER (WHERE service_type ILIKE '%Rabies%') / NULLIF(COUNT(*), 0), 1) AS rabies_pct,

  COUNT(*) FILTER (WHERE service_type ILIKE '%FVRCP%') AS has_fvrcp,
  ROUND(100.0 * COUNT(*) FILTER (WHERE service_type ILIKE '%FVRCP%') / NULLIF(COUNT(*), 0), 1) AS fvrcp_pct,

  COUNT(*) FILTER (WHERE service_type ILIKE '%Revolution%') AS has_revolution,
  ROUND(100.0 * COUNT(*) FILTER (WHERE service_type ILIKE '%Revolution%') / NULLIF(COUNT(*), 0), 1) AS revolution_pct,

  -- Data quality indicators
  COUNT(*) FILTER (WHERE service_type IS NULL OR service_type = '') AS no_service_data,
  COUNT(*) FILTER (WHERE service_type LIKE '% /; %') AS multi_service_records,
  COUNT(*) FILTER (WHERE service_type NOT LIKE '% /; %' AND service_type IS NOT NULL) AS single_service_only,

  -- Reliability classification
  CASE
    WHEN EXTRACT(YEAR FROM appointment_date) >= c.reliable_year THEN 'reliable'
    WHEN EXTRACT(YEAR FROM appointment_date) >= c.reliable_year - 1 THEN 'partial'
    ELSE 'unreliable'
  END AS data_reliability,

  -- Flag for whether to include in aggregate vaccination stats
  EXTRACT(YEAR FROM appointment_date) >= c.reliable_year AS include_in_vaccination_totals

FROM trapper.sot_appointments
CROSS JOIN cutoff c
WHERE cat_id IS NOT NULL
  AND appointment_date >= '2014-01-01'
GROUP BY EXTRACT(YEAR FROM appointment_date), c.reliable_year
ORDER BY year;

COMMENT ON VIEW trapper.v_appointment_service_coverage IS
'Vaccination and treatment data coverage by year with reliability flags.

data_reliability levels:
  - reliable: Systematic recording (2018+ by default)
  - partial: Transition period with partial backfill
  - unreliable: Paper-first workflow, incomplete backfill

include_in_vaccination_totals: Use this flag to filter years when calculating
aggregate vaccination rates. Pre-2018 data should generally be excluded.

Note: Spay/neuter counts are reliable across ALL years. Only vaccine/treatment
data is incomplete for older appointments.';

\echo 'Updated v_appointment_service_coverage view'

-- ============================================================================
-- Step 4: Create summary view for reliable vaccination stats
-- ============================================================================

\echo ''
\echo 'Step 4: Creating v_reliable_vaccination_stats view...'

CREATE OR REPLACE VIEW trapper.v_reliable_vaccination_stats AS
WITH cutoff AS (
  SELECT COALESCE(config_value, 2018)::INT as reliable_year
  FROM trapper.ecology_config
  WHERE config_key = 'medical_data_reliable_after_date'
),
stats AS (
  SELECT
    COUNT(*) AS total_reliable_appointments,
    COUNT(*) FILTER (WHERE service_type ILIKE '%Rabies%') AS with_rabies,
    COUNT(*) FILTER (WHERE service_type ILIKE '%FVRCP%') AS with_fvrcp,
    COUNT(*) FILTER (WHERE service_type ILIKE '%Revolution%') AS with_revolution,
    MIN(appointment_date)::DATE AS earliest_reliable_date,
    MAX(appointment_date)::DATE AS latest_date
  FROM trapper.sot_appointments, cutoff c
  WHERE cat_id IS NOT NULL
    AND EXTRACT(YEAR FROM appointment_date) >= c.reliable_year
)
SELECT
  s.total_reliable_appointments,
  s.with_rabies,
  ROUND(100.0 * s.with_rabies / NULLIF(s.total_reliable_appointments, 0), 1) AS rabies_rate,
  s.with_fvrcp,
  ROUND(100.0 * s.with_fvrcp / NULLIF(s.total_reliable_appointments, 0), 1) AS fvrcp_rate,
  s.with_revolution,
  ROUND(100.0 * s.with_revolution / NULLIF(s.total_reliable_appointments, 0), 1) AS revolution_rate,
  s.earliest_reliable_date,
  s.latest_date,
  c.reliable_year AS reliability_cutoff_year,
  NOW() AS calculated_at
FROM stats s, cutoff c;

COMMENT ON VIEW trapper.v_reliable_vaccination_stats IS
'Aggregate vaccination statistics using only reliable data (2018+ by default).

Use this view for Beacon analytics and public-facing vaccination rates.
Pre-2018 data is excluded due to incomplete paper-first workflow backfill.

The reliability_cutoff_year is configurable via ecology_config.';

\echo 'Created v_reliable_vaccination_stats view'

-- ============================================================================
-- Step 5: Verification
-- ============================================================================

\echo ''
\echo '=== Verification ==='
\echo ''

\echo 'Configuration:'
SELECT config_key, config_value, unit, description
FROM trapper.ecology_config
WHERE config_key = 'medical_data_reliable_after_date';

\echo ''
\echo 'Data reliability by era:'
SELECT
  medical_data_reliability,
  COUNT(*) as appointments,
  ROUND(100.0 * COUNT(*) FILTER (WHERE has_fvrcp) / COUNT(*), 1) as fvrcp_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE has_rabies) / COUNT(*), 1) as rabies_pct
FROM trapper.v_appointment_data_completeness
GROUP BY medical_data_reliability
ORDER BY medical_data_reliability;

\echo ''
\echo 'Service coverage by year (last 10 years):'
SELECT year, total_appointments, fvrcp_pct, rabies_pct, data_reliability
FROM trapper.v_appointment_service_coverage
WHERE year >= 2015
ORDER BY year;

\echo ''
\echo 'Reliable vaccination stats (2018+):'
SELECT * FROM trapper.v_reliable_vaccination_stats;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=== MIG_600 Complete ==='
\echo ''
\echo 'Created:'
\echo '  - ecology_config.medical_data_reliable_after_date = 2018'
\echo '  - v_appointment_data_completeness (per-appointment reliability flags)'
\echo '  - v_appointment_service_coverage (updated with reliability column)'
\echo '  - v_reliable_vaccination_stats (aggregate stats using reliable data only)'
\echo ''
\echo 'Usage:'
\echo '  -- Get reliable vaccination rate'
\echo '  SELECT fvrcp_rate, rabies_rate FROM trapper.v_reliable_vaccination_stats;'
\echo ''
\echo '  -- Check reliability of specific appointment'
\echo '  SELECT * FROM trapper.v_appointment_data_completeness WHERE appointment_number = ''24-326'';'
\echo ''
\echo '  -- Adjust cutoff year if needed'
\echo '  UPDATE trapper.ecology_config SET config_value = 2017'
\echo '  WHERE config_key = ''medical_data_reliable_after_date'';'
\echo ''
