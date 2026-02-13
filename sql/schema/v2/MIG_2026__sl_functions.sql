-- MIG_2026: ShelterLuv Processing Functions for V2
-- Ports V1 ShelterLuv processing functions to V2 schema

-- ============================================================================
-- 1. Create ops.staged_records table
-- ============================================================================
CREATE TABLE IF NOT EXISTS ops.staged_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_row_id TEXT,
  row_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  is_processed BOOLEAN DEFAULT FALSE,
  processor_name TEXT,
  resulting_entity_type TEXT,
  resulting_entity_id UUID,
  processing_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint on source_system + source_table + row_hash
CREATE UNIQUE INDEX IF NOT EXISTS idx_staged_records_unique
  ON ops.staged_records(source_system, source_table, row_hash);

CREATE INDEX IF NOT EXISTS idx_staged_records_unprocessed
  ON ops.staged_records(source_system, source_table, is_processed)
  WHERE is_processed = FALSE;

CREATE INDEX IF NOT EXISTS idx_staged_records_source
  ON ops.staged_records(source_system, source_table);

-- ============================================================================
-- 2. Create source.update_shelterluv_sync_state function
-- ============================================================================
CREATE OR REPLACE FUNCTION source.update_shelterluv_sync_state(
  p_sync_type TEXT,
  p_last_timestamp BIGINT,
  p_records_synced INTEGER,
  p_total_records INTEGER,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO source.shelterluv_sync_state (
    sync_type, last_sync_timestamp, last_sync_at, last_check_at,
    records_synced, total_records, error_message, updated_at
  ) VALUES (
    p_sync_type, p_last_timestamp, NOW(), NOW(),
    p_records_synced, p_total_records, p_error, NOW()
  )
  ON CONFLICT (sync_type)
  DO UPDATE SET
    last_sync_timestamp = COALESCE(EXCLUDED.last_sync_timestamp, source.shelterluv_sync_state.last_sync_timestamp),
    last_sync_at = CASE
      WHEN EXCLUDED.last_sync_timestamp IS NOT NULL THEN NOW()
      ELSE source.shelterluv_sync_state.last_sync_at
    END,
    last_check_at = NOW(),
    records_synced = EXCLUDED.records_synced,
    total_records = EXCLUDED.total_records,
    error_message = EXCLUDED.error_message,
    updated_at = NOW();
END;
$$;

-- ============================================================================
-- 3. Create ops.v_shelterluv_sync_status view
-- ============================================================================
CREATE OR REPLACE VIEW ops.v_shelterluv_sync_status AS
SELECT
  ss.sync_type,
  ss.last_sync_at,
  ss.records_synced,
  COALESCE(
    (SELECT COUNT(*)::int FROM ops.staged_records sr
     WHERE sr.source_system = 'shelterluv'
       AND sr.source_table = ss.sync_type
       AND sr.is_processed = FALSE),
    0
  ) AS pending_processing,
  CASE
    WHEN ss.error_message IS NOT NULL THEN 'error'
    WHEN ss.last_sync_at < NOW() - INTERVAL '2 days' THEN 'stale'
    ELSE 'healthy'
  END AS sync_health
FROM source.shelterluv_sync_state ss;

-- ============================================================================
-- 4. Create ops.process_shelterluv_people_batch function
-- ============================================================================
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

      -- Use Data Engine for identity resolution
      SELECT * INTO v_result FROM sot.data_engine_resolve_identity(
        p_email := v_email,
        p_phone := v_phone,
        p_first_name := v_first_name,
        p_last_name := v_last_name,
        p_address := v_address,
        p_source_system := 'shelterluv',
        p_staged_record_id := v_record.id,
        p_job_id := NULL
      );

      v_person_id := v_result.person_id;

      IF v_person_id IS NOT NULL THEN
        IF v_result.decision_type = 'created' THEN
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
        UPDATE ops.staged_records
        SET is_processed = TRUE,
            processor_name = 'process_shelterluv_people_batch',
            processing_error = 'Data Engine returned NULL'
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

-- ============================================================================
-- 5. Create ops.process_shelterluv_animal function
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.process_shelterluv_animal(p_staged_record_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_record RECORD;
  v_cat_id UUID;
  v_microchip TEXT;
  v_animal_name TEXT;
  v_sex TEXT;
  v_breed TEXT;
  v_primary_color TEXT;
  v_secondary_color TEXT;
  v_altered_status TEXT;
  v_status TEXT;
  v_foster_person_id UUID;
  v_foster_email TEXT;
  v_is_foster BOOLEAN := false;
  v_shelterluv_id TEXT;
  v_shelterluv_api_id TEXT;
  v_match_method TEXT := NULL;
BEGIN
  SELECT * INTO v_record
  FROM ops.staged_records
  WHERE id = p_staged_record_id;

  IF v_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Staged record not found');
  END IF;

  -- Extract microchip
  v_microchip := COALESCE(
    v_record.payload->>'Microchip Number',
    v_record.payload->>'Microchip'
  );

  -- Handle API Microchips array
  IF (v_microchip IS NULL OR LENGTH(v_microchip) < 9)
     AND jsonb_typeof(v_record.payload->'Microchips') = 'array'
     AND jsonb_array_length(v_record.payload->'Microchips') > 0 THEN
    v_microchip := v_record.payload->'Microchips'->0->>'Id';
  END IF;

  -- Handle scientific notation
  IF v_microchip ~ '^[0-9.]+E\+[0-9]+$' THEN
    v_microchip := TRIM(TO_CHAR(v_microchip::NUMERIC, '999999999999999'));
  END IF;

  v_animal_name := COALESCE(
    v_record.payload->>'Name',
    v_record.payload->>'Animal Name'
  );
  v_sex := v_record.payload->>'Sex';
  v_breed := v_record.payload->>'Breed';
  v_primary_color := v_record.payload->>'Color';
  v_secondary_color := v_record.payload->>'Secondary Color';
  v_altered_status := CASE
    WHEN (v_record.payload->>'Altered') IN ('Yes', 'true') THEN 'altered'
    WHEN (v_record.payload->>'Altered') IN ('No', 'false') THEN 'intact'
    ELSE NULL
  END;
  v_status := v_record.payload->>'Status';
  v_shelterluv_id := v_record.payload->>'Internal-ID';
  v_shelterluv_api_id := v_record.payload->>'Internal ID (API)';
  v_foster_email := NULLIF(TRIM(v_record.payload->>'Foster Person Email'), '');
  v_is_foster := (
    v_record.payload->>'InFoster' = 'true'
    OR v_status ILIKE '%foster%'
    OR v_foster_email IS NOT NULL
  );

  -- Find/create cat by microchip
  IF v_microchip IS NOT NULL AND LENGTH(v_microchip) >= 9 THEN
    v_cat_id := sot.find_or_create_cat_by_microchip(
      p_microchip := v_microchip,
      p_name := v_animal_name,
      p_sex := v_sex,
      p_breed := v_breed,
      p_primary_color := v_primary_color,
      p_secondary_color := v_secondary_color,
      p_source_system := 'shelterluv',
      p_source_record_id := COALESCE(v_shelterluv_id, v_shelterluv_api_id)
    );
    v_match_method := 'microchip';
  END IF;

  -- Try ShelterLuv ID if no microchip
  IF v_cat_id IS NULL AND v_shelterluv_id IS NOT NULL THEN
    SELECT ci.cat_id INTO v_cat_id
    FROM sot.cat_identifiers ci
    WHERE ci.id_type = 'shelterluv_id'
      AND ci.id_value = v_shelterluv_id;
    IF v_cat_id IS NOT NULL THEN
      v_match_method := 'shelterluv_id';
    END IF;
  END IF;

  IF v_cat_id IS NOT NULL THEN
    -- Store SL IDs
    IF v_shelterluv_id IS NOT NULL THEN
      INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
      VALUES (v_cat_id, 'shelterluv_id', v_shelterluv_id, 'shelterluv', 'animals')
      ON CONFLICT DO NOTHING;
    END IF;

    IF v_shelterluv_api_id IS NOT NULL
       AND v_shelterluv_api_id ~ '^[0-9]+$'
       AND v_shelterluv_api_id IS DISTINCT FROM v_shelterluv_id THEN
      INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
      VALUES (v_cat_id, 'shelterluv_id', v_shelterluv_api_id, 'shelterluv', 'animals')
      ON CONFLICT DO NOTHING;
    END IF;

    -- Handle foster relationship
    IF v_is_foster AND v_foster_email IS NOT NULL THEN
      BEGIN
        SELECT pi.person_id INTO v_foster_person_id
        FROM sot.person_identifiers pi
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = LOWER(TRIM(v_foster_email));

        IF v_foster_person_id IS NOT NULL THEN
          INSERT INTO sot.person_cat (
            person_id, cat_id, relationship_type, source_system, source_table, source_record_id
          ) VALUES (
            v_foster_person_id, v_cat_id, 'foster', 'shelterluv', 'animals',
            COALESCE(v_shelterluv_id, v_shelterluv_api_id)
          ) ON CONFLICT DO NOTHING;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL; -- Skip foster linking errors
      END;
    END IF;
  END IF;

  -- Mark as processed
  UPDATE ops.staged_records
  SET is_processed = TRUE,
      processor_name = 'process_shelterluv_animal',
      resulting_entity_type = CASE WHEN v_cat_id IS NOT NULL THEN 'cat' ELSE NULL END,
      resulting_entity_id = v_cat_id
  WHERE id = p_staged_record_id;

  RETURN jsonb_build_object(
    'success', true,
    'cat_id', v_cat_id,
    'match_method', v_match_method,
    'microchip', v_microchip,
    'name', v_animal_name
  );
END;
$$;

-- ============================================================================
-- 6. Create ops.process_shelterluv_events function
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.process_shelterluv_events(p_batch_size INTEGER DEFAULT 500)
RETURNS TABLE(
  events_processed INTEGER,
  adoptions_created INTEGER,
  fosters_created INTEGER,
  tnr_releases INTEGER,
  mortality_events INTEGER,
  returns_processed INTEGER,
  transfers_logged INTEGER,
  errors INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_record RECORD;
  v_processed INT := 0;
  v_adoptions INT := 0;
  v_fosters INT := 0;
  v_tnr INT := 0;
  v_mortality INT := 0;
  v_returns INT := 0;
  v_transfers INT := 0;
  v_errors INT := 0;
  v_event_type TEXT;
  v_subtype TEXT;
  v_cat_id UUID;
  v_person_id UUID;
  v_shelterluv_animal_id TEXT;
  v_person_email TEXT;
BEGIN
  FOR v_record IN
    SELECT sr.id, sr.payload, sr.source_row_id
    FROM ops.staged_records sr
    WHERE sr.source_system = 'shelterluv'
      AND sr.source_table = 'events'
      AND sr.is_processed = FALSE
      AND sr.payload->>'Type' LIKE 'Outcome.%'
    ORDER BY sr.created_at ASC
    LIMIT p_batch_size
  LOOP
    v_processed := v_processed + 1;

    BEGIN
      v_event_type := v_record.payload->>'Type';
      v_subtype := v_record.payload->>'Subtype';
      v_shelterluv_animal_id := v_record.payload->>'AssociatedRecords.Animal.Internal-ID';
      v_person_email := NULLIF(TRIM(v_record.payload->>'Person.Email'), '');

      -- Find cat by ShelterLuv ID
      IF v_shelterluv_animal_id IS NOT NULL THEN
        SELECT ci.cat_id INTO v_cat_id
        FROM sot.cat_identifiers ci
        WHERE ci.id_type = 'shelterluv_id'
          AND ci.id_value = v_shelterluv_animal_id;
      END IF;

      -- Find person by email
      IF v_person_email IS NOT NULL THEN
        SELECT pi.person_id INTO v_person_id
        FROM sot.person_identifiers pi
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = LOWER(TRIM(v_person_email))
          AND pi.confidence >= 0.5;
      END IF;

      -- Process based on event type
      CASE v_event_type
        WHEN 'Outcome.Adoption' THEN
          IF v_cat_id IS NOT NULL AND v_person_id IS NOT NULL THEN
            INSERT INTO sot.person_cat (
              person_id, cat_id, relationship_type, source_system, source_record_id
            ) VALUES (
              v_person_id, v_cat_id, 'adopter', 'shelterluv', v_record.source_row_id
            ) ON CONFLICT DO NOTHING;
            v_adoptions := v_adoptions + 1;
          END IF;

        WHEN 'Outcome.Foster' THEN
          IF v_cat_id IS NOT NULL AND v_person_id IS NOT NULL THEN
            INSERT INTO sot.person_cat (
              person_id, cat_id, relationship_type, source_system, source_record_id
            ) VALUES (
              v_person_id, v_cat_id, 'foster', 'shelterluv', v_record.source_row_id
            ) ON CONFLICT DO NOTHING;
            v_fosters := v_fosters + 1;
          END IF;

        WHEN 'Outcome.ReturnToField' THEN
          v_tnr := v_tnr + 1;
          -- TNR release tracked via cat status

        WHEN 'Outcome.Died', 'Outcome.Euthanasia' THEN
          IF v_cat_id IS NOT NULL THEN
            -- Record mortality event
            INSERT INTO sot.cat_mortality_events (
              cat_id, mortality_type, event_date, source_system, source_record_id
            ) VALUES (
              v_cat_id,
              CASE v_event_type
                WHEN 'Outcome.Died' THEN 'natural'
                ELSE 'euthanasia'
              END,
              COALESCE(
                (v_record.payload->>'Time')::timestamptz,
                NOW()
              )::date,
              'shelterluv',
              v_record.source_row_id
            ) ON CONFLICT DO NOTHING;
            v_mortality := v_mortality + 1;
          END IF;

        WHEN 'Outcome.ReturnToOwner' THEN
          v_returns := v_returns + 1;

        WHEN 'Outcome.Transfer' THEN
          v_transfers := v_transfers + 1;

        ELSE
          -- Other outcome types
          NULL;
      END CASE;

      -- Mark as processed
      UPDATE ops.staged_records
      SET is_processed = TRUE,
          processor_name = 'process_shelterluv_events',
          resulting_entity_type = CASE WHEN v_cat_id IS NOT NULL THEN 'cat' ELSE NULL END,
          resulting_entity_id = v_cat_id
      WHERE id = v_record.id;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      UPDATE ops.staged_records
      SET is_processed = TRUE,
          processor_name = 'process_shelterluv_events',
          processing_error = SQLERRM
      WHERE id = v_record.id;
    END;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_adoptions, v_fosters, v_tnr, v_mortality, v_returns, v_transfers, v_errors;
END;
$$;

-- ============================================================================
-- 7. Create ops.process_shelterluv_intake_events function
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.process_shelterluv_intake_events(p_batch_size INTEGER DEFAULT 500)
RETURNS TABLE(
  events_processed INTEGER,
  intake_created INTEGER,
  animals_matched INTEGER,
  animals_unmatched INTEGER,
  owner_surrenders_linked INTEGER,
  errors INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_record RECORD;
  v_processed INT := 0;
  v_intake INT := 0;
  v_matched INT := 0;
  v_unmatched INT := 0;
  v_owner_surrenders INT := 0;
  v_errors INT := 0;
  v_cat_id UUID;
  v_person_id UUID;
  v_shelterluv_animal_id TEXT;
  v_person_email TEXT;
  v_intake_type TEXT;
BEGIN
  FOR v_record IN
    SELECT sr.id, sr.payload, sr.source_row_id
    FROM ops.staged_records sr
    WHERE sr.source_system = 'shelterluv'
      AND sr.source_table = 'events'
      AND sr.is_processed = FALSE
      AND sr.payload->>'Type' LIKE 'Intake.%'
    ORDER BY sr.created_at ASC
    LIMIT p_batch_size
  LOOP
    v_processed := v_processed + 1;

    BEGIN
      v_intake_type := v_record.payload->>'Type';
      v_shelterluv_animal_id := v_record.payload->>'AssociatedRecords.Animal.Internal-ID';
      v_person_email := NULLIF(TRIM(v_record.payload->>'Person.Email'), '');

      -- Find cat
      IF v_shelterluv_animal_id IS NOT NULL THEN
        SELECT ci.cat_id INTO v_cat_id
        FROM sot.cat_identifiers ci
        WHERE ci.id_type = 'shelterluv_id'
          AND ci.id_value = v_shelterluv_animal_id;
      END IF;

      IF v_cat_id IS NOT NULL THEN
        v_matched := v_matched + 1;

        -- Record intake event
        INSERT INTO sot.cat_intake_events (
          cat_id, intake_type, event_date, source_system, source_record_id
        ) VALUES (
          v_cat_id,
          CASE v_intake_type
            WHEN 'Intake.OwnerSurrender' THEN 'owner_surrender'
            WHEN 'Intake.Stray' THEN 'stray'
            WHEN 'Intake.FeralWildlife' THEN 'feral'
            WHEN 'Intake.Transfer' THEN 'transfer'
            ELSE 'other'
          END,
          COALESCE(
            (v_record.payload->>'Time')::timestamptz,
            NOW()
          )::date,
          'shelterluv',
          v_record.source_row_id
        ) ON CONFLICT DO NOTHING;
        v_intake := v_intake + 1;

        -- Handle owner surrender
        IF v_intake_type = 'Intake.OwnerSurrender' AND v_person_email IS NOT NULL THEN
          SELECT pi.person_id INTO v_person_id
          FROM sot.person_identifiers pi
          WHERE pi.id_type = 'email'
            AND pi.id_value_norm = LOWER(TRIM(v_person_email))
            AND pi.confidence >= 0.5;

          IF v_person_id IS NOT NULL THEN
            INSERT INTO sot.person_cat (
              person_id, cat_id, relationship_type, source_system, source_record_id
            ) VALUES (
              v_person_id, v_cat_id, 'owner', 'shelterluv', v_record.source_row_id
            ) ON CONFLICT DO NOTHING;
            v_owner_surrenders := v_owner_surrenders + 1;
          END IF;
        END IF;
      ELSE
        v_unmatched := v_unmatched + 1;
      END IF;

      -- Mark as processed
      UPDATE ops.staged_records
      SET is_processed = TRUE,
          processor_name = 'process_shelterluv_intake_events',
          resulting_entity_type = CASE WHEN v_cat_id IS NOT NULL THEN 'cat' ELSE NULL END,
          resulting_entity_id = v_cat_id
      WHERE id = v_record.id;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      UPDATE ops.staged_records
      SET is_processed = TRUE,
          processor_name = 'process_shelterluv_intake_events',
          processing_error = SQLERRM
      WHERE id = v_record.id;
    END;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_intake, v_matched, v_unmatched, v_owner_surrenders, v_errors;
END;
$$;

-- ============================================================================
-- 8. Create missing event tables if they don't exist
-- ============================================================================
CREATE TABLE IF NOT EXISTS sot.cat_mortality_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cat_id UUID NOT NULL REFERENCES sot.cats(cat_id),
  mortality_type TEXT NOT NULL CHECK (mortality_type IN ('natural', 'euthanasia', 'trauma', 'unknown')),
  event_date DATE NOT NULL,
  cause TEXT,
  notes TEXT,
  source_system TEXT NOT NULL,
  source_record_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cat_mortality_unique
  ON sot.cat_mortality_events(cat_id, event_date, mortality_type);

CREATE TABLE IF NOT EXISTS sot.cat_intake_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cat_id UUID NOT NULL REFERENCES sot.cats(cat_id),
  intake_type TEXT NOT NULL CHECK (intake_type IN ('stray', 'feral', 'owner_surrender', 'transfer', 'return', 'other')),
  event_date DATE NOT NULL,
  notes TEXT,
  source_system TEXT NOT NULL,
  source_record_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cat_intake_unique
  ON sot.cat_intake_events(cat_id, event_date, source_record_id);

-- ============================================================================
-- Grant permissions
-- ============================================================================
GRANT ALL ON ops.staged_records TO postgres;
GRANT ALL ON sot.cat_mortality_events TO postgres;
GRANT ALL ON sot.cat_intake_events TO postgres;
GRANT EXECUTE ON FUNCTION source.update_shelterluv_sync_state(TEXT, BIGINT, INTEGER, INTEGER, TEXT) TO postgres;
GRANT EXECUTE ON FUNCTION ops.process_shelterluv_people_batch(INTEGER) TO postgres;
GRANT EXECUTE ON FUNCTION ops.process_shelterluv_animal(UUID) TO postgres;
GRANT EXECUTE ON FUNCTION ops.process_shelterluv_events(INTEGER) TO postgres;
GRANT EXECUTE ON FUNCTION ops.process_shelterluv_intake_events(INTEGER) TO postgres;

-- ============================================================================
-- Summary
-- ============================================================================
-- Created tables:
-- - ops.staged_records (staging for ShelterLuv processing)
-- - sot.cat_mortality_events (mortality tracking)
-- - sot.cat_intake_events (intake tracking)
--
-- Created views:
-- - ops.v_shelterluv_sync_status
--
-- Created functions:
-- - source.update_shelterluv_sync_state()
-- - ops.process_shelterluv_people_batch()
-- - ops.process_shelterluv_animal()
-- - ops.process_shelterluv_events()
-- - ops.process_shelterluv_intake_events()
