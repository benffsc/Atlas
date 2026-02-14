\echo '=== MIG_874: ShelterLuv API Outcome Migration + Relocation Tracking ==='
\echo 'Dumps corrupted XLSX outcomes, fixes ID mismatches, enables API-sourced outcomes.'
\echo 'Adds relocation_destination place context for map visibility.'
\echo ''

-- ============================================================================
-- PHASE 1: ADD RELOCATION DESTINATION PLACE CONTEXT TYPE
-- ============================================================================

\echo '--- Phase 1: Adding relocation_destination context type ---'

INSERT INTO trapper.place_context_types (context_type, display_label, description, sort_order)
VALUES ('relocation_destination', 'Relocation Destination',
        'Location where cats are relocated (barn cats, working cats, relocation programs)', 25)
ON CONFLICT (context_type) DO NOTHING;

\echo '  → relocation_destination context type added'


-- ============================================================================
-- PHASE 2: DELETE XLSX OUTCOME POLLUTION
-- ============================================================================

\echo ''
\echo '--- Phase 2: Deleting XLSX outcome data ---'

-- 2a. Delete place_contexts from XLSX outcome processor
WITH deleted_pc AS (
  DELETE FROM trapper.place_contexts
  WHERE assigned_by = 'shelterluv_outcome_processor'
  RETURNING place_context_id
)
SELECT count(*) as deleted_place_contexts FROM deleted_pc \gset

\echo '  → Deleted :deleted_place_contexts place_contexts'

-- 2b. Delete person_place_relationships from XLSX outcomes
WITH deleted_ppr AS (
  DELETE FROM trapper.person_place_relationships
  WHERE source_system = 'shelterluv' AND source_table = 'outcomes'
  RETURNING person_id
)
SELECT count(*) as deleted_person_place FROM deleted_ppr \gset

\echo '  → Deleted :deleted_person_place person_place_relationships'

-- 2c. Delete person_cat_relationships from XLSX outcomes
WITH deleted_pcr AS (
  DELETE FROM trapper.person_cat_relationships
  WHERE source_system = 'shelterluv' AND source_table = 'outcomes'
  RETURNING person_cat_id
)
SELECT count(*) as deleted_person_cat FROM deleted_pcr \gset

\echo '  → Deleted :deleted_person_cat person_cat_relationships'

-- 2d. Delete data_engine_match_decisions for XLSX outcome records
WITH outcome_ids AS (
  SELECT sr.id FROM trapper.staged_records sr
  WHERE sr.source_system = 'shelterluv' AND sr.source_table = 'outcomes'
),
deleted_ded AS (
  DELETE FROM trapper.data_engine_match_decisions d
  USING outcome_ids o WHERE d.staged_record_id = o.id
  RETURNING d.decision_id
)
SELECT count(*) as deleted_decisions FROM deleted_ded \gset

\echo '  → Deleted :deleted_decisions data_engine_match_decisions'

-- 2e. Delete XLSX outcome staged_records themselves
WITH deleted_sr AS (
  DELETE FROM trapper.staged_records
  WHERE source_system = 'shelterluv' AND source_table = 'outcomes'
  RETURNING id
)
SELECT count(*) as deleted_staged FROM deleted_sr \gset

\echo '  → Deleted :deleted_staged staged_records (XLSX outcomes)'


-- ============================================================================
-- PHASE 3: BACKFILL ANIMAL API IDS INTO CAT_IDENTIFIERS
-- ============================================================================

\echo ''
\echo '--- Phase 3: Backfilling animal API IDs ---'

-- Animals from API have Internal-ID (numeric). Animals from XLSX have Internal ID (API) (numeric).
-- Events reference animals by these numeric IDs. cat_identifiers only has FFSC-A-NNNN format.
-- We need to add the numeric API IDs so events can match.

DO $$
DECLARE
  v_rec RECORD;
  v_cat_id UUID;
  v_api_id TEXT;
  v_chip TEXT;
  v_added INT := 0;
  v_skipped INT := 0;
  v_no_cat INT := 0;
