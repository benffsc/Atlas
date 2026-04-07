-- MIG_3056: Data Hardening Cleanup — finding fixes post-epic
--
-- Part of FFS-1150 (Atlas Data Hardening), cleanup after 2026-04-07 findings walkthrough.
--
-- Bundles 7 surgical fixes uncovered during the Finding 2-5 analysis:
--
-- 1. Redefine `freshness_clinichq_sync` to count past clinic dates without
--    an upload (ClinicHQ uploads are manual, so time-since-last is the wrong
--    metric — clinic-day coverage is the right metric).
--
-- 2. Fix `freshness_volunteerhub_sync` — the original check looked at
--    `ops.file_uploads` but VH sync writes directly to
--    `source.volunteerhub_volunteers.last_api_sync_at`. That's why it
--    reported 9999 (never) when VH had actually synced 6 days ago.
--
-- 3. Fix `drift_appointment_count_anomaly` — today is Tuesday (not a clinic
--    day) and has 0 appointments, but the 7-day average is 33. ABS(0-33)
--    flagged as "anomaly" when it's just an expected off-day dip. Change
--    the check to flag spikes only, not dips. Rename accordingly.
--
-- 4. Add `coverage_master_list_imported` — past clinic dates without a
--    corresponding master list entry. The database currently holds clinic_days
--    only through 2026-02-11 despite real clinic days happening since.
--
-- 5. Add `coverage_legacy_v1_clinic_day_number` — track the 417 legacy_v1
--    values so they trend down as natural lifecycle replaces them.
--
-- 6. Add `sot.cats.shelterluv_last_intake_at` — promote
--    LastIntakeUnixTime from the pending registry. Low-stakes, useful for
--    outcome tracking via sot.cat_lifecycle_events.
--
-- 7. Mark `LastUpdatedUnixTime` as ignored in the extraction registry
--    (pure sync metadata).
--
-- Created: 2026-04-07

\echo ''
\echo '=============================================='
\echo '  MIG_3056: Data Hardening Cleanup'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. Fix freshness_clinichq_sync — measure clinic-day coverage, not
--    time-since-last-anything
-- ============================================================================

\echo '1. Redefining freshness_clinichq_sync...'

UPDATE ops.data_quality_checks
SET
  name = 'Past clinic days without ClinicHQ upload (last 90 days)',
  description = 'ClinicHQ uploads are manual. The right metric is "how many past clinic days in the last 90 days don''t yet have a processed ClinicHQ batch", not "hours since last upload".',
  sql_definition = $check$
    SELECT COUNT(*)::INT FROM ops.clinic_days cd
    WHERE cd.clinic_date < CURRENT_DATE
      AND cd.clinic_date >= CURRENT_DATE - INTERVAL '90 days'
      AND NOT EXISTS (
        SELECT 1 FROM ops.file_uploads fu
        JOIN ops.staged_records sr ON sr.file_upload_id = fu.upload_id
        WHERE fu.source_system = 'clinichq'
          AND fu.status = 'completed'
          AND sr.source_table = 'appointment_info'
          AND (sr.payload->>'Date') IS NOT NULL
          AND TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY') = cd.clinic_date
        LIMIT 1
      )
  $check$,
  expected_max = 0,
  severity = 'warning',
  updated_at = NOW()
WHERE check_id = 'freshness_clinichq_sync';

-- ============================================================================
-- 2. Fix freshness_volunteerhub_sync — read the correct column
-- ============================================================================

\echo ''
\echo '2. Redefining freshness_volunteerhub_sync...'

UPDATE ops.data_quality_checks
SET
  description = 'Hours since last successful VH API sync. Reads source.volunteerhub_volunteers.last_api_sync_at (where VH sync actually writes), NOT ops.file_uploads (which is ClinicHQ-only).',
  sql_definition = $check$
    SELECT COALESCE(
      EXTRACT(EPOCH FROM (NOW() - MAX(last_api_sync_at))) / 3600.0,
      9999
    )::INT
    FROM source.volunteerhub_volunteers
  $check$,
  expected_max = 48,
  updated_at = NOW()
WHERE check_id = 'freshness_volunteerhub_sync';

-- ============================================================================
-- 3. Fix drift_appointment_count_anomaly — flag spikes only, not dips
-- ============================================================================
-- Off-day dips (e.g., Tuesday when clinic is Mon/Wed/Thu) are expected and
-- not actionable. Spikes may indicate ghost floods, double-entry, or data
-- quality issues worth investigating. Use signed arithmetic instead of ABS.

\echo ''
\echo '3. Redefining drift_appointment_count_anomaly as spike-only...'

