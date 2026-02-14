\echo '=== MIG_874b: Fixup for ShelterLuv Outcome Migration ==='
\echo 'Fixes errors from MIG_874 initial run:'
\echo '  1. place_contexts column name (context_id not place_context_id)'
\echo '  2. Add shelterluv_id to identifier_type enum'
\echo '  3. Animal API ID backfill (extract microchip from Microchips JSON array)'
\echo '  4. Update process_shelterluv_animal() to handle API Microchips array'
\echo '  5. Person SL ID backfill (id_value_norm not id_value)'
\echo '  6. DROP + CREATE process_shelterluv_events() with correct return type'
\echo '  7. Fix process_shelterluv_person() enum type'
\echo '  8. Re-reset + reprocess all outcome events'
\echo ''

-- ============================================================================
-- FIX 1: Delete leftover place_contexts from old XLSX outcome processor
-- ============================================================================

\echo '--- Fix 1: Deleting leftover place_contexts ---'

WITH deleted_pc AS (
  DELETE FROM trapper.place_contexts
  WHERE assigned_by = 'shelterluv_outcome_processor'
  RETURNING context_id
)
SELECT count(*) as deleted_place_contexts FROM deleted_pc \gset

\echo '  → Deleted :deleted_place_contexts place_contexts'

-- ============================================================================
-- FIX 2: Add shelterluv_id to identifier_type enum
-- ============================================================================

\echo ''
\echo '--- Fix 2: Adding shelterluv_id to identifier_type enum ---'

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'trapper.identifier_type'::regtype
      AND enumlabel = 'shelterluv_id'
  ) THEN
    ALTER TYPE trapper.identifier_type ADD VALUE 'shelterluv_id';
    RAISE NOTICE 'Added shelterluv_id to identifier_type enum';
  ELSE
    RAISE NOTICE 'shelterluv_id already exists in identifier_type enum';
  END IF;
END $$;

\echo '  → shelterluv_id enum value available'

-- ============================================================================
-- FIX 3: Backfill animal API IDs via Microchips JSON array
-- ============================================================================

\echo ''
\echo '--- Fix 3: Backfilling animal API IDs ---'

DO $$
DECLARE
  v_rec RECORD;
  v_api_id TEXT;
  v_chip TEXT;
  v_cat_id UUID;
  v_backfilled INT := 0;
  v_no_match INT := 0;
  v_no_chip INT := 0;
BEGIN
  FOR v_rec IN
    SELECT sr.id, sr.payload
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'shelterluv'
      AND sr.source_table = 'animals'
      AND sr.payload->>'Internal-ID' ~ '^\d+$'
      AND sr.is_processed = true
  LOOP
    v_api_id := v_rec.payload->>'Internal-ID';

    -- Check if this numeric ID already exists
    IF EXISTS (
      SELECT 1 FROM trapper.cat_identifiers
      WHERE id_type = 'shelterluv_id' AND id_value = v_api_id
    ) THEN
      CONTINUE;
    END IF;

    -- Extract microchip from Microchips JSON array
    v_chip := NULL;
    IF jsonb_typeof(v_rec.payload->'Microchips') = 'array'
       AND jsonb_array_length(v_rec.payload->'Microchips') > 0 THEN
      v_chip := v_rec.payload->'Microchips'->0->>'Id';
    END IF;

    IF v_chip IS NULL OR LENGTH(v_chip) < 9 THEN
      v_no_chip := v_no_chip + 1;
      CONTINUE;
    END IF;

    -- Find cat by microchip
    SELECT ci.cat_id INTO v_cat_id
    FROM trapper.cat_identifiers ci
    WHERE ci.id_type = 'microchip' AND ci.id_value = v_chip
    LIMIT 1;

    IF v_cat_id IS NULL THEN
      v_no_match := v_no_match + 1;
      CONTINUE;
    END IF;

    -- Store numeric API ID
    INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
    VALUES (v_cat_id, 'shelterluv_id', v_api_id, 'shelterluv', 'animals')
    ON CONFLICT DO NOTHING;

    -- Also set resulting_entity_id on the staged record
    UPDATE trapper.staged_records
    SET resulting_entity_id = v_cat_id,
        resulting_entity_type = 'cat'
    WHERE id = v_rec.id AND resulting_entity_id IS NULL;

    v_backfilled := v_backfilled + 1;
  END LOOP;

  RAISE NOTICE 'Backfilled % numeric API IDs, % no microchip, % no match', v_backfilled, v_no_chip, v_no_match;
