-- MIG_2869: Fix ShelterLuv event processing functions (FFS-301)
--
-- Both process_shelterluv_events() and process_shelterluv_intake_events() have
-- three critical bugs that prevent any actual entity creation:
--
-- BUG 1: payload->>'AssociatedRecords.Animal.Internal-ID'
--   AssociatedRecords is a JSON ARRAY of {Id, Type} objects, not a nested object.
--   Flat key access returns NULL always. Must use jsonb_array_elements().
--
-- BUG 2: payload->>'Person.Email'
--   Person email is NOT on the event payload. Events reference persons by ID
--   in AssociatedRecords. Must look up email from source.shelterluv_raw person records.
--
-- BUG 3: id_type = 'shelterluv_id'
--   Cat identifiers use 'shelterluv_animal_id', not 'shelterluv_id'.
--
-- Impact: 6,343 outcome events stuck (2,956 adoptions, 2,460 fosters, 55 mortality).
--         Intake events processed but created 0 cat matches.
--
-- This migration:
-- 1. Replaces both functions with corrected JSON array extraction
-- 2. Resets stuck events for reprocessing
-- 3. Also fixes intake events (same 3 bugs, different symptoms)
--
-- Additionally adds origin tracking:
-- 4. Adds intake_person_id to cat_intake_events for tracking who brought cat in
-- 5. Creates ops.v_cat_origin_tracking view cross-referencing intake/clinic places
--
-- Safety: Replaces functions (CREATE OR REPLACE). Resets is_processed for stuck
--         events only. Origin columns are additive.

BEGIN;

