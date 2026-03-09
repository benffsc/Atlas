-- MIG_2878: Fix ShelterLuv Lifecycle Events & Outcome Tracking
--
-- Problem: cat_lifecycle_events has 33,345 tnr_procedure (ClinicHQ) but ZERO
-- ShelterLuv outcomes. 8,287 cats show as "unknown" in v_cat_current_status.
--
-- Three root causes:
--   1. process_shelterluv_events() writes person_cat/mortality but NOT lifecycle events
--   2. 483 outcome events silently dropped (FeralWildlife=439, UnassistedDeath=41, Lost=2)
--   3. Person lookup is email-only — 15 foster parents have phone but no email
--
-- This migration:
--   Step 0: Dedup index on cat_lifecycle_events
--   Step 1: Replace process_shelterluv_events() — phone fallback + lifecycle + new cases
--   Step 2: Replace process_shelterluv_intake_events() — lifecycle + foster_end + phone
--   Step 3: Backfill historical lifecycle events from existing data
--   Step 4: Update v_cat_current_status view (add foster_end)
--   Step 5: Verification
--
-- Safety: Function replacements are outside transaction (committed immediately).
--         Backfill is inside transaction. Does NOT reset staged_records.
--         Existing person_cat, mortality, and intake data is preserved.
--         All lifecycle INSERTs use ON CONFLICT DO NOTHING on dedup index.
--
-- Depends on: MIG_2363 (cat_lifecycle_events table), MIG_2869 (current functions)

-- =============================================================================
-- Step 0: Dedup index on cat_lifecycle_events
-- Prevents duplicate lifecycle events from the same source record.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_cat_lifecycle_source_dedup
  ON sot.cat_lifecycle_events(cat_id, event_type, source_system, source_record_id)
  WHERE source_record_id IS NOT NULL;