BEGIN
  FOR v_rec IN
    SELECT sr.id, sr.payload, sr.source_row_id
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'shelterluv'
      AND sr.source_table = 'animals'
      AND sr.is_processed = true
  LOOP
    -- Extract the numeric API ID (different field name in API vs XLSX payloads)
    v_api_id := COALESCE(
      v_rec.payload->>'Internal-ID',          -- API format (numeric)
      v_rec.payload->>'Internal ID (API)'     -- XLSX format (numeric, spaces in key)
    );

    -- Skip if no numeric API ID
    IF v_api_id IS NULL OR v_api_id !~ '^[0-9]+$' THEN
      CONTINUE;
    END IF;

    -- Check if this API ID already exists in cat_identifiers
    SELECT ci.cat_id INTO v_cat_id
    FROM trapper.cat_identifiers ci
    WHERE ci.id_type = 'shelterluv_id' AND ci.id_value = v_api_id;

    IF v_cat_id IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Try to find the cat via existing shelterluv_id entries
    -- Join through Animal ID (FFSC-A-NNNN) or sl_animal_ prefix
    v_cat_id := NULL;

    -- Try FFSC-A-NNNN format (from XLSX)
    IF v_rec.payload->>'Animal ID' IS NOT NULL THEN
      SELECT ci.cat_id INTO v_cat_id
      FROM trapper.cat_identifiers ci
      WHERE ci.id_type = 'shelterluv_id'
        AND (ci.id_value = v_rec.payload->>'Animal ID'
          OR ci.id_value = 'sl_animal_' || v_rec.payload->>'Animal ID');
    END IF;

    -- Try source_row_id match (for API records where source_row_id = Internal-ID)
    IF v_cat_id IS NULL THEN
      SELECT ci.cat_id INTO v_cat_id
      FROM trapper.cat_identifiers ci
      WHERE ci.id_type = 'shelterluv_id'
        AND ci.id_value = v_rec.source_row_id;
    END IF;

    -- Try microchip match as fallback
    IF v_cat_id IS NULL THEN
      v_chip := COALESCE(v_rec.payload->>'Microchip Number', v_rec.payload->>'Microchip');
      IF v_chip IS NOT NULL AND v_chip != '' THEN
        -- Handle scientific notation
        IF v_chip ~ '^[0-9.]+E\+[0-9]+$' THEN
          BEGIN
            v_chip := TRIM(TO_CHAR(v_chip::NUMERIC, '999999999999999'));
          EXCEPTION WHEN OTHERS THEN
            v_chip := NULL;
          END;
        ELSE
          v_chip := TRIM(v_chip);
        END IF;

        IF v_chip IS NOT NULL AND LENGTH(v_chip) >= 9 AND LENGTH(v_chip) <= 15 THEN
          SELECT ci.cat_id INTO v_cat_id
          FROM trapper.cat_identifiers ci
          WHERE ci.id_type = 'microchip' AND ci.id_value = v_chip;
        END IF;
      END IF;
    END IF;

    IF v_cat_id IS NOT NULL THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
      VALUES (v_cat_id, 'shelterluv_id', v_api_id, 'shelterluv', 'api_id_backfill')
      ON CONFLICT DO NOTHING;
      IF FOUND THEN v_added := v_added + 1; END IF;
    ELSE
      v_no_cat := v_no_cat + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Animal API ID backfill: % added, % already existed, % no cat match',
    v_added, v_skipped, v_no_cat;
END $$;

