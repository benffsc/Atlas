-- MIG_2509: Fix shelterluv_animal_id Column Not Being Set
--
-- Problem: process_shelterluv_animal() stores ShelterLuv IDs in cat_identifiers
-- but NEVER updates the denormalized shelterluv_animal_id column on sot.cats.
--
-- Evidence:
--   - 5,332 ShelterLuv IDs in cat_identifiers table
--   - Only 1,465 have shelterluv_animal_id column set on sot.cats
--   - 3,188 cats missing the denormalized column value!
--
-- Solution:
-- 1. Fix process_shelterluv_animal() to also UPDATE sot.cats.shelterluv_animal_id
-- 2. Backfill existing cats that have SL IDs in cat_identifiers but not on column
--
-- Created: 2026-02-26

\echo ''
\echo '=============================================='
\echo '  MIG_2509: Fix shelterluv_animal_id Column'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Pre-check: Count the gap
-- ============================================================================

\echo '1. Pre-check: Counting gap between identifiers and column...'

SELECT
  'cats_with_sl_in_identifiers' as metric,
  COUNT(DISTINCT ci.cat_id) as value
FROM sot.cat_identifiers ci
JOIN sot.cats c ON c.cat_id = ci.cat_id
WHERE ci.id_type = 'shelterluv_animal_id'
  AND c.merged_into_cat_id IS NULL
UNION ALL
SELECT
  'cats_with_sl_column_set',
  COUNT(*)
FROM sot.cats
WHERE shelterluv_animal_id IS NOT NULL
  AND merged_into_cat_id IS NULL
UNION ALL
SELECT
  'cats_missing_column_value',
  COUNT(DISTINCT ci.cat_id)
FROM sot.cat_identifiers ci
JOIN sot.cats c ON c.cat_id = ci.cat_id
WHERE ci.id_type = 'shelterluv_animal_id'
  AND c.merged_into_cat_id IS NULL
  AND c.shelterluv_animal_id IS NULL;

-- ============================================================================
-- 2. Fix the process_shelterluv_animal function
-- ============================================================================

\echo ''
\echo '2. Fixing process_shelterluv_animal() to set column...'

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

    -- ========================================================================
    -- FIX: Also update the denormalized shelterluv_animal_id column on sot.cats
    -- ========================================================================
    UPDATE sot.cats
    SET shelterluv_animal_id = COALESCE(v_shelterluv_api_id, v_shelterluv_id)
    WHERE cat_id = v_cat_id
      AND shelterluv_animal_id IS NULL;  -- Don't overwrite existing

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
        name, sex, breed, color, altered_status, source_system,
        shelterluv_animal_id  -- FIX: Set column on INSERT too
      ) VALUES (
        v_animal_name, v_sex, v_breed, v_combined_color, v_altered_status, 'shelterluv',
        COALESCE(v_shelterluv_api_id, v_shelterluv_id)  -- FIX: Include SL ID
      )
      RETURNING cat_id INTO v_cat_id;
      v_match_method := 'created_new';

      -- Store SL IDs in identifiers table
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
    'name', v_animal_name,
    'shelterluv_animal_id', COALESCE(v_shelterluv_api_id, v_shelterluv_id)
  );
END;
$$;

COMMENT ON FUNCTION ops.process_shelterluv_animal(UUID) IS
'Process a single ShelterLuv animal record. MIG_2509 fixed: Now sets shelterluv_animal_id column on sot.cats.';

\echo '   Fixed ops.process_shelterluv_animal()'

-- ============================================================================
-- 3. Backfill existing cats with SL IDs in identifiers but not on column
-- ============================================================================

\echo ''
\echo '3. Backfilling shelterluv_animal_id column for existing cats...'

-- Prefer numeric API IDs over FFSC-A format internal IDs
WITH sl_ids AS (
  SELECT DISTINCT ON (ci.cat_id)
    ci.cat_id,
    ci.id_value
  FROM sot.cat_identifiers ci
  JOIN sot.cats c ON c.cat_id = ci.cat_id
  WHERE ci.id_type = 'shelterluv_animal_id'
    AND c.merged_into_cat_id IS NULL
    AND c.shelterluv_animal_id IS NULL
  ORDER BY ci.cat_id,
    -- Prefer numeric API IDs
    CASE WHEN ci.id_value ~ '^[0-9]+$' THEN 0 ELSE 1 END,
    ci.created_at DESC
)
UPDATE sot.cats c
SET shelterluv_animal_id = sl.id_value
FROM sl_ids sl
WHERE c.cat_id = sl.cat_id;

\echo '   Backfill complete'

-- ============================================================================
-- 4. Post-check: Verify gap is closed
-- ============================================================================

\echo ''
\echo '4. Post-check: Verifying gap is closed...'

SELECT
  'cats_with_sl_in_identifiers' as metric,
  COUNT(DISTINCT ci.cat_id) as value
FROM sot.cat_identifiers ci
JOIN sot.cats c ON c.cat_id = ci.cat_id
WHERE ci.id_type = 'shelterluv_animal_id'
  AND c.merged_into_cat_id IS NULL
UNION ALL
SELECT
  'cats_with_sl_column_set',
  COUNT(*)
FROM sot.cats
WHERE shelterluv_animal_id IS NOT NULL
  AND merged_into_cat_id IS NULL
UNION ALL
SELECT
  'cats_still_missing_column',
  COUNT(DISTINCT ci.cat_id)
FROM sot.cat_identifiers ci
JOIN sot.cats c ON c.cat_id = ci.cat_id
WHERE ci.id_type = 'shelterluv_animal_id'
  AND c.merged_into_cat_id IS NULL
  AND c.shelterluv_animal_id IS NULL;

-- Expected: cats_still_missing_column = 0

\echo ''
\echo '=============================================='
\echo '  MIG_2509 Complete'
\echo '=============================================='
\echo ''
\echo 'Fixed: process_shelterluv_animal() now sets shelterluv_animal_id column'
\echo 'Backfilled: Existing cats with SL IDs in identifiers'
\echo 'Result: Column and identifiers table now in sync'
\echo ''
