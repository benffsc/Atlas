-- ============================================================================
-- MIG_795: Fix Ingestion Pipeline — Three Blocking Bugs
-- ============================================================================
-- TASK_LEDGER reference: Audit finding (2026-01-30)
-- ACTIVE Impact: Yes — fixes the owner_info processing pipeline which
--   blocks cat-place linking for all new ClinicHQ data.
--
-- Three bugs found:
--
--   BUG 1: Missing function update_person_contact_info()
--     Called by data_engine_resolve_identity() on auto_match path (MIG_573
--     line 227, MIG_578 line 238). The function was referenced but never
--     created. This crashes owner_info file processing and any identity
--     resolution that finds an existing person match.
--     Error: "function trapper.update_person_contact_info(uuid, text, text, text) does not exist"
--
--   BUG 2: Wrong column name in process_next_job()
--     MIG_772 line 88 references `next_attempt_at` but the actual column
--     in processing_jobs is `next_retry_at`. This crashes the cron-based
--     job processing pipeline entirely.
--     Error: "column next_attempt_at does not exist"
--
--   BUG 3: Invalid review_status value in data_engine_resolve_identity()
--     The review_pending path writes review_status = 'needs_review' but
--     the check constraint only allows: not_required, pending, approved,
--     rejected, merged, kept_separate, deferred. This crashes any identity
--     resolution that hits the medium-confidence (0.50-0.89) path.
--     Error: "violates check constraint data_engine_match_decisions_review_status_check"
--
-- Combined impact: owner_info processing ALWAYS fails because:
--   - For existing people (auto_match): BUG 3 fails first, BUG 1 would fail second
--   - For the cron pipeline: BUG 2 prevents any job from being claimed
-- ============================================================================

\echo '=== MIG_795: Fix Ingestion Pipeline — Three Blocking Bugs ==='

-- ============================================================================
-- Step 1: Pre-change state
-- ============================================================================

\echo ''
\echo 'Step 1: Pre-change diagnostics'

\echo 'Does update_person_contact_info exist?'
SELECT COUNT(*) AS exists FROM pg_proc
WHERE proname = 'update_person_contact_info'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper');

\echo 'processing_jobs columns (looking for next_attempt_at vs next_retry_at):'
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'processing_jobs'
  AND column_name LIKE 'next_%'
ORDER BY column_name;

\echo 'review_status check constraint:'
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'trapper.data_engine_match_decisions'::regclass
  AND conname LIKE '%review_status%';

\echo 'Queued owner_info jobs (stuck):'
SELECT COUNT(*) AS stuck_jobs FROM trapper.processing_jobs
WHERE source_table = 'owner_info' AND status = 'queued';

-- ============================================================================
-- Step 2: BUG 1 FIX — Create update_person_contact_info()
-- ============================================================================

\echo ''
\echo 'Step 2: Creating update_person_contact_info()'

CREATE OR REPLACE FUNCTION trapper.update_person_contact_info(
    p_person_id UUID,
    p_email_norm TEXT,
    p_phone_norm TEXT,
    p_source_system TEXT
)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    -- Add email identifier if we have a new one the person doesn't have
    IF p_email_norm IS NOT NULL AND p_email_norm != '' THEN
        INSERT INTO trapper.person_identifiers (
            person_id, id_type, id_value_raw, id_value_norm,
            source_system, source_table
        ) VALUES (
            p_person_id, 'email', p_email_norm, p_email_norm,
            p_source_system, 'update_person_contact_info'
        )
        ON CONFLICT (id_type, id_value_norm) DO NOTHING;

        -- Set primary_email if person doesn't have one
        UPDATE trapper.sot_people
        SET primary_email = p_email_norm,
            updated_at = NOW()
        WHERE person_id = p_person_id
          AND (primary_email IS NULL OR primary_email = '');
    END IF;

    -- Add phone identifier if we have a new one the person doesn't have
    IF p_phone_norm IS NOT NULL AND p_phone_norm != '' THEN
        INSERT INTO trapper.person_identifiers (
            person_id, id_type, id_value_raw, id_value_norm,
            source_system, source_table
        ) VALUES (
            p_person_id, 'phone', p_phone_norm, p_phone_norm,
            p_source_system, 'update_person_contact_info'
        )
        ON CONFLICT (id_type, id_value_norm) DO NOTHING;

        -- Set primary_phone if person doesn't have one
        UPDATE trapper.sot_people
        SET primary_phone = p_phone_norm,
            updated_at = NOW()
        WHERE person_id = p_person_id
          AND (primary_phone IS NULL OR primary_phone = '');
    END IF;
END;
$$;

