-- MIG_3050: Data Quality Observability Layer
--
-- Part of FFS-1150 (Atlas Data Hardening), Initiative 3 (FFS-1152).
--
-- Problem: Today's 02/04/2026 debug session needed 10+ ad-hoc SQL queries
-- across ops.appointments, ops.clinic_day_entries, source.clinichq_raw,
-- etc. to answer "what's wrong right now?". That question should have a
-- dashboard.
--
-- Pattern: Lightweight SQL-only equivalent of dbt tests + Soda continuous
-- monitoring. Each check is a SELECT that returns a single integer count;
-- the evaluator runs them all and stores results.
--
-- Depends on: MIG_3048 (manually_overridden_fields), MIG_3049 (ingest_skipped)
--
-- Created: 2026-04-06

\echo ''
\echo '=============================================='
\echo '  MIG_3050: Data Quality Framework'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. Schema
-- ============================================================================

\echo '1. Creating ops.data_quality_checks + runs tables...'

CREATE TABLE IF NOT EXISTS ops.data_quality_checks (
  check_id        TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  category        TEXT NOT NULL CHECK (category IN ('structural','referential','coverage','drift','freshness')),
  severity        TEXT NOT NULL CHECK (severity IN ('info','warning','error','critical')),
  sql_definition  TEXT NOT NULL,
  expected_max    INTEGER NOT NULL DEFAULT 0,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  drilldown_sql   TEXT,
  last_run_at     TIMESTAMPTZ,
  last_value      INTEGER,
  last_status     TEXT CHECK (last_status IN ('pass','warn','fail','error')),
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_quality_checks_category
  ON ops.data_quality_checks (category, severity);

CREATE INDEX IF NOT EXISTS idx_data_quality_checks_enabled
  ON ops.data_quality_checks (enabled, last_status)
  WHERE enabled = TRUE;

COMMENT ON TABLE ops.data_quality_checks IS
'MIG_3050: Registry of data quality checks. Each row is a SELECT that
returns a single integer count of violations. The evaluator
ops.run_data_quality_checks() runs them all and stores results in
ops.data_quality_check_runs.';

CREATE TABLE IF NOT EXISTS ops.data_quality_check_runs (
  run_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  check_id      TEXT NOT NULL REFERENCES ops.data_quality_checks(check_id) ON DELETE CASCADE,
  ran_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  value         INTEGER,
  status        TEXT,
  duration_ms   INTEGER,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_data_quality_check_runs_check_time
  ON ops.data_quality_check_runs (check_id, ran_at DESC);

CREATE INDEX IF NOT EXISTS idx_data_quality_check_runs_recent
  ON ops.data_quality_check_runs (ran_at DESC);

\echo '   Created tables'

-- ============================================================================
-- 2. Evaluator function
-- ============================================================================

\echo ''
\echo '2. Creating ops.run_data_quality_checks evaluator...'

CREATE OR REPLACE FUNCTION ops.run_data_quality_checks(
  p_categories TEXT[] DEFAULT NULL
) RETURNS TABLE(check_id TEXT, status TEXT, value INTEGER, duration_ms INTEGER) AS $$
DECLARE
  v_check RECORD;
  v_value INTEGER;
  v_status TEXT;
  v_start TIMESTAMPTZ;
  v_duration INTEGER;
  v_error TEXT;
BEGIN
  FOR v_check IN
    SELECT * FROM ops.data_quality_checks
    WHERE enabled = TRUE
      AND (p_categories IS NULL OR category = ANY(p_categories))
    ORDER BY check_id
  LOOP
    v_start := clock_timestamp();
    v_value := NULL;
    v_status := NULL;
    v_error := NULL;

    BEGIN
      EXECUTE v_check.sql_definition INTO v_value;

      IF v_value IS NULL THEN
        v_value := 0;
      END IF;

      IF v_value <= v_check.expected_max THEN
        v_status := 'pass';
      ELSIF v_check.severity = 'critical' OR v_check.severity = 'error' THEN
        v_status := 'fail';
      ELSE
        v_status := 'warn';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_status := 'error';
      v_error := SQLERRM;
    END;

    v_duration := EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_start))::INTEGER;

    -- Persist run
    INSERT INTO ops.data_quality_check_runs (check_id, value, status, duration_ms, error_message)
    VALUES (v_check.check_id, v_value, v_status, v_duration, v_error);

    -- Update last_* columns
    UPDATE ops.data_quality_checks
       SET last_run_at = NOW(),
           last_value = v_value,
           last_status = v_status,
           last_error = v_error,
           updated_at = NOW()
     WHERE data_quality_checks.check_id = v_check.check_id;

    RETURN QUERY SELECT v_check.check_id, v_status, v_value, v_duration;
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.run_data_quality_checks(TEXT[]) IS
'MIG_3050: Runs all enabled data quality checks (or only those in the
given categories). Stores each result in ops.data_quality_check_runs and
updates last_* columns on ops.data_quality_checks. Returns a row per check.';

