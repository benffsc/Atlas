-- MIG_621: ShelterLuv API Sync Infrastructure
--
-- Adds:
-- 1. shelterluv_sync_state table for incremental sync tracking
-- 2. Updates process_shelterluv_animal to record field sources
-- 3. process_shelterluv_events for mortality, TNR completion tracking
--
-- Supports 6-hourly automated sync via cron

\echo ''
\echo '========================================================'
\echo 'MIG_621: ShelterLuv API Sync Infrastructure'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Create sync state tracking table
-- ============================================================

\echo 'Creating shelterluv_sync_state table...'

CREATE TABLE IF NOT EXISTS trapper.shelterluv_sync_state (
  sync_type TEXT PRIMARY KEY,  -- 'animals', 'people', 'events'
  last_sync_timestamp BIGINT,  -- Unix timestamp for `after` param
  last_sync_at TIMESTAMPTZ,
  records_fetched INT DEFAULT 0,
  records_staged INT DEFAULT 0,
  records_processed INT DEFAULT 0,
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.shelterluv_sync_state IS
'Tracks incremental sync state for ShelterLuv API.
last_sync_timestamp is Unix epoch used for the "after" API parameter.';

-- Initialize sync types
INSERT INTO trapper.shelterluv_sync_state (sync_type, last_sync_timestamp)
VALUES
  ('animals', NULL),
  ('people', NULL),
  ('events', NULL)
ON CONFLICT (sync_type) DO NOTHING;

-- ============================================================
-- PART 2: Update process_shelterluv_animal to record field sources
-- ============================================================

\echo 'Updating process_shelterluv_animal to record field sources...'

CREATE OR REPLACE FUNCTION trapper.process_shelterluv_animal(p_staged_record_id UUID)
RETURNS JSONB AS $$
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
  v_hold_reason TEXT;
  v_hold_for TEXT;
  v_foster_person_id UUID;
  v_is_foster BOOLEAN := false;
  v_fields_recorded INT := 0;
  v_shelterluv_id TEXT;
BEGIN
  -- Get the staged record
  SELECT * INTO v_record
  FROM trapper.staged_records
  WHERE id = p_staged_record_id;

  IF v_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Staged record not found');
  END IF;

  -- Extract cat fields
  v_microchip := COALESCE(
    v_record.payload->>'Microchip Number',
    v_record.payload->>'Microchip'
  );

  -- Handle scientific notation in microchip
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
    WHEN (v_record.payload->>'Altered')::boolean = true THEN 'altered'
    WHEN (v_record.payload->>'Altered')::boolean = false THEN 'intact'
    ELSE NULL
  END;
  v_status := v_record.payload->>'Status';
  v_hold_reason := v_record.payload->>'Hold Reason';
  v_hold_for := v_record.payload->>'Hold For';
  v_shelterluv_id := v_record.payload->>'Internal-ID';

  -- Detect foster from status/hold fields
  v_is_foster := (
    v_status ILIKE '%foster%'
    OR v_hold_reason ILIKE '%foster%'
    OR v_hold_for IS NOT NULL AND v_hold_for != ''
  );

  -- Find or create cat by microchip
  IF v_microchip IS NOT NULL AND LENGTH(v_microchip) >= 9 THEN
    v_cat_id := trapper.find_or_create_cat_by_microchip(
      p_microchip := v_microchip,
      p_name := v_animal_name,
      p_sex := v_sex,
      p_breed := v_breed,
      p_altered_status := v_altered_status,
      p_primary_color := v_primary_color,
      p_secondary_color := v_secondary_color,
      p_source_system := 'shelterluv'
    );

    -- Add ShelterLuv ID as identifier if available
    IF v_shelterluv_id IS NOT NULL THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system)
      VALUES (v_cat_id, 'shelterluv_id', v_shelterluv_id, 'shelterluv')
      ON CONFLICT (cat_id, id_type, id_value) DO NOTHING;
    END IF;

    -- Record field sources for multi-source transparency (MIG_620)
    v_fields_recorded := trapper.record_cat_field_sources_batch(
      p_cat_id := v_cat_id,
      p_source_system := 'shelterluv',
      p_source_record_id := v_shelterluv_id,
      p_name := v_animal_name,
      p_breed := v_breed,
      p_sex := v_sex,
      p_primary_color := v_primary_color,
      p_secondary_color := v_secondary_color,
      p_altered_status := v_altered_status
    );

  ELSE
    -- No microchip - try to find by ShelterLuv ID
    IF v_shelterluv_id IS NOT NULL THEN
      SELECT ci.cat_id INTO v_cat_id
      FROM trapper.cat_identifiers ci
      WHERE ci.id_type = 'shelterluv_id'
        AND ci.id_value = v_shelterluv_id;
    END IF;
  END IF;

  -- Process foster relationship if detected
  IF v_is_foster AND v_hold_for IS NOT NULL THEN
    -- Look for the foster person by name similarity
    SELECT person_id INTO v_foster_person_id
    FROM trapper.sot_people
    WHERE merged_into_person_id IS NULL
      AND (
        display_name ILIKE '%' || v_hold_for || '%'
        OR display_name ILIKE v_hold_for || '%'
      )
    LIMIT 1;

    -- If found, create foster role and relationship
    IF v_foster_person_id IS NOT NULL AND v_cat_id IS NOT NULL THEN
      -- Assign foster role
      PERFORM trapper.assign_person_role(v_foster_person_id, 'foster', 'shelterluv');

      -- Create fosterer relationship to cat
      INSERT INTO trapper.person_cat_relationships (
        person_id, cat_id, relationship_type, confidence,
        source_system, source_table
      ) VALUES (
        v_foster_person_id, v_cat_id, 'fosterer', 'medium',
        'shelterluv', 'animals'
      ) ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table) DO NOTHING;
    END IF;
  END IF;

  -- Mark as processed
  UPDATE trapper.staged_records
  SET is_processed = true,
      processed_at = NOW(),
      processor_name = 'process_shelterluv_animal',
      resulting_entity_type = CASE WHEN v_cat_id IS NOT NULL THEN 'cat' ELSE NULL END,
      resulting_entity_id = v_cat_id
  WHERE id = p_staged_record_id;

  RETURN jsonb_build_object(
    'success', true,
    'cat_id', v_cat_id,
    'is_foster', v_is_foster,
    'foster_person_id', v_foster_person_id,
    'fields_recorded', v_fields_recorded
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_shelterluv_animal IS
'Unified Data Engine processor for ShelterLuv animal records.
Creates cats via microchip, detects foster status, creates foster relationships.
Now records field sources for multi-source transparency (MIG_620).';

-- ============================================================
-- PART 3: Create process_shelterluv_events for mortality/TNR
-- ============================================================

\echo 'Creating process_shelterluv_events function...'

CREATE OR REPLACE FUNCTION trapper.process_shelterluv_events(
  p_batch_size INT DEFAULT 500
)
RETURNS TABLE (
  events_processed INT,
  euthanasia_events INT,
  tnr_releases INT,
  transfers INT,
  intakes INT,
  errors INT
) AS $$
DECLARE
  v_rec RECORD;
  v_cat_id UUID;
  v_event_type TEXT;
  v_outcome_type TEXT;
  v_outcome_subtype TEXT;
  v_processed INT := 0;
  v_euthanasia INT := 0;
  v_tnr INT := 0;
  v_transfers INT := 0;
  v_intakes INT := 0;
  v_errors INT := 0;
  v_microchip TEXT;
  v_mortality_result RECORD;
BEGIN
  -- Process unprocessed event records
  FOR v_rec IN
    SELECT
      sr.id AS staged_record_id,
      sr.payload,
      sr.source_row_id
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'shelterluv'
      AND sr.source_table = 'events'
      AND sr.is_processed = false
    ORDER BY (sr.payload->>'Time')::BIGINT ASC NULLS LAST
    LIMIT p_batch_size
  LOOP
    BEGIN
      v_processed := v_processed + 1;

      -- Extract event info
      v_event_type := v_rec.payload->>'Type';
      v_outcome_type := SPLIT_PART(v_event_type, '.', 1);
      v_outcome_subtype := SPLIT_PART(v_event_type, '.', 2);

      -- Get microchip
      v_microchip := v_rec.payload->>'Microchip';
      IF v_microchip ~ '^[0-9.]+E\+[0-9]+$' THEN
        v_microchip := TRIM(TO_CHAR(v_microchip::NUMERIC, '999999999999999'));
      END IF;

      -- Find cat by microchip or ShelterLuv ID
      IF v_microchip IS NOT NULL AND LENGTH(v_microchip) >= 9 THEN
        SELECT ci.cat_id INTO v_cat_id
        FROM trapper.cat_identifiers ci
        WHERE ci.id_type = 'microchip' AND ci.id_value = v_microchip;
      END IF;

      IF v_cat_id IS NULL AND v_rec.payload->>'AnimalID' IS NOT NULL THEN
        SELECT ci.cat_id INTO v_cat_id
        FROM trapper.cat_identifiers ci
        WHERE ci.id_type = 'shelterluv_id'
          AND ci.id_value = v_rec.payload->>'AnimalID';
      END IF;

      -- Process based on event type
      CASE v_outcome_subtype

        -- EUTHANASIA → Create mortality event
        WHEN 'Euthanasia' THEN
          IF v_cat_id IS NOT NULL THEN
            SELECT * INTO v_mortality_result
            FROM trapper.register_mortality_event(
              p_cat_id := v_cat_id,
              p_death_date := to_timestamp((v_rec.payload->>'Time')::BIGINT)::DATE,
              p_death_date_precision := 'exact',
              p_death_cause := 'euthanasia',
              p_death_cause_notes := COALESCE(v_rec.payload->>'Reason', v_rec.payload->>'Notes'),
              p_source_system := 'shelterluv',
              p_source_record_id := v_rec.source_row_id
            );

            IF v_mortality_result.success THEN
              v_euthanasia := v_euthanasia + 1;
            END IF;
          END IF;

        -- FERAL/WILDLIFE RELEASE → TNR completion
        WHEN 'FeralWildlife' THEN
          IF v_cat_id IS NOT NULL THEN
            -- Check if it's a "Released to Feral Colony" subtype
            IF v_rec.payload->>'Outcome Subtype' ILIKE '%released%' OR
               v_rec.payload->>'Outcome Subtype' ILIKE '%colony%' THEN
              -- Mark cat as released/TNR complete
              UPDATE trapper.sot_cats
              SET tnr_complete = true,
                  tnr_complete_date = to_timestamp((v_rec.payload->>'Time')::BIGINT)::DATE,
                  updated_at = NOW()
              WHERE cat_id = v_cat_id;

              v_tnr := v_tnr + 1;
            END IF;
          END IF;

        -- TRANSFER → Track for partner reporting
        WHEN 'Transfer' THEN
          -- Log transfer (could be expanded to create partner org relationships)
          v_transfers := v_transfers + 1;

        -- INTAKE → Enrich-only mode
        ELSE
          IF v_outcome_type = 'Intake' THEN
            v_intakes := v_intakes + 1;
            -- Intake events are handled by process_shelterluv_animal
            -- No additional processing needed here
          END IF;

      END CASE;

      -- Mark as processed
      UPDATE trapper.staged_records
      SET is_processed = true,
          processed_at = NOW(),
          processor_name = 'process_shelterluv_events',
          resulting_entity_type = CASE WHEN v_cat_id IS NOT NULL THEN 'cat' ELSE NULL END,
          resulting_entity_id = v_cat_id
      WHERE id = v_rec.staged_record_id;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE NOTICE 'Error processing event %: %', v_rec.source_row_id, SQLERRM;

      -- Mark as processed with error
      UPDATE trapper.staged_records
      SET is_processed = true,
          processed_at = NOW(),
          processor_name = 'process_shelterluv_events',
          error_message = SQLERRM
      WHERE id = v_rec.staged_record_id;
    END;
  END LOOP;

  RETURN QUERY SELECT
    v_processed,
    v_euthanasia,
    v_tnr,
    v_transfers,
    v_intakes,
    v_errors;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_shelterluv_events IS
'Processes ShelterLuv event records for:
- Euthanasia → cat_mortality_events
- FeralWildlife releases → TNR completion tracking
- Transfers → partner org reporting (future)
- Intakes → handled by process_shelterluv_animal';

-- ============================================================
-- PART 4: Helper functions for sync state management
-- ============================================================

\echo 'Creating sync state helper functions...'

CREATE OR REPLACE FUNCTION trapper.update_shelterluv_sync_state(
  p_sync_type TEXT,
  p_last_timestamp BIGINT,
  p_fetched INT DEFAULT 0,
  p_staged INT DEFAULT 0,
  p_processed INT DEFAULT 0,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE trapper.shelterluv_sync_state
  SET
    last_sync_timestamp = COALESCE(p_last_timestamp, last_sync_timestamp),
    last_sync_at = NOW(),
    records_fetched = records_fetched + COALESCE(p_fetched, 0),
    records_staged = records_staged + COALESCE(p_staged, 0),
    records_processed = records_processed + COALESCE(p_processed, 0),
    last_error = CASE WHEN p_error IS NOT NULL THEN p_error ELSE last_error END,
    last_error_at = CASE WHEN p_error IS NOT NULL THEN NOW() ELSE last_error_at END,
    updated_at = NOW()
  WHERE sync_type = p_sync_type;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trapper.get_shelterluv_sync_state(p_sync_type TEXT)
RETURNS TABLE (
  sync_type TEXT,
  last_sync_timestamp BIGINT,
  last_sync_at TIMESTAMPTZ,
  records_fetched INT,
  records_staged INT,
  records_processed INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.sync_type,
    s.last_sync_timestamp,
    s.last_sync_at,
    s.records_fetched,
    s.records_staged,
    s.records_processed
  FROM trapper.shelterluv_sync_state s
  WHERE s.sync_type = p_sync_type;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PART 5: Add tnr_complete fields to sot_cats if not exists
-- ============================================================

\echo 'Adding TNR completion tracking to sot_cats...'

ALTER TABLE trapper.sot_cats
ADD COLUMN IF NOT EXISTS tnr_complete BOOLEAN DEFAULT FALSE;

ALTER TABLE trapper.sot_cats
ADD COLUMN IF NOT EXISTS tnr_complete_date DATE;

COMMENT ON COLUMN trapper.sot_cats.tnr_complete IS
'TRUE if cat has completed TNR process and been released.
Set automatically from ShelterLuv FeralWildlife release events.';

-- ============================================================
-- PART 6: Create sync status view
-- ============================================================

\echo 'Creating v_shelterluv_sync_status view...'

CREATE OR REPLACE VIEW trapper.v_shelterluv_sync_status AS
SELECT
  s.sync_type,
  s.last_sync_at,
  s.last_sync_timestamp AS last_record_time,
  s.records_fetched,
  s.records_staged,
  s.records_processed,
  s.records_fetched AS records_synced,  -- Alias for backwards compatibility
  s.records_fetched AS last_batch_size,
  s.last_error,
  s.last_error_at,
  -- Count of unprocessed records for this type
  COALESCE(
    (SELECT COUNT(*)
     FROM trapper.staged_records sr
     WHERE sr.source_system = 'shelterluv'
       AND sr.source_table = s.sync_type
       AND sr.is_processed IS NOT TRUE),
    0
  )::INT AS pending_processing,
  CASE
    WHEN s.last_sync_at IS NULL THEN 'never_synced'
    WHEN s.last_sync_at > NOW() - INTERVAL '7 hours' THEN 'recent'
    WHEN s.last_sync_at > NOW() - INTERVAL '1 day' THEN 'stale'
    ELSE 'very_stale'
  END AS sync_health,
  EXTRACT(EPOCH FROM (NOW() - s.last_sync_at)) / 3600 AS hours_since_sync
FROM trapper.shelterluv_sync_state s;

COMMENT ON VIEW trapper.v_shelterluv_sync_status IS
'Shows current sync status for each ShelterLuv data type.
sync_health: recent (< 7hrs), stale (< 1 day), very_stale (> 1 day)';

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Verification:'

SELECT 'shelterluv_sync_state table' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'trapper' AND tablename = 'shelterluv_sync_state')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'process_shelterluv_events function' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'process_shelterluv_events')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'update_shelterluv_sync_state function' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_shelterluv_sync_state')
            THEN 'OK' ELSE 'MISSING' END AS status;

\echo ''
\echo 'Current sync state:'
SELECT sync_type, last_sync_timestamp, last_sync_at, records_fetched, records_staged
FROM trapper.shelterluv_sync_state;

\echo ''
\echo '========================================================'
\echo 'MIG_621 Complete!'
\echo '========================================================'
\echo ''
\echo 'New capabilities:'
\echo '  1. shelterluv_sync_state table for incremental sync tracking'
\echo '  2. process_shelterluv_animal now records field sources (MIG_620)'
\echo '  3. process_shelterluv_events for mortality + TNR tracking'
\echo '  4. TNR completion fields on sot_cats'
\echo ''
\echo 'Sync state functions:'
\echo '  - update_shelterluv_sync_state(type, timestamp, fetched, staged, processed, error)'
\echo '  - get_shelterluv_sync_state(type)'
\echo ''
\echo 'Process functions:'
\echo '  - process_shelterluv_animal(staged_record_id) - now with field sources'
\echo '  - process_shelterluv_events(batch_size) - mortality, TNR releases'
\echo ''