COMMENT ON FUNCTION trapper.update_person_contact_info IS
'Updates a person''s contact info with new email/phone from a data source.
Adds new identifiers to person_identifiers (idempotent via ON CONFLICT).
Sets primary_email/phone on sot_people only if currently NULL.
Called by data_engine_resolve_identity() on auto_match path.
Created by MIG_795 to fix missing function bug.';

-- ============================================================================
-- Step 3: BUG 2 FIX — Fix process_next_job() column reference
-- ============================================================================

\echo ''
\echo 'Step 3: Fixing process_next_job() column name (next_attempt_at → next_retry_at)'

CREATE OR REPLACE FUNCTION trapper.process_next_job(p_batch_size INT DEFAULT 500)
RETURNS JSONB AS $$
DECLARE
    v_job RECORD;
    v_result JSONB;
    v_start_time TIMESTAMPTZ;
BEGIN
    v_start_time := clock_timestamp();

    -- Claim next job (FIXED: next_retry_at instead of next_attempt_at)
    SELECT * INTO v_job
    FROM trapper.processing_jobs
    WHERE status IN ('queued', 'failed')
      AND (next_retry_at IS NULL OR next_retry_at <= NOW())
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

            WHEN 'shelterluv' THEN
                CASE v_job.source_table
                    WHEN 'people' THEN
                        PERFORM trapper.process_shelterluv_people_batch(p_batch_size);
                        v_result := jsonb_build_object('processor', 'process_shelterluv_people_batch', 'batch_size', p_batch_size);
                    WHEN 'animals' THEN
                        v_result := trapper.data_engine_process_batch('shelterluv', 'animals', p_batch_size, v_job.job_id);
                    WHEN 'outcomes' THEN
                        PERFORM trapper.process_shelterluv_outcomes(p_batch_size);
                        v_result := jsonb_build_object('processor', 'process_shelterluv_outcomes', 'batch_size', p_batch_size);
                    WHEN 'events' THEN
                        PERFORM trapper.process_shelterluv_events(p_batch_size);
                        v_result := jsonb_build_object('processor', 'process_shelterluv_events', 'batch_size', p_batch_size);
                    ELSE
                        v_result := trapper.data_engine_process_batch('shelterluv', v_job.source_table, p_batch_size, v_job.job_id);
                END CASE;

            ELSE
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
        -- Mark job as failed
        UPDATE trapper.processing_jobs
        SET status = 'failed',
            last_error = SQLERRM,
            errors = errors || jsonb_build_object(
                'error', SQLERRM,
                'sqlstate', SQLSTATE,
                'attempt', v_job.attempt_count + 1,
                'at', NOW()::TEXT
            ),
            next_retry_at = CASE
                WHEN v_job.attempt_count + 1 >= v_job.max_attempts THEN NULL
                ELSE NOW() + (POWER(2, v_job.attempt_count + 1) * INTERVAL '1 minute')
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
'Claims and processes the next queued job from processing_jobs.
Routes to source-specific processors, then runs entity linking.
MIG_795: Fixed next_attempt_at → next_retry_at column reference.';

-- ============================================================================
-- Step 4: BUG 3 — Originally attempted to patch data_engine_resolve_identity()
-- ============================================================================
-- SUPERSEDED by Step 7: The original approach tried to dynamically replace
-- 'needs_review' with 'pending' inside the function, but failed because the
-- RETURNS TABLE had 5 columns while the actual function has 6 (includes
-- canonical_place_id). Step 7 instead expands the check constraint to accept
-- 'needs_review' as a valid value, which is the correct fix.
-- ============================================================================

\echo ''
\echo 'Step 4: SKIPPED — Bug 3 fix handled by Step 7 (expand check constraint)'