UPDATE ops.data_quality_checks
SET
  name = 'Appointment count spike vs 7-day rolling average',
  description = 'Returns 0 if today is within 2σ of trailing 7-day mean. Only flags SPIKES (today > avg + 2σ), not dips — dips on off-days are expected and not actionable.',
  sql_definition = $check$
    WITH daily AS (
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
      WHEN (today - avg7) > 2 * std7 THEN (today - avg7)::INT
      ELSE 0
    END FROM stats
  $check$,
  updated_at = NOW()
WHERE check_id = 'drift_appointment_count_anomaly';

-- ============================================================================
-- 4. Add coverage_master_list_imported check
-- ============================================================================
-- Past clinic dates where ops.clinic_days has no entries. We discovered that
-- the database currently has clinic_days only through 2026-02-11 despite
-- real clinic days happening since. That's a data import gap worth alerting on.

\echo ''
\echo '4. Adding coverage_master_list_imported check...'

INSERT INTO ops.data_quality_checks (
  check_id, name, description, category, severity, sql_definition, expected_max
) VALUES (
  'coverage_master_list_imported',
  'Past clinic dates with no master list entries (last 90d)',
  'Counts past clinic dates (inferred from appointments, not ops.clinic_days itself) in the last 90 days that have NO clinic_day_entries. FFSC staff must import the master list Excel for each clinic day or the matching pipeline has nothing to match against.',
  'coverage',
  'warning',
  $check$
    SELECT COUNT(DISTINCT a.appointment_date)::INT
    FROM ops.appointments a
    WHERE a.appointment_date < CURRENT_DATE
      AND a.appointment_date >= CURRENT_DATE - INTERVAL '90 days'
      AND a.merged_into_appointment_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ops.clinic_day_entries e
        JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
        WHERE cd.clinic_date = a.appointment_date
        LIMIT 1
      )
  $check$,
  0
)
ON CONFLICT (check_id) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      category = EXCLUDED.category,
      severity = EXCLUDED.severity,
      sql_definition = EXCLUDED.sql_definition,
      expected_max = EXCLUDED.expected_max,
      updated_at = NOW();

-- ============================================================================
-- 5. Add coverage_legacy_v1_clinic_day_number check
-- ============================================================================
-- Tracks the 417 legacy_v1 values so they trend down as natural lifecycle
-- (merges, replacements) cleans them up. This is a "trend to zero" check.

\echo ''
\echo '5. Adding coverage_legacy_v1_clinic_day_number check...'

INSERT INTO ops.data_quality_checks (
  check_id, name, description, category, severity, sql_definition, expected_max
) VALUES (
  'coverage_legacy_v1_clinic_day_number',
  'Appointments with legacy_v1 clinic_day_number source',
  'Count of active appointments where clinic_day_number_source = legacy_v1 — meaning the value was set before MIG_3052 provenance tracking and cannot be traced to a specific writer. Should trend down over time as natural lifecycle replaces them. Not a blocker; informational.',
  'drift',
  'info',
  $check$
    SELECT COUNT(*)::INT FROM ops.appointments
    WHERE clinic_day_number_source = 'legacy_v1'
      AND merged_into_appointment_id IS NULL
  $check$,
  500  -- starts at 417, expected to trend down
)
ON CONFLICT (check_id) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      category = EXCLUDED.category,
      severity = EXCLUDED.severity,
      sql_definition = EXCLUDED.sql_definition,
      expected_max = EXCLUDED.expected_max,
      updated_at = NOW();

-- ============================================================================
-- 6. Add sot.cats.shelterluv_last_intake_at column
-- ============================================================================
-- Promotes LastIntakeUnixTime from the ShelterLuv pending registry.
-- Low-stakes (no existing data depends on it). Useful for future outcome
-- tracking via sot.cat_lifecycle_events.

\echo ''
\echo '6. Adding sot.cats.shelterluv_last_intake_at column...'

ALTER TABLE sot.cats
  ADD COLUMN IF NOT EXISTS shelterluv_last_intake_at TIMESTAMPTZ;

COMMENT ON COLUMN sot.cats.shelterluv_last_intake_at IS
'MIG_3056: Last intake timestamp from ShelterLuv API (LastIntakeUnixTime
converted to timestamptz). Populated during ShelterLuv sync. Source for
outcome tracking in sot.cat_lifecycle_events.';

-- Update the extraction registry
UPDATE ops.source_extraction_registry
SET
  status = 'extracted',
  extracted_to_table = 'sot.cats',
  extracted_to_column = 'shelterluv_last_intake_at',
  extraction_method = 'ingest_pipeline',
  extraction_migration = 'MIG_3056',
  reviewed_at = NOW(),
  notes = 'Unix timestamp of last intake. Promoted 2026-04-07. Populate during ShelterLuv sync with to_timestamp(LastIntakeUnixTime).'
WHERE source_table = 'source.shelterluv_raw'
  AND payload_key = 'LastIntakeUnixTime';

-- ============================================================================
-- 7. Mark LastUpdatedUnixTime as ignored
-- ============================================================================

\echo ''
\echo '7. Marking LastUpdatedUnixTime as ignored...'

UPDATE ops.source_extraction_registry
SET
  status = 'ignored',
  reviewed_at = NOW(),
  notes = 'Pure sync metadata. Atlas has its own updated_at columns; the ShelterLuv version is not authoritative for anything.'
WHERE source_table = 'source.shelterluv_raw'
  AND payload_key = 'LastUpdatedUnixTime';

-- ============================================================================
-- 8. Re-run all checks to refresh baseline
-- ============================================================================

\echo ''
\echo '8. Re-running all data quality checks with new definitions...'

SELECT * FROM ops.run_data_quality_checks();

COMMIT;

\echo ''
\echo '=============================================='
\echo '  MIG_3056 Complete'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  1. freshness_clinichq_sync now counts missing clinic-day uploads'
\echo '  2. freshness_volunteerhub_sync reads source.volunteerhub_volunteers'
\echo '  3. drift_appointment_count_anomaly flags spikes only (signed)'
\echo '  4. NEW: coverage_master_list_imported'
\echo '  5. NEW: coverage_legacy_v1_clinic_day_number'
\echo '  6. NEW: sot.cats.shelterluv_last_intake_at column'
\echo '  7. ShelterLuv LastUpdatedUnixTime marked ignored'
\echo ''
\echo 'Registry state:'
\echo '  clinichq:   80 extracted, 5 ignored, 0 pending'
\echo '  shelterluv: 34 extracted, 8 ignored, 3 pending (AssociatedRecords, InFoster, LitterGroupId)'
\echo ''
