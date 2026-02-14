\echo '=== MIG_316: Data Engine Pipeline Integration ==='
\echo 'Integrating Data Engine with centralized processing pipeline'
\echo ''

-- ============================================================================
-- EXTEND PROCESSING JOBS TABLE
-- Add Data Engine stats tracking
-- ============================================================================

ALTER TABLE trapper.processing_jobs
ADD COLUMN IF NOT EXISTS data_engine_stats JSONB DEFAULT '{}';

COMMENT ON COLUMN trapper.processing_jobs.data_engine_stats IS
'Statistics from Data Engine identity resolution (matches, new entities, reviews).';

\echo 'Extended processing_jobs table with data_engine_stats'

-- ============================================================================
-- DATA ENGINE BATCH PROCESSOR
-- Process staged records through the Data Engine
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.data_engine_process_batch(
    p_source_system TEXT,
    p_source_table TEXT DEFAULT NULL,
    p_batch_size INT DEFAULT 500,
    p_job_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_processed INT := 0;
    v_auto_matched INT := 0;
    v_new_entities INT := 0;
    v_reviews_created INT := 0;
    v_household_members INT := 0;
    v_rejected INT := 0;
    v_errors INT := 0;
    v_rec RECORD;
    v_result RECORD;
    v_start_time TIMESTAMPTZ;
BEGIN
    v_start_time := clock_timestamp();

    -- Process unprocessed staged records with person data
    FOR v_rec IN
        SELECT
            sr.staged_record_id,
            sr.payload,
            sr.source_table
        FROM trapper.staged_records sr
        LEFT JOIN trapper.data_engine_match_decisions d ON d.staged_record_id = sr.staged_record_id
        WHERE sr.source_system = p_source_system
          AND (p_source_table IS NULL OR sr.source_table = p_source_table)
          AND d.decision_id IS NULL  -- Not yet processed by Data Engine
          AND (
              sr.payload->>'Owner Email' IS NOT NULL OR
              sr.payload->>'Owner Phone' IS NOT NULL OR
              sr.payload->>'email' IS NOT NULL OR
              sr.payload->>'phone' IS NOT NULL OR
              sr.payload->>'Email' IS NOT NULL OR
              sr.payload->>'Phone' IS NOT NULL
          )
        ORDER BY sr.staged_at ASC
        LIMIT p_batch_size
    LOOP
        BEGIN
            -- Extract identity fields based on source
            SELECT * INTO v_result
            FROM trapper.data_engine_resolve_identity(
                p_email := COALESCE(
                    v_rec.payload->>'Owner Email',
                    v_rec.payload->>'email',
                    v_rec.payload->>'Email'
                ),
                p_phone := COALESCE(
                    v_rec.payload->>'Owner Phone',
                    v_rec.payload->>'phone',
                    v_rec.payload->>'Phone'
                ),
                p_first_name := COALESCE(
                    v_rec.payload->>'Owner First Name',
                    v_rec.payload->>'first_name',
                    v_rec.payload->>'firstName',
                    v_rec.payload->>'First Name'
                ),
                p_last_name := COALESCE(
                    v_rec.payload->>'Owner Last Name',
                    v_rec.payload->>'last_name',
                    v_rec.payload->>'lastName',
                    v_rec.payload->>'Last Name'
                ),
                p_address := COALESCE(
                    v_rec.payload->>'Owner Address',
                    v_rec.payload->>'address',
                    v_rec.payload->>'Address'
                ),
                p_source_system := p_source_system,
                p_staged_record_id := v_rec.staged_record_id,
                p_job_id := p_job_id
            );

            v_processed := v_processed + 1;

            -- Track stats by decision type
            CASE v_result.decision_type
                WHEN 'auto_match' THEN v_auto_matched := v_auto_matched + 1;
                WHEN 'new_entity' THEN v_new_entities := v_new_entities + 1;
                WHEN 'review_pending' THEN v_reviews_created := v_reviews_created + 1;
                WHEN 'household_member' THEN v_household_members := v_household_members + 1;
                WHEN 'rejected' THEN v_rejected := v_rejected + 1;
                ELSE NULL;
            END CASE;

        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            -- Log error but continue processing
            RAISE NOTICE 'Error processing staged_record_id %: %', v_rec.staged_record_id, SQLERRM;
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'processed', v_processed,
        'auto_matched', v_auto_matched,
        'new_entities', v_new_entities,
        'reviews_created', v_reviews_created,
        'household_members', v_household_members,
        'rejected', v_rejected,
        'errors', v_errors,
        'duration_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_process_batch IS
'Processes a batch of staged records through the Data Engine for identity resolution.';

\echo 'Created data_engine_process_batch function'

-- ============================================================================
-- ENHANCED CLINICHQ OWNER INFO PROCESSOR
-- Updates existing function to use Data Engine
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.process_clinichq_owner_info(
    p_job_id UUID,
    p_batch_size INT DEFAULT 1000
)
RETURNS JSONB AS $$
DECLARE
    v_updated INT := 0;
    v_created INT := 0;
    v_linked INT := 0;
    v_data_engine_stats JSONB;
    v_start_time TIMESTAMPTZ;
    v_rec RECORD;
    v_person_id UUID;
BEGIN
    v_start_time := clock_timestamp();

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
          AND (a.owner_email IS NULL OR a.owner_phone IS NULL)
          AND (sr.payload->>'Owner Email' IS NOT NULL OR sr.payload->>'Owner Phone' IS NOT NULL)
        RETURNING a.appointment_id
    )
    SELECT COUNT(*) INTO v_updated FROM updates;

    -- Step 2: Process identities through Data Engine
    v_data_engine_stats := trapper.data_engine_process_batch('clinichq', 'owner_info', p_batch_size, p_job_id);

    -- Step 3: Link persons to appointments
    WITH links AS (
        UPDATE trapper.sot_appointments a
        SET person_id = pi.person_id
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
        WHERE a.person_id IS NULL
          AND a.owner_email IS NOT NULL
          AND pi.id_type = 'email'
          AND pi.id_value_norm = LOWER(TRIM(a.owner_email))
        RETURNING a.appointment_id
    )
    SELECT COUNT(*) INTO v_linked FROM links;

    -- Also link by phone for appointments with phone but no email
    WITH phone_links AS (
        UPDATE trapper.sot_appointments a
        SET person_id = pi.person_id
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
        WHERE a.person_id IS NULL
          AND a.owner_email IS NULL
          AND a.owner_phone IS NOT NULL
          AND pi.id_type = 'phone'
          AND pi.id_value_norm = trapper.norm_phone_us(a.owner_phone)
        RETURNING a.appointment_id
    )
    SELECT v_linked + COUNT(*) INTO v_linked FROM phone_links;

    RETURN jsonb_build_object(
        'appointments_updated', v_updated,
        'persons_linked', v_linked,
        'data_engine', v_data_engine_stats,
        'duration_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_clinichq_owner_info IS
'Enhanced processor that uses Data Engine for identity resolution. Backfills owner info and links persons.';

\echo 'Enhanced process_clinichq_owner_info to use Data Engine'

-- ============================================================================
-- UPDATE PROCESS_NEXT_JOB TO TRACK DATA ENGINE STATS
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.process_next_job(
    p_batch_size INT DEFAULT 1000
)
RETURNS TABLE (
    job_id UUID,
    source_system TEXT,
    source_table TEXT,
    status TEXT,
    result JSONB
) AS $$
DECLARE
    v_job RECORD;
    v_result JSONB;
    v_data_engine_stats JSONB;
    v_start_time TIMESTAMPTZ;
    v_batch_actual INT;
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

    -- Return if no jobs
    IF v_job IS NULL THEN
        RETURN QUERY SELECT
            NULL::UUID,
            'no_jobs'::TEXT,
            ''::TEXT,
            'no_jobs'::TEXT,
            '{}'::JSONB;
        RETURN;
    END IF;

    -- Update to processing
    UPDATE trapper.processing_jobs
    SET status = 'processing',
        started_at = NOW(),
        attempts = attempts + 1,
        claimed_by = pg_backend_pid()::TEXT
    WHERE processing_jobs.job_id = v_job.job_id;

    -- Process based on source_system
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
                -- Run Data Engine batch processing for Airtable data
                v_result := trapper.data_engine_process_batch('airtable', v_job.source_table, p_batch_size, v_job.job_id);

            WHEN 'web_intake' THEN
                -- Run Data Engine batch processing for web intake
                v_result := trapper.data_engine_process_batch('web_intake', v_job.source_table, p_batch_size, v_job.job_id);

            ELSE
                RAISE EXCEPTION 'Unknown source_system: %', v_job.source_system;
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

        RETURN QUERY SELECT
            v_job.job_id,
            v_job.source_system,
            v_job.source_table,
            'completed'::TEXT,
            v_result;

    EXCEPTION WHEN OTHERS THEN
        -- Mark as failed
        UPDATE trapper.processing_jobs
        SET status = 'failed',
            error_message = SQLERRM,
            next_attempt_at = CASE
                WHEN attempts < 3 THEN NOW() + (attempts * INTERVAL '5 minutes')
                ELSE NULL
            END
        WHERE processing_jobs.job_id = v_job.job_id;

        RETURN QUERY SELECT
            v_job.job_id,
            v_job.source_system,
            v_job.source_table,
            'failed'::TEXT,
            jsonb_build_object('error', SQLERRM);
    END;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_next_job IS
'Main orchestrator that claims and processes the next job in the queue. Now integrates Data Engine for all sources.';

\echo 'Updated process_next_job with Data Engine integration'

-- ============================================================================
-- DATA ENGINE HEALTH CHECK VIEW
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_data_engine_health AS
SELECT
    -- Decision stats (last 24h)
    (SELECT COUNT(*) FROM trapper.data_engine_match_decisions WHERE processed_at > NOW() - INTERVAL '24 hours') as decisions_24h,
    (SELECT COUNT(*) FROM trapper.data_engine_match_decisions WHERE processed_at > NOW() - INTERVAL '24 hours' AND decision_type = 'auto_match') as auto_matches_24h,
    (SELECT COUNT(*) FROM trapper.data_engine_match_decisions WHERE processed_at > NOW() - INTERVAL '24 hours' AND decision_type = 'new_entity') as new_entities_24h,
    (SELECT COUNT(*) FROM trapper.data_engine_match_decisions WHERE review_status = 'pending') as pending_reviews,

    -- Processing queue
    (SELECT COUNT(*) FROM trapper.processing_jobs WHERE status = 'queued') as queued_jobs,
    (SELECT COUNT(*) FROM trapper.processing_jobs WHERE status = 'processing') as processing_jobs,
    (SELECT COUNT(*) FROM trapper.processing_jobs WHERE status = 'failed') as failed_jobs,

    -- Household stats
    (SELECT COUNT(*) FROM trapper.households) as total_households,
    (SELECT COUNT(*) FROM trapper.household_members WHERE valid_to IS NULL) as active_household_members,

    -- Soft blacklist coverage
    (SELECT COUNT(*) FROM trapper.data_engine_soft_blacklist) as soft_blacklisted_identifiers,

    -- Average processing time (last 100 decisions)
    (SELECT ROUND(AVG(processing_duration_ms)::numeric, 2) FROM (
        SELECT processing_duration_ms FROM trapper.data_engine_match_decisions
        WHERE processing_duration_ms IS NOT NULL
        ORDER BY processed_at DESC LIMIT 100
    ) r) as avg_processing_ms;

COMMENT ON VIEW trapper.v_data_engine_health IS
'Health dashboard for Data Engine monitoring.';

\echo 'Created v_data_engine_health view'

-- ============================================================================
-- TRIGGER: AUTO-PROCESS NEW STAGED RECORDS
-- Queue processing when significant data is staged
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.auto_queue_data_engine_processing()
RETURNS TRIGGER AS $$
DECLARE
    v_pending_count INT;
BEGIN
    -- Check how many unprocessed records exist
    SELECT COUNT(*) INTO v_pending_count
    FROM trapper.staged_records sr
    LEFT JOIN trapper.data_engine_match_decisions d ON d.staged_record_id = sr.staged_record_id
    WHERE sr.source_system = NEW.source_system
      AND sr.source_table = NEW.source_table
      AND d.decision_id IS NULL;

    -- Auto-queue if we hit threshold (50 records)
    IF v_pending_count >= 50 THEN
        INSERT INTO trapper.processing_jobs (
            source_system, source_table, trigger_type, priority
        ) VALUES (
            NEW.source_system, NEW.source_table, 'auto_queue', 5
        ) ON CONFLICT DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger if not exists
DROP TRIGGER IF EXISTS trg_auto_queue_data_engine ON trapper.staged_records;
CREATE TRIGGER trg_auto_queue_data_engine
    AFTER INSERT ON trapper.staged_records
    FOR EACH ROW
    EXECUTE FUNCTION trapper.auto_queue_data_engine_processing();

\echo 'Created auto-queue trigger for Data Engine processing'

\echo ''
\echo '=== MIG_316 Complete ==='
\echo 'Pipeline integration:'
\echo '  - Extended processing_jobs with data_engine_stats'
\echo '  - Created data_engine_process_batch for batch processing'
\echo '  - Enhanced process_clinichq_owner_info with Data Engine'
\echo '  - Updated process_next_job with Data Engine integration'
\echo '  - Created v_data_engine_health monitoring view'
\echo '  - Added auto-queue trigger for staged records'
\echo ''