-- Also update process_shelterluv_animal() to store BOTH IDs going forward
-- The function already stores Internal-ID. For XLSX records it's FFSC-A-NNNN,
-- for API records it's numeric. We add: also store 'Internal ID (API)' if different.

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

  -- Extract cat fields
  v_microchip := COALESCE(
    v_record.payload->>'Microchip Number',
    v_record.payload->>'Microchip'
  );

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

  -- MIG_874: Extract both ID formats
  v_shelterluv_id := v_record.payload->>'Internal-ID';  -- API: numeric, XLSX: FFSC-A-NNNN
  v_shelterluv_api_id := v_record.payload->>'Internal ID (API)';  -- Numeric API ID (both formats)

  v_foster_email := NULLIF(TRIM(v_record.payload->>'Foster Person Email'), '');
  v_foster_person_name := NULLIF(TRIM(v_record.payload->>'Foster Person Name'), '');

  v_is_foster := (
    v_status ILIKE '%foster%'
    OR v_hold_reason ILIKE '%foster%'
    OR v_hold_for IS NOT NULL AND v_hold_for != ''
  );

  -- Cat matching: microchip first, then ShelterLuv ID fallback
  IF v_microchip IS NOT NULL AND LENGTH(v_microchip) >= 9 THEN
    v_cat_id := trapper.find_or_create_cat_by_microchip(
      p_microchip := v_microchip,
      p_name := v_animal_name,
      p_sex := v_sex,
      p_breed := v_breed,
      p_source_system := 'shelterluv'
    );
  END IF;

  IF v_cat_id IS NULL AND v_shelterluv_id IS NOT NULL THEN
    SELECT ci.cat_id INTO v_cat_id
    FROM trapper.cat_identifiers ci
    WHERE ci.id_type = 'shelterluv_id'
      AND ci.id_value = v_shelterluv_id;
  END IF;

  IF v_cat_id IS NOT NULL THEN
    -- Store primary SL ID (Internal-ID)
    IF v_shelterluv_id IS NOT NULL THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
      VALUES (v_cat_id, 'shelterluv_id', v_shelterluv_id, 'shelterluv', 'animals')
      ON CONFLICT DO NOTHING;
    END IF;

    -- MIG_874: Also store numeric API ID if different from Internal-ID
    IF v_shelterluv_api_id IS NOT NULL
       AND v_shelterluv_api_id ~ '^[0-9]+$'
       AND v_shelterluv_api_id IS DISTINCT FROM v_shelterluv_id THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
      VALUES (v_cat_id, 'shelterluv_id', v_shelterluv_api_id, 'shelterluv', 'animals')
      ON CONFLICT DO NOTHING;
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
      p_altered_status := v_altered_status
    );
  END IF;

  -- Foster matching (MIG_828: email-first)
  IF v_is_foster AND (v_hold_for IS NOT NULL OR v_foster_email IS NOT NULL) THEN
    IF v_foster_email IS NOT NULL THEN
      SELECT pi.person_id INTO v_foster_person_id
      FROM trapper.person_identifiers pi
      JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
      WHERE pi.id_type = 'email'
        AND pi.id_value_norm = LOWER(v_foster_email)
        AND sp.merged_into_person_id IS NULL
      LIMIT 1;

      IF v_foster_person_id IS NOT NULL THEN
        v_match_method := 'email';
      END IF;
    END IF;

    IF v_foster_person_id IS NOT NULL AND v_cat_id IS NOT NULL THEN
      PERFORM trapper.assign_person_role(v_foster_person_id, 'foster', 'shelterluv');

      INSERT INTO trapper.person_cat_relationships (
        person_id, cat_id, relationship_type, confidence,
        source_system, source_table
      ) VALUES (
        v_foster_person_id, v_cat_id, 'fosterer', 'high',
        'shelterluv', 'animals'
      ) ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table) DO NOTHING;
    ELSE
      INSERT INTO trapper.shelterluv_unmatched_fosters (
        staged_record_id, hold_for_name, foster_email, foster_person_name,
        cat_id, cat_name, shelterluv_animal_id, match_attempt
      ) VALUES (
        p_staged_record_id,
        COALESCE(v_hold_for, v_foster_person_name, 'unknown'),
        v_foster_email, v_foster_person_name, v_cat_id, v_animal_name,
        COALESCE(v_shelterluv_id, v_shelterluv_api_id),
        CASE WHEN v_foster_email IS NULL THEN 'no_email' ELSE 'email_not_found' END
      ) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

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
    'foster_match_method', v_match_method,
    'fields_recorded', v_fields_recorded
  );
END;
$function$;

\echo '  → process_shelterluv_animal() updated (stores both ID formats + sets resulting_entity_id)'


-- ============================================================================
-- PHASE 4: FIX PEOPLE PROCESSING + BACKFILL SL IDS
-- ============================================================================

