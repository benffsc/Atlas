-- MIG_2402: Fix ShelterLuv Animal Processor
--
-- Problem: MIG_2026's process_shelterluv_animal calls find_or_create_cat_by_microchip
-- with parameters that don't exist:
--   - p_primary_color (should be p_color)
--   - p_secondary_color (not supported)
--   - p_source_record_id (not supported)
--
-- Fix: Update to use correct parameter names.
--
-- Created: 2026-02-19

\echo ''
\echo '=============================================='
\echo '  MIG_2402: Fix ShelterLuv Animal Processor'
\echo '=============================================='
\echo ''

-- Drop existing function
DROP FUNCTION IF EXISTS ops.process_shelterluv_animal(uuid);

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
  v_combined_color TEXT;
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
  v_microchip := NULLIF(TRIM(v_microchip), '');

  -- Extract other fields
  v_animal_name := NULLIF(TRIM(v_record.payload->>'Name'), '');
  v_sex := NULLIF(TRIM(v_record.payload->>'Sex'), '');
  v_breed := NULLIF(TRIM(v_record.payload->>'Breed'), '');
  v_primary_color := NULLIF(TRIM(v_record.payload->>'Primary Color'), '');
  v_secondary_color := NULLIF(TRIM(v_record.payload->>'Secondary Color'), '');
  -- Map ShelterLuv altered values to DB constraint values
  -- ShelterLuv: Yes, No, Unknown -> DB: spayed/neutered, intact, unknown
  v_altered_status := CASE UPPER(TRIM(v_record.payload->>'Altered'))
    WHEN 'YES' THEN
      CASE UPPER(v_sex)
        WHEN 'FEMALE' THEN 'spayed'
        WHEN 'MALE' THEN 'neutered'
        ELSE 'neutered'  -- Default to neutered if sex unknown but altered
      END
    WHEN 'NO' THEN 'intact'
    WHEN 'UNKNOWN' THEN 'unknown'
    ELSE 'unknown'
  END;
  v_status := NULLIF(TRIM(v_record.payload->>'Status'), '');

  -- Combine colors for single color field
  v_combined_color := CASE
    WHEN v_secondary_color IS NOT NULL AND v_primary_color IS NOT NULL
      THEN v_primary_color || '/' || v_secondary_color
    ELSE v_primary_color
  END;

  -- Extract ShelterLuv IDs
  v_shelterluv_id := NULLIF(TRIM(v_record.payload->>'Internal-ID'), '');
  v_shelterluv_api_id := NULLIF(TRIM(v_record.source_row_id), '');

  -- Extract foster info
  v_foster_email := NULLIF(TRIM(v_record.payload->>'Foster.Email'), '');

  v_is_foster := (
    v_record.payload->>'InFoster' = 'true'
    OR v_status ILIKE '%foster%'
    OR v_foster_email IS NOT NULL
  );

  -- Find/create cat by microchip
  IF v_microchip IS NOT NULL AND LENGTH(v_microchip) >= 9 THEN
    -- FIXED: Use correct parameter names
    v_cat_id := sot.find_or_create_cat_by_microchip(
      p_microchip := v_microchip,
      p_name := v_animal_name,
      p_sex := v_sex,
      p_breed := v_breed,
      p_altered_status := v_altered_status,
      p_color := v_combined_color,
      p_source_system := 'shelterluv'
    );
    v_match_method := 'microchip';
  END IF;

  -- Try ShelterLuv ID if no microchip
  IF v_cat_id IS NULL AND v_shelterluv_id IS NOT NULL THEN
    SELECT ci.cat_id INTO v_cat_id
    FROM sot.cat_identifiers ci
    WHERE ci.id_type = 'shelterluv_animal_id'
      AND ci.id_value = v_shelterluv_id;
    IF v_cat_id IS NOT NULL THEN
      v_match_method := 'shelterluv_animal_id';
    END IF;
  END IF;

  IF v_cat_id IS NOT NULL THEN
    -- Store SL IDs in cat_identifiers
    IF v_shelterluv_id IS NOT NULL THEN
      INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system)
      VALUES (v_cat_id, 'shelterluv_animal_id', v_shelterluv_id, 'shelterluv')
      ON CONFLICT DO NOTHING;
    END IF;

    IF v_shelterluv_api_id IS NOT NULL
       AND v_shelterluv_api_id ~ '^[0-9]+$'
       AND v_shelterluv_api_id IS DISTINCT FROM v_shelterluv_id THEN
      INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system)
      VALUES (v_cat_id, 'shelterluv_animal_id', v_shelterluv_api_id, 'shelterluv')
      ON CONFLICT DO NOTHING;
    END IF;

    -- Handle foster relationship
    IF v_is_foster AND v_foster_email IS NOT NULL THEN
      BEGIN
        SELECT pi.person_id INTO v_foster_person_id
        FROM sot.person_identifiers pi
        JOIN sot.people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = LOWER(TRIM(v_foster_email))
          AND pi.confidence >= 0.5
          AND p.merged_into_person_id IS NULL
        LIMIT 1;

        IF v_foster_person_id IS NOT NULL THEN
          INSERT INTO sot.person_cat (person_id, cat_id, relationship_type, source_system, source_record_id)
          VALUES (v_foster_person_id, v_cat_id, 'foster', 'shelterluv', v_shelterluv_id)
          ON CONFLICT DO NOTHING;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL; -- Skip foster linking errors
      END;
    END IF;
  ELSE
    -- No microchip and no existing SL ID - create new cat if we have a name
    IF v_animal_name IS NOT NULL THEN
      INSERT INTO sot.cats (
        name, sex, breed, color, altered_status, source_system
      ) VALUES (
        v_animal_name, v_sex, v_breed, v_combined_color, v_altered_status, 'shelterluv'
      )
      RETURNING cat_id INTO v_cat_id;
      v_match_method := 'created_new';

      -- Store SL IDs
      IF v_shelterluv_id IS NOT NULL THEN
        INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system)
        VALUES (v_cat_id, 'shelterluv_animal_id', v_shelterluv_id, 'shelterluv')
        ON CONFLICT DO NOTHING;
      END IF;
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

COMMENT ON FUNCTION ops.process_shelterluv_animal(UUID) IS
'Process a single ShelterLuv animal record (MIG_2402 fix).
Uses correct sot.find_or_create_cat_by_microchip parameters.';

-- Reset errors so they can be reprocessed
UPDATE ops.staged_records
SET is_processed = FALSE,
    processing_error = NULL
WHERE source_system = 'shelterluv'
  AND source_table = 'animals'
  AND processing_error LIKE '%find_or_create_cat_by_microchip%';

\echo ''
SELECT 'Reset for reprocessing' as status, COUNT(*) as count
FROM ops.staged_records
WHERE source_system = 'shelterluv'
  AND source_table = 'animals'
  AND is_processed = FALSE;

\echo ''
\echo 'MIG_2402 complete - Fixed ShelterLuv animal processor'
\echo ''
