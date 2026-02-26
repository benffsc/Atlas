-- MIG_2400: Staged Records Orchestrator
--
-- Problem: Individual batch functions exist but no orchestration to process all pending.
-- Solution: Create ops.process_all_pending_staged() that calls all processors in order.
--
-- Created: 2026-02-19

\echo ''
\echo '=============================================='
\echo '  MIG_2400: Staged Records Orchestrator'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Create orchestrator function
-- ============================================================================

CREATE OR REPLACE FUNCTION ops.process_all_pending_staged(
    p_max_iterations INTEGER DEFAULT 100
)
RETURNS TABLE(
    source_system TEXT,
    source_table TEXT,
    records_processed INTEGER,
    entities_created INTEGER,
    errors INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_batch_result RECORD;
    v_animal_record RECORD;
    v_iteration INT;
    v_total_processed INT;

    -- People batch results
    v_people_processed INT := 0;
    v_people_created INT := 0;
    v_people_errors INT := 0;

    -- Animals results
    v_animals_processed INT := 0;
    v_animals_created INT := 0;
    v_animals_errors INT := 0;

    -- Events results
    v_events_processed INT := 0;
    v_events_created INT := 0;
    v_events_errors INT := 0;

    -- Intake events results
    v_intake_processed INT := 0;
    v_intake_created INT := 0;
    v_intake_errors INT := 0;

    -- VolunteerHub results
    v_vh_processed INT := 0;
    v_vh_created INT := 0;
    v_vh_errors INT := 0;
BEGIN
    RAISE NOTICE 'Starting staged records processing (max iterations: %)', p_max_iterations;

    -- =========================================================================
    -- Phase 1: Process ShelterLuv People
    -- =========================================================================
    RAISE NOTICE '';
    RAISE NOTICE '=== Phase 1: ShelterLuv People ===';

    v_iteration := 0;
    LOOP
        v_iteration := v_iteration + 1;
        IF v_iteration > p_max_iterations THEN
            RAISE NOTICE 'People: Hit max iterations limit';
            EXIT;
        END IF;

        SELECT * INTO v_batch_result
        FROM ops.process_shelterluv_people_batch(100);

        IF v_batch_result.records_processed = 0 THEN
            RAISE NOTICE 'People: No more records to process';
            EXIT;
        END IF;

        v_people_processed := v_people_processed + v_batch_result.records_processed;
        v_people_created := v_people_created + v_batch_result.people_created;
        v_people_errors := v_people_errors + v_batch_result.errors;

        RAISE NOTICE 'People batch %: processed=%, created=%, errors=%',
            v_iteration, v_batch_result.records_processed,
            v_batch_result.people_created, v_batch_result.errors;
    END LOOP;

    -- =========================================================================
    -- Phase 2: Process ShelterLuv Animals
    -- =========================================================================
    RAISE NOTICE '';
    RAISE NOTICE '=== Phase 2: ShelterLuv Animals ===';

    FOR v_animal_record IN
        SELECT sr.id
        FROM ops.staged_records sr
        WHERE sr.source_system = 'shelterluv'
          AND sr.source_table = 'animals'
          AND sr.is_processed = FALSE
        ORDER BY sr.created_at ASC
        LIMIT p_max_iterations * 100  -- Process up to max_iterations * 100 animals
    LOOP
        v_animals_processed := v_animals_processed + 1;

        BEGIN
            PERFORM ops.process_shelterluv_animal(v_animal_record.id);
            v_animals_created := v_animals_created + 1;
        EXCEPTION WHEN OTHERS THEN
            v_animals_errors := v_animals_errors + 1;

            -- Mark as processed with error
            UPDATE ops.staged_records
            SET is_processed = TRUE,
                processing_error = SQLERRM
            WHERE id = v_animal_record.id;
        END;

        -- Progress logging every 100 animals
        IF v_animals_processed % 100 = 0 THEN
            RAISE NOTICE 'Animals: processed % so far...', v_animals_processed;
        END IF;
    END LOOP;

    RAISE NOTICE 'Animals: total processed=%, created=%, errors=%',
        v_animals_processed, v_animals_created, v_animals_errors;

    -- =========================================================================
    -- Phase 3: Process ShelterLuv Outcome Events
    -- =========================================================================
    RAISE NOTICE '';
    RAISE NOTICE '=== Phase 3: ShelterLuv Outcome Events ===';

    v_iteration := 0;
    LOOP
        v_iteration := v_iteration + 1;
        IF v_iteration > p_max_iterations THEN
            RAISE NOTICE 'Events: Hit max iterations limit';
            EXIT;
        END IF;

        SELECT * INTO v_batch_result
        FROM ops.process_shelterluv_events(500);

        IF v_batch_result.events_processed = 0 THEN
            RAISE NOTICE 'Events: No more records to process';
            EXIT;
        END IF;

        v_events_processed := v_events_processed + v_batch_result.events_processed;
        v_events_created := v_events_created +
            v_batch_result.adoptions_created +
            v_batch_result.fosters_created +
            v_batch_result.mortality_events +
            v_batch_result.tnr_releases;
        v_events_errors := v_events_errors + v_batch_result.errors;

        RAISE NOTICE 'Events batch %: processed=%, adoptions=%, fosters=%, errors=%',
            v_iteration, v_batch_result.events_processed,
            v_batch_result.adoptions_created, v_batch_result.fosters_created,
            v_batch_result.errors;
    END LOOP;

    -- =========================================================================
    -- Phase 4: Process ShelterLuv Intake Events
    -- =========================================================================
    RAISE NOTICE '';
    RAISE NOTICE '=== Phase 4: ShelterLuv Intake Events ===';

    v_iteration := 0;
    LOOP
        v_iteration := v_iteration + 1;
        IF v_iteration > p_max_iterations THEN
            RAISE NOTICE 'Intake: Hit max iterations limit';
            EXIT;
        END IF;

        SELECT * INTO v_batch_result
        FROM ops.process_shelterluv_intake_events(500);

        IF v_batch_result.events_processed = 0 THEN
            RAISE NOTICE 'Intake: No more records to process';
            EXIT;
        END IF;

        v_intake_processed := v_intake_processed + v_batch_result.events_processed;
        v_intake_created := v_intake_created + v_batch_result.intakes_created;
        v_intake_errors := v_intake_errors + v_batch_result.errors;

        RAISE NOTICE 'Intake batch %: processed=%, created=%, errors=%',
            v_iteration, v_batch_result.events_processed,
            v_batch_result.intakes_created, v_batch_result.errors;
    END LOOP;

    -- =========================================================================
    -- Phase 5: Process VolunteerHub (if function exists)
    -- =========================================================================
    BEGIN
        RAISE NOTICE '';
        RAISE NOTICE '=== Phase 5: VolunteerHub Users ===';

        -- Check if VH processing function exists
        IF EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'ops' AND p.proname = 'process_volunteerhub_users_batch'
        ) THEN
            v_iteration := 0;
            LOOP
                v_iteration := v_iteration + 1;
                IF v_iteration > p_max_iterations THEN
                    RAISE NOTICE 'VH: Hit max iterations limit';
                    EXIT;
                END IF;

                SELECT * INTO v_batch_result
                FROM ops.process_volunteerhub_users_batch(100);

                IF v_batch_result.records_processed = 0 THEN
                    RAISE NOTICE 'VH: No more records to process';
                    EXIT;
                END IF;

                v_vh_processed := v_vh_processed + v_batch_result.records_processed;
                v_vh_created := v_vh_created + v_batch_result.users_created;
                v_vh_errors := v_vh_errors + v_batch_result.errors;
            END LOOP;
        ELSE
            RAISE NOTICE 'VH: process_volunteerhub_users_batch not found, skipping';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'VH: Error - %', SQLERRM;
    END;

    -- =========================================================================
    -- Return summary
    -- =========================================================================
    RAISE NOTICE '';
    RAISE NOTICE '=== Processing Complete ===';

    RETURN QUERY
    SELECT 'shelterluv'::TEXT, 'people'::TEXT, v_people_processed, v_people_created, v_people_errors
    UNION ALL
    SELECT 'shelterluv'::TEXT, 'animals'::TEXT, v_animals_processed, v_animals_created, v_animals_errors
    UNION ALL
    SELECT 'shelterluv'::TEXT, 'events'::TEXT, v_events_processed, v_events_created, v_events_errors
    UNION ALL
    SELECT 'shelterluv'::TEXT, 'intake_events'::TEXT, v_intake_processed, v_intake_created, v_intake_errors
    UNION ALL
    SELECT 'volunteerhub'::TEXT, 'users'::TEXT, v_vh_processed, v_vh_created, v_vh_errors;