\echo ''
\echo '--- Phase 4: Fixing people processing + backfilling SL IDs ---'

-- 4a. Update process_shelterluv_person() to:
--   - Store 'Internal ID (API)' as person_identifier
--   - Fix address field name ('Street Address 1' not 'Street Address')
--   - Set resulting_entity_id on staged_records

CREATE OR REPLACE FUNCTION trapper.process_shelterluv_person(p_staged_record_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_record RECORD;
  v_person_id UUID;
  v_email TEXT;
  v_phone TEXT;
  v_name TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_address TEXT;
  v_sl_api_id TEXT;
  v_was_new BOOLEAN := false;
  v_existing_count INT;
BEGIN
  SELECT * INTO v_record
  FROM trapper.staged_records
  WHERE id = p_staged_record_id;

  IF v_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Staged record not found');
  END IF;

  IF v_record.is_processed THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'already_processed');
  END IF;

  -- Extract fields (handles both API and XLSX field names)
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
  -- MIG_874: Extract ShelterLuv API ID for person_identifiers
  v_sl_api_id := COALESCE(
    v_record.payload->>'Internal ID (API)',   -- Both formats have this
    v_record.payload->>'Person ID'            -- Fallback to FFSC-P-NNNN
  );

  -- Skip if no identifiable information
  IF (v_email IS NULL OR TRIM(v_email) = '')
     AND (v_phone IS NULL OR TRIM(v_phone) = '')
     AND (v_name IS NULL OR TRIM(v_name) = '') THEN
    UPDATE trapper.staged_records
    SET is_processed = true, processed_at = NOW()
    WHERE id = p_staged_record_id;
    RETURN jsonb_build_object('success', false, 'skipped', true, 'reason', 'no_identifiable_info');
  END IF;

  -- Split name
  v_name := TRIM(v_name);
  IF v_name IS NOT NULL AND v_name <> '' THEN
    v_first_name := SPLIT_PART(v_name, ' ', 1);
    IF POSITION(' ' IN v_name) > 0 THEN
      v_last_name := TRIM(SUBSTRING(v_name FROM POSITION(' ' IN v_name) + 1));
    END IF;
  END IF;

  -- MIG_874: Fix address field — use 'Street Address 1' (SL actual field name)
  v_address := NULLIF(TRIM(CONCAT_WS(', ',
    NULLIF(TRIM(COALESCE(
      v_record.payload->>'Street Address 1',
      v_record.payload->>'Street Address',
      v_record.payload->>'Address',
      '')), ''),
    NULLIF(TRIM(COALESCE(v_record.payload->>'City', '')), ''),
    NULLIF(TRIM(COALESCE(v_record.payload->>'State', '')), ''),
    NULLIF(TRIM(COALESCE(
      v_record.payload->>'Zip',
      v_record.payload->>'Postal Code',
      '')), '')
  )), '');

  SELECT COUNT(*) INTO v_existing_count
  FROM trapper.sot_people WHERE merged_into_person_id IS NULL;

  v_person_id := trapper.find_or_create_person(
    p_email := v_email,
    p_phone := v_phone,
    p_first_name := v_first_name,
    p_last_name := v_last_name,
    p_address := v_address,
    p_source_system := 'shelterluv'
  );

  IF v_person_id IS NOT NULL THEN
    SELECT (COUNT(*) > v_existing_count) INTO v_was_new
    FROM trapper.sot_people WHERE merged_into_person_id IS NULL;

    -- MIG_874: Store ShelterLuv API ID as person_identifier for event lookups
    IF v_sl_api_id IS NOT NULL AND v_sl_api_id != '' THEN
      INSERT INTO trapper.person_identifiers (
        person_id, id_type, id_value, id_value_norm, source_system
      ) VALUES (
        v_person_id, 'shelterluv_id', v_sl_api_id, v_sl_api_id, 'shelterluv'
      ) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- MIG_874: Set resulting_entity_id so events can look up person
  UPDATE trapper.staged_records
  SET is_processed = true,
      processed_at = NOW(),
      resulting_entity_id = v_person_id
  WHERE id = p_staged_record_id;

  -- Audit trail
  IF v_person_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM trapper.data_engine_match_decisions WHERE staged_record_id = p_staged_record_id) THEN
      INSERT INTO trapper.data_engine_match_decisions (
        staged_record_id, source_system, incoming_name, incoming_email, incoming_phone,
        decision_type, decision_reason, resulting_person_id, processed_at
      ) VALUES (
        p_staged_record_id, 'shelterluv', v_name, v_email, v_phone,
        CASE WHEN v_was_new THEN 'new_entity' ELSE 'auto_match' END,
        CASE WHEN v_was_new THEN 'created_new_person' ELSE 'matched_by_identifier' END,
        v_person_id, NOW()
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', v_person_id IS NOT NULL,
    'person_id', v_person_id,
    'was_new', v_was_new,
    'email', v_email,
    'phone', v_phone,
    'name', v_name,
    'sl_api_id', v_sl_api_id
  );
