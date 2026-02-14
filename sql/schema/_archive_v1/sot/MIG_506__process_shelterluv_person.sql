-- MIG_506: Create process_shelterluv_person Function
--
-- Problem:
--   The data engine has `shelterluv_person` processor registered but the
--   function was never implemented. ShelterLuv people are being created
--   through legacy paths that bypass identity resolution, causing duplicates.
--
-- Solution:
--   Create the missing processor function that:
--   1. Extracts email, phone, name from staged_records payload
--   2. Uses centralized find_or_create_person() for deduplication
--   3. Creates person_identifiers records properly
--   4. Marks staged records as processed
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_506__process_shelterluv_person.sql

\echo ''
\echo '=============================================='
\echo 'MIG_506: Create process_shelterluv_person'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Create the processor function
-- ============================================================

\echo '1. Creating process_shelterluv_person function...'

CREATE OR REPLACE FUNCTION trapper.process_shelterluv_person(p_staged_record_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_record RECORD;
  v_person_id UUID;
  v_email TEXT;
  v_phone TEXT;
  v_name TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_address TEXT;
  v_source_person_id TEXT;
  v_was_new BOOLEAN := false;
  v_existing_count INT;
BEGIN
  -- Get the staged record
  SELECT * INTO v_record
  FROM trapper.staged_records
  WHERE id = p_staged_record_id;

  IF v_record IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Staged record not found',
      'staged_record_id', p_staged_record_id
    );
  END IF;

  -- Skip if already processed
  IF v_record.is_processed THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'reason', 'already_processed'
    );
  END IF;

  -- Extract fields from payload (ShelterLuv people XLSX structure)
  -- Handle multiple possible field names for compatibility
  v_email := COALESCE(
    v_record.payload->>'Primary Email',
    v_record.payload->>'Email',
    v_record.payload->>'email'
  );
  v_phone := COALESCE(
    v_record.payload->>'Primary Phone',
    v_record.payload->>'Phone',
    v_record.payload->>'phone'
  );
  v_name := COALESCE(
    v_record.payload->>'Name',
    v_record.payload->>'name',
    v_record.payload->>'Full Name'
  );
  v_source_person_id := COALESCE(
    v_record.payload->>'Person ID',
    v_record.payload->>'Internal-ID',
    v_record.source_row_id
  );

  -- Skip if no identifiable information
  IF (v_email IS NULL OR TRIM(v_email) = '')
     AND (v_phone IS NULL OR TRIM(v_phone) = '')
     AND (v_name IS NULL OR TRIM(v_name) = '') THEN
    -- Mark as processed but no person created
    UPDATE trapper.staged_records
    SET is_processed = true,
        processed_at = NOW(),
        processor_name = 'process_shelterluv_person',
        processing_error = 'No identifiable information (email, phone, or name)'
    WHERE id = p_staged_record_id;

    RETURN jsonb_build_object(
      'success', false,
      'skipped', true,
      'reason', 'no_identifiable_info'
    );
  END IF;

  -- Split name into first/last
  v_name := TRIM(v_name);
  IF v_name IS NOT NULL AND v_name != '' THEN
    v_first_name := SPLIT_PART(v_name, ' ', 1);
    -- Get everything after the first space as last name
    IF POSITION(' ' IN v_name) > 0 THEN
      v_last_name := TRIM(SUBSTRING(v_name FROM POSITION(' ' IN v_name) + 1));
    ELSE
      v_last_name := NULL;
    END IF;
  END IF;

  -- Build address from components if available
  v_address := NULLIF(TRIM(CONCAT_WS(', ',
    NULLIF(TRIM(COALESCE(v_record.payload->>'Street Address', v_record.payload->>'Address', '')), ''),
    NULLIF(TRIM(COALESCE(v_record.payload->>'City', '')), ''),
    NULLIF(TRIM(COALESCE(v_record.payload->>'State', '')), ''),
    NULLIF(TRIM(COALESCE(v_record.payload->>'Zip', v_record.payload->>'Postal Code', '')), '')
  )), '');

  -- Count existing people before creation (to detect if new)
  SELECT COUNT(*) INTO v_existing_count
  FROM trapper.sot_people
  WHERE merged_into_person_id IS NULL;

  -- Use centralized function for proper deduplication
  -- This handles: identity resolution, normalization, person_identifiers creation
  v_person_id := trapper.find_or_create_person(
    p_email := v_email,
    p_phone := v_phone,
    p_first_name := v_first_name,
    p_last_name := v_last_name,
    p_address := v_address,
    p_source_system := 'shelterluv'
  );

  -- Check if person was newly created
  IF v_person_id IS NOT NULL THEN
    SELECT (COUNT(*) > v_existing_count) INTO v_was_new
    FROM trapper.sot_people
    WHERE merged_into_person_id IS NULL;
  END IF;

  -- Mark staged record as processed
  UPDATE trapper.staged_records
  SET is_processed = true,
      processed_at = NOW(),
      processor_name = 'process_shelterluv_person',
      processor_version = '1.0',
      resulting_entity_type = CASE WHEN v_person_id IS NOT NULL THEN 'person' ELSE NULL END,
      resulting_entity_id = v_person_id,
      processing_error = CASE WHEN v_person_id IS NULL THEN 'find_or_create_person returned NULL' ELSE NULL END
  WHERE id = p_staged_record_id;

  -- Record match decision for audit trail
  IF v_person_id IS NOT NULL THEN
    INSERT INTO trapper.data_engine_match_decisions (
      staged_record_id,
      source_system,
      incoming_name,
      incoming_email,
      incoming_phone,
      decision_type,
      decision_reason,
      resulting_person_id,
      processed_at
    ) VALUES (
      p_staged_record_id,
      'shelterluv',
      v_name,
      v_email,
      v_phone,
      CASE WHEN v_was_new THEN 'new_entity' ELSE 'auto_match' END,
      CASE WHEN v_was_new THEN 'created_new_person' ELSE 'matched_by_identifier' END,
      v_person_id,
      NOW()
    ) ON CONFLICT (staged_record_id) DO UPDATE SET
      decision_type = EXCLUDED.decision_type,
      decision_reason = EXCLUDED.decision_reason,
      resulting_person_id = EXCLUDED.resulting_person_id,
      processed_at = EXCLUDED.processed_at;
  END IF;

  RETURN jsonb_build_object(
    'success', v_person_id IS NOT NULL,
    'person_id', v_person_id,
    'was_new', v_was_new,
    'email', v_email,
    'phone', v_phone,
    'name', v_name
  );