\echo '   Created evaluator'

-- ============================================================================
-- 3. Initial check catalog (~20 checks)
-- ============================================================================

\echo ''
\echo '3. Seeding initial check catalog...'

INSERT INTO ops.data_quality_checks (
  check_id, name, description, category, severity, sql_definition, expected_max, drilldown_sql
) VALUES

-- ────────────── STRUCTURAL ──────────────
(
  'structural_ghost_appointments',
  'Ghost appointments (no number, no client, no cat)',
  'Appointments with NULL appointment_number AND NULL client_name AND NULL cat_id. FFS-862 signature.',
  'structural', 'critical',
  $sql$SELECT COUNT(*)::INT FROM ops.appointments
       WHERE appointment_number IS NULL
         AND client_name IS NULL
         AND cat_id IS NULL
         AND merged_into_appointment_id IS NULL$sql$,
  0,
  $sql$SELECT appointment_id, appointment_date, source_system, source_record_id
       FROM ops.appointments
       WHERE appointment_number IS NULL AND client_name IS NULL AND cat_id IS NULL
         AND merged_into_appointment_id IS NULL$sql$
),

(
  'structural_appointments_missing_source',
  'Appointments without source_system',
  'Active appointments lacking source_system provenance.',
  'structural', 'warning',
  $sql$SELECT COUNT(*)::INT FROM ops.appointments
       WHERE source_system IS NULL
         AND merged_into_appointment_id IS NULL$sql$,
  0, NULL
),

(
  'structural_clinic_day_number_no_source',
  'clinic_day_number set without provenance source',
  'MIG_3052: appointments where clinic_day_number is non-NULL but clinic_day_number_source is NULL.',
  'structural', 'warning',
  $sql$SELECT COUNT(*)::INT FROM ops.appointments
       WHERE clinic_day_number IS NOT NULL
         AND clinic_day_number_source IS NULL
         AND merged_into_appointment_id IS NULL$sql$,
  0, NULL
),

(
  'structural_orphan_cat_id',
  'Appointments with cat_id pointing to merged/missing cats',
  'cat_id references that no longer resolve to an active sot.cats row.',
  'structural', 'error',
  $sql$SELECT COUNT(*)::INT FROM ops.appointments a
       LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
       WHERE a.cat_id IS NOT NULL
         AND c.cat_id IS NULL
         AND a.merged_into_appointment_id IS NULL$sql$,
  0, NULL
),

(
  'structural_orphan_person_id',
  'Appointments with person_id pointing to merged/missing people',
  'person_id references that no longer resolve to an active sot.people row.',
  'structural', 'error',
  $sql$SELECT COUNT(*)::INT FROM ops.appointments a
       LEFT JOIN sot.people p ON p.person_id = a.person_id AND p.merged_into_person_id IS NULL
       WHERE a.person_id IS NOT NULL
         AND p.person_id IS NULL
         AND a.merged_into_appointment_id IS NULL$sql$,
  0, NULL
),

-- ────────────── REFERENTIAL ──────────────
(
  'referential_clinic_leakage',
  'Cats incorrectly linked to clinic addresses',
  'INV-cat-place rule: cats should never link to the clinic address. ops.v_clinic_leakage.',
  'referential', 'critical',
  $sql$SELECT COALESCE((SELECT COUNT(*)::INT FROM ops.v_clinic_leakage), 0)$sql$,
  0, NULL
),

(
  'referential_duplicate_high_conf_identifiers',
  'Duplicate person_identifiers at confidence ≥ 0.5',
  'High-confidence person_identifiers should be unique within (id_type, id_value_norm).',
  'referential', 'warning',
  $sql$SELECT COALESCE(COUNT(*)::INT, 0) FROM (
         SELECT id_type, id_value_norm, COUNT(*) c
         FROM sot.person_identifiers
         WHERE confidence >= 0.5
         GROUP BY id_type, id_value_norm
         HAVING COUNT(*) > 1
       ) dups$sql$,
  0, NULL
),