END;
$function$;

\echo '  → process_shelterluv_person() updated (stores SL API ID + sets resulting_entity_id)'

-- 4b. Backfill: set resulting_entity_id from data_engine_match_decisions
\echo '  Backfilling resulting_entity_id on staged people records...'

WITH updated AS (
  UPDATE trapper.staged_records sr
  SET resulting_entity_id = d.resulting_person_id
  FROM trapper.data_engine_match_decisions d
  WHERE d.staged_record_id = sr.id
    AND sr.source_system = 'shelterluv' AND sr.source_table = 'people'
    AND sr.resulting_entity_id IS NULL
    AND d.resulting_person_id IS NOT NULL
  RETURNING sr.id
)
SELECT count(*) as backfilled_entity_ids FROM updated \gset

\echo '  → Backfilled :backfilled_entity_ids resulting_entity_ids'

-- 4c. Backfill: add SL API IDs to person_identifiers
\echo '  Backfilling SL API IDs into person_identifiers...'

WITH inserted AS (
  INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system)
  SELECT DISTINCT
    d.resulting_person_id,
    'shelterluv_id',
    sr.payload->>'Internal ID (API)',
    sr.payload->>'Internal ID (API)',
    'shelterluv'
  FROM trapper.staged_records sr
  JOIN trapper.data_engine_match_decisions d ON d.staged_record_id = sr.id
  WHERE sr.source_system = 'shelterluv' AND sr.source_table = 'people'
    AND d.resulting_person_id IS NOT NULL
    AND sr.payload->>'Internal ID (API)' IS NOT NULL
    AND sr.payload->>'Internal ID (API)' != ''
  ON CONFLICT DO NOTHING
  RETURNING person_id
)
SELECT count(*) as backfilled_person_sl_ids FROM inserted \gset

\echo '  → Backfilled :backfilled_person_sl_ids person SL API IDs'


-- ============================================================================
-- PHASE 5: FIX process_shelterluv_events() — FULL OUTCOME PROCESSING
-- ============================================================================

\echo ''
\echo '--- Phase 5: Fixing process_shelterluv_events() ---'

CREATE OR REPLACE FUNCTION trapper.process_shelterluv_events(p_batch_size integer DEFAULT 500)
 RETURNS TABLE(events_processed integer, adoptions_created integer, fosters_created integer,
               tnr_releases integer, mortality_events integer, returns_processed integer,
               transfers_logged integer, errors integer)
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
  v_partner_id_str TEXT;
  v_cat_id UUID;
  v_person_id UUID;
  v_place_id UUID;
  v_event_time TIMESTAMPTZ;
  v_context_type TEXT;
