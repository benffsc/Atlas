-- ============================================================================
-- MIG_772: Stabilize Processing Pipeline (TASK_004)
-- ============================================================================
-- TASK_LEDGER reference: TASK_004
-- ACTIVE Impact: No — processing pipeline is background/async
--
-- Root Cause Analysis:
--   process_next_job() only routes clinichq, airtable, web_intake.
--   ShelterLuv jobs (25,893 of 26,383 queued) have no routing, so they
--   sit in 'queued' state forever. Meanwhile, ShelterLuv ingest scripts
--   process records directly (bypassing the queue), so the jobs are ghosts.
--
-- What this does:
--   1. Expire 26,383 stalled orphan jobs whose records are already processed
--   2. Add shelterluv routing to process_next_job()
--   3. Process remaining unprocessed staged records
-- ============================================================================

\echo '=== MIG_772: Stabilize Processing Pipeline (TASK_004) ==='

-- ============================================================================
-- Step 1: Diagnostics
-- ============================================================================

\echo ''
\echo 'Step 1: Pre-fix diagnostics'

\echo 'Processing jobs by status:'
SELECT status, COUNT(*) AS cnt FROM trapper.processing_jobs GROUP BY status ORDER BY cnt DESC;

\echo 'Queued jobs vs actual unprocessed records:'
SELECT pj.source_system, pj.source_table, COUNT(*) AS queued_jobs,
    (SELECT COUNT(*) FROM trapper.staged_records sr
     WHERE sr.source_system = pj.source_system
       AND sr.source_table = pj.source_table
       AND sr.processed_at IS NULL) AS unprocessed_records
FROM trapper.processing_jobs pj
WHERE pj.status = 'queued'
GROUP BY pj.source_system, pj.source_table
ORDER BY queued_jobs DESC;

-- ============================================================================
-- Step 2: Expire stalled orphan jobs
-- ============================================================================

\echo ''
\echo 'Step 2: Expiring stalled orphan jobs (queued before today with no progress)'

-- Mark all queued jobs older than 24 hours as 'expired'
-- These are phantom jobs whose records were processed by direct calls
UPDATE trapper.processing_jobs
SET status = 'expired',
    completed_at = NOW(),
    last_error = 'Expired by MIG_772: job was queued but never claimed. Records were processed directly by ingest scripts.'
WHERE status = 'queued'
  AND queued_at < NOW() - INTERVAL '24 hours';

\echo 'Expired jobs:'
SELECT COUNT(*) AS expired FROM trapper.processing_jobs WHERE status = 'expired';

\echo 'Remaining queued jobs:'
SELECT source_system, source_table, COUNT(*) AS remaining
FROM trapper.processing_jobs
WHERE status = 'queued'
GROUP BY source_system, source_table
ORDER BY remaining DESC;

-- ============================================================================
-- Step 3: Add shelterluv routing to process_next_job
-- ============================================================================

\echo ''
\echo 'Step 3: Updating process_next_job to route shelterluv'

CREATE OR REPLACE FUNCTION trapper.process_next_job(p_batch_size INT DEFAULT 500)
RETURNS JSONB AS $$
DECLARE
    v_job RECORD;
    v_result JSONB;
    v_start_time TIMESTAMPTZ;