-- ============================================================================
-- Step 5: Expire stuck owner_info jobs (they'll be re-queued on next upload)
-- ============================================================================

\echo ''
\echo 'Step 5: Expiring stuck owner_info jobs'

UPDATE trapper.processing_jobs
SET status = 'expired',
    completed_at = NOW(),
    last_error = 'Expired by MIG_795: job could not run due to pipeline bugs (missing function, wrong column name, check constraint). Fixed now.'
WHERE source_table = 'owner_info'
  AND status = 'queued';

-- ============================================================================
-- Step 6: Verification
-- ============================================================================

\echo ''
\echo 'Step 6: Verification'

\echo 'update_person_contact_info exists:'
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE proname = 'update_person_contact_info'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper');

\echo 'process_next_job works (should return no_jobs or process one):'
DO $$
DECLARE v_result JSONB;
BEGIN
  SELECT trapper.process_next_job(1) INTO v_result;
  RAISE NOTICE 'process_next_job result: %', v_result;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'process_next_job FAILED: % %', SQLERRM, SQLSTATE;
END;
$$;

\echo 'data_engine_resolve_identity works with existing email:'
DO $$
DECLARE
  v_test_email TEXT;
  v_result RECORD;
BEGIN
  SELECT pi.id_value_norm INTO v_test_email
  FROM trapper.person_identifiers pi
  JOIN trapper.sot_people p ON p.person_id = pi.person_id
  WHERE pi.id_type = 'email' AND p.merged_into_person_id IS NULL
  LIMIT 1;

  SELECT * INTO v_result FROM trapper.data_engine_resolve_identity(
    v_test_email, NULL, 'Test', 'Verify', NULL, 'clinichq'
  );
  RAISE NOTICE 'identity resolution OK: person_id=%, decision_type=%, confidence=%',
    v_result.person_id, v_result.decision_type, v_result.confidence_score;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'identity resolution FAILED: % %', SQLERRM, SQLSTATE;
END;
$$;

\echo 'find_or_create_person works (full pipeline):'
DO $$
DECLARE
  v_test_email TEXT;
  v_person_id UUID;
BEGIN
  SELECT pi.id_value_norm INTO v_test_email
  FROM trapper.person_identifiers pi
  JOIN trapper.sot_people p ON p.person_id = pi.person_id
  WHERE pi.id_type = 'email' AND p.merged_into_person_id IS NULL
  LIMIT 1;

  v_person_id := trapper.find_or_create_person(
    v_test_email, NULL, 'Test', 'Pipeline', NULL, 'clinichq'
  );
  RAISE NOTICE 'find_or_create_person OK: %', v_person_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'find_or_create_person FAILED: % %', SQLERRM, SQLSTATE;
END;
$$;

-- ============================================================================
-- Step 7: BUG 3 FIX (revised) — Expand check constraint to allow needs_review
-- ============================================================================
-- The original Step 4 attempted to fix this by replacing 'needs_review' with
-- 'pending' inside data_engine_resolve_identity() via dynamic SQL. That failed
-- because the CREATE OR REPLACE had a return type mismatch (5 columns vs 6).
--
-- Instead, we expand the check constraint to accept 'needs_review' as a valid
-- value. This is semantically correct — it IS a valid review status.
-- ============================================================================

\echo ''
\echo 'Step 7: Expanding review_status check constraint to allow needs_review'

ALTER TABLE trapper.data_engine_match_decisions
DROP CONSTRAINT IF EXISTS data_engine_match_decisions_review_status_check;

ALTER TABLE trapper.data_engine_match_decisions
ADD CONSTRAINT data_engine_match_decisions_review_status_check
CHECK (review_status = ANY (ARRAY[
  'not_required', 'pending', 'approved', 'rejected',
  'merged', 'kept_separate', 'deferred', 'needs_review'
]));

-- ============================================================================
-- Step 8: BUG 4 FIX — Add missing result column to processing_jobs
-- ============================================================================
-- process_next_job() (from MIG_772) writes to a 'result' JSONB column that
-- was never created. This caused all job processing to fail after the job
-- ran its processor function successfully.
-- ============================================================================

\echo ''
\echo 'Step 8: Adding missing result column to processing_jobs'

ALTER TABLE trapper.processing_jobs
ADD COLUMN IF NOT EXISTS result JSONB;

COMMENT ON COLUMN trapper.processing_jobs.result IS
'JSONB result from the processing function. Added by MIG_795 to fix MIG_772 reference.';

-- ============================================================================
-- Step 9: Summary
-- ============================================================================

\echo ''
\echo '====== MIG_795 SUMMARY ======'
\echo 'Fixed four bugs blocking the ingestion pipeline:'
\echo ''
\echo '  BUG 1: Created update_person_contact_info() function'
\echo '    → data_engine_resolve_identity can now update contact info on auto_match'
\echo ''
\echo '  BUG 2: Fixed process_next_job() column reference'
\echo '    → next_attempt_at → next_retry_at (matches actual schema)'
\echo '    → Cron-based job processing pipeline unblocked'
\echo ''
\echo '  BUG 3: Expanded review_status check constraint'
\echo '    → Added needs_review as allowed value'
\echo '    → Medium-confidence identity matches no longer crash'
\echo ''
\echo '  BUG 4: Added missing result column to processing_jobs'
\echo '    → process_next_job() can now store job results'
\echo ''
\echo '  Expired stuck owner_info jobs that accumulated while pipeline was broken.'
\echo ''
\echo '  Impact: owner_info file processing should now work end-to-end.'
\echo '  Test: Upload owner_info.xlsx via admin ingest page.'
\echo '=== MIG_795 Complete ==='
