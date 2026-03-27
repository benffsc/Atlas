-- MIG_3005: Adoption Context Enrichment + Adopter Links Backfill
--
-- Problem: ShelterLuv sends 16 distinct adoption subtypes (e.g., Relocation = barn cat
-- placements) but the event processor never stores event_subtype or metadata for adoptions.
-- Result: 3,141 adoption lifecycle events have NULL event_subtype and empty metadata.
-- Additionally, ZERO person_cat adopter records exist — MIG_2878 backfill only inserted
-- lifecycle_events, not person_cat links.
--
-- Jackie Muzio example: Adopted 2 barn cats (Ghost, Nugget) via Relocation program,
-- but Atlas shows generic "adoptions" of "Unknown" cats with no adopter link.
--
-- This migration:
--   Section A: Fix process_shelterluv_events() to store subtype + metadata (forward-fix)
--   Section B: Backfill event_subtype on existing adoption lifecycle events
--   Section C: Backfill metadata (fee_group, barn_cat flag) on existing adoptions
--   Section D: Backfill missing person_cat adopter links from lifecycle events
--   Section E: Create sot.v_adoption_context convenience view
--   Section F: Verification diagnostics
--
-- Safety: Function replacement is outside transaction (committed immediately).
--         Backfills are inside transaction with ON CONFLICT DO NOTHING.
--         Existing data is preserved — only fills missing values.
--
-- Depends on: MIG_2878 (current function + dedup index), MIG_2363 (lifecycle table)

