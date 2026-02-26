-- MIG_2401: Fix ShelterLuv People Batch Function
--
-- Problem: MIG_2026 calls sot.data_engine_resolve_identity with parameters
-- that don't exist (p_staged_record_id, p_job_id) and uses wrong return column
-- (person_id vs resolved_person_id).
--
-- Fix: Update to use correct 6-parameter signature and column names.
--
-- Created: 2026-02-19

\echo ''
\echo '=============================================='
\echo '  MIG_2401: Fix ShelterLuv People Batch'
\echo '=============================================='
\echo ''

-- ============================================================================
-- Fix ops.process_shelterluv_people_batch
-- ============================================================================

-- Drop existing function first (return type changed)
DROP FUNCTION IF EXISTS ops.process_shelterluv_people_batch(integer);

CREATE OR REPLACE FUNCTION ops.process_shelterluv_people_batch(p_batch_size INTEGER DEFAULT 100)
RETURNS TABLE(
  records_processed INTEGER,
  people_created INTEGER,
  people_updated INTEGER,
  errors INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_record RECORD;
  v_processed INT := 0;
  v_created INT := 0;
  v_updated INT := 0;
  v_errors INT := 0;
  v_person_id UUID;
  v_result RECORD;
  v_email TEXT;
  v_phone TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_address TEXT;
BEGIN
  FOR v_record IN
    SELECT sr.id, sr.payload, sr.source_row_id
    FROM ops.staged_records sr
    WHERE sr.source_system = 'shelterluv'
      AND sr.source_table = 'people'
      AND sr.is_processed = FALSE
    ORDER BY sr.created_at ASC
    LIMIT p_batch_size
  LOOP
    v_processed := v_processed + 1;

    BEGIN
      -- Extract fields from payload
      v_email := NULLIF(TRIM(v_record.payload->>'Email'), '');
      v_phone := NULLIF(TRIM(v_record.payload->>'Phone'), '');
      v_first_name := NULLIF(TRIM(v_record.payload->>'Firstname'), '');
      v_last_name := NULLIF(TRIM(v_record.payload->>'Lastname'), '');
      v_address := CONCAT_WS(', ',
        NULLIF(TRIM(v_record.payload->>'Street'), ''),
        NULLIF(TRIM(v_record.payload->>'City'), ''),
        NULLIF(TRIM(v_record.payload->>'State'), ''),
        NULLIF(TRIM(v_record.payload->>'Zip'), '')
      );

      -- Skip if no identifiers
      IF v_email IS NULL AND v_phone IS NULL THEN
        UPDATE ops.staged_records
        SET is_processed = TRUE,
            processor_name = 'process_shelterluv_people_batch',
            processing_error = 'No email or phone'
        WHERE id = v_record.id;
        CONTINUE;
      END IF;

      -- FIXED: Use correct 6-parameter signature
      SELECT * INTO v_result FROM sot.data_engine_resolve_identity(
        v_email,      -- p_email
        v_phone,      -- p_phone
        v_first_name, -- p_first_name
        v_last_name,  -- p_last_name
        v_address,    -- p_address
        'shelterluv'  -- p_source_system
      );

      -- FIXED: Use resolved_person_id instead of person_id
      v_person_id := v_result.resolved_person_id;

      IF v_person_id IS NOT NULL THEN
        IF v_result.decision_type = 'new_entity' THEN
          v_created := v_created + 1;
        ELSE
          v_updated := v_updated + 1;
        END IF;

        -- Link to staged record
        UPDATE ops.staged_records
        SET is_processed = TRUE,
            processor_name = 'process_shelterluv_people_batch',
            resulting_entity_type = 'person',
            resulting_entity_id = v_person_id
        WHERE id = v_record.id;
      ELSE
        -- Decision type might be 'rejected' - still mark as processed
        UPDATE ops.staged_records
        SET is_processed = TRUE,
            processor_name = 'process_shelterluv_people_batch',
            processing_error = COALESCE(v_result.reason, 'Data Engine returned NULL')
        WHERE id = v_record.id;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      UPDATE ops.staged_records
      SET is_processed = TRUE,
          processor_name = 'process_shelterluv_people_batch',
          processing_error = SQLERRM
      WHERE id = v_record.id;
    END;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_created, v_updated, v_errors;
END;
$$;

COMMENT ON FUNCTION ops.process_shelterluv_people_batch(INTEGER) IS
'Process ShelterLuv people records through Data Engine (MIG_2401 fix).
Uses correct 6-parameter sot.data_engine_resolve_identity signature.';

\echo ''
\echo 'MIG_2401 complete - Fixed ShelterLuv people batch function'
\echo ''