-- =============================================================================
-- Step 1: Replace process_shelterluv_events() (outside transaction)
--
-- Changes from MIG_2869:
--   A) Phone fallback — after email lookup, try phone via sot.norm_phone_us()
--   B) Lifecycle writes — INSERT into cat_lifecycle_events for each outcome type
--   C) New WHEN clauses — FeralWildlife, UnassistedDeathInCustody, Lost, Service
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
  v_person_phone TEXT;  -- MIG_2878: phone fallback
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
    v_person_phone := NULL;

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

      -- MIG_2878: Phone fallback — try phone if email lookup failed
      IF v_person_id IS NULL AND v_shelterluv_person_id IS NOT NULL THEN
        SELECT NULLIF(TRIM(sp.payload->>'Phone'), '')
        INTO v_person_phone
        FROM source.shelterluv_raw sp
        WHERE sp.record_type = 'person'
          AND sp.source_record_id = v_shelterluv_person_id
        LIMIT 1;

        IF v_person_phone IS NOT NULL THEN
          SELECT pi.person_id INTO v_person_id
          FROM sot.person_identifiers pi
          WHERE pi.id_type = 'phone'
            AND pi.id_value_norm = sot.norm_phone_us(v_person_phone)
            AND pi.confidence >= 0.5
          LIMIT 1;
        END IF;
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
          -- MIG_2878: Lifecycle event (cat_id required, person optional)
          IF v_cat_id IS NOT NULL THEN
            INSERT INTO sot.cat_lifecycle_events (
              cat_id, event_type, event_at, person_id,
              source_system, source_record_id
            ) VALUES (
              v_cat_id, 'adoption', v_event_time, v_person_id,
              'shelterluv', v_record.source_row_id
            ) ON CONFLICT DO NOTHING;
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
          -- MIG_2878: Lifecycle event
          IF v_cat_id IS NOT NULL THEN
            INSERT INTO sot.cat_lifecycle_events (
              cat_id, event_type, event_at, person_id,
              source_system, source_record_id
            ) VALUES (
              v_cat_id, 'foster_start', v_event_time, v_person_id,
              'shelterluv', v_record.source_row_id
            ) ON CONFLICT DO NOTHING;
          END IF;

        WHEN 'Outcome.ReturnToField' THEN
          -- MIG_2878: Lifecycle event
          IF v_cat_id IS NOT NULL THEN
            INSERT INTO sot.cat_lifecycle_events (
              cat_id, event_type, event_at, person_id,
              source_system, source_record_id
            ) VALUES (
              v_cat_id, 'return_to_field', v_event_time, v_person_id,
              'shelterluv', v_record.source_row_id
            ) ON CONFLICT DO NOTHING;
          END IF;
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
            -- MIG_2878: Lifecycle event
            INSERT INTO sot.cat_lifecycle_events (
              cat_id, event_type, event_subtype, event_at, person_id,
              source_system, source_record_id
            ) VALUES (
              v_cat_id, 'mortality',
              CASE v_event_type
                WHEN 'Outcome.Died' THEN 'natural'
                ELSE 'euthanasia'
              END,
              v_event_time, v_person_id,
              'shelterluv', v_record.source_row_id
            ) ON CONFLICT DO NOTHING;
            v_mortality := v_mortality + 1;
          END IF;

        WHEN 'Outcome.ReturnToOwner' THEN
          -- MIG_2878: Lifecycle event
          IF v_cat_id IS NOT NULL THEN
            INSERT INTO sot.cat_lifecycle_events (
              cat_id, event_type, event_subtype, event_at, person_id,
              source_system, source_record_id
            ) VALUES (
              v_cat_id, 'return_to_field', 'return_to_owner', v_event_time, v_person_id,
              'shelterluv', v_record.source_row_id
            ) ON CONFLICT DO NOTHING;
          END IF;
          v_returns := v_returns + 1;

        WHEN 'Outcome.Transfer' THEN
          -- MIG_2878: Lifecycle event
          IF v_cat_id IS NOT NULL THEN
            INSERT INTO sot.cat_lifecycle_events (
              cat_id, event_type, event_at, person_id,
              source_system, source_record_id
            ) VALUES (
              v_cat_id, 'transfer', v_event_time, v_person_id,
              'shelterluv', v_record.source_row_id
            ) ON CONFLICT DO NOTHING;
          END IF;
          v_transfers := v_transfers + 1;

        -- MIG_2878: Previously unhandled outcome types (483 events dropped)

        WHEN 'Outcome.FeralWildlife' THEN
          IF v_cat_id IS NOT NULL THEN
            INSERT INTO sot.cat_lifecycle_events (
              cat_id, event_type, event_subtype, event_at, person_id,
              source_system, source_record_id
            ) VALUES (
              v_cat_id, 'return_to_field', 'feral_wildlife', v_event_time, v_person_id,
              'shelterluv', v_record.source_row_id
            ) ON CONFLICT DO NOTHING;
          END IF;
          v_tnr := v_tnr + 1;

        WHEN 'Outcome.UnassistedDeathInCustody' THEN
          IF v_cat_id IS NOT NULL THEN
            INSERT INTO sot.cat_mortality_events (
              cat_id, mortality_type, event_date, source_system, source_record_id
            ) VALUES (
              v_cat_id, 'natural', v_event_time::date,
              'shelterluv', v_record.source_row_id
            ) ON CONFLICT DO NOTHING;
            INSERT INTO sot.cat_lifecycle_events (
              cat_id, event_type, event_subtype, event_at,
              source_system, source_record_id
            ) VALUES (
              v_cat_id, 'mortality', 'natural', v_event_time,
              'shelterluv', v_record.source_row_id
            ) ON CONFLICT DO NOTHING;
            v_mortality := v_mortality + 1;
          END IF;

        WHEN 'Outcome.Lost' THEN
          IF v_cat_id IS NOT NULL THEN
            INSERT INTO sot.cat_lifecycle_events (
              cat_id, event_type, event_subtype, event_at,
              source_system, source_record_id
            ) VALUES (
              v_cat_id, 'transfer', 'lost', v_event_time,
              'shelterluv', v_record.source_row_id
            ) ON CONFLICT DO NOTHING;
          END IF;
          v_transfers := v_transfers + 1;

        WHEN 'Outcome.Service' THEN
          -- Administrative event, no lifecycle significance (1 event)
          NULL;

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
-- Step 2: Replace process_shelterluv_intake_events() (outside transaction)
--
-- Changes from MIG_2869:
--   A) Phone fallback — same as Step 1
--   B) FosterReturn mapping — intake_type = 'return' (was 'other')
--   C) Lifecycle writes — INSERT lifecycle 'intake' for ALL intake events
--   D) Foster_end — for Intake.FosterReturn, ALSO insert lifecycle 'foster_end'
-- =============================================================================

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
  v_person_phone TEXT;  -- MIG_2878: phone fallback
  v_intake_type TEXT;
  v_mapped_intake_type TEXT;  -- MIG_2878: resolved intake type
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
    v_person_phone := NULL;

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

      -- MIG_2878: Phone fallback — try phone if email lookup failed
      IF v_person_id IS NULL AND v_shelterluv_person_id IS NOT NULL THEN
        SELECT NULLIF(TRIM(sp.payload->>'Phone'), '')
        INTO v_person_phone
        FROM source.shelterluv_raw sp
        WHERE sp.record_type = 'person'
          AND sp.source_record_id = v_shelterluv_person_id
        LIMIT 1;

        IF v_person_phone IS NOT NULL THEN
          SELECT pi.person_id INTO v_person_id
          FROM sot.person_identifiers pi
          WHERE pi.id_type = 'phone'
            AND pi.id_value_norm = sot.norm_phone_us(v_person_phone)
            AND pi.confidence >= 0.5
          LIMIT 1;
        END IF;
      END IF;

      -- MIG_2878: Map intake type (added 'return' for FosterReturn)
      v_mapped_intake_type := CASE v_intake_type
        WHEN 'Intake.OwnerSurrender' THEN 'owner_surrender'
        WHEN 'Intake.Stray' THEN 'stray'
        WHEN 'Intake.FeralWildlife' THEN 'feral'
        WHEN 'Intake.Transfer' THEN 'transfer'
        WHEN 'Intake.FosterReturn' THEN 'return'
        ELSE 'other'
      END;

      IF v_cat_id IS NOT NULL THEN
        v_matched := v_matched + 1;

        -- Record intake event with person tracking
        INSERT INTO sot.cat_intake_events (
          cat_id, intake_type, event_date, intake_person_id, shelterluv_person_id,
          source_system, source_record_id
        ) VALUES (
          v_cat_id,
          v_mapped_intake_type,
          v_event_time::date,
          v_person_id,
          v_shelterluv_person_id,
          'shelterluv',
          v_record.source_row_id
        ) ON CONFLICT DO NOTHING;
        v_intake := v_intake + 1;

        -- MIG_2878: Lifecycle 'intake' event for ALL intake types
        INSERT INTO sot.cat_lifecycle_events (
          cat_id, event_type, event_subtype, event_at, person_id,
          source_system, source_record_id
        ) VALUES (
          v_cat_id, 'intake', v_mapped_intake_type, v_event_time, v_person_id,
          'shelterluv', v_record.source_row_id
        ) ON CONFLICT DO NOTHING;

        -- MIG_2878: For FosterReturn, ALSO insert lifecycle 'foster_end'
        IF v_intake_type = 'Intake.FosterReturn' THEN
          INSERT INTO sot.cat_lifecycle_events (
            cat_id, event_type, event_subtype, event_at, person_id,
            source_system, source_record_id
          ) VALUES (
            v_cat_id, 'foster_end', 'return', v_event_time, v_person_id,
            'shelterluv', v_record.source_row_id || '_foster_end'
          ) ON CONFLICT DO NOTHING;
        END IF;

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
-- Step 3: Backfill historical lifecycle events (inside transaction)
--
-- Does NOT reset staged_records. Existing person_cat, mortality, and intake
-- data is correct. Only fills missing cat_lifecycle_events rows.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 3a: Outcome events from shelterluv_raw → lifecycle events
--
-- Reads raw ShelterLuv events, resolves cat + person (email then phone fallback),
-- maps outcome type → lifecycle event_type, and inserts with ON CONFLICT DO NOTHING.
-- -----------------------------------------------------------------------------

