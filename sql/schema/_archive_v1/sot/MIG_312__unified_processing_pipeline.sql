-- MIG_312: Unified Processing Pipeline
--
-- Problem: Data processing is fragmented across CLI scripts and UI endpoints,
-- causing:
--   1. CLI scripts only stage records, never process them
--   2. Cat-place linking requires separate cron that may not run
--   3. Files must be processed in specific order
--   4. 15,921 appointments missing owner_email, 101 cats without place links
--
-- Solution: Centralized processing pipeline with:
--   1. processing_jobs table as job queue
--   2. SQL orchestrator functions
--   3. Automatic entity linking after every batch
--   4. Order-independent two-phase processing
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_312__unified_processing_pipeline.sql

\echo ''
\echo '=============================================='
\echo 'MIG_312: Unified Processing Pipeline'
\echo '=============================================='
\echo ''

-- ==============================================================
-- PHASE 1: Processing Jobs Table
-- ==============================================================

\echo 'Creating processing_jobs table...'

CREATE TABLE IF NOT EXISTS trapper.processing_jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Trigger info
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('file_upload', 'cli_ingest', 'cron', 'manual', 'backfill')),
  trigger_id UUID,  -- Reference to file_uploads.upload_id or ingest_runs.run_id

  -- What to process
  source_system TEXT NOT NULL,
  source_table TEXT NOT NULL,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued',       -- Waiting to be processed
    'processing',   -- Currently being processed
    'linking',      -- Entity linking phase
    'completed',    -- Successfully finished
    'failed',       -- Failed (will retry if attempts remain)
    'retry_pending' -- Waiting to retry
  )),

  -- Priority (higher = processed first)
  priority INT DEFAULT 0,

  -- Progress tracking
  total_records INT,
  records_processed INT DEFAULT 0,
  entities_created JSONB DEFAULT '{}',  -- {cats: 5, people: 3, places: 2}
  linking_results JSONB DEFAULT '{}',   -- Results from entity linking
  errors JSONB DEFAULT '[]',            -- Array of error objects

  -- Timing
  queued_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,

  -- Retry logic
  attempt_count INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT
);

-- Indexes for efficient job claiming and monitoring
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status_priority
  ON trapper.processing_jobs (status, priority DESC, queued_at ASC)
  WHERE status IN ('queued', 'retry_pending');

CREATE INDEX IF NOT EXISTS idx_processing_jobs_trigger
  ON trapper.processing_jobs (trigger_type, trigger_id)
  WHERE trigger_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_processing_jobs_monitoring
  ON trapper.processing_jobs (source_system, source_table, queued_at DESC);

COMMENT ON TABLE trapper.processing_jobs IS
'Job queue for centralized data processing. All data ingestion (CLI, UI, sync)
queues jobs here, and a cron processor works through them.

Statuses:
- queued: Waiting to be processed
- processing: Currently being processed (claimed by worker)
- linking: Running entity linking phase
- completed: Successfully finished
- failed: Failed (will retry if attempts remain)
- retry_pending: Waiting to retry';

-- ==============================================================
-- PHASE 2: Enqueue Function
-- ==============================================================

\echo 'Creating enqueue_processing function...'

CREATE OR REPLACE FUNCTION trapper.enqueue_processing(
  p_source_system TEXT,
  p_source_table TEXT,
  p_trigger_type TEXT,
  p_trigger_id UUID DEFAULT NULL,
  p_priority INT DEFAULT 0
)
RETURNS UUID AS $$
DECLARE
  v_job_id UUID;
  v_total_records INT;
BEGIN
  -- Count records to process
  SELECT COUNT(*) INTO v_total_records
  FROM trapper.staged_records sr
  WHERE sr.source_system = p_source_system
    AND sr.source_table = p_source_table
    AND sr.processed_at IS NULL;

  -- If no records, still create job (for linking phase) but mark 0 records
  IF v_total_records IS NULL THEN
    v_total_records := 0;
  END IF;

  -- Create the job
  INSERT INTO trapper.processing_jobs (
    source_system,
    source_table,
    trigger_type,
    trigger_id,
    priority,
    total_records
  ) VALUES (
    p_source_system,
    p_source_table,
    p_trigger_type,
    p_trigger_id,
    p_priority,
    v_total_records
  )
  RETURNING job_id INTO v_job_id;

  RETURN v_job_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.enqueue_processing IS
