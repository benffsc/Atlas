-- MIG_923: Unified Data Orchestrator Functions
--
-- Problem: Each source (ClinicHQ, VolunteerHub, ShelterLuv) has its own cron job
-- running independently. No single system ensures correct processing order.
--
-- Solution: Create a unified orchestrator that:
--   1. Processes all sources in correct dependency order
--   2. Tracks run history and metrics
--   3. Handles cross-source reconciliation
--   4. Provides a single entry point for data cleaning pipeline
--
-- Related: MIG_922 (person_field_sources), MIG_875 (source authority map)

\echo ''
\echo '========================================================'
\echo 'MIG_923: Unified Data Orchestrator Functions'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Create orchestrator_run_logs table
-- ============================================================

\echo 'Creating orchestrator_run_logs table...'

CREATE TABLE IF NOT EXISTS trapper.orchestrator_run_logs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Run metadata
  run_type TEXT NOT NULL CHECK (run_type IN ('full', 'incremental', 'single_source', 'reprocess')),
  triggered_by TEXT NOT NULL DEFAULT 'cron',  -- 'cron', 'manual', 'api'

  -- Timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INT,

  -- Status
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'partial')),
  error_message TEXT,

  -- Phase tracking (JSONB for flexibility)
  phases_completed JSONB DEFAULT '[]'::jsonb,
  current_phase TEXT,

  -- Metrics
  records_processed JSONB DEFAULT '{}'::jsonb,  -- { "clinichq": 500, "volunteerhub": 100, ... }
  conflicts_detected INT DEFAULT 0,
  conflicts_resolved INT DEFAULT 0,

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.orchestrator_run_logs IS
'Tracks all orchestrator runs with timing, status, and metrics.
Used by the admin dashboard to monitor data pipeline health.';