WITH raw_outcome_events AS (
    -- Deduplicate raw events (multiple fetches may exist per event)
    SELECT DISTINCT ON (sr.source_record_id)
        sr.source_record_id,
        sr.payload,
        sr.fetched_at
    FROM source.shelterluv_raw sr
    WHERE sr.record_type = 'event'
      AND sr.payload->>'Type' LIKE 'Outcome.%'
      AND sr.payload->>'Type' != 'Outcome.Service'
    ORDER BY sr.source_record_id, sr.fetched_at DESC
),
extracted AS (
    SELECT
        roe.source_record_id,
        roe.payload->>'Type' AS event_type,
        roe.payload->>'Subtype' AS event_subtype,
        -- Parse Unix timestamp safely
        CASE
            WHEN roe.payload->>'Time' ~ '^\d+$'
            THEN TO_TIMESTAMP((roe.payload->>'Time')::BIGINT)
            ELSE NOW()
        END AS event_time,
        -- Extract Animal ID from AssociatedRecords array
        (SELECT ar->>'Id'
         FROM jsonb_array_elements(roe.payload->'AssociatedRecords') ar
         WHERE ar->>'Type' = 'Animal' LIMIT 1) AS animal_id,
        -- Extract Person ID from AssociatedRecords array
        (SELECT ar->>'Id'
         FROM jsonb_array_elements(roe.payload->'AssociatedRecords') ar
         WHERE ar->>'Type' = 'Person' LIMIT 1) AS sl_person_id
    FROM raw_outcome_events roe
),
with_cat AS (
    SELECT
        e.*,
        ci.cat_id,
        -- Get person email from SL person record
        NULLIF(TRIM(sp.payload->>'Email'), '') AS person_email,
        NULLIF(TRIM(sp.payload->>'Phone'), '') AS person_phone
    FROM extracted e
    JOIN sot.cat_identifiers ci
        ON ci.id_type = 'shelterluv_animal_id'
        AND ci.id_value = e.animal_id
    LEFT JOIN source.shelterluv_raw sp
        ON sp.record_type = 'person'
        AND sp.source_record_id = e.sl_person_id
),
with_person AS (
    SELECT
        wc.*,
        COALESCE(
            -- Email lookup first
            (SELECT pi.person_id
             FROM sot.person_identifiers pi
             WHERE pi.id_type = 'email'
               AND pi.id_value_norm = LOWER(TRIM(wc.person_email))
               AND pi.confidence >= 0.5
               AND wc.person_email IS NOT NULL
             LIMIT 1),
            -- Phone fallback
            (SELECT pi.person_id
             FROM sot.person_identifiers pi
             WHERE pi.id_type = 'phone'
               AND pi.id_value_norm = sot.norm_phone_us(wc.person_phone)
               AND pi.confidence >= 0.5
               AND wc.person_phone IS NOT NULL
             LIMIT 1)
        ) AS resolved_person_id
    FROM with_cat wc
)
INSERT INTO sot.cat_lifecycle_events (
    cat_id, event_type, event_subtype, event_at, person_id,
    source_system, source_record_id
)
SELECT
    wp.cat_id,
    -- Map outcome type → lifecycle event_type
    CASE wp.event_type
        WHEN 'Outcome.Adoption' THEN 'adoption'
        WHEN 'Outcome.Foster' THEN 'foster_start'
        WHEN 'Outcome.ReturnToField' THEN 'return_to_field'
        WHEN 'Outcome.Died' THEN 'mortality'
        WHEN 'Outcome.Euthanasia' THEN 'mortality'
        WHEN 'Outcome.ReturnToOwner' THEN 'return_to_field'
        WHEN 'Outcome.Transfer' THEN 'transfer'
        WHEN 'Outcome.FeralWildlife' THEN 'return_to_field'
        WHEN 'Outcome.UnassistedDeathInCustody' THEN 'mortality'
        WHEN 'Outcome.Lost' THEN 'transfer'
    END,
    -- Map outcome type → lifecycle event_subtype
    CASE wp.event_type
        WHEN 'Outcome.Died' THEN 'natural'
        WHEN 'Outcome.Euthanasia' THEN 'euthanasia'
        WHEN 'Outcome.ReturnToOwner' THEN 'return_to_owner'
        WHEN 'Outcome.FeralWildlife' THEN 'feral_wildlife'
        WHEN 'Outcome.UnassistedDeathInCustody' THEN 'natural'
        WHEN 'Outcome.Lost' THEN 'lost'
        ELSE NULL
    END,
    wp.event_time,
    wp.resolved_person_id,
    'shelterluv',
    wp.source_record_id
