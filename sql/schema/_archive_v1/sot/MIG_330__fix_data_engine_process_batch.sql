\echo '=== MIG_330: Fix Data Engine Process Batch Column References ==='
\echo 'Fixes column name mismatches in data_engine_process_batch function'
\echo ''

-- ============================================================================
-- PROBLEM
-- The data_engine_process_batch function references:
--   - sr.staged_record_id (should be sr.id)
--   - sr.staged_at (should be sr.created_at)
-- This prevented the Data Engine backfill from working.
-- ============================================================================

\echo 'Step 1: Fixing data_engine_process_batch function...'

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
            sr.id as staged_record_id,  -- Use id, alias as staged_record_id
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
              sr.payload->>'Phone' IS NOT NULL
          )
        ORDER BY sr.created_at ASC  -- Use created_at not staged_at
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
                    v_rec.payload->>'First Name',
                    v_rec.payload->>'first_name',
                    v_rec.payload->>'firstName'
                ),
                p_last_name := COALESCE(
                    v_rec.payload->>'Owner Last Name',
                    v_rec.payload->>'Last Name',
                    v_rec.payload->>'last_name',
                    v_rec.payload->>'lastName'
                ),
                p_address := COALESCE(
                    v_rec.payload->>'Owner Address',
                    v_rec.payload->>'address',
                    v_rec.payload->>'Address'
                ),
                p_source_system := p_source_system,
                p_staged_record_id := v_rec.staged_record_id
            );

            v_processed := v_processed + 1;

            -- Count by decision type
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
            RAISE NOTICE 'Error processing record %: %', v_rec.staged_record_id, SQLERRM;
        END;
    END LOOP;

    -- Update job if provided
    IF p_job_id IS NOT NULL THEN
        UPDATE trapper.processing_jobs
        SET data_engine_stats = jsonb_build_object(
            'processed', v_processed,
            'auto_matched', v_auto_matched,
            'new_entities', v_new_entities,
            'reviews_created', v_reviews_created,
            'household_members', v_household_members,
            'rejected', v_rejected,
            'errors', v_errors,
            'duration_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT
        )
        WHERE job_id = p_job_id;
    END IF;

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
'Processes a batch of staged records through the Data Engine for identity resolution.
Fixed: Uses sr.id instead of sr.staged_record_id, sr.created_at instead of sr.staged_at.';

\echo 'Fixed data_engine_process_batch function'

-- ============================================================================
-- Step 2: Fix the data_engine_full_backfill function
-- ============================================================================

\echo ''
\echo 'Step 2: Fixing data_engine_full_backfill function...'

CREATE OR REPLACE FUNCTION trapper.data_engine_full_backfill(
    p_batch_size INT DEFAULT 500,
    p_max_batches INT DEFAULT 200,
    p_source_system TEXT DEFAULT NULL
)
RETURNS TABLE (
    source_system TEXT,
    total_processed INT,
    auto_matched INT,
    new_entities INT,
    reviews_created INT,
    household_members INT,
    rejected INT,
    errors INT,
    batches_run INT,
    duration_seconds NUMERIC
) AS $$
DECLARE
    v_batch_result JSONB;
    v_batch_count INT := 0;
    v_total_processed INT := 0;
    v_auto_matched INT := 0;
    v_new_entities INT := 0;
    v_reviews_created INT := 0;
    v_household_members INT := 0;
    v_rejected INT := 0;
    v_errors INT := 0;
    v_source TEXT;
    v_sources TEXT[];
    v_start_time TIMESTAMPTZ;
BEGIN
    v_start_time := clock_timestamp();

    -- Determine which sources to process
    IF p_source_system IS NOT NULL THEN
        v_sources := ARRAY[p_source_system];
    ELSE
        SELECT ARRAY_AGG(DISTINCT sr.source_system) INTO v_sources
        FROM trapper.staged_records sr
        LEFT JOIN trapper.data_engine_match_decisions d ON d.staged_record_id = sr.id
        WHERE d.decision_id IS NULL
          AND (
              sr.payload->>'Owner Email' IS NOT NULL OR
              sr.payload->>'Owner Phone' IS NOT NULL OR
              sr.payload->>'email' IS NOT NULL OR
              sr.payload->>'phone' IS NOT NULL
          );
    END IF;

    -- Process each source
    FOREACH v_source IN ARRAY v_sources
    LOOP
        v_batch_count := 0;

        LOOP
            -- Run a batch
            SELECT trapper.data_engine_process_batch(v_source, NULL, p_batch_size, NULL)
            INTO v_batch_result;

            -- Accumulate stats
            v_total_processed := v_total_processed + COALESCE((v_batch_result->>'processed')::INT, 0);
            v_auto_matched := v_auto_matched + COALESCE((v_batch_result->>'auto_matched')::INT, 0);
            v_new_entities := v_new_entities + COALESCE((v_batch_result->>'new_entities')::INT, 0);
            v_reviews_created := v_reviews_created + COALESCE((v_batch_result->>'reviews_created')::INT, 0);
            v_household_members := v_household_members + COALESCE((v_batch_result->>'household_members')::INT, 0);
            v_rejected := v_rejected + COALESCE((v_batch_result->>'rejected')::INT, 0);
            v_errors := v_errors + COALESCE((v_batch_result->>'errors')::INT, 0);

            v_batch_count := v_batch_count + 1;

            -- Exit conditions
            EXIT WHEN COALESCE((v_batch_result->>'processed')::INT, 0) < p_batch_size;
            EXIT WHEN v_batch_count >= p_max_batches;
        END LOOP;

        RAISE NOTICE 'Processed % records from % in % batches', v_total_processed, v_source, v_batch_count;
    END LOOP;

    RETURN QUERY SELECT
        COALESCE(p_source_system, 'all')::TEXT,
        v_total_processed,
        v_auto_matched,
        v_new_entities,
        v_reviews_created,
        v_household_members,
        v_rejected,
        v_errors,
        v_batch_count,
        ROUND(EXTRACT(EPOCH FROM clock_timestamp() - v_start_time)::NUMERIC, 2);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_full_backfill IS
'Processes all unprocessed staged records through the Data Engine in batches.
Creates full audit trail of identity decisions.';

\echo 'Fixed data_engine_full_backfill function'

-- ============================================================================
-- Step 3: Test with a small batch
-- ============================================================================

\echo ''
\echo 'Step 3: Testing with a small batch...'

SELECT * FROM trapper.data_engine_full_backfill(10, 1, 'clinichq');

\echo ''
\echo '=== MIG_330 Complete ==='
\echo 'Fixed column references in Data Engine batch processing functions.'
\echo ''
\echo 'To run the full backfill:'
\echo '  SELECT * FROM trapper.data_engine_full_backfill(500, 200, ''clinichq'');'
\echo '  SELECT * FROM trapper.data_engine_full_backfill(500, 100, ''airtable'');'
\echo ''