END $$;

\echo '  → Animal API ID backfill complete'

-- Verify
SELECT 'numeric_sl_ids_now' as metric,
  COUNT(*) FROM trapper.cat_identifiers
  WHERE id_type = 'shelterluv_id' AND id_value ~ '^\d+$';

-- ============================================================================
-- FIX 4: Update process_shelterluv_animal() to handle API Microchips array
-- ============================================================================

\echo ''
\echo '--- Fix 4: Updating process_shelterluv_animal() for API Microchips array ---'

CREATE OR REPLACE FUNCTION trapper.process_shelterluv_animal(p_staged_record_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
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
  v_foster_email TEXT;
  v_foster_person_name TEXT;
  v_is_foster BOOLEAN := false;
  v_fields_recorded INT := 0;
  v_shelterluv_id TEXT;
  v_shelterluv_api_id TEXT;
  v_match_method TEXT := NULL;
BEGIN
  SELECT * INTO v_record
  FROM trapper.staged_records
  WHERE id = p_staged_record_id;

  IF v_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Staged record not found');
  END IF;

  -- Extract microchip: try string fields first, then API Microchips array
  v_microchip := COALESCE(
    v_record.payload->>'Microchip Number',
    v_record.payload->>'Microchip'
  );

  -- MIG_874b: Extract from API Microchips JSON array
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
    WHEN (v_record.payload->>'Altered') = 'Yes' OR (v_record.payload->>'Altered') = 'true' THEN 'altered'
    WHEN (v_record.payload->>'Altered') = 'No' OR (v_record.payload->>'Altered') = 'false' THEN 'intact'
    ELSE NULL
  END;

  v_status := v_record.payload->>'Status';

  -- Extract ShelterLuv IDs (both formats)
  v_shelterluv_id := v_record.payload->>'Internal-ID';  -- API: numeric, XLSX: FFSC-A-NNNN
  v_shelterluv_api_id := v_record.payload->>'Internal ID (API)';  -- Numeric API ID (XLSX has this)

  v_foster_email := NULLIF(TRIM(v_record.payload->>'Foster Person Email'), '');
  v_foster_person_name := NULLIF(TRIM(v_record.payload->>'Foster Person Name'), '');

  v_is_foster := (
    v_record.payload->>'InFoster' = 'true'
    OR v_status ILIKE '%foster%'
    OR v_foster_email IS NOT NULL
  );

  -- Try to find cat by microchip
  IF v_microchip IS NOT NULL AND LENGTH(v_microchip) >= 9 THEN
    v_cat_id := trapper.find_or_create_cat_by_microchip(
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

  -- Try to find cat by ShelterLuv ID if microchip didn't work
  IF v_cat_id IS NULL AND v_shelterluv_id IS NOT NULL THEN
    SELECT ci.cat_id INTO v_cat_id
    FROM trapper.cat_identifiers ci
    WHERE ci.id_type = 'shelterluv_id'
      AND ci.id_value = v_shelterluv_id;
    IF v_cat_id IS NOT NULL THEN
      v_match_method := 'shelterluv_id';
    END IF;
  END IF;

  IF v_cat_id IS NOT NULL THEN
    -- Store primary SL ID (Internal-ID)
    IF v_shelterluv_id IS NOT NULL THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
      VALUES (v_cat_id, 'shelterluv_id', v_shelterluv_id, 'shelterluv', 'animals')
      ON CONFLICT DO NOTHING;
    END IF;

    -- Also store numeric API ID if different from Internal-ID
    IF v_shelterluv_api_id IS NOT NULL
       AND v_shelterluv_api_id ~ '^[0-9]+$'
       AND v_shelterluv_api_id IS DISTINCT FROM v_shelterluv_id THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
      VALUES (v_cat_id, 'shelterluv_id', v_shelterluv_api_id, 'shelterluv', 'animals')
      ON CONFLICT DO NOTHING;
    END IF;

    -- Store additional microchips from API array (2nd chip onward)
    IF jsonb_typeof(v_record.payload->'Microchips') = 'array'
       AND jsonb_array_length(v_record.payload->'Microchips') > 1 THEN
      DECLARE
        v_extra_chip TEXT;
        v_i INT;
      BEGIN
        FOR v_i IN 1..jsonb_array_length(v_record.payload->'Microchips')-1 LOOP
          v_extra_chip := v_record.payload->'Microchips'->v_i->>'Id';
          IF v_extra_chip IS NOT NULL AND LENGTH(v_extra_chip) >= 9
             AND v_extra_chip ~ '^\d{9,16}$' THEN
            INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
            VALUES (v_cat_id, 'microchip', v_extra_chip, 'shelterluv', 'animals')
            ON CONFLICT DO NOTHING;
          END IF;
        END LOOP;
      END;
    END IF;

    v_fields_recorded := trapper.record_cat_field_sources_batch(
      p_cat_id := v_cat_id,
      p_source_system := 'shelterluv',
      p_source_record_id := COALESCE(v_shelterluv_id, v_shelterluv_api_id),
      p_name := v_animal_name,
      p_breed := v_breed,
      p_sex := v_sex,
      p_primary_color := v_primary_color,
      p_secondary_color := v_secondary_color,
      p_alteration_status := v_altered_status
    );

    -- Handle foster relationship
    IF v_is_foster AND v_foster_email IS NOT NULL THEN
      BEGIN
        SELECT pi.person_id INTO v_foster_person_id
        FROM trapper.person_identifiers pi
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = LOWER(TRIM(v_foster_email));

        IF v_foster_person_id IS NOT NULL THEN
          INSERT INTO trapper.person_cat_relationships (
            person_id, cat_id, relationship_type, source_system, source_table, source_record_id
          ) VALUES (
            v_foster_person_id, v_cat_id, 'foster', 'shelterluv', 'animals',
            COALESCE(v_shelterluv_id, v_shelterluv_api_id)
          ) ON CONFLICT DO NOTHING;
        ELSE
          INSERT INTO trapper.data_engine_match_decisions (
            source_system, source_table, source_row_id, decision_type, reasoning
          ) VALUES (
            'shelterluv', 'animals',
            COALESCE(v_shelterluv_id, v_shelterluv_api_id),
            CASE WHEN v_foster_email IS NULL THEN 'no_email' ELSE 'email_not_found' END,
            'Foster person not found for: ' || COALESCE(v_foster_person_name, 'unknown')
          ) ON CONFLICT DO NOTHING;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL; -- Skip foster linking errors
      END;
    END IF;
  END IF;

  -- Mark as processed and store entity reference
  UPDATE trapper.staged_records
  SET is_processed = true,
      processor_name = 'process_shelterluv_animal',
      resulting_entity_type = CASE WHEN v_cat_id IS NOT NULL THEN 'cat' ELSE NULL END,
      resulting_entity_id = v_cat_id
  WHERE id = p_staged_record_id;

  RETURN jsonb_build_object(
    'success', true,
    'cat_id', v_cat_id,
    'match_method', v_match_method,
    'fields_recorded', v_fields_recorded,
    'is_foster', v_is_foster,
    'foster_linked', v_foster_person_id IS NOT NULL
  );
END;
$function$;

\echo '  → process_shelterluv_animal() updated with API Microchips array support'

-- ============================================================================
-- FIX 5: Backfill person SL IDs into person_identifiers
-- ============================================================================

\echo ''
\echo '--- Fix 5: Backfilling person SL IDs ---'

-- First, backfill resulting_entity_id from data_engine_match_decisions
WITH backfill AS (
  UPDATE trapper.staged_records sr
  SET resulting_entity_id = demd.resulting_person_id,
      resulting_entity_type = 'person'
  FROM trapper.data_engine_match_decisions demd
  WHERE sr.source_system = 'shelterluv'
    AND sr.source_table = 'people'
    AND sr.is_processed = true
    AND sr.resulting_entity_id IS NULL
    AND demd.staged_record_id = sr.id
    AND demd.resulting_person_id IS NOT NULL
  RETURNING sr.id
)
SELECT count(*) as backfilled_entity_ids FROM backfill \gset

\echo '  → Backfilled :backfilled_entity_ids resulting_entity_ids'

-- Now backfill SL API IDs into person_identifiers
WITH sl_ids AS (
  SELECT DISTINCT
    sr.resulting_entity_id as person_id,
    sr.payload->>'Internal ID (API)' as sl_api_id
  FROM trapper.staged_records sr
  WHERE sr.source_system = 'shelterluv'
    AND sr.source_table = 'people'
    AND sr.resulting_entity_id IS NOT NULL
    AND sr.payload->>'Internal ID (API)' IS NOT NULL
    AND sr.payload->>'Internal ID (API)' ~ '^\d+$'
),
inserted AS (
  INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_norm, id_value_raw, source_system, source_table)
  SELECT person_id, 'shelterluv_id'::trapper.identifier_type, sl_api_id, sl_api_id, 'shelterluv', 'people'
  FROM sl_ids
  ON CONFLICT (id_type, id_value_norm) DO NOTHING
  RETURNING identifier_id
)
SELECT count(*) as backfilled_person_sl_ids FROM inserted \gset

\echo '  → Backfilled :backfilled_person_sl_ids person SL API IDs'

-- ============================================================================
-- FIX 6: Fix process_shelterluv_person() to use correct enum type
-- ============================================================================

\echo ''
\echo '--- Fix 6: Updating process_shelterluv_person() ---'

CREATE OR REPLACE FUNCTION trapper.process_shelterluv_person(p_staged_record_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_record RECORD;
  v_person_id UUID;
  v_place_id UUID;
  v_first_name TEXT;
  v_last_name TEXT;
  v_email TEXT;
  v_phone TEXT;
  v_address TEXT;
  v_city TEXT;
  v_state TEXT;
  v_zip TEXT;
  v_full_address TEXT;
  v_sl_api_id TEXT;
  v_source_person_id TEXT;
BEGIN
  SELECT * INTO v_record
  FROM trapper.staged_records
  WHERE id = p_staged_record_id;

  IF v_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Staged record not found');
  END IF;

  -- Extract person fields
  v_first_name := NULLIF(TRIM(split_part(v_record.payload->>'Name', ' ', 1)), '');
  v_last_name := NULLIF(TRIM(
    CASE
      WHEN v_record.payload->>'Name' LIKE '% %'
      THEN substring(v_record.payload->>'Name' FROM position(' ' IN v_record.payload->>'Name') + 1)
      ELSE ''
    END
  ), '');
  v_email := NULLIF(TRIM(LOWER(v_record.payload->>'Primary Email')), '');
  v_phone := NULLIF(TRIM(v_record.payload->>'Primary Phone'), '');
  v_address := NULLIF(TRIM(v_record.payload->>'Street Address 1'), '');
  v_city := NULLIF(TRIM(v_record.payload->>'City'), '');
  v_state := NULLIF(TRIM(v_record.payload->>'State'), '');
  v_zip := NULLIF(TRIM(v_record.payload->>'Zip'), '');

  -- MIG_874: Extract ShelterLuv API ID for person_identifiers
  v_sl_api_id := NULLIF(TRIM(v_record.payload->>'Internal ID (API)'), '');
  v_source_person_id := v_record.source_row_id;

  -- Build full address for place creation
  v_full_address := NULLIF(TRIM(
    COALESCE(v_address, '') ||
    CASE WHEN v_city IS NOT NULL THEN ', ' || v_city ELSE '' END ||
    CASE WHEN v_state IS NOT NULL THEN ', ' || v_state ELSE '' END ||
    CASE WHEN v_zip IS NOT NULL THEN ' ' || v_zip ELSE '' END
  ), '');

  -- Skip records with no useful identity info
  IF v_email IS NULL AND v_phone IS NULL THEN
    UPDATE trapper.staged_records
    SET is_processed = true,
        processor_name = 'process_shelterluv_person'
    WHERE id = p_staged_record_id;

    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'no_identifiers');
  END IF;

  -- Use centralized identity resolution
  v_person_id := trapper.find_or_create_person(
    p_email := v_email,
    p_phone := v_phone,
    p_first_name := v_first_name,
    p_last_name := v_last_name,
    p_address := v_full_address,
    p_source_system := 'shelterluv'
  );

  -- Create place if we have an address
  IF v_full_address IS NOT NULL AND v_person_id IS NOT NULL THEN
    v_place_id := trapper.find_or_create_place_deduped(
      p_address := v_full_address,
      p_name := NULL,
      p_lat := NULL,
      p_lng := NULL,
      p_source_system := 'shelterluv'
    );

    IF v_place_id IS NOT NULL THEN
      INSERT INTO trapper.person_place_relationships (
        person_id, place_id, role, source_system, source_table
      ) VALUES (
        v_person_id, v_place_id, 'resident'::trapper.person_place_role, 'shelterluv', 'people'
      ) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- MIG_874: Store ShelterLuv API ID as person_identifier for event lookups
  IF v_sl_api_id IS NOT NULL AND v_sl_api_id ~ '^\d+$' AND v_person_id IS NOT NULL THEN
    INSERT INTO trapper.person_identifiers (
      person_id, id_type, id_value_norm, id_value_raw, source_system, source_table
    ) VALUES (
      v_person_id, 'shelterluv_id'::trapper.identifier_type, v_sl_api_id, v_sl_api_id, 'shelterluv', 'people'
    ) ON CONFLICT (id_type, id_value_norm) DO NOTHING;
  END IF;

  -- MIG_874: Set resulting_entity_id so events can look up person
  UPDATE trapper.staged_records
  SET is_processed = true,
      processor_name = 'process_shelterluv_person',
      resulting_entity_type = CASE WHEN v_person_id IS NOT NULL THEN 'person' ELSE NULL END,
      resulting_entity_id = v_person_id
  WHERE id = p_staged_record_id;

  RETURN jsonb_build_object(
    'success', true,
    'person_id', v_person_id,
    'place_id', v_place_id,
    'sl_api_id', v_sl_api_id
  );
END;
$function$;

\echo '  → process_shelterluv_person() updated'

-- ============================================================================
-- FIX 7: DROP + CREATE process_shelterluv_events() with new return type
-- ============================================================================

\echo ''
\echo '--- Fix 7: Recreating process_shelterluv_events() ---'

DROP FUNCTION IF EXISTS trapper.process_shelterluv_events(integer);

CREATE OR REPLACE FUNCTION trapper.process_shelterluv_events(p_batch_size integer DEFAULT 500)
RETURNS TABLE(
  events_processed integer,
  adoptions_created integer,
  fosters_created integer,
  tnr_releases integer,
  mortality_events integer,
  returns_processed integer,
  transfers_logged integer,
  errors integer
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_rec RECORD;
  v_processed INT := 0;
  v_adoptions INT := 0;
  v_fosters INT := 0;
  v_tnr INT := 0;
  v_mortality INT := 0;
  v_returns INT := 0;
  v_transfers INT := 0;
  v_errors INT := 0;
  v_event_type TEXT;
  v_event_subtype TEXT;
  v_animal_id TEXT;
  v_person_id_str TEXT;
  v_cat_id UUID;
  v_person_id UUID;
  v_place_id UUID;
  v_event_time TIMESTAMPTZ;
  v_assoc JSONB;
  v_rel_type TEXT;
  v_context_type TEXT;
BEGIN
  FOR v_rec IN
    SELECT sr.id, sr.payload
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'shelterluv'
      AND sr.source_table = 'events'
      AND sr.is_processed IS NOT TRUE
    ORDER BY (sr.payload->>'Time')::bigint ASC NULLS LAST
    LIMIT p_batch_size
  LOOP
    BEGIN
      v_event_type := v_rec.payload->>'Type';
      v_event_subtype := COALESCE(v_rec.payload->>'Subtype', '');

      -- Extract event timestamp
      IF v_rec.payload->>'Time' IS NOT NULL THEN
        v_event_time := to_timestamp((v_rec.payload->>'Time')::bigint);
      ELSE
        v_event_time := NULL;
      END IF;

      -- Extract animal and person IDs from AssociatedRecords
      v_animal_id := NULL;
      v_person_id_str := NULL;
      v_cat_id := NULL;
      v_person_id := NULL;
      v_place_id := NULL;

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

      -- === ANIMAL LOOKUP ===
      -- Try numeric API ID first (from API events)
      IF v_animal_id IS NOT NULL THEN
        SELECT ci.cat_id INTO v_cat_id
        FROM trapper.cat_identifiers ci
        WHERE ci.id_type = 'shelterluv_id' AND ci.id_value = v_animal_id;

        -- Fallback: try FFSC-A-NNNN format (from XLSX events)
        IF v_cat_id IS NULL THEN
          SELECT ci.cat_id INTO v_cat_id
          FROM trapper.cat_identifiers ci
          WHERE ci.id_type = 'shelterluv_id'
            AND (ci.id_value = 'FFSC-A-' || v_animal_id
              OR ci.id_value = 'sl_animal_FFSC-A-' || v_animal_id);
        END IF;
      END IF;

      -- === PERSON LOOKUP ===
      -- Use person_identifiers (shelterluv_id) instead of staged_records.source_row_id
      IF v_person_id_str IS NOT NULL THEN
        SELECT pi.person_id INTO v_person_id
        FROM trapper.person_identifiers pi
        WHERE pi.id_type = 'shelterluv_id'::trapper.identifier_type
          AND pi.id_value_norm = v_person_id_str;
      END IF;

      -- === FIND PERSON'S PLACE (for context tagging) ===
      IF v_person_id IS NOT NULL THEN
        SELECT ppr.place_id INTO v_place_id
        FROM trapper.person_place_relationships ppr
        WHERE ppr.person_id = v_person_id
          AND ppr.role = 'resident'::trapper.person_place_role
        ORDER BY ppr.created_at DESC
        LIMIT 1;
      END IF;

      -- === PROCESS BY EVENT TYPE ===

      IF v_event_type = 'Outcome.Adoption' THEN
        -- Determine relationship and context type based on subtype
        v_rel_type := 'adopter';

        IF v_event_subtype = 'Relocation' THEN
          v_context_type := 'relocation_destination';
        ELSIF v_event_subtype = 'Returned to Colony' THEN
          v_context_type := 'colony_site';
          v_rel_type := 'caretaker';
        ELSE
          v_context_type := 'adopter_residence';
        END IF;

        -- Create person_cat_relationship
        IF v_cat_id IS NOT NULL AND v_person_id IS NOT NULL THEN
          INSERT INTO trapper.person_cat_relationships (
            person_id, cat_id, relationship_type,
            effective_date, source_system, source_table, context_notes
          ) VALUES (
            v_person_id, v_cat_id, v_rel_type,
            v_event_time::date, 'shelterluv', 'events',
            'SL event ' || COALESCE(v_rec.payload->>'Internal-ID', '') || ': ' || v_event_subtype
          ) ON CONFLICT DO NOTHING;
          v_adoptions := v_adoptions + 1;
        END IF;

        -- Tag place with context
        IF v_place_id IS NOT NULL THEN
          PERFORM trapper.assign_place_context(
            p_place_id := v_place_id,
            p_context_type := v_context_type,
            p_evidence_type := 'shelterluv_outcome',
            p_evidence_notes := v_event_type || ': ' || v_event_subtype,
            p_source_system := 'shelterluv',
            p_assigned_by := 'process_shelterluv_events'
          );
        END IF;

      ELSIF v_event_type = 'Outcome.Foster' THEN
        IF v_cat_id IS NOT NULL AND v_person_id IS NOT NULL THEN
          INSERT INTO trapper.person_cat_relationships (
            person_id, cat_id, relationship_type,
            effective_date, source_system, source_table, context_notes
          ) VALUES (
            v_person_id, v_cat_id, 'foster',
            v_event_time::date, 'shelterluv', 'events',
            'SL foster event ' || COALESCE(v_rec.payload->>'Internal-ID', '')
          ) ON CONFLICT DO NOTHING;
          v_fosters := v_fosters + 1;
        END IF;

        -- Tag place as foster home
        IF v_place_id IS NOT NULL THEN
          PERFORM trapper.assign_place_context(
            p_place_id := v_place_id,
            p_context_type := 'foster_home',
            p_evidence_type := 'shelterluv_outcome',
            p_evidence_notes := 'Foster placement via ShelterLuv',
            p_source_system := 'shelterluv',
            p_assigned_by := 'process_shelterluv_events'
          );
        END IF;

      ELSIF v_event_type = 'Outcome.FeralWildlife' THEN
        -- TNR release — create colony_site context
        IF v_place_id IS NOT NULL THEN
          PERFORM trapper.assign_place_context(
            p_place_id := v_place_id,
            p_context_type := 'colony_site',
            p_evidence_type := 'shelterluv_outcome',
            p_evidence_notes := 'Feral/wildlife release: ' || v_event_subtype,
            p_source_system := 'shelterluv',
            p_assigned_by := 'process_shelterluv_events'
          );
        END IF;
        v_tnr := v_tnr + 1;

      ELSIF v_event_type IN ('Outcome.Euthanasia', 'Outcome.UnassistedDeathInCustody') THEN
        -- Mortality event
        IF v_cat_id IS NOT NULL THEN
          INSERT INTO trapper.cat_mortality_events (
            cat_id, death_date, death_cause,
            death_cause_notes, source_system, source_record_id
          ) VALUES (
            v_cat_id, v_event_time::date,
            CASE WHEN v_event_type = 'Outcome.Euthanasia' THEN 'euthanasia'::trapper.death_cause ELSE 'unknown'::trapper.death_cause END,
            v_event_subtype,
            'shelterluv', v_rec.payload->>'Internal-ID'
          ) ON CONFLICT DO NOTHING;
          v_mortality := v_mortality + 1;
        END IF;

      ELSIF v_event_type = 'Outcome.ReturnToOwner' THEN
        -- Return to owner — create owner relationship + colony_site context
        IF v_cat_id IS NOT NULL AND v_person_id IS NOT NULL THEN
          INSERT INTO trapper.person_cat_relationships (
            person_id, cat_id, relationship_type,
            effective_date, source_system, source_table, context_notes
          ) VALUES (
            v_person_id, v_cat_id, 'owner',
            v_event_time::date, 'shelterluv', 'events',
            'SL return to owner: ' || v_event_subtype
          ) ON CONFLICT DO NOTHING;
          v_returns := v_returns + 1;
        END IF;

        IF v_place_id IS NOT NULL THEN
          PERFORM trapper.assign_place_context(
            p_place_id := v_place_id,
            p_context_type := 'colony_site',
            p_evidence_type := 'shelterluv_outcome',
            p_evidence_notes := 'Return to owner: ' || v_event_subtype,
            p_source_system := 'shelterluv',
            p_assigned_by := 'process_shelterluv_events'
          );
        END IF;

      ELSIF v_event_type = 'Outcome.Transfer' THEN
        -- Log transfer (partner org tracking is future work)
        v_transfers := v_transfers + 1;

      END IF;

      -- Mark as processed
      UPDATE trapper.staged_records
      SET is_processed = true,
          processor_name = 'process_shelterluv_events',
          resulting_entity_type = CASE
            WHEN v_cat_id IS NOT NULL THEN 'cat'
            ELSE NULL
          END,
          resulting_entity_id = v_cat_id
      WHERE id = v_rec.id;

      v_processed := v_processed + 1;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE WARNING 'Error processing event %: %', v_rec.id, SQLERRM;

      UPDATE trapper.staged_records
      SET is_processed = true,
          processor_name = 'process_shelterluv_events_error'
      WHERE id = v_rec.id;
    END;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_adoptions, v_fosters, v_tnr, v_mortality, v_returns, v_transfers, v_errors;
END;
$function$;

\echo '  → process_shelterluv_events() recreated with correct return type'

-- ============================================================================
-- FIX 8: Re-reset all outcome events and reprocess
-- ============================================================================

\echo ''
\echo '--- Fix 8: Re-resetting and reprocessing outcome events ---'

WITH reset AS (
  UPDATE trapper.staged_records
  SET is_processed = false, processor_name = NULL,
      resulting_entity_type = NULL, resulting_entity_id = NULL
  WHERE source_system = 'shelterluv'
    AND source_table = 'events'
    AND payload->>'Type' LIKE 'Outcome.%'
  RETURNING id
)
SELECT count(*) as reset_events FROM reset \gset

\echo '  → Reset :reset_events outcome events for reprocessing'

\echo '  Processing batch 1...'
SELECT * FROM trapper.process_shelterluv_events(1000);

\echo '  Processing batch 2...'
SELECT * FROM trapper.process_shelterluv_events(1000);

\echo '  Processing batch 3...'
SELECT * FROM trapper.process_shelterluv_events(1000);

\echo '  Processing batch 4...'
SELECT * FROM trapper.process_shelterluv_events(1000);

\echo '  Processing batch 5...'
SELECT * FROM trapper.process_shelterluv_events(1000);

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '--- Verification ---'

\echo ''
\echo 'Remaining unprocessed outcome events:'
SELECT COUNT(*) as unprocessed_outcome_events
FROM trapper.staged_records
WHERE source_system = 'shelterluv' AND source_table = 'events'
  AND payload->>'Type' LIKE 'Outcome.%' AND is_processed IS NOT TRUE;

\echo ''
\echo 'ShelterLuv relationships from events:'
SELECT pcr.relationship_type, COUNT(*) as total,
  COUNT(DISTINCT pcr.cat_id) as distinct_cats,
  COUNT(DISTINCT pcr.person_id) as distinct_people
FROM trapper.person_cat_relationships pcr
WHERE pcr.source_system = 'shelterluv' AND pcr.source_table = 'events'
GROUP BY pcr.relationship_type ORDER BY total DESC;

\echo ''
\echo 'Place contexts from events processor:'
SELECT context_type, COUNT(*) as count
FROM trapper.place_contexts
WHERE assigned_by = 'process_shelterluv_events'
GROUP BY context_type ORDER BY count DESC;

\echo ''
\echo 'Relocation destinations (for map):'
SELECT COUNT(*) as relocation_destination_count
FROM trapper.place_contexts WHERE context_type = 'relocation_destination';

\echo ''
\echo 'Numeric SL IDs in cat_identifiers:'
SELECT COUNT(*) as numeric_sl_ids FROM trapper.cat_identifiers
WHERE id_type = 'shelterluv_id' AND id_value ~ '^\d+$';

\echo ''
\echo 'Person SL IDs in person_identifiers:'
SELECT COUNT(*) as person_sl_ids FROM trapper.person_identifiers
WHERE id_type = 'shelterluv_id'::trapper.identifier_type;

\echo ''
\echo 'Match rates for outcome events:'
SELECT
  v_event_type,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE cat_matched) as cat_matches,
  COUNT(*) FILTER (WHERE person_matched) as person_matches,
  COUNT(*) FILTER (WHERE cat_matched AND person_matched) as both_matched,
  ROUND(100.0 * COUNT(*) FILTER (WHERE cat_matched) / NULLIF(COUNT(*), 0), 1) as cat_match_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE person_matched) / NULLIF(COUNT(*), 0), 1) as person_match_pct
FROM (
  SELECT
    sr.payload->>'Type' as v_event_type,
    sr.resulting_entity_id IS NOT NULL as cat_matched,
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(sr.payload->'AssociatedRecords') ar
      WHERE ar->>'Type' = 'Person'
        AND EXISTS (
          SELECT 1 FROM trapper.person_identifiers pi
          WHERE pi.id_type = 'shelterluv_id'::trapper.identifier_type
            AND pi.id_value_norm = ar->>'Id'
        )
    ) as person_matched
  FROM trapper.staged_records sr
  WHERE sr.source_system = 'shelterluv' AND sr.source_table = 'events'
    AND sr.payload->>'Type' LIKE 'Outcome.%'
) sub
GROUP BY v_event_type
ORDER BY total DESC;

\echo ''
\echo '=== MIG_874b Complete ==='