FROM with_person wp
ON CONFLICT DO NOTHING;

-- Report 3a results
DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM sot.cat_lifecycle_events
    WHERE source_system = 'shelterluv'
      AND event_type IN ('adoption', 'foster_start', 'return_to_field', 'mortality', 'transfer');
    RAISE NOTICE 'MIG_2878 Step 3a: % ShelterLuv outcome lifecycle events', v_count;
END $$;

-- -----------------------------------------------------------------------------
-- 3b: Intake events from existing cat_intake_events → lifecycle 'intake'
-- -----------------------------------------------------------------------------

INSERT INTO sot.cat_lifecycle_events (
    cat_id, event_type, event_subtype, event_at, person_id,
    source_system, source_record_id
)
SELECT
    cie.cat_id,
    'intake',
    cie.intake_type,
    cie.event_date::timestamptz,
    cie.intake_person_id,
    cie.source_system,
    cie.source_record_id
FROM sot.cat_intake_events cie
WHERE cie.source_record_id IS NOT NULL
ON CONFLICT DO NOTHING;

DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM sot.cat_lifecycle_events WHERE event_type = 'intake';
    RAISE NOTICE 'MIG_2878 Step 3b: % intake lifecycle events', v_count;
END $$;

-- -----------------------------------------------------------------------------
-- 3c: Foster_end from Intake.FosterReturn events in shelterluv_raw
--
-- Uses shelterluv_raw directly because existing cat_intake_events mapped
-- FosterReturn to 'other' (now fixed in updated function for future events).
-- Uses source_record_id || '_foster_end' to differentiate from intake event.
-- -----------------------------------------------------------------------------