EXCEPTION WHEN OTHERS THEN
  -- Log error but don't fail
  UPDATE trapper.staged_records
  SET processing_error = SQLERRM
  WHERE id = p_staged_record_id;

  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'staged_record_id', p_staged_record_id
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_shelterluv_person IS
'Data Engine processor for ShelterLuv people records.
Extracts email/phone/name from staged_records payload and uses
find_or_create_person() for proper identity resolution and deduplication.
Created by MIG_506 to fix missing processor that caused duplicates.';

-- ============================================================
-- 2. Create batch processing function
-- ============================================================

\echo '2. Creating process_shelterluv_people_batch function...'

CREATE OR REPLACE FUNCTION trapper.process_shelterluv_people_batch(
  p_batch_size INT DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
  v_processed INT := 0;
  v_success INT := 0;
  v_errors INT := 0;
  v_skipped INT := 0;
  v_rec RECORD;
  v_result JSONB;
  v_start_time TIMESTAMPTZ;
BEGIN
  v_start_time := clock_timestamp();

  -- Process unprocessed shelterluv/people staged records
  FOR v_rec IN
    SELECT sr.id AS staged_record_id
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'shelterluv'
      AND sr.source_table = 'people'
      AND sr.is_processed = false
    ORDER BY sr.created_at ASC
    LIMIT p_batch_size
  LOOP
    v_processed := v_processed + 1;

    -- Process through the processor function
    v_result := trapper.process_shelterluv_person(v_rec.staged_record_id);

    IF (v_result->>'success')::boolean THEN
      IF (v_result->>'skipped')::boolean THEN
        v_skipped := v_skipped + 1;
      ELSE
        v_success := v_success + 1;
      END IF;
    ELSE
      v_errors := v_errors + 1;
    END IF;
  END LOOP;

  -- Update processor stats (if table exists)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'trapper' AND table_name = 'data_engine_processors'
  ) THEN
    UPDATE trapper.data_engine_processors
    SET stats = jsonb_set(
      jsonb_set(
        jsonb_set(stats, '{processed}', to_jsonb(COALESCE((stats->>'processed')::int, 0) + v_success)),
        '{errors}', to_jsonb(COALESCE((stats->>'errors')::int, 0) + v_errors)
      ),
      '{last_run}', to_jsonb(NOW()::text)
    )
    WHERE source_system = 'shelterluv' AND source_table = 'people';
  END IF;

  RETURN jsonb_build_object(
    'processed', v_processed,
    'success', v_success,
    'errors', v_errors,
    'skipped', v_skipped,
    'processing_time_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::int
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_shelterluv_people_batch IS
'Batch processor for ShelterLuv people staged records.
Calls process_shelterluv_person() for each unprocessed record.
Returns counts of processed, success, errors, skipped.';

-- ============================================================
-- 3. Update data_engine_processors registry (if table exists)
-- ============================================================

\echo '3. Updating data_engine_processors registry (if exists)...'

-- Update the existing registration (or insert if missing)
-- Skip if table doesn't exist (MIG_467 may not be deployed)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'trapper' AND table_name = 'data_engine_processors'
  ) THEN
    INSERT INTO trapper.data_engine_processors (
      processor_name,
      source_system,
      source_table,
      entity_type,
      processor_function,
      description,
      is_active,
      priority,
      stats
    )
    VALUES (
      'shelterluv_person',
      'shelterluv',
      'people',
      'person',
      'process_shelterluv_person',
      'Creates people from ShelterLuv records using centralized identity resolution (MIG_506)',
      true,
      40,
      '{"processed": 0, "errors": 0, "last_run": null}'::jsonb
    )
    ON CONFLICT (source_system, source_table) DO UPDATE SET
      processor_function = EXCLUDED.processor_function,
      description = EXCLUDED.description,
      is_active = true,
      updated_at = NOW();
    RAISE NOTICE 'Updated data_engine_processors registry';
  ELSE
    RAISE NOTICE 'data_engine_processors table does not exist, skipping registry update';
  END IF;