'Queue a processing job for the unified pipeline.

Parameters:
- p_source_system: Source system (clinichq, airtable, web_intake)
- p_source_table: Source table (cat_info, owner_info, appointment_info)
- p_trigger_type: What triggered this (file_upload, cli_ingest, cron, manual, backfill)
- p_trigger_id: Optional reference to trigger source
- p_priority: Higher priority jobs processed first (default 0)

Returns the job_id for tracking.';

-- ==============================================================
-- PHASE 3: Job Claiming Function
-- ==============================================================

\echo 'Creating claim_next_job function...'

CREATE OR REPLACE FUNCTION trapper.claim_next_job()
RETURNS trapper.processing_jobs AS $$
DECLARE
  v_job trapper.processing_jobs;
BEGIN
  -- Claim next available job using SKIP LOCKED for concurrency safety
  -- Also handle retry_pending jobs that are ready
  UPDATE trapper.processing_jobs
  SET
    status = 'processing',
    started_at = COALESCE(started_at, NOW()),
    heartbeat_at = NOW(),
    attempt_count = attempt_count + 1
  WHERE job_id = (
    SELECT job_id
    FROM trapper.processing_jobs
    WHERE (
      status = 'queued'
      OR (status = 'retry_pending' AND next_retry_at <= NOW())
    )
    ORDER BY priority DESC, queued_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.claim_next_job IS
'Atomically claim the next available job from the queue.
Uses FOR UPDATE SKIP LOCKED for safe concurrent processing.';

-- ==============================================================
-- PHASE 4: Job Heartbeat Function
-- ==============================================================

\echo 'Creating update_job_heartbeat function...'

CREATE OR REPLACE FUNCTION trapper.update_job_heartbeat(
  p_job_id UUID,
  p_records_processed INT DEFAULT NULL,
  p_entities_created JSONB DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE trapper.processing_jobs
  SET
    heartbeat_at = NOW(),
    records_processed = COALESCE(p_records_processed, records_processed),
    entities_created = CASE
      WHEN p_entities_created IS NOT NULL
      THEN entities_created || p_entities_created
      ELSE entities_created
    END
  WHERE job_id = p_job_id;
END;
$$ LANGUAGE plpgsql;

-- ==============================================================
-- PHASE 5: Job Completion Functions
-- ==============================================================

\echo 'Creating job completion functions...'

CREATE OR REPLACE FUNCTION trapper.complete_job(
  p_job_id UUID,
  p_linking_results JSONB DEFAULT '{}'
)
RETURNS VOID AS $$
BEGIN
  UPDATE trapper.processing_jobs
  SET
    status = 'completed',
    completed_at = NOW(),
    linking_results = p_linking_results
  WHERE job_id = p_job_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trapper.fail_job(
  p_job_id UUID,
  p_error TEXT,
  p_error_details JSONB DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_job trapper.processing_jobs;
BEGIN
  SELECT * INTO v_job FROM trapper.processing_jobs WHERE job_id = p_job_id;

  IF v_job.attempt_count < v_job.max_attempts THEN
    -- Schedule retry with exponential backoff
    UPDATE trapper.processing_jobs
    SET
      status = 'retry_pending',
      last_error = p_error,
      errors = errors || jsonb_build_array(jsonb_build_object(
        'timestamp', NOW(),
        'attempt', v_job.attempt_count,
        'error', p_error,
        'details', p_error_details
      )),
      next_retry_at = NOW() + (POWER(2, v_job.attempt_count) * INTERVAL '1 minute')
    WHERE job_id = p_job_id;
  ELSE
    -- Max retries exceeded
    UPDATE trapper.processing_jobs
    SET
      status = 'failed',
      completed_at = NOW(),
      last_error = p_error,
      errors = errors || jsonb_build_array(jsonb_build_object(
        'timestamp', NOW(),
        'attempt', v_job.attempt_count,
        'error', p_error,
        'details', p_error_details,
        'final', true
      ))
    WHERE job_id = p_job_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ==============================================================
-- PHASE 6: Enhanced Entity Linking Function
-- ==============================================================

\echo 'Creating enhanced link_appointments_to_owners function...'

-- This is the CRITICAL missing step from the CLI pipeline
-- Links owner_info from staged_records to sot_appointments

CREATE OR REPLACE FUNCTION trapper.link_appointments_to_owners()
RETURNS TABLE (
  appointments_updated INT,
  persons_created INT,
  persons_linked INT
) AS $$
DECLARE
  v_updated INT := 0;
  v_persons_created INT := 0;
  v_persons_linked INT := 0;
BEGIN
  -- Step 1: Backfill owner_email and owner_phone from staged_records
  WITH updates AS (
    UPDATE trapper.sot_appointments a
    SET
      owner_email = LOWER(TRIM(sr.payload->>'Owner Email')),
      owner_phone = trapper.norm_phone_us(sr.payload->>'Owner Phone')
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND sr.payload->>'Number' = a.appointment_number
      AND a.owner_email IS NULL
      AND sr.payload->>'Owner Email' IS NOT NULL
      AND sr.payload->>'Owner Email' != ''
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_updated FROM updates;

  -- Step 2: Create/link persons for appointments with owner_email but no person_id
  -- Using existing find_or_create_person function
  WITH appts_needing_persons AS (
    SELECT DISTINCT
      a.appointment_id,
      a.owner_email,
      a.owner_phone,
      a.appointment_number
    FROM trapper.sot_appointments a
    WHERE a.owner_email IS NOT NULL
      AND a.person_id IS NULL
    LIMIT 500  -- Process in batches for safety
  ),
  person_links AS (
    SELECT
      anp.appointment_id,
      anp.owner_email,
      trapper.find_or_create_person(
        anp.owner_email,
        anp.owner_phone,
        sr.payload->>'Owner First Name',
        sr.payload->>'Owner Last Name',
        sr.payload->>'Owner Address',
        'clinichq'
      ) AS person_id
    FROM appts_needing_persons anp
    LEFT JOIN trapper.staged_records sr ON
      sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND sr.payload->>'Number' = anp.appointment_number
  ),
  updates AS (
    UPDATE trapper.sot_appointments a
    SET person_id = pl.person_id
    FROM person_links pl
    WHERE a.appointment_id = pl.appointment_id
      AND pl.person_id IS NOT NULL
    RETURNING a.appointment_id, pl.person_id
  )
  SELECT COUNT(DISTINCT appointment_id), COUNT(DISTINCT person_id)
  INTO v_persons_linked, v_persons_created
  FROM updates;

  RETURN QUERY SELECT v_updated, v_persons_created, v_persons_linked;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_appointments_to_owners IS
'Links owner information from staged_records to sot_appointments.
This fixes the critical CLI pipeline bug where owner_info was staged but never linked.
Run as part of entity linking phase.';

-- ==============================================================
-- PHASE 7: Enhanced run_all_entity_linking
-- ==============================================================

\echo 'Enhancing run_all_entity_linking function...'

CREATE OR REPLACE FUNCTION trapper.run_all_entity_linking()
RETURNS TABLE (
  operation TEXT,
  count INT
) AS $$
DECLARE
  v_count INT;
  v_cats INT;
  v_places INT;
  v_updated INT;
  v_created INT;
  v_linked INT;
BEGIN
  -- NEW: Link appointments to owners first (critical for cat-place linking)
  SELECT appointments_updated, persons_created, persons_linked
  INTO v_updated, v_created, v_linked
  FROM trapper.link_appointments_to_owners();
  RETURN QUERY SELECT 'appointments_linked_to_owners'::TEXT, v_updated;
  RETURN QUERY SELECT 'persons_created_for_appointments'::TEXT, v_created;

  -- 1. Create places from intake
  SELECT trapper.create_places_from_intake() INTO v_count;
  RETURN QUERY SELECT 'places_created_from_intake'::TEXT, v_count;

  -- 2. Link intake requesters to places
  SELECT trapper.link_intake_requesters_to_places() INTO v_count;
  RETURN QUERY SELECT 'intake_requester_place_links'::TEXT, v_count;

  -- 3. Link cats to places (now includes appointments with proper person_id)
  SELECT cats_linked, places_involved INTO v_cats, v_places
  FROM trapper.run_cat_place_linking();
  RETURN QUERY SELECT 'cats_linked_to_places'::TEXT, v_cats;

  -- 4. Link appointments to trappers
  SELECT trapper.run_appointment_trapper_linking() INTO v_count;
  RETURN QUERY SELECT 'appointments_linked_to_trappers'::TEXT, v_count;

  -- 5. NEW: Link cats to places via appointment person_id
  -- This catches cats that were missed by the microchip-based linking
  WITH additional_links AS (
    INSERT INTO trapper.cat_place_relationships (
      cat_id,
      place_id,
      relationship_type,
      confidence,
      source_system,
      source_table
    )
    SELECT DISTINCT
      a.cat_id,
      ppr.place_id,
      'appointment_site'::TEXT,
      0.85,
      'clinichq',
      'appointment_person_link'
    FROM trapper.sot_appointments a
    JOIN trapper.person_place_relationships ppr ON ppr.person_id = a.person_id
    WHERE a.cat_id IS NOT NULL
      AND a.person_id IS NOT NULL
      AND ppr.place_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trapper.cat_place_relationships cpr
        WHERE cpr.cat_id = a.cat_id AND cpr.place_id = ppr.place_id
      )
    RETURNING cat_id
  )
  SELECT COUNT(DISTINCT cat_id) INTO v_count FROM additional_links;
  RETURN QUERY SELECT 'cats_linked_via_appointment_person'::TEXT, v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.run_all_entity_linking IS
'Enhanced entity linking that runs all linking operations including:
- Link appointments to owners (critical fix for CLI pipeline bug)
- Create places from geocoded intake addresses
- Link intake requesters to places
- Link cats to places via microchip/owner info
- Link appointments to trappers
- Link cats to places via appointment person_id

Run after every processing batch and periodically via cron.';

-- ==============================================================
-- PHASE 8: Main Processor Orchestrator
-- ==============================================================

\echo 'Creating process_next_job function...'

CREATE OR REPLACE FUNCTION trapper.process_next_job(
  p_batch_size INT DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
  v_job trapper.processing_jobs;
  v_result JSONB;
  v_linking_results JSONB;
  v_error TEXT;
BEGIN
  -- Try to claim a job
  SELECT * INTO v_job FROM trapper.claim_next_job();

  IF v_job IS NULL THEN
    RETURN jsonb_build_object('status', 'no_jobs');
  END IF;

  BEGIN
    -- Route to appropriate processor based on source_system and source_table
    -- For now, we just run entity linking - Phase 2 will add specific processors

    -- Update status to linking
    UPDATE trapper.processing_jobs
    SET status = 'linking', heartbeat_at = NOW()
    WHERE job_id = v_job.job_id;

    -- Run entity linking
    SELECT jsonb_object_agg(operation, count)
    INTO v_linking_results
    FROM trapper.run_all_entity_linking();

    -- Mark as complete
    PERFORM trapper.complete_job(v_job.job_id, v_linking_results);

    RETURN jsonb_build_object(
      'status', 'completed',
      'job_id', v_job.job_id,
      'source_system', v_job.source_system,
      'source_table', v_job.source_table,
      'linking_results', v_linking_results
    );

  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    PERFORM trapper.fail_job(v_job.job_id, v_error);

    RETURN jsonb_build_object(
      'status', 'failed',
      'job_id', v_job.job_id,
      'error', v_error
    );
  END;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_next_job IS
'Main orchestrator function. Claims next job, routes to processor, runs linking.
Call repeatedly from cron endpoint until it returns no_jobs.';

-- ==============================================================
-- PHASE 9: Monitoring View
-- ==============================================================

\echo 'Creating processing dashboard view...'

CREATE OR REPLACE VIEW trapper.v_processing_dashboard AS
SELECT
  source_system,
  source_table,
  COUNT(*) FILTER (WHERE status = 'queued') as queued,
  COUNT(*) FILTER (WHERE status = 'processing') as processing,
  COUNT(*) FILTER (WHERE status = 'linking') as linking,
  COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours') as completed_24h,
  COUNT(*) FILTER (WHERE status = 'failed' AND completed_at > NOW() - INTERVAL '24 hours') as failed_24h,
  COUNT(*) FILTER (WHERE status = 'retry_pending') as retry_pending,
  ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) FILTER (WHERE status = 'completed'))::INT as avg_duration_seconds,
  MAX(completed_at) as last_completed
FROM trapper.processing_jobs
WHERE queued_at > NOW() - INTERVAL '7 days'
GROUP BY source_system, source_table;

COMMENT ON VIEW trapper.v_processing_dashboard IS
'Dashboard view for monitoring processing job status.
Shows queue depth, completion rates, and performance metrics.';

-- ==============================================================
-- PHASE 10: Stuck Job Detection
-- ==============================================================

\echo 'Creating stuck job detection function...'

CREATE OR REPLACE FUNCTION trapper.detect_stuck_jobs(
  p_timeout_minutes INT DEFAULT 30
)
RETURNS TABLE (
  job_id UUID,
  source_system TEXT,
  source_table TEXT,
  status TEXT,
  started_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  minutes_stuck INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pj.job_id,
    pj.source_system,
    pj.source_table,
    pj.status,
    pj.started_at,
    pj.heartbeat_at,
    EXTRACT(EPOCH FROM (NOW() - COALESCE(pj.heartbeat_at, pj.started_at)))::INT / 60
  FROM trapper.processing_jobs pj
  WHERE pj.status IN ('processing', 'linking')
    AND COALESCE(pj.heartbeat_at, pj.started_at) < NOW() - (p_timeout_minutes * INTERVAL '1 minute');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.detect_stuck_jobs IS
'Detects jobs that may be stuck (no heartbeat for specified minutes).
Use to identify and potentially reset stuck jobs.';

-- ==============================================================
-- SUMMARY
-- ==============================================================

\echo ''
\echo 'MIG_312 complete!'
\echo ''
\echo 'New tables:'
\echo '  - processing_jobs: Centralized job queue'
\echo ''
\echo 'New functions:'
\echo '  - enqueue_processing(): Queue a job for processing'
\echo '  - claim_next_job(): Atomically claim next job'
\echo '  - process_next_job(): Main orchestrator'
\echo '  - link_appointments_to_owners(): CRITICAL fix for CLI bug'
\echo '  - complete_job()/fail_job(): Job status updates'
\echo '  - detect_stuck_jobs(): Monitoring helper'
\echo ''
\echo 'Enhanced functions:'
\echo '  - run_all_entity_linking(): Now includes appointment-to-owner linking'
\echo ''
\echo 'New views:'
\echo '  - v_processing_dashboard: Job queue monitoring'
\echo ''
\echo 'Usage:'
\echo '  -- Queue a job'
\echo '  SELECT trapper.enqueue_processing(''clinichq'', ''owner_info'', ''manual'');'
\echo ''
\echo '  -- Process jobs (call from cron)'
\echo '  SELECT * FROM trapper.process_next_job();'
\echo ''
\echo '  -- Check status'
\echo '  SELECT * FROM trapper.v_processing_dashboard;'
\echo ''