END;
$$;

COMMENT ON FUNCTION ops.process_all_pending_staged(INTEGER) IS
'Orchestrator that processes all pending staged records in order:
1. ShelterLuv people (identity resolution via Data Engine)
2. ShelterLuv animals (cat creation/matching)
3. ShelterLuv outcome events (adoptions, fosters, mortality)
4. ShelterLuv intake events (intake records)
5. VolunteerHub users (if function exists)

Returns summary table with counts per source/table.
Use p_max_iterations to limit processing for testing.';

-- ============================================================================
-- 2. Create quick status check function
-- ============================================================================

CREATE OR REPLACE FUNCTION ops.staged_records_status()
RETURNS TABLE(
    source_system TEXT,
    source_table TEXT,
    pending BIGINT,
    processed BIGINT,
    with_errors BIGINT
)
LANGUAGE sql
AS $$
    SELECT
        source_system,
        source_table,
        COUNT(*) FILTER (WHERE NOT is_processed) as pending,
        COUNT(*) FILTER (WHERE is_processed AND processing_error IS NULL) as processed,
        COUNT(*) FILTER (WHERE is_processed AND processing_error IS NOT NULL) as with_errors
    FROM ops.staged_records
    GROUP BY source_system, source_table
    ORDER BY source_system, source_table;
$$;

COMMENT ON FUNCTION ops.staged_records_status() IS
'Quick status check for staged records processing.
Shows pending, processed, and error counts by source/table.';

-- ============================================================================
-- 3. Grant permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION ops.process_all_pending_staged(INTEGER) TO postgres;
GRANT EXECUTE ON FUNCTION ops.staged_records_status() TO postgres;

-- ============================================================================
-- Verification
-- ============================================================================

\echo ''
\echo '=== Current Staged Records Status ==='
SELECT * FROM ops.staged_records_status();

\echo ''
\echo 'MIG_2400 complete!'
\echo ''
\echo 'To process all pending staged records:'
\echo '  SELECT * FROM ops.process_all_pending_staged();'
\echo ''
\echo 'To check status:'
\echo '  SELECT * FROM ops.staged_records_status();'
\echo ''