WITH raw_foster_returns AS (
    SELECT DISTINCT ON (sr.source_record_id)
        sr.source_record_id,
        sr.payload,
        sr.fetched_at
    FROM source.shelterluv_raw sr
    WHERE sr.record_type = 'event'
      AND sr.payload->>'Type' = 'Intake.FosterReturn'
    ORDER BY sr.source_record_id, sr.fetched_at DESC
),
extracted AS (
    SELECT
        rfr.source_record_id,
        CASE
            WHEN rfr.payload->>'Time' ~ '^\d+$'
            THEN TO_TIMESTAMP((rfr.payload->>'Time')::BIGINT)
            ELSE NOW()
        END AS event_time,
        (SELECT ar->>'Id'
         FROM jsonb_array_elements(rfr.payload->'AssociatedRecords') ar
         WHERE ar->>'Type' = 'Animal' LIMIT 1) AS animal_id,
        (SELECT ar->>'Id'
         FROM jsonb_array_elements(rfr.payload->'AssociatedRecords') ar
         WHERE ar->>'Type' = 'Person' LIMIT 1) AS sl_person_id
    FROM raw_foster_returns rfr
),
with_cat AS (
    SELECT
        e.*,
        ci.cat_id,
        NULLIF(TRIM(sp.payload->>'Email'), '') AS person_email,
        NULLIF(TRIM(sp.payload->>'Phone'), '') AS person_phone
    FROM extracted e
    JOIN sot.cat_identifiers ci
        ON ci.id_type = 'shelterluv_animal_id'
        AND ci.id_value = e.animal_id
    LEFT JOIN source.shelterluv_raw sp
        ON sp.record_type = 'person'
        AND sp.source_record_id = e.sl_person_id
),
with_person AS (
    SELECT
        wc.*,
        COALESCE(
            (SELECT pi.person_id
             FROM sot.person_identifiers pi
             WHERE pi.id_type = 'email'
               AND pi.id_value_norm = LOWER(TRIM(wc.person_email))
               AND pi.confidence >= 0.5
               AND wc.person_email IS NOT NULL
             LIMIT 1),
            (SELECT pi.person_id
             FROM sot.person_identifiers pi
             WHERE pi.id_type = 'phone'
               AND pi.id_value_norm = sot.norm_phone_us(wc.person_phone)
               AND pi.confidence >= 0.5
               AND wc.person_phone IS NOT NULL
             LIMIT 1)
        ) AS resolved_person_id
    FROM with_cat wc
)
INSERT INTO sot.cat_lifecycle_events (
    cat_id, event_type, event_subtype, event_at, person_id,
    source_system, source_record_id
)
SELECT
    wp.cat_id,
    'foster_end',
    'return',
    wp.event_time,
    wp.resolved_person_id,
    'shelterluv',
    wp.source_record_id || '_foster_end'
