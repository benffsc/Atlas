\echo '=== MIG_463: Fix Data Engine Staged Record Column References ==='
\echo 'The staged_records table uses "id" not "staged_record_id"'
\echo ''

-- ============================================================================
-- FIX: data_engine_process_batch - Use correct column name
-- The staged_records table has column "id", not "staged_record_id"
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
    -- FIXED: Use sr.id instead of sr.staged_record_id
    FOR v_rec IN
        SELECT
            sr.id AS staged_record_id,  -- Alias to match expected field name
            sr.payload,
            sr.source_table
        FROM trapper.staged_records sr
        LEFT JOIN trapper.data_engine_match_decisions d ON d.staged_record_id = sr.id
        WHERE sr.source_system = p_source_system
          AND (p_source_table IS NULL OR sr.source_table = p_source_table)
          AND d.decision_id IS NULL  -- Not yet processed by Data Engine
          AND (
              sr.payload->>'Owner Email' IS NOT NULL OR
              sr.payload->>'Owner Phone' IS NOT NULL OR
              sr.payload->>'email' IS NOT NULL OR
              sr.payload->>'phone' IS NOT NULL OR
              sr.payload->>'Email' IS NOT NULL OR
              sr.payload->>'Phone' IS NOT NULL OR
              sr.payload->>'Primary Email' IS NOT NULL OR
              sr.payload->>'Primary Phone' IS NOT NULL OR
              sr.payload->>'Name' IS NOT NULL
          )
        ORDER BY sr.created_at ASC
        LIMIT p_batch_size
    LOOP
        BEGIN
            -- Extract identity fields based on source
            SELECT * INTO v_result
            FROM trapper.data_engine_resolve_identity(
                p_email := COALESCE(
                    v_rec.payload->>'Owner Email',
                    v_rec.payload->>'email',
                    v_rec.payload->>'Email',
                    v_rec.payload->>'Primary Email'
                ),
                p_phone := COALESCE(
                    v_rec.payload->>'Owner Phone',
                    v_rec.payload->>'phone',
                    v_rec.payload->>'Phone',
                    v_rec.payload->>'Primary Phone'
                ),
                p_first_name := COALESCE(
                    v_rec.payload->>'Owner First Name',
                    v_rec.payload->>'first_name',
                    v_rec.payload->>'firstName',
                    v_rec.payload->>'First Name',
                    SPLIT_PART(v_rec.payload->>'Name', ' ', 1)
                ),
                p_last_name := COALESCE(
                    v_rec.payload->>'Owner Last Name',
                    v_rec.payload->>'last_name',
                    v_rec.payload->>'lastName',
                    v_rec.payload->>'Last Name',
                    NULLIF(TRIM(SUBSTRING(v_rec.payload->>'Name' FROM POSITION(' ' IN v_rec.payload->>'Name'))), '')
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
'Processes a batch of staged records through the Data Engine for identity resolution. Fixed to use correct column name.';

\echo 'Fixed data_engine_process_batch function'

-- ============================================================================
-- FIX: auto_queue_data_engine_processing trigger function
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.auto_queue_data_engine_processing()
RETURNS TRIGGER AS $$
DECLARE
    v_pending_count INT;
BEGIN
    -- Check how many unprocessed records exist
    -- FIXED: Use sr.id instead of sr.staged_record_id
    SELECT COUNT(*) INTO v_pending_count
    FROM trapper.staged_records sr
    LEFT JOIN trapper.data_engine_match_decisions d ON d.staged_record_id = sr.id
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

\echo 'Fixed auto_queue_data_engine_processing trigger function'

-- ============================================================================
-- FIX: create_person_basic - Add shelterluv source mapping
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.create_person_basic(
    p_display_name TEXT,
    p_email_norm TEXT,
    p_phone_norm TEXT,
    p_source_system TEXT
)
RETURNS UUID AS $$
DECLARE
    v_person_id UUID;
    v_data_source trapper.data_source;
BEGIN
    -- Validate name
    IF NOT trapper.is_valid_person_name(p_display_name) THEN
        RETURN NULL;
    END IF;

    -- Map source_system to data_source enum
    v_data_source := CASE p_source_system
        WHEN 'clinichq' THEN 'clinichq'::trapper.data_source
        WHEN 'airtable' THEN 'airtable'::trapper.data_source
        WHEN 'shelterluv' THEN 'shelterluv'::trapper.data_source
        WHEN 'volunteerhub' THEN 'volunteerhub'::trapper.data_source
        WHEN 'web_intake' THEN 'web_app'::trapper.data_source
        WHEN 'atlas_ui' THEN 'web_app'::trapper.data_source
        ELSE 'web_app'::trapper.data_source
    END;

    -- Create person
    INSERT INTO trapper.sot_people (
        display_name, data_source, is_canonical, primary_email, primary_phone
    ) VALUES (
        p_display_name, v_data_source, TRUE, p_email_norm, p_phone_norm
    ) RETURNING person_id INTO v_person_id;

    -- Add email identifier
    IF p_email_norm IS NOT NULL AND p_email_norm != '' THEN
        INSERT INTO trapper.person_identifiers (
            person_id, id_type, id_value_norm, id_value_raw, source_system, confidence
        ) VALUES (
            v_person_id, 'email', p_email_norm, p_email_norm, p_source_system, 1.0
        ) ON CONFLICT (id_type, id_value_norm) DO NOTHING;
    END IF;

    -- Add phone identifier (if not blacklisted)
    IF p_phone_norm IS NOT NULL AND p_phone_norm != '' THEN
        IF NOT EXISTS (
            SELECT 1 FROM trapper.identity_phone_blacklist
            WHERE phone_norm = p_phone_norm
        ) THEN
            INSERT INTO trapper.person_identifiers (
                person_id, id_type, id_value_norm, id_value_raw, source_system, confidence
            ) VALUES (
                v_person_id, 'phone', p_phone_norm, p_phone_norm, p_source_system, 1.0
            ) ON CONFLICT (id_type, id_value_norm) DO NOTHING;
        END IF;
    END IF;

    RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.create_person_basic IS
'Creates a new person with email/phone identifiers. Used internally by Data Engine. Fixed to support shelterluv source.';

\echo 'Fixed create_person_basic with shelterluv mapping'

-- ============================================================================
-- EXTEND process_next_job TO HANDLE shelterluv
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
    WHERE processing_jobs.status IN ('queued', 'failed')
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
                v_result := trapper.data_engine_process_batch('airtable', v_job.source_table, p_batch_size, v_job.job_id);

            WHEN 'web_intake' THEN
                v_result := trapper.data_engine_process_batch('web_intake', v_job.source_table, p_batch_size, v_job.job_id);

            WHEN 'shelterluv' THEN
                v_result := trapper.data_engine_process_batch('shelterluv', v_job.source_table, p_batch_size, v_job.job_id);

            WHEN 'volunteerhub' THEN
                v_result := trapper.data_engine_process_batch('volunteerhub', v_job.source_table, p_batch_size, v_job.job_id);

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
'Main orchestrator that claims and processes the next job in the queue. Supports shelterluv and volunteerhub sources.';

\echo 'Extended process_next_job to support shelterluv'

\echo ''
\echo '=== MIG_463 Complete ==='
\echo 'Fixed:'
\echo '  - data_engine_process_batch: Uses sr.id instead of sr.staged_record_id'
\echo '  - auto_queue_data_engine_processing: Uses sr.id instead of sr.staged_record_id'
\echo '  - create_person_basic: Added shelterluv and volunteerhub source mapping'
\echo '  - process_next_job: Added shelterluv and volunteerhub handlers'
\echo ''