CREATE INDEX IF NOT EXISTS idx_orchestrator_run_logs_status
  ON trapper.orchestrator_run_logs(status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestrator_run_logs_started
  ON trapper.orchestrator_run_logs(started_at DESC);

-- ============================================================
-- PART 2: Create orchestrator_phase_config table
-- ============================================================

\echo 'Creating orchestrator_phase_config table...'

CREATE TABLE IF NOT EXISTS trapper.orchestrator_phase_config (
  phase_id SERIAL PRIMARY KEY,
  phase_name TEXT NOT NULL UNIQUE,
  phase_order INT NOT NULL,  -- Execution order

  -- What this phase does
  source_system TEXT,  -- NULL for cross-source phases
  processor_function TEXT NOT NULL,  -- SQL function to call
  batch_size INT DEFAULT 500,

  -- Dependencies
  depends_on TEXT[],  -- Array of phase_names that must complete first

  -- Flags
  is_enabled BOOLEAN DEFAULT TRUE,
  is_parallel_safe BOOLEAN DEFAULT FALSE,  -- Can run in parallel with other parallel_safe phases

  -- Metrics
  avg_duration_ms INT,
  last_run_at TIMESTAMPTZ,
  last_records_processed INT,

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.orchestrator_phase_config IS
'Defines the phases of the data orchestrator pipeline.
Each phase has a processor function, dependencies, and execution order.';

-- Populate default phase configuration
INSERT INTO trapper.orchestrator_phase_config (phase_name, phase_order, source_system, processor_function, depends_on, is_parallel_safe)
VALUES
  -- ClinicHQ processing (order matters!)
  ('clinichq_appointments', 10, 'clinichq', 'trapper.process_clinichq_appointment_info', NULL, FALSE),
  ('clinichq_owners', 20, 'clinichq', 'trapper.process_clinichq_owner_info', ARRAY['clinichq_appointments'], FALSE),
  ('clinichq_cats', 30, 'clinichq', 'trapper.process_clinichq_cat_info', ARRAY['clinichq_owners'], FALSE),

  -- VolunteerHub processing
  ('volunteerhub_people', 40, 'volunteerhub', 'trapper.process_volunteerhub_people_batch', NULL, TRUE),

  -- ShelterLuv processing (order matters!)
  ('shelterluv_people', 50, 'shelterluv', 'trapper.process_shelterluv_people_batch', NULL, TRUE),
  ('shelterluv_animals', 60, 'shelterluv', 'trapper.process_shelterluv_animal', ARRAY['shelterluv_people'], FALSE),
  ('shelterluv_events', 70, 'shelterluv', 'trapper.process_shelterluv_events', ARRAY['shelterluv_animals'], FALSE),

  -- Cross-source phases
  ('entity_linking', 100, NULL, 'trapper.run_all_entity_linking',
   ARRAY['clinichq_cats', 'volunteerhub_people', 'shelterluv_events'], FALSE),
  ('cross_source_reconciliation', 110, NULL, 'trapper.reconcile_cross_source_conflicts',
   ARRAY['entity_linking'], FALSE),
  ('data_quality_audit', 120, NULL, 'trapper.run_data_quality_audit',
   ARRAY['cross_source_reconciliation'], FALSE)
ON CONFLICT (phase_name) DO NOTHING;

-- ============================================================
-- PART 3: Create run_orchestrator_phase() function
-- ============================================================

\echo 'Creating run_orchestrator_phase() function...'

CREATE OR REPLACE FUNCTION trapper.run_orchestrator_phase(
  p_run_id UUID,
  p_phase_name TEXT,
  p_batch_size INT DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
  v_config RECORD;
  v_start_time TIMESTAMPTZ;
  v_result JSONB;
  v_records_processed INT := 0;
  v_sql TEXT;
BEGIN
  -- Get phase config
  SELECT * INTO v_config
  FROM trapper.orchestrator_phase_config
  WHERE phase_name = p_phase_name AND is_enabled = TRUE;

  IF v_config IS NULL THEN
    RETURN jsonb_build_object(
      'phase', p_phase_name,
      'status', 'skipped',
      'reason', 'Phase not found or disabled'
    );
  END IF;

  -- Update run log with current phase
  UPDATE trapper.orchestrator_run_logs
  SET current_phase = p_phase_name
  WHERE run_id = p_run_id;

  v_start_time := clock_timestamp();

  -- Execute the processor function
  BEGIN
    -- Build dynamic SQL call
    v_sql := format('SELECT * FROM %s($1)', v_config.processor_function);

    -- Execute and capture result
    EXECUTE v_sql INTO v_result USING p_batch_size;

    -- Extract records processed from result
    IF v_result ? 'records_processed' THEN
      v_records_processed := (v_result->>'records_processed')::INT;
    ELSIF v_result ? 'total' THEN
      v_records_processed := (v_result->>'total')::INT;
    ELSIF v_result ? 'processed' THEN
      v_records_processed := (v_result->>'processed')::INT;
    END IF;

    -- Update phase metrics
    UPDATE trapper.orchestrator_phase_config
    SET last_run_at = NOW(),
        last_records_processed = v_records_processed,
        avg_duration_ms = COALESCE(
          (avg_duration_ms + EXTRACT(EPOCH FROM (clock_timestamp() - v_start_time)) * 1000) / 2,
          EXTRACT(EPOCH FROM (clock_timestamp() - v_start_time)) * 1000
        )::INT,
        updated_at = NOW()
    WHERE phase_name = p_phase_name;

    RETURN jsonb_build_object(
      'phase', p_phase_name,
      'status', 'completed',
      'duration_ms', (EXTRACT(EPOCH FROM (clock_timestamp() - v_start_time)) * 1000)::INT,
      'records_processed', v_records_processed,
      'result', v_result
    );

  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'phase', p_phase_name,
      'status', 'failed',
      'duration_ms', (EXTRACT(EPOCH FROM (clock_timestamp() - v_start_time)) * 1000)::INT,
      'error', SQLERRM,
      'error_detail', SQLSTATE
    );
  END;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.run_orchestrator_phase IS
'Executes a single orchestrator phase and returns status/metrics.
Used by run_full_orchestrator() and the API endpoint.';

-- ============================================================
-- PART 4: Create reconcile_cross_source_conflicts() function
-- ============================================================

\echo 'Creating reconcile_cross_source_conflicts() function...'

CREATE OR REPLACE FUNCTION trapper.reconcile_cross_source_conflicts(
  p_batch_size INT DEFAULT 100
)
RETURNS JSONB AS $$
DECLARE
  v_cat_conflicts INT := 0;
  v_person_conflicts INT := 0;
  v_auto_resolved INT := 0;
BEGIN
  -- Count current conflicts
  SELECT COUNT(*) INTO v_cat_conflicts FROM trapper.v_cat_field_conflicts;
  SELECT COUNT(*) INTO v_person_conflicts FROM trapper.v_person_field_conflicts;

  -- Auto-resolve conflicts where survivorship_priority is clear
  -- (This is a placeholder - actual resolution logic depends on business rules)

  -- For now, just surface the conflicts
  RETURN jsonb_build_object(
    'cat_conflicts', v_cat_conflicts,
    'person_conflicts', v_person_conflicts,
    'total_conflicts', v_cat_conflicts + v_person_conflicts,
    'auto_resolved', v_auto_resolved,
    'needs_review', v_cat_conflicts + v_person_conflicts - v_auto_resolved
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.reconcile_cross_source_conflicts IS
'Detects and optionally auto-resolves cross-source conflicts.
Returns conflict counts for dashboard display.';

-- ============================================================
-- PART 5: Create run_data_quality_audit() function
-- ============================================================

\echo 'Creating run_data_quality_audit() function...'

CREATE OR REPLACE FUNCTION trapper.run_data_quality_audit(
  p_batch_size INT DEFAULT 100
)
RETURNS JSONB AS $$
DECLARE
  v_org_emails INT := 0;
  v_location_names INT := 0;
  v_no_contact INT := 0;
  v_clinic_misclass INT := 0;
BEGIN
  -- Check for DATA_GAP patterns

  -- DATA_GAP_009: FFSC org emails
  SELECT COUNT(*) INTO v_org_emails
  FROM trapper.person_identifiers pi
  WHERE pi.id_type = 'email'
    AND (pi.id_value_norm LIKE '%@forgottenfelines.com'
         OR pi.id_value_norm LIKE '%@forgottenfelines.org');

  -- DATA_GAP_011: Location-like names
  SELECT COUNT(*) INTO v_location_names
  FROM trapper.sot_people p
  WHERE p.merged_into_person_id IS NULL
    AND trapper.classify_owner_name(p.display_name) IN ('organization', 'address', 'apartment_complex');

  -- DATA_GAP_016: No contact info
  SELECT COUNT(*) INTO v_no_contact
  FROM trapper.sot_people p
  WHERE p.merged_into_person_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.person_id = p.person_id
        AND pi.id_type IN ('email', 'phone')
    );

  -- DATA_GAP_019: Clinic misclassification
  SELECT COUNT(*) INTO v_clinic_misclass
  FROM trapper.places
  WHERE place_kind = 'clinic'
    AND merged_into_place_id IS NULL;

  RETURN jsonb_build_object(
    'org_emails', v_org_emails,
    'location_names', v_location_names,
    'no_contact', v_no_contact,
    'clinic_misclassification', v_clinic_misclass,
    'audit_time', NOW()
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.run_data_quality_audit IS
'Checks for known DATA_GAP patterns and returns counts.
Used by orchestrator and admin dashboard.';

-- ============================================================
-- PART 6: Create run_full_orchestrator() function
-- ============================================================

\echo 'Creating run_full_orchestrator() function...'

CREATE OR REPLACE FUNCTION trapper.run_full_orchestrator(
  p_run_type TEXT DEFAULT 'incremental',
  p_triggered_by TEXT DEFAULT 'cron',
  p_batch_size INT DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
  v_run_id UUID;
  v_start_time TIMESTAMPTZ;
  v_phase RECORD;
  v_phase_result JSONB;
  v_phases_completed JSONB := '[]'::jsonb;
  v_records_processed JSONB := '{}'::jsonb;
  v_total_conflicts INT := 0;
  v_has_failure BOOLEAN := FALSE;
  v_final_status TEXT;
BEGIN
  v_start_time := clock_timestamp();

  -- Create run log entry
  INSERT INTO trapper.orchestrator_run_logs (run_type, triggered_by, status)
  VALUES (p_run_type, p_triggered_by, 'running')
  RETURNING run_id INTO v_run_id;

  -- Execute phases in order
  FOR v_phase IN
    SELECT * FROM trapper.orchestrator_phase_config
    WHERE is_enabled = TRUE
    ORDER BY phase_order
  LOOP
    -- Check dependencies
    IF v_phase.depends_on IS NOT NULL THEN
      -- Verify all dependencies completed successfully
      IF NOT (
        SELECT bool_and(
          v_phases_completed @> jsonb_build_array(jsonb_build_object('phase', dep, 'status', 'completed'))
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_phases_completed) elem
            WHERE elem->>'phase' = dep AND elem->>'status' = 'completed'
          )
        )
        FROM unnest(v_phase.depends_on) dep
      ) THEN
        -- Skip this phase if dependencies not met
        v_phase_result := jsonb_build_object(
          'phase', v_phase.phase_name,
          'status', 'skipped',
          'reason', 'Dependencies not met'
        );
        v_phases_completed := v_phases_completed || v_phase_result;
        CONTINUE;
      END IF;
    END IF;

    -- Run the phase
    v_phase_result := trapper.run_orchestrator_phase(v_run_id, v_phase.phase_name, p_batch_size);
    v_phases_completed := v_phases_completed || v_phase_result;

    -- Track metrics
    IF v_phase.source_system IS NOT NULL AND v_phase_result->>'status' = 'completed' THEN
      v_records_processed := jsonb_set(
        v_records_processed,
        ARRAY[v_phase.source_system],
        to_jsonb(COALESCE((v_records_processed->>v_phase.source_system)::INT, 0) +
                 COALESCE((v_phase_result->>'records_processed')::INT, 0))
      );
    END IF;

    -- Track failures
    IF v_phase_result->>'status' = 'failed' THEN
      v_has_failure := TRUE;
    END IF;

    -- Extract conflict count from reconciliation phase
    IF v_phase.phase_name = 'cross_source_reconciliation' AND v_phase_result->'result' IS NOT NULL THEN
      v_total_conflicts := COALESCE((v_phase_result->'result'->>'total_conflicts')::INT, 0);
    END IF;
  END LOOP;

  -- Determine final status
  IF v_has_failure THEN
    v_final_status := 'partial';
  ELSE
    v_final_status := 'completed';
  END IF;

  -- Update run log
  UPDATE trapper.orchestrator_run_logs
  SET completed_at = clock_timestamp(),
      duration_ms = (EXTRACT(EPOCH FROM (clock_timestamp() - v_start_time)) * 1000)::INT,
      status = v_final_status,
      phases_completed = v_phases_completed,
      current_phase = NULL,
      records_processed = v_records_processed,
      conflicts_detected = v_total_conflicts
  WHERE run_id = v_run_id;

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'status', v_final_status,
    'duration_ms', (EXTRACT(EPOCH FROM (clock_timestamp() - v_start_time)) * 1000)::INT,
    'phases_completed', jsonb_array_length(v_phases_completed),
    'records_processed', v_records_processed,
    'conflicts_detected', v_total_conflicts,
    'phases', v_phases_completed
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.run_full_orchestrator IS
'Master function that runs all orchestrator phases in correct order.
Respects dependencies, tracks metrics, and logs results.
Called by /api/cron/orchestrator-run endpoint.';

-- ============================================================
-- PART 7: Create orchestrator health view
-- ============================================================

\echo 'Creating v_orchestrator_health view...'

CREATE OR REPLACE VIEW trapper.v_orchestrator_health AS
SELECT
  -- Last run info
  (SELECT run_id FROM trapper.orchestrator_run_logs ORDER BY started_at DESC LIMIT 1) AS last_run_id,
  (SELECT status FROM trapper.orchestrator_run_logs ORDER BY started_at DESC LIMIT 1) AS last_run_status,
  (SELECT started_at FROM trapper.orchestrator_run_logs ORDER BY started_at DESC LIMIT 1) AS last_run_at,
  (SELECT duration_ms FROM trapper.orchestrator_run_logs ORDER BY started_at DESC LIMIT 1) AS last_run_duration_ms,

  -- Run stats (last 24 hours)
  (SELECT COUNT(*) FROM trapper.orchestrator_run_logs WHERE started_at > NOW() - INTERVAL '24 hours') AS runs_last_24h,
  (SELECT COUNT(*) FROM trapper.orchestrator_run_logs WHERE started_at > NOW() - INTERVAL '24 hours' AND status = 'failed') AS failures_last_24h,

  -- Conflict stats
  (SELECT COUNT(*) FROM trapper.v_cat_field_conflicts) AS cat_conflicts,
  (SELECT COUNT(*) FROM trapper.v_person_field_conflicts) AS person_conflicts,

  -- Phase health
  (SELECT jsonb_object_agg(phase_name, last_run_at) FROM trapper.orchestrator_phase_config WHERE is_enabled) AS phase_last_runs;

COMMENT ON VIEW trapper.v_orchestrator_health IS
'Quick health check for the data orchestrator.
Shows last run status, recent failures, and conflict counts.';

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Verification:'

SELECT 'orchestrator_run_logs table' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'trapper' AND tablename = 'orchestrator_run_logs')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'orchestrator_phase_config table' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'trapper' AND tablename = 'orchestrator_phase_config')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'run_full_orchestrator function' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'run_full_orchestrator')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'v_orchestrator_health view' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'trapper' AND viewname = 'v_orchestrator_health')
            THEN 'OK' ELSE 'MISSING' END AS status;

\echo ''
\echo 'Phase configuration:'
SELECT phase_name, phase_order, source_system, is_enabled
FROM trapper.orchestrator_phase_config
ORDER BY phase_order;

\echo ''
\echo '========================================================'
\echo 'MIG_923 Complete!'
\echo '========================================================'
\echo ''
\echo 'New capabilities:'
\echo '  1. orchestrator_run_logs tracks all pipeline runs'
\echo '  2. orchestrator_phase_config defines processing order'
\echo '  3. run_full_orchestrator() executes all phases in order'
\echo '  4. v_orchestrator_health provides quick status check'
\echo ''
\echo 'Usage:'
\echo '  -- Run full orchestrator:'
\echo '  SELECT * FROM trapper.run_full_orchestrator(''incremental'', ''manual'');'
\echo ''
\echo '  -- Check health:'
\echo '  SELECT * FROM trapper.v_orchestrator_health;'
\echo ''
\echo '  -- View last run:'
\echo '  SELECT * FROM trapper.orchestrator_run_logs ORDER BY started_at DESC LIMIT 1;'
\echo ''