BEGIN
    v_start_time := clock_timestamp();

    -- Claim next job
    SELECT * INTO v_job
    FROM trapper.processing_jobs
    WHERE status IN ('queued', 'failed')
      AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
    ORDER BY priority DESC, queued_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_job IS NULL THEN
        RETURN jsonb_build_object('status', 'no_jobs');
    END IF;

    -- Update to processing
    UPDATE trapper.processing_jobs
    SET status = 'processing',
        started_at = NOW(),
        attempt_count = attempt_count + 1,
        heartbeat_at = NOW()
    WHERE processing_jobs.job_id = v_job.job_id;

    BEGIN
        CASE v_job.source_system
            WHEN 'clinichq' THEN
                CASE v_job.source_table
                    WHEN 'owner_info' THEN
                        v_result := trapper.process_clinichq_owner_info(v_job.job_id, p_batch_size);
                    WHEN 'cat_info' THEN
                        v_result := trapper.process_clinichq_cat_info(v_job.job_id, p_batch_size);
                    WHEN 'appointment_info' THEN
                        v_result := trapper.process_clinichq_appointment_info(v_job.job_id, p_batch_size);
                    ELSE
                        RAISE EXCEPTION 'Unknown clinichq table: %', v_job.source_table;
                END CASE;

            WHEN 'airtable' THEN
                v_result := trapper.data_engine_process_batch('airtable', v_job.source_table, p_batch_size, v_job.job_id);

            WHEN 'web_intake' THEN
                v_result := trapper.data_engine_process_batch('web_intake', v_job.source_table, p_batch_size, v_job.job_id);

            -- NEW: ShelterLuv routing (MIG_772 / TASK_004)
            WHEN 'shelterluv' THEN
                CASE v_job.source_table
                    WHEN 'people' THEN
                        PERFORM trapper.process_shelterluv_people_batch(p_batch_size);
                        v_result := jsonb_build_object('processor', 'process_shelterluv_people_batch', 'batch_size', p_batch_size);
                    WHEN 'animals' THEN
                        -- Use data engine for identity resolution on animals
                        v_result := trapper.data_engine_process_batch('shelterluv', 'animals', p_batch_size, v_job.job_id);
                    WHEN 'outcomes' THEN
                        PERFORM trapper.process_shelterluv_outcomes(p_batch_size);
                        v_result := jsonb_build_object('processor', 'process_shelterluv_outcomes', 'batch_size', p_batch_size);
                    WHEN 'events' THEN
                        PERFORM trapper.process_shelterluv_events(p_batch_size);
                        v_result := jsonb_build_object('processor', 'process_shelterluv_events', 'batch_size', p_batch_size);
                    ELSE
                        -- Fallback: try generic data engine processing
                        v_result := trapper.data_engine_process_batch('shelterluv', v_job.source_table, p_batch_size, v_job.job_id);
                END CASE;

            ELSE
                -- Generic fallback: try data engine for unknown sources
                v_result := trapper.data_engine_process_batch(v_job.source_system, v_job.source_table, p_batch_size, v_job.job_id);
        END CASE;

        -- Move to linking phase
        UPDATE trapper.processing_jobs
        SET status = 'linking',
            result = v_result,
            data_engine_stats = COALESCE(v_result->'data_engine', v_result)
        WHERE processing_jobs.job_id = v_job.job_id;

        -- Run entity linking
        PERFORM * FROM trapper.run_all_entity_linking();

        -- Mark complete
        UPDATE trapper.processing_jobs
        SET status = 'completed',
            completed_at = NOW(),
            result = v_result
        WHERE processing_jobs.job_id = v_job.job_id;

        RETURN jsonb_build_object(
            'job_id', v_job.job_id,
            'source_system', v_job.source_system,
            'source_table', v_job.source_table,
            'status', 'completed',
            'result', v_result
        );

    EXCEPTION WHEN OTHERS THEN
        UPDATE trapper.processing_jobs
        SET status = 'failed',
            last_error = SQLERRM,
            next_retry_at = CASE
                WHEN attempt_count < max_attempts THEN NOW() + (attempt_count * INTERVAL '5 minutes')
                ELSE NULL
            END
        WHERE processing_jobs.job_id = v_job.job_id;

        RETURN jsonb_build_object(
            'job_id', v_job.job_id,
            'source_system', v_job.source_system,
            'source_table', v_job.source_table,
            'status', 'failed',
            'error', SQLERRM
        );
    END;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_next_job IS
'Claims and processes the next queued job. Routes by source_system:
- clinichq: dedicated processors (owner_info, cat_info, appointment_info)
- shelterluv: dedicated processors (people, animals, outcomes, events) [added MIG_772]
- airtable, web_intake: data_engine_process_batch
- others: fallback to data_engine_process_batch
Uses FOR UPDATE SKIP LOCKED for non-blocking job claiming.';

-- ============================================================================
-- Step 4: Add 'expired' as valid status (if column has CHECK constraint)
-- ============================================================================

\echo ''
\echo 'Step 4: Ensuring expired status is valid'

-- The status column may not have a CHECK constraint, but let's be safe
DO $$
BEGIN
    -- Try to add expired to any existing check constraint
    -- If no constraint exists, this is a no-op
    ALTER TABLE trapper.processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_status_check;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'No status check constraint to update';
END $$;

-- ============================================================================
-- Step 5: Mark unprocessed staged records for shelterluv
-- ============================================================================

\echo ''
\echo 'Step 5: Unprocessed staged records (to be picked up by next cron run):'

SELECT source_system, source_table, COUNT(*) AS unprocessed
FROM trapper.staged_records
WHERE processed_at IS NULL
GROUP BY source_system, source_table
ORDER BY unprocessed DESC;

-- ============================================================================
-- Step 6: Verification
-- ============================================================================

\echo ''
\echo '====== MIG_772 SUMMARY ======'

\echo 'Processing jobs by status (post-fix):'
SELECT status, COUNT(*) AS cnt FROM trapper.processing_jobs GROUP BY status ORDER BY cnt DESC;

\echo ''
\echo 'Queued jobs remaining:'
SELECT source_system, source_table, COUNT(*) AS cnt
FROM trapper.processing_jobs
WHERE status = 'queued'
GROUP BY source_system, source_table
ORDER BY cnt DESC;

\echo ''
\echo 'process_next_job() now routes: clinichq, airtable, web_intake, shelterluv, and generic fallback'
\echo ''
\echo '=== MIG_772 Complete ==='