FROM with_person wp
ON CONFLICT DO NOTHING;

DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM sot.cat_lifecycle_events WHERE event_type = 'foster_end';
    RAISE NOTICE 'MIG_2878 Step 3c: % foster_end lifecycle events', v_count;
END $$;

-- -----------------------------------------------------------------------------
-- 3d: Mortality from existing cat_mortality_events → lifecycle 'mortality'
-- Catches both ShelterLuv and ClinicHQ mortality records.
-- Dedup index handles overlap with 3a (same source_record_id).
-- -----------------------------------------------------------------------------

INSERT INTO sot.cat_lifecycle_events (
    cat_id, event_type, event_subtype, event_at,
    source_system, source_record_id
)
SELECT
    cme.cat_id,
    'mortality',
    cme.mortality_type,
    cme.event_date::timestamptz,
    cme.source_system,
    cme.source_record_id
FROM sot.cat_mortality_events cme
WHERE cme.source_record_id IS NOT NULL
ON CONFLICT DO NOTHING;

DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM sot.cat_lifecycle_events WHERE event_type = 'mortality';
    RAISE NOTICE 'MIG_2878 Step 3d: % mortality lifecycle events (total)', v_count;
END $$;

-- -----------------------------------------------------------------------------
-- 3e: Fix existing FosterReturn intake_type from 'other' to 'return'
-- These were mapped incorrectly by the MIG_2869 function.
-- -----------------------------------------------------------------------------

UPDATE sot.cat_intake_events cie
SET intake_type = 'return'
FROM source.shelterluv_raw sr
WHERE cie.source_system = 'shelterluv'
  AND cie.source_record_id = sr.source_record_id
  AND sr.record_type = 'event'
  AND sr.payload->>'Type' = 'Intake.FosterReturn'
  AND cie.intake_type = 'other';

DO $$
DECLARE
    v_count INT;
BEGIN
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'MIG_2878 Step 3e: fixed % FosterReturn intake records (other → return)', v_count;
END $$;

-- =============================================================================
-- Step 4: Update v_cat_current_status view
-- Add foster_end → 'in_care' mapping (cat returned from foster = back in care)
-- =============================================================================