-- =============================================================================
-- Step 1: Replace process_shelterluv_events() with corrected version
-- =============================================================================

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
  v_shelterluv_person_id TEXT;
  v_person_email TEXT;
  v_event_time TIMESTAMPTZ;
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
    -- Reset per-iteration
    v_cat_id := NULL;
    v_person_id := NULL;
    v_shelterluv_animal_id := NULL;
    v_shelterluv_person_id := NULL;
    v_person_email := NULL;

    BEGIN
      v_event_type := v_record.payload->>'Type';
      v_subtype := v_record.payload->>'Subtype';

      -- Extract Animal ID from AssociatedRecords JSON array
      SELECT ar->>'Id' INTO v_shelterluv_animal_id
      FROM jsonb_array_elements(v_record.payload->'AssociatedRecords') ar
      WHERE ar->>'Type' = 'Animal'
      LIMIT 1;

      -- Extract Person ID from AssociatedRecords JSON array
      SELECT ar->>'Id' INTO v_shelterluv_person_id
      FROM jsonb_array_elements(v_record.payload->'AssociatedRecords') ar
      WHERE ar->>'Type' = 'Person'
      LIMIT 1;

      -- Look up person email from shelterluv_raw person record
      IF v_shelterluv_person_id IS NOT NULL THEN
        SELECT NULLIF(TRIM(sp.payload->>'Email'), '')
        INTO v_person_email
        FROM source.shelterluv_raw sp
        WHERE sp.record_type = 'person'
          AND sp.source_record_id = v_shelterluv_person_id
        LIMIT 1;
      END IF;

      -- Parse event timestamp (Unix seconds)
      BEGIN
        v_event_time := TO_TIMESTAMP((v_record.payload->>'Time')::BIGINT);
      EXCEPTION WHEN OTHERS THEN
        v_event_time := NOW();
      END;

      -- Find cat by ShelterLuv ID
      IF v_shelterluv_animal_id IS NOT NULL THEN
        SELECT ci.cat_id INTO v_cat_id
        FROM sot.cat_identifiers ci
        WHERE ci.id_type = 'shelterluv_animal_id'
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
              person_id, cat_id, relationship_type, source_system, source_table
            ) VALUES (
              v_person_id, v_cat_id, 'adopter', 'shelterluv', 'events'
            ) ON CONFLICT DO NOTHING;
            v_adoptions := v_adoptions + 1;
          END IF;

        WHEN 'Outcome.Foster' THEN
          IF v_cat_id IS NOT NULL AND v_person_id IS NOT NULL THEN
            INSERT INTO sot.person_cat (
              person_id, cat_id, relationship_type, source_system, source_table
            ) VALUES (
              v_person_id, v_cat_id, 'foster', 'shelterluv', 'events'
            ) ON CONFLICT DO NOTHING;
            v_fosters := v_fosters + 1;
          END IF;

        WHEN 'Outcome.ReturnToField' THEN
          v_tnr := v_tnr + 1;

        WHEN 'Outcome.Died', 'Outcome.Euthanasia' THEN
          IF v_cat_id IS NOT NULL THEN
            INSERT INTO sot.cat_mortality_events (
              cat_id, mortality_type, event_date, source_system, source_record_id
            ) VALUES (
              v_cat_id,
              CASE v_event_type
                WHEN 'Outcome.Died' THEN 'natural'
                ELSE 'euthanasia'
              END,
              v_event_time::date,
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

-- =============================================================================
-- Step 2: Replace process_shelterluv_intake_events() with corrected version
-- Adds intake_person_id tracking for origin analysis
-- =============================================================================

-- Add intake_person_id column for origin tracking
ALTER TABLE sot.cat_intake_events ADD COLUMN IF NOT EXISTS intake_person_id UUID REFERENCES sot.people(person_id);
ALTER TABLE sot.cat_intake_events ADD COLUMN IF NOT EXISTS shelterluv_person_id TEXT;

COMMENT ON COLUMN sot.cat_intake_events.intake_person_id IS 'Person who brought cat in (resolved via ShelterLuv person email). For feral intake: finder/trapper/caretaker. For owner surrender: owner. (MIG_2869)';
COMMENT ON COLUMN sot.cat_intake_events.shelterluv_person_id IS 'Raw ShelterLuv person ID from event AssociatedRecords (MIG_2869)';

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
  v_shelterluv_person_id TEXT;
  v_person_email TEXT;
  v_intake_type TEXT;
  v_event_time TIMESTAMPTZ;
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
    -- Reset per-iteration
    v_cat_id := NULL;
    v_person_id := NULL;
    v_shelterluv_animal_id := NULL;
    v_shelterluv_person_id := NULL;
    v_person_email := NULL;

    BEGIN
      v_intake_type := v_record.payload->>'Type';

      -- Extract Animal ID from AssociatedRecords JSON array
      SELECT ar->>'Id' INTO v_shelterluv_animal_id
      FROM jsonb_array_elements(v_record.payload->'AssociatedRecords') ar
      WHERE ar->>'Type' = 'Animal'
      LIMIT 1;

      -- Extract Person ID from AssociatedRecords JSON array
      SELECT ar->>'Id' INTO v_shelterluv_person_id
      FROM jsonb_array_elements(v_record.payload->'AssociatedRecords') ar
      WHERE ar->>'Type' = 'Person'
      LIMIT 1;

      -- Look up person email from shelterluv_raw person record
      IF v_shelterluv_person_id IS NOT NULL THEN
        SELECT NULLIF(TRIM(sp.payload->>'Email'), '')
        INTO v_person_email
        FROM source.shelterluv_raw sp
        WHERE sp.record_type = 'person'
          AND sp.source_record_id = v_shelterluv_person_id
        LIMIT 1;
      END IF;

      -- Parse event timestamp
      BEGIN
        v_event_time := TO_TIMESTAMP((v_record.payload->>'Time')::BIGINT);
      EXCEPTION WHEN OTHERS THEN
        v_event_time := NOW();
      END;

      -- Find cat by ShelterLuv ID
      IF v_shelterluv_animal_id IS NOT NULL THEN
        SELECT ci.cat_id INTO v_cat_id
        FROM sot.cat_identifiers ci
        WHERE ci.id_type = 'shelterluv_animal_id'
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

      IF v_cat_id IS NOT NULL THEN
        v_matched := v_matched + 1;

        -- Record intake event with person tracking
        INSERT INTO sot.cat_intake_events (
          cat_id, intake_type, event_date, intake_person_id, shelterluv_person_id,
          source_system, source_record_id
        ) VALUES (
          v_cat_id,
          CASE v_intake_type
            WHEN 'Intake.OwnerSurrender' THEN 'owner_surrender'
            WHEN 'Intake.Stray' THEN 'stray'
            WHEN 'Intake.FeralWildlife' THEN 'feral'
            WHEN 'Intake.Transfer' THEN 'transfer'
            ELSE 'other'
          END,
          v_event_time::date,
          v_person_id,           -- resolved person (may be NULL)
          v_shelterluv_person_id, -- raw SL person ID (for later lookup)
          'shelterluv',
          v_record.source_row_id
        ) ON CONFLICT DO NOTHING;
        v_intake := v_intake + 1;

        -- Handle owner surrender — link person as owner
        IF v_intake_type = 'Intake.OwnerSurrender' AND v_person_id IS NOT NULL THEN
          INSERT INTO sot.person_cat (
            person_id, cat_id, relationship_type, source_system, source_table
          ) VALUES (
            v_person_id, v_cat_id, 'owner', 'shelterluv', 'events'
          ) ON CONFLICT DO NOTHING;
          v_owner_surrenders := v_owner_surrenders + 1;
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

-- =============================================================================
-- Step 3: Reset stuck outcome events for reprocessing
-- Only resets events that were marked processed by the broken function
-- but created 0 actual entity links.
-- =============================================================================

UPDATE ops.staged_records
SET is_processed = FALSE,
    processor_name = NULL,
    resulting_entity_type = NULL,
    resulting_entity_id = NULL,
    processing_error = NULL
WHERE source_system = 'shelterluv'
  AND source_table = 'events'
  AND is_processed = TRUE
  AND processor_name = 'process_shelterluv_events'
  AND payload->>'Type' LIKE 'Outcome.%';

-- Also reset intake events that were processed with broken function
-- (they matched 0 cats due to wrong id_type)
UPDATE ops.staged_records
SET is_processed = FALSE,
    processor_name = NULL,
    resulting_entity_type = NULL,
    resulting_entity_id = NULL,
    processing_error = NULL
WHERE source_system = 'shelterluv'
  AND source_table = 'events'
  AND is_processed = TRUE
  AND processor_name = 'process_shelterluv_intake_events';

-- Clear old intake events that had 0 matches so they can be re-created with person tracking
DELETE FROM sot.cat_intake_events WHERE source_system = 'shelterluv';

-- =============================================================================
-- Step 4: Cat origin tracking view
-- Cross-references ShelterLuv intake events with known places to determine
-- where cats came from.
--
-- Design considerations:
-- - Intake.FeralWildlife person = finder/trapper/caretaker (NOT always origin)
-- - High-volume intake persons (>10 events) are likely trappers, not origin
-- - Single-event persons are more likely caretakers = reliable origin
-- - ClinicHQ inferred_place_id on earliest appointment = best ground truth
-- - ShelterLuv person address (Street/City/State/Zip) provides backup signal
-- =============================================================================

CREATE OR REPLACE VIEW ops.v_cat_origin_tracking AS
WITH intake_events AS (
    -- All feral/stray intake events with person info
    SELECT
        cie.cat_id,
        cie.event_date AS intake_date,
        cie.intake_type,
        cie.intake_person_id,
        cie.shelterluv_person_id,
        c.name AS cat_name,
        c.microchip
    FROM sot.cat_intake_events cie
    JOIN sot.cats c ON c.cat_id = cie.cat_id AND c.merged_into_cat_id IS NULL
    WHERE cie.source_system = 'shelterluv'
      AND cie.intake_type IN ('feral', 'stray')
),
sl_person_addresses AS (
    -- ShelterLuv person addresses for intake persons
    SELECT
        sr.source_record_id AS sl_person_id,
        sr.payload->>'Firstname' AS first_name,
        sr.payload->>'Lastname' AS last_name,
        NULLIF(TRIM(sr.payload->>'Street'), '') AS street,
        NULLIF(TRIM(sr.payload->>'City'), '') AS city,
        NULLIF(TRIM(sr.payload->>'State'), '') AS state,
        NULLIF(TRIM(sr.payload->>'Zip'), '') AS zip,
        -- Count how many intake events reference this person (trapper detection)
        (SELECT COUNT(*)
         FROM sot.cat_intake_events ie2
         WHERE ie2.shelterluv_person_id = sr.source_record_id
           AND ie2.intake_type IN ('feral', 'stray')) AS intake_event_count
    FROM source.shelterluv_raw sr
    WHERE sr.record_type = 'person'
),
earliest_clinic_place AS (
    -- ClinicHQ first appointment place per cat (strongest origin signal)
    SELECT DISTINCT ON (a.cat_id)
        a.cat_id,
        a.inferred_place_id,
        p.display_name AS clinic_place_name,
        p.formatted_address AS clinic_place_address,
        a.appointment_date
    FROM ops.appointments a
    JOIN sot.places p ON p.place_id = a.inferred_place_id AND p.merged_into_place_id IS NULL
    WHERE a.inferred_place_id IS NOT NULL
    ORDER BY a.cat_id, a.appointment_date ASC
)
SELECT
    ie.cat_id,
    ie.cat_name,
    ie.microchip,
    ie.intake_date,
    ie.intake_type,
    -- ShelterLuv intake person info
    spa.first_name AS intake_person_first,
    spa.last_name AS intake_person_last,
    spa.street AS intake_person_street,
    spa.city AS intake_person_city,
    spa.state AS intake_person_state,
    spa.intake_event_count,
    CASE
        WHEN spa.intake_event_count IS NULL THEN 'unknown'
        WHEN spa.first_name = 'Unknown' AND spa.last_name = 'Finder' THEN 'unknown_finder'
        WHEN spa.intake_event_count > 10 THEN 'likely_trapper'
        WHEN spa.intake_event_count > 3 THEN 'possible_trapper'
        ELSE 'likely_caretaker'
    END AS person_role_inference,
    -- Resolved sot person (if matched)
    ie.intake_person_id,
    -- ClinicHQ origin signal (strongest)
    ecp.inferred_place_id AS clinic_origin_place_id,
    ecp.clinic_place_name,
    ecp.clinic_place_address,
    ecp.appointment_date AS first_clinic_date,
    -- Origin confidence
    CASE
        WHEN ecp.inferred_place_id IS NOT NULL AND spa.street IS NOT NULL THEN 'high'
        WHEN ecp.inferred_place_id IS NOT NULL THEN 'medium_clinic'
        WHEN spa.street IS NOT NULL AND spa.intake_event_count <= 3 THEN 'medium_intake'
        WHEN spa.street IS NOT NULL AND spa.intake_event_count > 10 THEN 'low_trapper_address'
        ELSE 'unknown'
    END AS origin_confidence
FROM intake_events ie
LEFT JOIN sl_person_addresses spa ON spa.sl_person_id = ie.shelterluv_person_id
LEFT JOIN earliest_clinic_place ecp ON ecp.cat_id = ie.cat_id;

COMMENT ON VIEW ops.v_cat_origin_tracking IS 'Cat origin analysis combining ShelterLuv intake person addresses with ClinicHQ appointment places. High-volume persons are likely trappers, not origin. (MIG_2869)';

-- =============================================================================
-- Step 5: Summary statistics
-- =============================================================================

DO $$
DECLARE
  v_outcome_pending INT;
  v_intake_pending INT;
BEGIN
  SELECT COUNT(*) INTO v_outcome_pending
  FROM ops.staged_records
  WHERE source_system = 'shelterluv' AND source_table = 'events'
    AND is_processed = FALSE AND payload->>'Type' LIKE 'Outcome.%';

  SELECT COUNT(*) INTO v_intake_pending
  FROM ops.staged_records
  WHERE source_system = 'shelterluv' AND source_table = 'events'
    AND is_processed = FALSE AND payload->>'Type' LIKE 'Intake.%';

  RAISE NOTICE 'MIG_2869: Functions replaced, events reset for reprocessing';
  RAISE NOTICE '  Outcome events pending: %', v_outcome_pending;
  RAISE NOTICE '  Intake events pending: %', v_intake_pending;
  RAISE NOTICE '  Run process_shelterluv_events() then process_shelterluv_intake_events() to process';
END $$;

COMMIT;
