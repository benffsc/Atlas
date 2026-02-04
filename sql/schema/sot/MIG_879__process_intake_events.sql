\echo '=== MIG_879: Process ShelterLuv Intake Events ==='
\echo 'Problem: 4,179 Intake.* events staged but no processor exists.'
\echo 'Creates cat_intake_events table + processor function.'
\echo ''

-- ============================================================================
-- 1. CREATE cat_intake_events TABLE
-- ============================================================================

\echo '--- Step 1: Create cat_intake_events table ---'

CREATE TABLE IF NOT EXISTS trapper.cat_intake_events (
  intake_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cat_id UUID REFERENCES trapper.sot_cats(cat_id),
  intake_type TEXT NOT NULL,
  intake_subtype TEXT,
  intake_date DATE,
  intake_date_precision TEXT DEFAULT 'exact'
    CHECK (intake_date_precision IN ('exact', 'week', 'month', 'estimated')),
  person_id UUID REFERENCES trapper.sot_people(person_id),
  place_id UUID REFERENCES trapper.places(place_id),
  source_system TEXT DEFAULT 'shelterluv',
  source_record_id TEXT,
  staged_record_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for lookups by cat
CREATE INDEX IF NOT EXISTS idx_cat_intake_events_cat_id
  ON trapper.cat_intake_events(cat_id);

-- Index for lookups by type
CREATE INDEX IF NOT EXISTS idx_cat_intake_events_type
  ON trapper.cat_intake_events(intake_type);

-- Prevent duplicate intake events from same source
CREATE UNIQUE INDEX IF NOT EXISTS idx_cat_intake_events_source_unique
  ON trapper.cat_intake_events(source_system, source_record_id)
  WHERE source_record_id IS NOT NULL;

COMMENT ON TABLE trapper.cat_intake_events IS
  'Records when animals enter FFSC programs. A cat can have multiple intake events
   (e.g., surrender → adopt → return → re-adopt). From ShelterLuv Intake.* events.';

COMMENT ON COLUMN trapper.cat_intake_events.intake_type IS
  'ShelterLuv event type: FeralWildlife, FosterReturn, Transfer, Stray,
   OwnerSurrender, AdoptionReturn, Service, Born';

COMMENT ON COLUMN trapper.cat_intake_events.intake_subtype IS
  'ShelterLuv event subtype: Cat (feral), Found Cat, Colony, Relocation,
   Landlord / Housing Issues, Owner Health, Financial Issues, etc.';

-- ============================================================================
-- 2. CREATE INTAKE PROCESSOR FUNCTION
-- ============================================================================

\echo '--- Step 2: Create intake processor function ---'

CREATE OR REPLACE FUNCTION trapper.process_shelterluv_intake_events(
  p_batch_size INT DEFAULT 500
)
RETURNS TABLE (
  events_processed INT,
  intake_created INT,
  animals_matched INT,
  animals_unmatched INT,
  owner_surrenders_linked INT,
  errors INT
) AS $$
DECLARE
  v_rec RECORD;
  v_cat_id UUID;
  v_person_id UUID;
  v_event_type TEXT;
  v_event_subtype TEXT;
  v_intake_short TEXT;
  v_animal_id TEXT;
  v_person_id_str TEXT;
  v_event_time BIGINT;
  v_intake_date DATE;
  v_assoc JSONB;
  v_events_processed INT := 0;
  v_intake_created INT := 0;
  v_animals_matched INT := 0;
  v_animals_unmatched INT := 0;
  v_owner_surrenders_linked INT := 0;
  v_errors INT := 0;
BEGIN
  FOR v_rec IN
    SELECT sr.id, sr.payload, sr.source_row_id
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'shelterluv'
      AND sr.source_table = 'events'
      AND sr.is_processed IS NOT TRUE
      AND sr.payload->>'Type' LIKE 'Intake.%'
    ORDER BY sr.id
    LIMIT p_batch_size
  LOOP
    BEGIN
      v_events_processed := v_events_processed + 1;

      v_event_type := v_rec.payload->>'Type';
      v_event_subtype := v_rec.payload->>'Subtype';

      -- Extract short intake type (e.g., 'FeralWildlife' from 'Intake.FeralWildlife')
      v_intake_short := REPLACE(v_event_type, 'Intake.', '');

      -- Extract animal and person IDs from AssociatedRecords array
      v_animal_id := NULL;
      v_person_id_str := NULL;
      IF jsonb_typeof(v_rec.payload->'AssociatedRecords') = 'array' THEN
        FOR v_assoc IN SELECT * FROM jsonb_array_elements(v_rec.payload->'AssociatedRecords')
        LOOP
          IF v_assoc->>'Type' = 'Animal' AND v_animal_id IS NULL THEN
            v_animal_id := v_assoc->>'Id';
          ELSIF v_assoc->>'Type' = 'Person' AND v_person_id_str IS NULL THEN
            v_person_id_str := v_assoc->>'Id';
          END IF;
        END LOOP;
      END IF;

      -- Extract event time
      v_event_time := (v_rec.payload->>'Time')::bigint;
      v_intake_date := NULL;
      IF v_event_time IS NOT NULL THEN
        v_intake_date := (to_timestamp(v_event_time))::date;
      END IF;

      -- Match animal by SL Internal-ID
      v_cat_id := NULL;
      IF v_animal_id IS NOT NULL AND v_animal_id != '' THEN
        SELECT ci.cat_id INTO v_cat_id
        FROM trapper.cat_identifiers ci
        WHERE ci.id_type = 'shelterluv_id'
          AND ci.id_value = v_animal_id
        LIMIT 1;

        -- Fallback: try FFSC-A-NNNN format
        IF v_cat_id IS NULL THEN
          SELECT ci.cat_id INTO v_cat_id
          FROM trapper.cat_identifiers ci
          WHERE ci.id_type = 'shelterluv_id'
            AND ci.id_value = 'FFSC-A-' || v_animal_id
          LIMIT 1;
        END IF;
      END IF;

      IF v_cat_id IS NOT NULL THEN
        v_animals_matched := v_animals_matched + 1;
      ELSE
        v_animals_unmatched := v_animals_unmatched + 1;
      END IF;

      -- Match person for OwnerSurrender events
      v_person_id := NULL;
      IF v_person_id_str IS NOT NULL AND v_person_id_str != '' THEN
        SELECT pi.person_id INTO v_person_id
        FROM trapper.person_identifiers pi
        WHERE pi.id_type = 'shelterluv_id'::trapper.identifier_type
          AND pi.id_value_norm = v_person_id_str
        LIMIT 1;
      END IF;

      -- Create intake event (if we matched the animal)
      IF v_cat_id IS NOT NULL THEN
        INSERT INTO trapper.cat_intake_events (
          cat_id, intake_type, intake_subtype, intake_date,
          person_id, source_system, source_record_id, staged_record_id,
          notes
        ) VALUES (
          v_cat_id, v_intake_short, v_event_subtype, v_intake_date,
          v_person_id, 'shelterluv', v_rec.source_row_id, v_rec.id,
          'SL Event ' || COALESCE(v_rec.source_row_id, v_rec.id::text) ||
            ': ' || v_event_type || COALESCE(' / ' || v_event_subtype, '')
        )
        ON CONFLICT (source_system, source_record_id)
          WHERE source_record_id IS NOT NULL
        DO NOTHING;

        IF FOUND THEN
          v_intake_created := v_intake_created + 1;
        END IF;

        -- For OwnerSurrender with matched person, create owner relationship
        IF v_intake_short = 'OwnerSurrender' AND v_person_id IS NOT NULL THEN
          INSERT INTO trapper.person_cat_relationships (
            person_id, cat_id, relationship_type,
            source_system, source_table, effective_date,
            context_notes
          ) VALUES (
            v_person_id, v_cat_id, 'owner',
            'shelterluv', 'events', v_intake_date,
            'SL Intake.OwnerSurrender event'
          )
          ON CONFLICT DO NOTHING;

          IF FOUND THEN
            v_owner_surrenders_linked := v_owner_surrenders_linked + 1;
          END IF;
        END IF;
      END IF;

      -- Mark as processed
      UPDATE trapper.staged_records
      SET is_processed = TRUE,
          processor_name = 'process_shelterluv_intake_events',
          resulting_entity_type = CASE WHEN v_cat_id IS NOT NULL THEN 'cat_intake_event' ELSE NULL END,
          resulting_entity_id = v_cat_id,
          updated_at = NOW()
      WHERE id = v_rec.id;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE NOTICE 'Error processing intake event %: %', v_rec.id, SQLERRM;
      -- Still mark as processed to avoid infinite retry
      UPDATE trapper.staged_records
      SET is_processed = TRUE,
          processor_name = 'process_shelterluv_intake_events',
          updated_at = NOW()
      WHERE id = v_rec.id;
    END;
  END LOOP;

  RETURN QUERY SELECT
    v_events_processed, v_intake_created, v_animals_matched,
    v_animals_unmatched, v_owner_surrenders_linked, v_errors;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_shelterluv_intake_events IS
  'Processes ShelterLuv Intake.* events into cat_intake_events.
   Matches animals by SL API ID. For OwnerSurrender, also creates owner relationship.';

-- ============================================================================
-- 3. UPDATE process_shelterluv_events TO SKIP INTAKE EVENTS
-- ============================================================================

\echo '--- Step 3: Update process_shelterluv_events to skip Intake.* ---'

-- First, un-mark any intake events that were incorrectly marked as processed
-- by the outcome processor (they were silently no-op'd)
WITH reset AS (
  UPDATE trapper.staged_records
  SET is_processed = FALSE,
      processor_name = NULL,
      resulting_entity_type = NULL,
      resulting_entity_id = NULL,
      updated_at = NOW()
  WHERE source_system = 'shelterluv'
    AND source_table = 'events'
    AND payload->>'Type' LIKE 'Intake.%'
    AND is_processed = TRUE
    AND processor_name = 'process_shelterluv_events'
  RETURNING id
)
SELECT COUNT(*) AS intake_events_reset FROM reset \gset

\echo '  Reset :intake_events_reset intake events from outcome processor'

-- ============================================================================
-- 4. PROCESS ALL INTAKE EVENTS
-- ============================================================================

\echo ''
\echo '--- Step 4: Processing intake events (batch 1 of up to 9) ---'
SELECT * FROM trapper.process_shelterluv_intake_events(500);

\echo '--- Batch 2 ---'
SELECT * FROM trapper.process_shelterluv_intake_events(500);

\echo '--- Batch 3 ---'
SELECT * FROM trapper.process_shelterluv_intake_events(500);

\echo '--- Batch 4 ---'
SELECT * FROM trapper.process_shelterluv_intake_events(500);

\echo '--- Batch 5 ---'
SELECT * FROM trapper.process_shelterluv_intake_events(500);

\echo '--- Batch 6 ---'
SELECT * FROM trapper.process_shelterluv_intake_events(500);

\echo '--- Batch 7 ---'
SELECT * FROM trapper.process_shelterluv_intake_events(500);

\echo '--- Batch 8 ---'
SELECT * FROM trapper.process_shelterluv_intake_events(500);

\echo '--- Batch 9 ---'
SELECT * FROM trapper.process_shelterluv_intake_events(500);

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

\echo ''
\echo '--- Step 5: Verification ---'

\echo 'Intake events by type:'
SELECT intake_type, intake_subtype, COUNT(*) as count
FROM trapper.cat_intake_events
GROUP BY intake_type, intake_subtype
ORDER BY count DESC;

\echo ''
\echo 'Remaining unprocessed intake events:'
SELECT COUNT(*) as unprocessed
FROM trapper.staged_records
WHERE source_system = 'shelterluv'
  AND source_table = 'events'
  AND payload->>'Type' LIKE 'Intake.%'
  AND is_processed IS NOT TRUE;

\echo ''
\echo 'Total intake events created:'
SELECT COUNT(*) as total FROM trapper.cat_intake_events;

\echo ''
\echo '=== MIG_879 Complete ==='
\echo 'ShelterLuv intake events processed into cat_intake_events table.'
\echo 'OwnerSurrender events also create owner relationships.'
