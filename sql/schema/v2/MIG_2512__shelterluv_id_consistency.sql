-- MIG_2511: ShelterLuv ID Type Consistency
--
-- Problem: ID type mismatch across ShelterLuv processing functions:
-- - MIG_2026 (original): Uses 'shelterluv_id'
-- - MIG_2402 (fix): Uses 'shelterluv_animal_id'
--
-- This causes outcome/intake events to not find cats because they're
-- looking for 'shelterluv_id' but IDs are stored as 'shelterluv_animal_id'.
--
-- Solution:
-- 1. Standardize all existing identifiers to 'shelterluv_animal_id'
-- 2. Update process_shelterluv_events() to use correct id_type
-- 3. Update process_shelterluv_intake_events() to use correct id_type
-- 4. Update process_shelterluv_animal() in MIG_2026 (legacy, just in case)
--
-- Created: 2026-02-26

\echo ''
\echo '=============================================='
\echo '  MIG_2511: ShelterLuv ID Consistency'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Pre-check: Count inconsistent ID types
-- ============================================================================

\echo '1. Pre-check: Counting ID type usage...'

SELECT id_type, COUNT(*) as count
FROM sot.cat_identifiers
WHERE id_type LIKE '%shelterluv%'
GROUP BY id_type
ORDER BY id_type;

-- ============================================================================
-- 2. Migrate 'shelterluv_id' to 'shelterluv_animal_id'
-- ============================================================================

\echo ''
\echo '2. Migrating shelterluv_id to shelterluv_animal_id...'

-- First, insert any missing shelterluv_animal_id entries from shelterluv_id
INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system)
SELECT ci.cat_id, 'shelterluv_animal_id', ci.id_value, ci.source_system
FROM sot.cat_identifiers ci
WHERE ci.id_type = 'shelterluv_id'
  AND NOT EXISTS (
    SELECT 1 FROM sot.cat_identifiers ci2
    WHERE ci2.cat_id = ci.cat_id
      AND ci2.id_type = 'shelterluv_animal_id'
      AND ci2.id_value = ci.id_value
  )
ON CONFLICT DO NOTHING;

-- Then delete the old shelterluv_id entries
DELETE FROM sot.cat_identifiers
WHERE id_type = 'shelterluv_id';

\echo '   Migration complete'

-- ============================================================================
-- 3. Fix process_shelterluv_events() function
-- ============================================================================

\echo ''
\echo '3. Fixing process_shelterluv_events() to use shelterluv_animal_id...'

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
      -- FIX: Use 'shelterluv_animal_id' instead of 'shelterluv_id'
      IF v_shelterluv_animal_id IS NOT NULL THEN
        SELECT ci.cat_id INTO v_cat_id
        FROM sot.cat_identifiers ci
        WHERE ci.id_type = 'shelterluv_animal_id'  -- FIXED
          AND ci.id_value = v_shelterluv_animal_id;
      END IF;

      -- Also try to find by shelterluv_animal_id column on sot.cats
      IF v_cat_id IS NULL AND v_shelterluv_animal_id IS NOT NULL THEN
        SELECT c.cat_id INTO v_cat_id
        FROM sot.cats c
        WHERE c.shelterluv_animal_id = v_shelterluv_animal_id
          AND c.merged_into_cat_id IS NULL;
      END IF;

      -- Find person by email
      IF v_person_email IS NOT NULL THEN
        SELECT pi.person_id INTO v_person_id
        FROM sot.person_identifiers pi
        JOIN sot.people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = LOWER(TRIM(v_person_email))
          AND pi.confidence >= 0.5
          AND p.merged_into_person_id IS NULL
        LIMIT 1;
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

COMMENT ON FUNCTION ops.process_shelterluv_events(INTEGER) IS
'Process ShelterLuv outcome events. MIG_2511 fixed: Uses shelterluv_animal_id consistently.';

\echo '   Fixed ops.process_shelterluv_events()'