END $$;

-- ============================================================
-- 4. Summary
-- ============================================================

\echo ''
\echo '=============================================='
\echo 'MIG_506 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - process_shelterluv_person(staged_record_id): Single record processor'
\echo '  - process_shelterluv_people_batch(batch_size): Batch processor'
\echo ''
\echo 'Updated:'
\echo '  - data_engine_processors registry: shelterluv_person now active'
\echo ''
\echo 'Usage:'
\echo '  -- Process single record:'
\echo '  SELECT trapper.process_shelterluv_person(staged_record_id);'
\echo ''
\echo '  -- Process batch:'
\echo '  SELECT * FROM trapper.process_shelterluv_people_batch(500);'
\echo ''

-- Show processor status (if table exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'trapper' AND table_name = 'data_engine_processors'
  ) THEN
    RAISE NOTICE 'Checking data_engine_processors...';
  ELSE
    RAISE NOTICE 'data_engine_processors table does not exist, skipping status check';
  END IF;
END $$;

-- Show pending count
SELECT 'Pending shelterluv/people records' as metric, COUNT(*) as count
FROM trapper.staged_records
WHERE source_system = 'shelterluv'
  AND source_table = 'people'
  AND is_processed = false;

-- Record migration
SELECT trapper.record_migration(506, 'MIG_506__process_shelterluv_person');