BEGIN
  FOR v_rec IN
    SELECT sr.id AS staged_record_id, sr.payload, sr.source_row_id
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
      v_cat_id := NULL;
      v_person_id := NULL;
      v_place_id := NULL;

      v_event_type := v_rec.payload->>'Type';
      v_event_subtype := NULLIF(v_rec.payload->>'Subtype', '');
      v_event_time := TO_TIMESTAMP((v_rec.payload->>'Time')::BIGINT);

      -- Extract IDs from AssociatedRecords
      SELECT r->>'Id' INTO v_animal_id
      FROM jsonb_array_elements(v_rec.payload->'AssociatedRecords') r
      WHERE r->>'Type' = 'Animal' LIMIT 1;

      SELECT r->>'Id' INTO v_person_id_str
      FROM jsonb_array_elements(v_rec.payload->'AssociatedRecords') r
      WHERE r->>'Type' = 'Person' LIMIT 1;

      SELECT r->>'Id' INTO v_partner_id_str
      FROM jsonb_array_elements(v_rec.payload->'AssociatedRecords') r
      WHERE r->>'Type' = 'Partner' LIMIT 1;

      -- ============================================================
      -- MIG_874: ANIMAL LOOKUP — try numeric API ID in cat_identifiers
      -- ============================================================
      IF v_animal_id IS NOT NULL THEN
        -- Direct match (numeric API ID)
        SELECT ci.cat_id INTO v_cat_id
        FROM trapper.cat_identifiers ci
        WHERE ci.id_type = 'shelterluv_id' AND ci.id_value = v_animal_id;

        -- Fallback: FFSC-A-NNNN format (from XLSX)
        IF v_cat_id IS NULL THEN
          SELECT ci.cat_id INTO v_cat_id
          FROM trapper.cat_identifiers ci
          WHERE ci.id_type = 'shelterluv_id'
            AND (ci.id_value = 'FFSC-A-' || v_animal_id
              OR ci.id_value = 'sl_animal_FFSC-A-' || v_animal_id);
        END IF;
      END IF;

      -- ============================================================
      -- MIG_874: PERSON LOOKUP — use person_identifiers (shelterluv_id)
      -- ============================================================
      IF v_person_id_str IS NOT NULL THEN
        -- Match by SL API ID in person_identifiers
        SELECT pi.person_id INTO v_person_id
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
        WHERE pi.id_type = 'shelterluv_id'
          AND pi.id_value = v_person_id_str
          AND sp.merged_into_person_id IS NULL
        LIMIT 1;

        -- Fallback: try staged_records resulting_entity_id
        IF v_person_id IS NULL THEN
          SELECT sr2.resulting_entity_id INTO v_person_id
          FROM trapper.staged_records sr2
          WHERE sr2.source_system = 'shelterluv'
            AND sr2.source_table = 'people'
            AND sr2.resulting_entity_id IS NOT NULL
            AND (sr2.source_row_id = v_person_id_str
              OR sr2.payload->>'Internal ID (API)' = v_person_id_str)
          LIMIT 1;
        END IF;
      END IF;

      -- ============================================================
      -- MIG_874: PLACE LOOKUP — find person's residential place
      -- ============================================================
      IF v_person_id IS NOT NULL THEN
        SELECT ppr.place_id INTO v_place_id
        FROM trapper.person_place_relationships ppr
        WHERE ppr.person_id = v_person_id
          AND ppr.role IN ('resident', 'owner')
        LIMIT 1;
      END IF;

      -- ============================================================
      -- PROCESS BY EVENT TYPE
      -- ============================================================
      CASE
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
            ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table)
            DO UPDATE SET effective_date = LEAST(
              trapper.person_cat_relationships.effective_date, EXCLUDED.effective_date
            );
            v_adoptions := v_adoptions + 1;

            -- MIG_874: Tag place with context based on subtype
            IF v_place_id IS NOT NULL THEN
              v_context_type := CASE
                WHEN v_event_subtype = 'Relocation' THEN 'relocation_destination'
                ELSE 'adopter_residence'
              END;

              PERFORM trapper.assign_place_context(
                p_place_id := v_place_id,
                p_context_type := v_context_type,
                p_valid_from := v_event_time::DATE,
                p_confidence := 0.90,
                p_source_system := 'shelterluv',
                p_source_record_id := v_rec.source_row_id,
                p_assigned_by := 'process_shelterluv_events'
              );
            END IF;
          END IF;

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
            ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table)
            DO UPDATE SET effective_date = LEAST(
              trapper.person_cat_relationships.effective_date, EXCLUDED.effective_date
            );
            v_fosters := v_fosters + 1;

            -- Tag foster's place as foster_home
            IF v_place_id IS NOT NULL THEN
              PERFORM trapper.assign_place_context(
                p_place_id := v_place_id,
                p_context_type := 'foster_home',
                p_valid_from := v_event_time::DATE,
                p_confidence := 0.85,
                p_source_system := 'shelterluv',
                p_source_record_id := v_rec.source_row_id,
                p_assigned_by := 'process_shelterluv_events'
              );
            END IF;
          END IF;

        -- MIG_874: NEW — Return to Owner
        WHEN v_event_type = 'Outcome.ReturnToOwner' THEN
          IF v_cat_id IS NOT NULL AND v_person_id IS NOT NULL THEN
            INSERT INTO trapper.person_cat_relationships (
              person_id, cat_id, relationship_type, confidence,
              source_system, source_table, effective_date, context_notes
            ) VALUES (
              v_person_id, v_cat_id, 'owner', 'high',
              'shelterluv', 'events', v_event_time::DATE,
              'Return to owner: ' || COALESCE(v_event_subtype, 'standard')
            )
            ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table)
            DO UPDATE SET effective_date = LEAST(
              trapper.person_cat_relationships.effective_date, EXCLUDED.effective_date
            );
            v_returns := v_returns + 1;

            IF v_place_id IS NOT NULL THEN
              PERFORM trapper.assign_place_context(
                p_place_id := v_place_id,
                p_context_type := 'colony_site',
                p_valid_from := v_event_time::DATE,
                p_confidence := 0.70,
                p_source_system := 'shelterluv',
                p_source_record_id := v_rec.source_row_id,
                p_assigned_by := 'process_shelterluv_events'
              );
            END IF;
          END IF;

        -- MIG_874: NEW — Transfer (log only, partner org tracking is future work)
        WHEN v_event_type = 'Outcome.Transfer' THEN
          v_transfers := v_transfers + 1;
          -- Future: link to partner_organizations table via v_partner_id_str

        WHEN v_event_type = 'Outcome.FeralWildlife'
             AND v_event_subtype = 'Released to Feral Colony' THEN
          IF v_cat_id IS NOT NULL THEN
            UPDATE trapper.sot_cats
            SET altered_status = 'altered',
                notes = COALESCE(notes, '') || E'\n[ShelterLuv] Released to colony ' || v_event_time::DATE
            WHERE cat_id = v_cat_id
              AND (altered_status IS NULL OR altered_status = 'unknown');
            v_tnr := v_tnr + 1;
          END IF;

        WHEN v_event_type = 'Outcome.Euthanasia' THEN
          IF v_cat_id IS NOT NULL THEN
            INSERT INTO trapper.cat_mortality_events (
              cat_id, death_date, death_cause,
              source_system, source_record_id, notes
            ) VALUES (
              v_cat_id, v_event_time::DATE, 'euthanasia',
              'shelterluv', v_rec.source_row_id,
              'ShelterLuv: ' || COALESCE(v_event_subtype, 'euthanasia')
            ) ON CONFLICT DO NOTHING;

            UPDATE trapper.sot_cats
            SET is_deceased = TRUE,
                deceased_date = COALESCE(deceased_date, v_event_time::DATE)
            WHERE cat_id = v_cat_id;
            v_mortality := v_mortality + 1;
          END IF;

        WHEN v_event_type = 'Outcome.UnassistedDeathInCustody' THEN
          IF v_cat_id IS NOT NULL THEN
            INSERT INTO trapper.cat_mortality_events (
              cat_id, death_date, death_cause,
              source_system, source_record_id, notes
            ) VALUES (
              v_cat_id, v_event_time::DATE, 'natural',
              'shelterluv', v_rec.source_row_id,
              'Died in care: ' || COALESCE(v_event_subtype, 'unknown')
            ) ON CONFLICT DO NOTHING;

            UPDATE trapper.sot_cats
            SET is_deceased = TRUE,
                deceased_date = COALESCE(deceased_date, v_event_time::DATE)
            WHERE cat_id = v_cat_id;
            v_mortality := v_mortality + 1;
          END IF;

        ELSE
          NULL; -- Outcome.Lost, etc.
      END CASE;

      -- Mark processed
      UPDATE trapper.staged_records
      SET is_processed = TRUE,
          processor_name = 'process_shelterluv_events',
          resulting_entity_type = CASE
            WHEN v_event_type IN ('Outcome.Adoption', 'Outcome.Foster', 'Outcome.ReturnToOwner') THEN 'relationship'
            WHEN v_event_type IN ('Outcome.Euthanasia', 'Outcome.UnassistedDeathInCustody') THEN 'mortality_event'
            WHEN v_event_type = 'Outcome.Transfer' THEN 'transfer'
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

  RETURN QUERY SELECT v_processed, v_adoptions, v_fosters, v_tnr,
    v_mortality, v_returns, v_transfers, v_errors;