-- ============================================================================
-- 4. Fix process_shelterluv_intake_events() function
-- ============================================================================

\echo ''
\echo '4. Fixing process_shelterluv_intake_events() to use shelterluv_animal_id...'

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

      -- Find cat by ShelterLuv ID
      -- FIX: Use 'shelterluv_animal_id' instead of 'shelterluv_id'
      IF v_shelterluv_animal_id IS NOT NULL THEN
        SELECT ci.cat_id INTO v_cat_id
        FROM sot.cat_identifiers ci
        WHERE ci.id_type = 'shelterluv_animal_id'  -- FIXED
          AND ci.id_value = v_shelterluv_animal_id;
      END IF;

      -- Also try shelterluv_animal_id column on sot.cats
      IF v_cat_id IS NULL AND v_shelterluv_animal_id IS NOT NULL THEN
        SELECT c.cat_id INTO v_cat_id
        FROM sot.cats c
        WHERE c.shelterluv_animal_id = v_shelterluv_animal_id
          AND c.merged_into_cat_id IS NULL;
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
          JOIN sot.people p ON p.person_id = pi.person_id
          WHERE pi.id_type = 'email'
            AND pi.id_value_norm = LOWER(TRIM(v_person_email))
            AND pi.confidence >= 0.5
            AND p.merged_into_person_id IS NULL
          LIMIT 1;

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

COMMENT ON FUNCTION ops.process_shelterluv_intake_events(INTEGER) IS
'Process ShelterLuv intake events. MIG_2511 fixed: Uses shelterluv_animal_id consistently.';

\echo '   Fixed ops.process_shelterluv_intake_events()'

-- ============================================================================
-- 5. Reset unprocessed events so they can be retried with fixed functions
-- ============================================================================

\echo ''
\echo '5. Resetting event records for reprocessing...'

-- Reset outcome events that failed to find cats
UPDATE ops.staged_records
SET is_processed = FALSE,
    processing_error = NULL
WHERE source_system = 'shelterluv'
  AND source_table = 'events'
  AND payload->>'Type' LIKE 'Outcome.%'
  AND resulting_entity_id IS NULL
  AND is_processed = TRUE;

-- Reset intake events that failed to find cats
UPDATE ops.staged_records
SET is_processed = FALSE,
    processing_error = NULL
WHERE source_system = 'shelterluv'
  AND source_table = 'events'
  AND payload->>'Type' LIKE 'Intake.%'
  AND resulting_entity_id IS NULL
  AND is_processed = TRUE;

SELECT 'outcome_events_reset' as result, COUNT(*) as count
FROM ops.staged_records
WHERE source_system = 'shelterluv'
  AND source_table = 'events'
  AND payload->>'Type' LIKE 'Outcome.%'
  AND is_processed = FALSE
UNION ALL
SELECT 'intake_events_reset', COUNT(*)
FROM ops.staged_records
WHERE source_system = 'shelterluv'
  AND source_table = 'events'
  AND payload->>'Type' LIKE 'Intake.%'
  AND is_processed = FALSE;

-- ============================================================================
-- 6. Post-check: Verify ID types are consistent
-- ============================================================================

\echo ''
\echo '6. Post-check: Verifying ID type consistency...'

SELECT id_type, COUNT(*) as count
FROM sot.cat_identifiers
WHERE id_type LIKE '%shelterluv%'
GROUP BY id_type
ORDER BY id_type;

-- Expected: Only 'shelterluv_animal_id', no 'shelterluv_id'

\echo ''
\echo '=============================================='
\echo '  MIG_2511 Complete'
\echo '=============================================='
\echo ''
\echo 'Migrated: All shelterluv_id -> shelterluv_animal_id'
\echo 'Fixed: process_shelterluv_events() id_type lookup'
\echo 'Fixed: process_shelterluv_intake_events() id_type lookup'
\echo 'Reset: Failed event records for reprocessing'
\echo ''
\echo 'NEXT: Run the ShelterLuv sync cron to reprocess events.'
\echo ''