-- =============================================================================
-- Section A: Replace process_shelterluv_events() (outside transaction)
--
-- Changes from MIG_2878:
--   1) New variables: v_fee_group, v_is_barn_cat
--   2) Animal metadata lookup for adoption enrichment
--   3) Adoption INSERT now includes event_subtype + metadata
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
  v_fee_group TEXT;     -- MIG_3005: adoption fee group
  v_is_barn_cat BOOLEAN; -- MIG_3005: barn cat attribute flag
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
    v_fee_group := NULL;
    v_is_barn_cat := FALSE;

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

      -- MIG_3005: Look up animal metadata for adoption enrichment
      IF v_shelterluv_animal_id IS NOT NULL THEN
        SELECT
          NULLIF(TRIM(sa.payload->'AdoptionFeeGroup'->>'Name'), ''),
          EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(sa.payload->'Attributes', '[]'::jsonb)) attr
            WHERE attr->>'AttributeName' ILIKE '%barn cat%'
          )
        INTO v_fee_group, v_is_barn_cat
        FROM source.shelterluv_raw sa
        WHERE sa.record_type = 'animal'
          AND sa.source_record_id = v_shelterluv_animal_id
        ORDER BY sa.fetched_at DESC
        LIMIT 1;
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
          -- MIG_3005: Lifecycle event with event_subtype and metadata
          IF v_cat_id IS NOT NULL THEN
            INSERT INTO sot.cat_lifecycle_events (
              cat_id, event_type, event_subtype, event_at, person_id,
              metadata, source_system, source_record_id
            ) VALUES (
              v_cat_id, 'adoption', v_subtype, v_event_time, v_person_id,
              jsonb_build_object(
                'fee_group', v_fee_group,
                'is_barn_cat', COALESCE(v_is_barn_cat, FALSE)
              ),
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
-- Sections B-F: Inside transaction
-- =============================================================================

BEGIN;

-- =============================================================================
-- Section B: Backfill event_subtype on existing adoption lifecycle events
--
-- Joins lifecycle events back to shelterluv_raw to get the Subtype field
-- that was read into v_subtype but never stored.
-- =============================================================================

UPDATE sot.cat_lifecycle_events cle
SET event_subtype = raw_events.subtype,
    updated_at = NOW()
FROM (
  SELECT DISTINCT ON (sr.source_record_id)
    sr.source_record_id,
    NULLIF(TRIM(sr.payload->>'Subtype'), '') AS subtype
  FROM source.shelterluv_raw sr
  WHERE sr.record_type = 'event'
    AND sr.payload->>'Type' = 'Outcome.Adoption'
  ORDER BY sr.source_record_id, sr.fetched_at DESC
) raw_events
WHERE cle.event_type = 'adoption'
  AND cle.source_system = 'shelterluv'
  AND cle.source_record_id = raw_events.source_record_id
  AND cle.event_subtype IS NULL;

DO $$
DECLARE
  v_count INT;
BEGIN
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'MIG_3005 Section B: Backfilled event_subtype on % adoption events', v_count;
END $$;

-- =============================================================================
-- Section C: Backfill metadata on existing adoption lifecycle events
--
-- Joins events -> animals via AssociatedRecords array to get fee_group
-- and barn_cat attribute flag from the animal record.
-- =============================================================================

UPDATE sot.cat_lifecycle_events cle
SET metadata = jsonb_build_object(
      'fee_group', enrichment.fee_group,
      'is_barn_cat', COALESCE(enrichment.is_barn_cat, FALSE)
    ),
    updated_at = NOW()
FROM (
  SELECT DISTINCT ON (evt.source_record_id)
    evt.source_record_id AS event_source_record_id,
    NULLIF(TRIM(animal.payload->'AdoptionFeeGroup'->>'Name'), '') AS fee_group,
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(animal.payload->'Attributes', '[]'::jsonb)) attr
      WHERE attr->>'AttributeName' ILIKE '%barn cat%'
    ) AS is_barn_cat
  FROM source.shelterluv_raw evt
  JOIN LATERAL (
    SELECT ar->>'Id' AS animal_id
    FROM jsonb_array_elements(evt.payload->'AssociatedRecords') ar
    WHERE ar->>'Type' = 'Animal' LIMIT 1
  ) assoc ON TRUE
  LEFT JOIN LATERAL (
    SELECT sa.payload
    FROM source.shelterluv_raw sa
    WHERE sa.record_type = 'animal' AND sa.source_record_id = assoc.animal_id
    ORDER BY sa.fetched_at DESC LIMIT 1
  ) animal ON TRUE
  WHERE evt.record_type = 'event'
    AND evt.payload->>'Type' = 'Outcome.Adoption'
  ORDER BY evt.source_record_id, evt.fetched_at DESC
) enrichment
WHERE cle.event_type = 'adoption'
  AND cle.source_system = 'shelterluv'
  AND cle.source_record_id = enrichment.event_source_record_id
  AND (cle.metadata IS NULL OR cle.metadata = '{}'::jsonb);

DO $$
DECLARE
  v_count INT;
BEGIN
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'MIG_3005 Section C: Backfilled metadata on % adoption events', v_count;
END $$;

-- =============================================================================
-- Section D: Backfill missing person_cat adopter links
--
-- MIG_2878 backfill only created lifecycle_events, NOT person_cat links.
-- This creates adopter records for all adoption events that have a person_id.
-- Merge-aware: filters out merged people and cats.
-- =============================================================================

INSERT INTO sot.person_cat (
  person_id, cat_id, relationship_type,
  evidence_type, confidence, source_system, source_table
)
SELECT
  cle.person_id, cle.cat_id, 'adopter',
  'imported', 0.8, 'shelterluv', 'events'
FROM sot.cat_lifecycle_events cle
JOIN sot.people p ON p.person_id = cle.person_id AND p.merged_into_person_id IS NULL
JOIN sot.cats c ON c.cat_id = cle.cat_id AND c.merged_into_cat_id IS NULL
WHERE cle.event_type = 'adoption'
  AND cle.source_system = 'shelterluv'
  AND cle.person_id IS NOT NULL
ON CONFLICT (person_id, cat_id, relationship_type) DO NOTHING;

DO $$
DECLARE
  v_count INT;
BEGIN
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'MIG_3005 Section D: Created % person_cat adopter links', v_count;
END $$;

