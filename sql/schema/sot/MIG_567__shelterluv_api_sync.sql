\echo ''
\echo '=============================================='
\echo 'MIG_567: ShelterLuv API Sync Infrastructure'
\echo '=============================================='
\echo ''
\echo 'Creates sync state tracking for incremental API sync'
\echo 'and event processing functions.'
\echo ''

BEGIN;

-- ============================================================================
-- PART 1: Sync State Table
-- ============================================================================

\echo 'Creating shelterluv_sync_state table...'

CREATE TABLE IF NOT EXISTS trapper.shelterluv_sync_state (
  sync_type TEXT PRIMARY KEY,  -- 'animals', 'people', 'events'
  last_sync_timestamp BIGINT,  -- Unix timestamp for API 'after' param
  last_sync_at TIMESTAMPTZ,
  records_synced INT DEFAULT 0,
  total_records INT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE trapper.shelterluv_sync_state IS
'Tracks incremental sync state for ShelterLuv API.
last_sync_timestamp is used as the "after" parameter in API calls.';

-- Initialize sync types
INSERT INTO trapper.shelterluv_sync_state (sync_type)
VALUES ('animals'), ('people'), ('events')
ON CONFLICT (sync_type) DO NOTHING;

-- ============================================================================
-- PART 2: Update sync state function
-- ============================================================================

\echo 'Creating update_shelterluv_sync_state function...'

CREATE OR REPLACE FUNCTION trapper.update_shelterluv_sync_state(
  p_sync_type TEXT,
  p_last_timestamp BIGINT,
  p_records_synced INT,
  p_total_records INT DEFAULT NULL,
  p_error TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  UPDATE trapper.shelterluv_sync_state
  SET last_sync_timestamp = p_last_timestamp,
      last_sync_at = NOW(),
      records_synced = p_records_synced,
      total_records = COALESCE(p_total_records, total_records),
      error_message = p_error,
      updated_at = NOW()
  WHERE sync_type = p_sync_type;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PART 3: Process ShelterLuv Events Function
-- ============================================================================

\echo 'Creating process_shelterluv_events function...'

CREATE OR REPLACE FUNCTION trapper.process_shelterluv_events(
  p_batch_size INT DEFAULT 500
)
RETURNS TABLE (
  events_processed INT,
  adoptions_created INT,
  fosters_created INT,
  tnr_releases INT,
  mortality_events INT,
  errors INT
) AS $$
DECLARE
  v_rec RECORD;
  v_processed INT := 0;
  v_adoptions INT := 0;
  v_fosters INT := 0;
  v_tnr INT := 0;
  v_mortality INT := 0;
  v_errors INT := 0;
  v_event_type TEXT;
  v_event_subtype TEXT;
  v_animal_id TEXT;
  v_person_id_str TEXT;
  v_cat_id UUID;
  v_person_id UUID;
  v_event_time TIMESTAMPTZ;
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
      AND sr.is_processed IS NOT TRUE
      AND sr.payload->>'Type' LIKE 'Outcome.%'
    ORDER BY (sr.payload->>'Time')::BIGINT ASC
    LIMIT p_batch_size
  LOOP
    BEGIN
      v_processed := v_processed + 1;

      v_event_type := v_rec.payload->>'Type';
      v_event_subtype := v_rec.payload->>'Subtype';
      v_event_time := TO_TIMESTAMP((v_rec.payload->>'Time')::BIGINT);

      -- Extract animal and person IDs from AssociatedRecords
      SELECT r->>'Id' INTO v_animal_id
      FROM jsonb_array_elements(v_rec.payload->'AssociatedRecords') r
      WHERE r->>'Type' = 'Animal'
      LIMIT 1;

      SELECT r->>'Id' INTO v_person_id_str
      FROM jsonb_array_elements(v_rec.payload->'AssociatedRecords') r
      WHERE r->>'Type' = 'Person'
      LIMIT 1;

      -- Find cat by shelterluv internal ID
      IF v_animal_id IS NOT NULL THEN
        SELECT ci.cat_id INTO v_cat_id
        FROM trapper.cat_identifiers ci
        WHERE ci.id_type = 'shelterluv_id'
          AND ci.id_value = v_animal_id;
      END IF;

      -- Find person by shelterluv ID (from staged people records)
      IF v_person_id_str IS NOT NULL THEN
        SELECT p.person_id INTO v_person_id
        FROM trapper.sot_people p
        JOIN trapper.staged_records sr ON sr.resulting_entity_id = p.person_id
        WHERE sr.source_system = 'shelterluv'
          AND sr.source_table = 'people'
          AND sr.source_row_id = v_person_id_str
        LIMIT 1;
      END IF;

      -- Process based on event type
      CASE
        -- Adoption
        WHEN v_event_type = 'Outcome.Adoption' THEN
          IF v_cat_id IS NOT NULL AND v_person_id IS NOT NULL THEN
            INSERT INTO trapper.person_cat_relationships (
              person_id, cat_id, relationship_type, confidence,
              source_system, source_table, effective_date, context_notes
            ) VALUES (
              v_person_id, v_cat_id, 'adopter', 'high',
              'shelterluv', 'events', v_event_time::DATE,
              'Adoption: ' || COALESCE(v_event_subtype, 'standard')
            )
            ON CONFLICT (person_id, cat_id, relationship_type) DO UPDATE
            SET effective_date = LEAST(
              trapper.person_cat_relationships.effective_date,
              EXCLUDED.effective_date
            );

            v_adoptions := v_adoptions + 1;
          END IF;

        -- Foster placement
        WHEN v_event_type = 'Outcome.Foster' THEN
          IF v_cat_id IS NOT NULL AND v_person_id IS NOT NULL THEN
            INSERT INTO trapper.person_cat_relationships (
              person_id, cat_id, relationship_type, confidence,
              source_system, source_table, effective_date, context_notes
            ) VALUES (
              v_person_id, v_cat_id, 'foster', 'high',
              'shelterluv', 'events', v_event_time::DATE,
              'Foster placement'
            )
            ON CONFLICT (person_id, cat_id, relationship_type) DO UPDATE
            SET effective_date = LEAST(
              trapper.person_cat_relationships.effective_date,
              EXCLUDED.effective_date
            );

            v_fosters := v_fosters + 1;
          END IF;

        -- TNR Release (Feral Wildlife released to colony)
        WHEN v_event_type = 'Outcome.FeralWildlife' AND v_event_subtype = 'Released to Feral Colony' THEN
          IF v_cat_id IS NOT NULL THEN
            -- Mark cat as TNR complete
            UPDATE trapper.sot_cats
            SET altered_status = 'altered',
                notes = COALESCE(notes, '') || E'\n[ShelterLuv] Released to colony ' || v_event_time::DATE
            WHERE cat_id = v_cat_id
              AND (altered_status IS NULL OR altered_status = 'unknown');

            v_tnr := v_tnr + 1;
          END IF;

        -- Euthanasia
        WHEN v_event_type = 'Outcome.Euthanasia' THEN
          IF v_cat_id IS NOT NULL THEN
            -- Create mortality event
            INSERT INTO trapper.cat_mortality_events (
              cat_id, death_date, death_cause,
              source_system, source_record_id, notes
            ) VALUES (
              v_cat_id, v_event_time::DATE, 'euthanasia',
              'shelterluv', v_rec.source_row_id,
              'From ShelterLuv outcome event'
            )
            ON CONFLICT DO NOTHING;

            -- Update cat record
            UPDATE trapper.sot_cats
            SET is_deceased = TRUE,
                deceased_date = COALESCE(deceased_date, v_event_time::DATE)
            WHERE cat_id = v_cat_id;

            v_mortality := v_mortality + 1;
          END IF;

        -- Unassisted death in custody
        WHEN v_event_type = 'Outcome.UnassistedDeathInCustody' THEN
          IF v_cat_id IS NOT NULL THEN
            INSERT INTO trapper.cat_mortality_events (
              cat_id, death_date, death_cause,
              source_system, source_record_id, notes
            ) VALUES (
              v_cat_id, v_event_time::DATE, 'natural',
              'shelterluv', v_rec.source_row_id,
              'Died in care (from ShelterLuv)'
            )
            ON CONFLICT DO NOTHING;

            UPDATE trapper.sot_cats
            SET is_deceased = TRUE,
                deceased_date = COALESCE(deceased_date, v_event_time::DATE)
            WHERE cat_id = v_cat_id;

            v_mortality := v_mortality + 1;
          END IF;

        ELSE
          -- Other event types - just mark as processed
          NULL;
      END CASE;

      -- Mark staged record as processed
      UPDATE trapper.staged_records
      SET is_processed = TRUE,
          processor_name = 'process_shelterluv_events',
          resulting_entity_type = CASE
            WHEN v_event_type LIKE 'Outcome.Adoption%' THEN 'relationship'
            WHEN v_event_type LIKE 'Outcome.Foster%' THEN 'relationship'
            WHEN v_event_type LIKE 'Outcome.Euthanasia%' THEN 'mortality_event'
            ELSE 'event'
          END
      WHERE id = v_rec.staged_record_id;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;

      UPDATE trapper.staged_records
      SET processing_error = SQLERRM
      WHERE id = v_rec.staged_record_id;
    END;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_adoptions, v_fosters, v_tnr, v_mortality, v_errors;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_shelterluv_events IS
'Processes ShelterLuv event records (adoptions, fosters, TNR releases, mortality).
Creates person-cat relationships and mortality events.';

-- ============================================================================
-- PART 4: View for sync status
-- ============================================================================

\echo 'Creating v_shelterluv_sync_status view...'

CREATE OR REPLACE VIEW trapper.v_shelterluv_sync_status AS
SELECT
  ss.sync_type,
  ss.last_sync_at,
  TO_TIMESTAMP(ss.last_sync_timestamp) AS last_record_time,
  ss.records_synced AS last_batch_size,
  ss.total_records,
  ss.error_message,
  (
    SELECT COUNT(*)
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'shelterluv'
      AND sr.source_table = ss.sync_type
      AND sr.is_processed IS NOT TRUE
  ) AS pending_processing,
  CASE
    WHEN ss.last_sync_at IS NULL THEN 'never'
    WHEN ss.last_sync_at > NOW() - INTERVAL '1 day' THEN 'recent'
    WHEN ss.last_sync_at > NOW() - INTERVAL '7 days' THEN 'stale'
    ELSE 'very_stale'
  END AS sync_health
FROM trapper.shelterluv_sync_state ss
ORDER BY ss.sync_type;

COMMENT ON VIEW trapper.v_shelterluv_sync_status IS
'Dashboard view showing ShelterLuv sync health and pending records.';

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo 'Verifying objects created...'

SELECT 'shelterluv_sync_state' as object, 'table' as type,
  EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'trapper' AND table_name = 'shelterluv_sync_state') as exists;

SELECT proname as function_name
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'trapper'
  AND p.proname IN ('update_shelterluv_sync_state', 'process_shelterluv_events');

\echo ''
\echo '=============================================='
\echo 'MIG_567 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - shelterluv_sync_state table'
\echo '  - update_shelterluv_sync_state() function'
\echo '  - process_shelterluv_events() function'
\echo '  - v_shelterluv_sync_status view'
\echo ''