(
  'referential_merged_people_referenced',
  'Active appointments referencing merged people',
  'Should be 0 — merge_person_into() relinks all references.',
  'referential', 'error',
  $sql$SELECT COUNT(*)::INT FROM ops.appointments a
       JOIN sot.people p ON p.person_id = a.person_id
       WHERE p.merged_into_person_id IS NOT NULL
         AND a.merged_into_appointment_id IS NULL$sql$,
  0, NULL
),

-- ────────────── COVERAGE ──────────────
(
  'coverage_cats_with_place',
  'Cats without any place link',
  'Active cats missing a sot.cat_place row. Higher = worse coverage.',
  'coverage', 'info',
  $sql$SELECT COUNT(*)::INT FROM sot.cats c
       WHERE c.merged_into_cat_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = c.cat_id
         )$sql$,
  9999, NULL  -- coverage check, no hard threshold
),

(
  'coverage_appointments_with_clinic_day_number',
  'Appointments missing clinic_day_number on dates with master list',
  'For dates that have a clinic_day_entries row, count appointments lacking clinic_day_number.',
  'coverage', 'warning',
  $sql$SELECT COUNT(*)::INT FROM ops.appointments a
       WHERE a.clinic_day_number IS NULL
         AND a.merged_into_appointment_id IS NULL
         AND EXISTS (
           SELECT 1 FROM ops.clinic_day_entries e
           JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
           WHERE cd.clinic_date = a.appointment_date
         )$sql$,
  9999, NULL
),

(
  'coverage_high_confidence_identifiers',
  'People without any high-confidence identifier',
  'Active people lacking an identifier with confidence ≥ 0.5.',
  'coverage', 'info',
  $sql$SELECT COUNT(*)::INT FROM sot.people p
       WHERE p.merged_into_person_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM sot.person_identifiers pi
           WHERE pi.person_id = p.person_id AND pi.confidence >= 0.5
         )$sql$,
  9999, NULL
),

-- ────────────── DRIFT ──────────────
(
  'drift_unresolved_ingest_skips',
  'Unresolved ingest_skipped rows',
  'MIG_3049 review queue: rows the ingest pipeline refused or could not place.',
  'drift', 'warning',
  $sql$SELECT COUNT(*)::INT FROM ops.ingest_skipped WHERE resolved_at IS NULL$sql$,
  0, NULL
),

(
  'drift_orphan_clinichq_cat_info',
  'Unresolved cat_info orphans (FFS-862 cancel/rebook)',
  'cat_info rows whose (Number, Date) had no matching appointment_info row.',
  'drift', 'critical',
  $sql$SELECT COUNT(*)::INT FROM ops.ingest_skipped
       WHERE resolved_at IS NULL
         AND skip_reason = 'orphan_reference'
         AND source_table = 'cat_info'$sql$,
  0, NULL
),

(
  'drift_appointment_count_anomaly',
  'New appointments today vs 7-day rolling average',
  'Returns 0 if today is within 2σ of trailing 7-day mean, else returns the absolute deviation.',
  'drift', 'info',
  $sql$WITH daily AS (
         SELECT appointment_date::DATE AS d, COUNT(*)::NUMERIC AS c
         FROM ops.appointments
         WHERE appointment_date >= CURRENT_DATE - INTERVAL '8 days'
           AND appointment_date <= CURRENT_DATE
           AND merged_into_appointment_id IS NULL
         GROUP BY 1
       ),
       stats AS (
         SELECT
           AVG(c) FILTER (WHERE d < CURRENT_DATE) AS avg7,
           STDDEV_SAMP(c) FILTER (WHERE d < CURRENT_DATE) AS std7,
           COALESCE((SELECT c FROM daily WHERE d = CURRENT_DATE), 0) AS today
         FROM daily
       )
       SELECT CASE
         WHEN std7 IS NULL OR std7 = 0 THEN 0
         WHEN ABS(today - avg7) > 2 * std7 THEN ABS(today - avg7)::INT
         ELSE 0
       END FROM stats$sql$,
  0, NULL
),

-- ────────────── FRESHNESS ──────────────
(
  'freshness_clinichq_sync',
  'Hours since last successful ClinicHQ ingest',
  'Returns hours elapsed since the most recent completed ClinicHQ file_upload.',
  'freshness', 'warning',
  $sql$SELECT COALESCE(
         EXTRACT(EPOCH FROM (NOW() - MAX(processed_at))) / 3600.0,
         9999
       )::INT
       FROM ops.file_uploads
       WHERE source_system = 'clinichq'
         AND status = 'completed'$sql$,
  48, NULL
),