-- =============================================================================
-- Section E: Create sot.v_adoption_context convenience view
--
-- Classifies adoptions into placement types based on ShelterLuv subtype:
--   Relocation -> relocation (barn cat / working cat placements)
--   Returned to Colony -> colony_return
--   Forever Foster -> permanent_foster
--   RPS -> transfer (Rohnert Park Animal Services)
--   Others -> residential
--   NULL -> unknown
-- =============================================================================

CREATE OR REPLACE VIEW sot.v_adoption_context AS
SELECT
  cle.event_id,
  cle.cat_id,
  c.name AS cat_name,
  cle.person_id AS adopter_person_id,
  p.display_name AS adopter_name,
  cle.event_at AS adoption_date,
  cle.event_subtype AS sl_subtype,
  cle.metadata->>'fee_group' AS fee_group,
  (cle.metadata->>'is_barn_cat')::boolean AS is_barn_cat,
  CASE
    WHEN cle.event_subtype = 'Relocation' THEN 'relocation'
    WHEN cle.event_subtype = 'Returned to Colony' THEN 'colony_return'
    WHEN cle.event_subtype = 'Forever Foster' THEN 'permanent_foster'
    WHEN cle.event_subtype = 'RPS' THEN 'transfer'
    WHEN cle.event_subtype IS NOT NULL THEN 'residential'
    ELSE 'unknown'
  END AS placement_type,
  cle.source_record_id
FROM sot.cat_lifecycle_events cle
JOIN sot.cats c ON c.cat_id = cle.cat_id AND c.merged_into_cat_id IS NULL
LEFT JOIN sot.people p ON p.person_id = cle.person_id AND p.merged_into_person_id IS NULL
WHERE cle.event_type = 'adoption';

COMMENT ON VIEW sot.v_adoption_context IS
'Adoption events enriched with ShelterLuv subtype, fee group, barn cat flag, and derived placement_type classification. MIG_3005.';

-- =============================================================================
-- Section F: Verification diagnostics
-- =============================================================================

DO $$
DECLARE
  v_rec RECORD;
  v_adopter_count INT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== MIG_3005 Verification ===';
  RAISE NOTICE '';

  -- Adoption subtypes populated
  RAISE NOTICE 'Adoption event_subtype distribution:';
  FOR v_rec IN
    SELECT COALESCE(event_subtype, '(NULL)') AS subtype, COUNT(*) AS cnt
    FROM sot.cat_lifecycle_events
    WHERE event_type = 'adoption'
    GROUP BY 1 ORDER BY 2 DESC
  LOOP
    RAISE NOTICE '  %-30s %', v_rec.subtype, v_rec.cnt;
  END LOOP;

  RAISE NOTICE '';

  -- Placement type distribution
  RAISE NOTICE 'Placement type distribution (from v_adoption_context):';
  FOR v_rec IN
    SELECT placement_type, COUNT(*) AS cnt
    FROM sot.v_adoption_context
    GROUP BY 1 ORDER BY 2 DESC
  LOOP
    RAISE NOTICE '  %-20s %', v_rec.placement_type, v_rec.cnt;
  END LOOP;

  RAISE NOTICE '';

  -- Adopter links created
  SELECT COUNT(*) INTO v_adopter_count
  FROM sot.person_cat
  WHERE relationship_type = 'adopter';
  RAISE NOTICE 'Total person_cat adopter links: %', v_adopter_count;

  RAISE NOTICE '';

  -- Jackie Muzio verification
  RAISE NOTICE 'Jackie Muzio verification:';
  FOR v_rec IN
    SELECT cat_name, adoption_date::date, sl_subtype, placement_type, fee_group
    FROM sot.v_adoption_context
    WHERE adopter_name ILIKE '%muzio%'
  LOOP
    RAISE NOTICE '  Cat: %, Date: %, Subtype: %, Type: %, Fee: %',
      v_rec.cat_name, v_rec.adoption_date, v_rec.sl_subtype,
      v_rec.placement_type, v_rec.fee_group;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE 'MIG_3005: Complete.';
END $$;

COMMIT;