CREATE OR REPLACE VIEW sot.v_cat_current_status AS
WITH ranked_events AS (
  SELECT
    cat_id,
    event_type,
    event_subtype,
    event_at,
    person_id,
    place_id,
    metadata,
    ROW_NUMBER() OVER (PARTITION BY cat_id ORDER BY event_at DESC) as rn
  FROM sot.cat_lifecycle_events
)
SELECT
  c.cat_id,
  c.name,
  c.microchip,
  e.event_type as last_event_type,
  e.event_subtype as last_event_subtype,
  e.event_at as last_event_at,
  e.person_id as last_event_person_id,
  e.place_id as last_event_place_id,
  CASE
    WHEN e.event_type = 'mortality' THEN 'deceased'
    WHEN e.event_type = 'adoption' THEN 'adopted'
    WHEN e.event_type = 'foster_start' THEN 'in_foster'
    WHEN e.event_type = 'foster_end' THEN 'in_care'
    WHEN e.event_type = 'return_to_field' THEN 'community_cat'
    WHEN e.event_type = 'transfer' THEN 'transferred'
    WHEN e.event_type = 'tnr_procedure' THEN 'tnr_complete'
    WHEN e.event_type = 'intake' THEN 'in_care'
    ELSE 'unknown'
  END as current_status
FROM sot.cats c
LEFT JOIN ranked_events e ON e.cat_id = c.cat_id AND e.rn = 1
WHERE c.merged_into_cat_id IS NULL;

COMMENT ON VIEW sot.v_cat_current_status IS
'Derived view showing current status of each cat based on most recent lifecycle event. Updated MIG_2878: added foster_end → in_care.';

-- =============================================================================
-- Step 5: Verification
-- =============================================================================

DO $$
DECLARE
    v_rec RECORD;
    v_unknown INT;
    v_total INT;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== MIG_2878 Verification ===';
    RAISE NOTICE '';

    -- Lifecycle event distribution
    RAISE NOTICE 'Lifecycle events by type:';
    FOR v_rec IN
        SELECT event_type, COUNT(*) AS cnt
        FROM sot.cat_lifecycle_events
        GROUP BY event_type
        ORDER BY cnt DESC
    LOOP
        RAISE NOTICE '  %-20s %', v_rec.event_type, v_rec.cnt;
    END LOOP;

    RAISE NOTICE '';

    -- Cat status distribution
    RAISE NOTICE 'Cat status distribution:';
    FOR v_rec IN
        SELECT current_status, COUNT(*) AS cnt
        FROM sot.v_cat_current_status
        GROUP BY current_status
        ORDER BY cnt DESC
    LOOP
        RAISE NOTICE '  %-20s %', v_rec.current_status, v_rec.cnt;
    END LOOP;

    -- Check unknown count
    SELECT COUNT(*) INTO v_unknown
    FROM sot.v_cat_current_status
    WHERE current_status = 'unknown';

    SELECT COUNT(*) INTO v_total
    FROM sot.v_cat_current_status;

    RAISE NOTICE '';
    RAISE NOTICE 'Cats with unknown status: % / % (was 8,287)', v_unknown, v_total;

    -- Check ShelterLuv lifecycle events specifically
    RAISE NOTICE '';
    RAISE NOTICE 'ShelterLuv lifecycle events:';
    FOR v_rec IN
        SELECT event_type, COUNT(*) AS cnt
        FROM sot.cat_lifecycle_events
        WHERE source_system = 'shelterluv'
        GROUP BY event_type
        ORDER BY cnt DESC
    LOOP
        RAISE NOTICE '  %-20s %', v_rec.event_type, v_rec.cnt;
    END LOOP;

    RAISE NOTICE '';
    RAISE NOTICE 'MIG_2878: Complete. Run process_shelterluv_events() and process_shelterluv_intake_events() for any remaining staged records.';
END $$;

COMMIT;