(
  'freshness_volunteerhub_sync',
  'Hours since last successful VolunteerHub ingest',
  'Returns hours elapsed since the most recent completed VolunteerHub file_upload.',
  'freshness', 'warning',
  $sql$SELECT COALESCE(
         EXTRACT(EPOCH FROM (NOW() - MAX(processed_at))) / 3600.0,
         9999
       )::INT
       FROM ops.file_uploads
       WHERE source_system = 'volunteerhub'
         AND status = 'completed'$sql$,
  48, NULL
)
ON CONFLICT (check_id) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      category = EXCLUDED.category,
      severity = EXCLUDED.severity,
      sql_definition = EXCLUDED.sql_definition,
      expected_max = EXCLUDED.expected_max,
      drilldown_sql = EXCLUDED.drilldown_sql,
      updated_at = NOW();

\echo '   Seeded initial checks'

-- ============================================================================
-- 4. Clinic-day specific health view
-- ============================================================================
-- Standalone date-scoped health summary called by the clinic day hub page.

\echo ''
\echo '4. Creating ops.clinic_day_health(date) function...'

CREATE OR REPLACE FUNCTION ops.clinic_day_health(p_date DATE)
RETURNS TABLE(
  check_name TEXT,
  status TEXT,
  value INTEGER,
  detail TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    'ghost_appointments'::TEXT,
    CASE WHEN c = 0 THEN 'pass' ELSE 'fail' END,
    c,
    'Appointments on this date with NULL number/client/cat'::TEXT
  FROM (
    SELECT COUNT(*)::INT c FROM ops.appointments
    WHERE appointment_date = p_date
      AND appointment_number IS NULL
      AND client_name IS NULL
      AND cat_id IS NULL
      AND merged_into_appointment_id IS NULL
  ) x;

  RETURN QUERY
  SELECT
    'orphan_cat_info_rows'::TEXT,
    CASE WHEN c = 0 THEN 'pass' ELSE 'warn' END,
    c,
    'Unresolved FFS-862 cancel/rebook orphans for this date'::TEXT
  FROM (
    SELECT COUNT(*)::INT c FROM ops.ingest_skipped
    WHERE source_date = p_date
      AND skip_reason = 'orphan_reference'
      AND resolved_at IS NULL
  ) x;

  RETURN QUERY
  SELECT
    'appointments_without_clinic_day_number'::TEXT,
    CASE WHEN c = 0 THEN 'pass' ELSE 'warn' END,
    c,
    'Appointments missing clinic_day_number on a date with master list entries'::TEXT
  FROM (
    SELECT COUNT(*)::INT c FROM ops.appointments a
    WHERE a.appointment_date = p_date
      AND a.clinic_day_number IS NULL
      AND a.merged_into_appointment_id IS NULL
      AND EXISTS (
        SELECT 1 FROM ops.clinic_day_entries e
        JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
        WHERE cd.clinic_date = p_date
      )
  ) x;

  RETURN QUERY
  SELECT
    'unmatched_master_list_entries'::TEXT,
    CASE WHEN c = 0 THEN 'pass' ELSE 'warn' END,
    c,
    'Master list rows with no matched appointment'::TEXT
  FROM (
    SELECT COUNT(*)::INT c FROM ops.clinic_day_entries e
    JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
    WHERE cd.clinic_date = p_date
      AND (e.match_confidence IS NULL OR e.match_confidence = 'unmatched')
  ) x;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION ops.clinic_day_health(DATE) IS
'MIG_3050: Date-scoped data quality summary for the clinic day hub page.
Returns a row per check with pass/warn/fail status. Cheap to call on
every page load.';

\echo '   Created ops.clinic_day_health'

-- ============================================================================
-- 5. Verification — seed run
-- ============================================================================

\echo ''
\echo '5. Running initial check pass...'

SELECT * FROM ops.run_data_quality_checks();

COMMIT;

\echo ''
\echo '=============================================='
\echo '  MIG_3050 Complete'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  1. Created ops.data_quality_checks registry'
\echo '  2. Created ops.data_quality_check_runs history'
\echo '  3. Created ops.run_data_quality_checks() evaluator'
\echo '  4. Seeded 16 initial checks across 5 categories'
\echo '  5. Created ops.clinic_day_health(date) for hub page'
\echo ''
\echo 'Next steps:'
\echo '  - Build /admin/data-quality "Checks Registry" tab UI'
\echo '  - Add /api/cron/data-quality Vercel cron (every 4h)'
\echo '  - Wire Slack alerts for fail+critical checks'
\echo ''