END;
$function$;

\echo '  → process_shelterluv_events() updated with ID fix + place tagging + new outcome types'


-- ============================================================================
-- PHASE 6: RESET AND REPROCESS ALL OUTCOME EVENTS
-- ============================================================================

\echo ''
\echo '--- Phase 6: Resetting outcome events for reprocessing ---'

WITH reset AS (
  UPDATE trapper.staged_records
  SET is_processed = FALSE,
      processor_name = NULL,
      resulting_entity_type = NULL,
      processing_error = NULL
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
-- PHASE 7: VERIFICATION
-- ============================================================================

\echo ''
\echo '--- Phase 7: Verification ---'

\echo ''
\echo 'Remaining unprocessed outcome events:'

SELECT COUNT(*) as unprocessed_outcome_events
FROM trapper.staged_records
WHERE source_system = 'shelterluv'
  AND source_table = 'events'
  AND is_processed IS NOT TRUE
  AND payload->>'Type' LIKE 'Outcome.%';

\echo ''
\echo 'XLSX outcome data remaining (should be 0):'

SELECT COUNT(*) as remaining_xlsx_outcomes
FROM trapper.staged_records
WHERE source_system = 'shelterluv' AND source_table = 'outcomes';

\echo ''
\echo 'ShelterLuv relationships from events:'

SELECT
  pcr.relationship_type,
  COUNT(*) as total,
  COUNT(DISTINCT pcr.cat_id) as distinct_cats,
  COUNT(DISTINCT pcr.person_id) as distinct_people
FROM trapper.person_cat_relationships pcr
WHERE pcr.source_system = 'shelterluv'
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
FROM trapper.place_contexts
WHERE context_type = 'relocation_destination';

\echo ''
\echo 'Person SL IDs available for event matching:'

SELECT COUNT(*) as person_sl_ids
FROM trapper.person_identifiers
WHERE id_type = 'shelterluv_id';

\echo ''
\echo 'Cat SL IDs (numeric API format) available:'

SELECT COUNT(*) as numeric_sl_ids
FROM trapper.cat_identifiers
WHERE id_type = 'shelterluv_id' AND id_value ~ '^[0-9]+$';


-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=== MIG_874 Complete ==='
\echo 'ShelterLuv API Outcome Migration + Relocation Tracking'
\echo ''
\echo 'Phase 1: Added relocation_destination place context type'
\echo 'Phase 2: Deleted XLSX outcome data (corrupted by Excel scientific notation)'
\echo 'Phase 3: Backfilled animal API IDs into cat_identifiers'
\echo 'Phase 4: Fixed people processing + backfilled SL API IDs'
\echo 'Phase 5: Fixed process_shelterluv_events() with:'
\echo '  - Numeric API ID lookup for animals'
\echo '  - person_identifiers lookup for people'
\echo '  - Place context tagging (adopter_residence, relocation_destination, foster_home)'
\echo '  - New: ReturnToOwner, Transfer handling'
\echo 'Phase 6: Reset + reprocessed all outcome events from API data'
\echo ''
\echo 'Relocation spots are now queryable on the map via:'
\echo '  SELECT * FROM trapper.place_contexts WHERE context_type = ''relocation_destination'''
