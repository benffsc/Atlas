-- MIG_2871: Fix ShelterLuv animal processor microchip extraction + merge duplicates (FFS-323)
--
-- ROOT CAUSE: process_shelterluv_animal() extracts microchip via:
--   payload->>'Microchip Number'  (doesn't exist in SL API)
--   payload->>'Microchip'         (wrong — it's a Microchips array)
-- Actual API field: payload#>>'{Microchips,0,Id}' (JSON array of {Id, Issuer, ImplantUnixTime})
--
-- IMPACT: 5,820 SL animals with microchips were created as NEW cats instead of
-- deduping against existing ClinicHQ cats via find_or_create_cat_by_microchip().
-- All person_cat links (adoptions, fosters, mortality) reference the SL duplicate cat_id.
--
-- FIX ORDER (corrected — merge before backfill to avoid unique constraint violations):
-- 1. Fix the field path in process_shelterluv_animal()
-- 2. Merge SL duplicate cats into ClinicHQ originals (using RAW payload microchips)
-- 3. Backfill microchip on REMAINING SL cats (non-duplicates)
-- 4. Verify
--
-- Safety: Uses merge_cat_into() which preserves all relationships.
-- Staged records approach with RAISE NOTICE for auditability.

-- =============================================================================
-- Step 1: Fix process_shelterluv_animal() microchip extraction
-- Done OUTSIDE transaction so function persists even if data steps need retry.
-- =============================================================================

-- NOTE: This function definition is superseded by MIG_2873__foster_matching_phase2.sql
-- which adds multi-chip support (iterating ALL Microchips array positions) and
-- compound chip format handling. The version below is kept for reference.
-- To apply the latest version, run MIG_2873__foster_matching_phase2.sql.
CREATE OR REPLACE FUNCTION ops.process_shelterluv_animal(p_staged_record_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_record RECORD;
  v_cat_id UUID;
  v_microchip TEXT;           -- Primary microchip (first valid chip found)
  v_chip_raw TEXT;
  v_chip_parsed TEXT;
  v_secondary_chip TEXT;
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
  v_all_chips TEXT[] := '{}'; -- All extracted microchips across all positions
  v_existing_cat UUID;
  v_chip_element RECORD;
BEGIN
  SELECT * INTO v_record
  FROM ops.staged_records
  WHERE id = p_staged_record_id;

  IF v_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Staged record not found');
  END IF;

  -- =========================================================================
  -- Extract ALL microchips from Microchips JSON array (FFS-330)
  -- Handles: standard chips, compound format "981020053778657 (981020053752169)"
  -- Iterates ALL array positions, not just [0]
  -- =========================================================================
  v_microchip := NULL;

  IF v_record.payload->'Microchips' IS NOT NULL
     AND jsonb_typeof(v_record.payload->'Microchips') = 'array' THEN
    FOR v_chip_element IN
      SELECT chip->>'Id' AS chip_id
      FROM jsonb_array_elements(v_record.payload->'Microchips') chip
      WHERE chip->>'Id' IS NOT NULL
        AND LENGTH(TRIM(chip->>'Id')) >= 9
    LOOP
      v_chip_raw := TRIM(v_chip_element.chip_id);

      -- Handle compound format: "981020053778657 (981020053752169)"
      IF v_chip_raw ~ '\(' THEN
        v_chip_parsed := (REGEXP_MATCH(v_chip_raw, '^(\d{9,15})'))[1];
        IF v_chip_parsed IS NOT NULL THEN
          v_all_chips := array_append(v_all_chips, v_chip_parsed);
          IF v_microchip IS NULL THEN
            v_microchip := v_chip_parsed;
          END IF;
        END IF;
        v_secondary_chip := (REGEXP_MATCH(v_chip_raw, '\((\d{9,15})\)'))[1];
        IF v_secondary_chip IS NOT NULL THEN
          v_all_chips := array_append(v_all_chips, v_secondary_chip);
        END IF;
      ELSE
        IF v_chip_raw ~ '^\d{9,15}$' THEN
          v_all_chips := array_append(v_all_chips, v_chip_raw);
          IF v_microchip IS NULL THEN
            v_microchip := v_chip_raw;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Fallback to flat field formats (XLSX import, legacy)
  IF v_microchip IS NULL THEN
    v_microchip := COALESCE(
      v_record.payload->>'Microchip Number',
      v_record.payload->>'Microchip'
    );
    v_microchip := NULLIF(TRIM(v_microchip), '');
    IF v_microchip IS NOT NULL THEN
      v_all_chips := array_append(v_all_chips, v_microchip);
    END IF;
  END IF;

  -- Extract other fields
  v_animal_name := NULLIF(TRIM(v_record.payload->>'Name'), '');
  v_sex := NULLIF(TRIM(v_record.payload->>'Sex'), '');
  v_breed := NULLIF(TRIM(v_record.payload->>'Breed'), '');
  v_primary_color := NULLIF(TRIM(v_record.payload->>'Primary Color'), '');
  v_secondary_color := NULLIF(TRIM(v_record.payload->>'Secondary Color'), '');
  v_altered_status := CASE UPPER(TRIM(v_record.payload->>'Altered'))
    WHEN 'YES' THEN
      CASE UPPER(v_sex)
        WHEN 'FEMALE' THEN 'spayed'
        WHEN 'MALE' THEN 'neutered'
        ELSE 'neutered'
      END
    WHEN 'NO' THEN 'intact'
    WHEN 'UNKNOWN' THEN 'unknown'
    ELSE 'unknown'
  END;
  v_status := NULLIF(TRIM(v_record.payload->>'Status'), '');

  v_combined_color := CASE
    WHEN v_secondary_color IS NOT NULL AND v_primary_color IS NOT NULL
      THEN v_primary_color || '/' || v_secondary_color
    ELSE v_primary_color
  END;

  v_shelterluv_id := NULLIF(TRIM(v_record.payload->>'Internal-ID'), '');
  v_shelterluv_api_id := NULLIF(TRIM(v_record.source_row_id), '');

  -- Extract foster info
  v_foster_email := NULL;
  v_is_foster := (
    v_record.payload->>'InFoster' = 'true'
    OR v_status ILIKE '%foster%'
    OR v_record.payload#>>'{AssociatedPerson,RelationshipType}' = 'foster'
  );

  -- =========================================================================
  -- Find/create cat — try ALL extracted chips before creating new
  -- =========================================================================

  -- First pass: check if ANY chip matches an existing cat (SELECT only, no create)
  IF array_length(v_all_chips, 1) IS NOT NULL THEN
    FOR i IN 1..array_length(v_all_chips, 1) LOOP
      SELECT cat_id INTO v_existing_cat
      FROM sot.cats
      WHERE microchip = v_all_chips[i]
        AND merged_into_cat_id IS NULL
      LIMIT 1;

      IF v_existing_cat IS NOT NULL THEN
        v_cat_id := v_existing_cat;
        v_match_method := CASE WHEN i = 1 THEN 'microchip' ELSE 'secondary_microchip' END;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  -- Second pass: if no existing cat found, create via primary chip
  IF v_cat_id IS NULL AND v_microchip IS NOT NULL AND LENGTH(v_microchip) >= 9 THEN
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

  -- Try ShelterLuv ID if no microchip match
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
    -- Store ALL microchips in cat_identifiers (FFS-330)
    IF array_length(v_all_chips, 1) IS NOT NULL THEN
      FOR i IN 1..array_length(v_all_chips, 1) LOOP
        INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system)
        VALUES (v_cat_id, 'microchip', v_all_chips[i], 'shelterluv')
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;

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

    -- Update denormalized shelterluv_animal_id column
    UPDATE sot.cats
    SET shelterluv_animal_id = COALESCE(v_shelterluv_api_id, v_shelterluv_id)
    WHERE cat_id = v_cat_id
      AND shelterluv_animal_id IS NULL;

    -- Update microchip if not set (use primary chip)
    IF v_microchip IS NOT NULL THEN
      UPDATE sot.cats
      SET microchip = v_microchip
      WHERE cat_id = v_cat_id
        AND microchip IS NULL;
    END IF;
  ELSE
    -- No microchip and no existing SL ID — create new cat
    IF v_animal_name IS NOT NULL THEN
      INSERT INTO sot.cats (
        name, sex, breed, color, altered_status, source_system,
        shelterluv_animal_id, microchip
      ) VALUES (
        v_animal_name, v_sex, v_breed, v_combined_color, v_altered_status, 'shelterluv',
        COALESCE(v_shelterluv_api_id, v_shelterluv_id),
        v_microchip
      )
      RETURNING cat_id INTO v_cat_id;
      v_match_method := 'created_new';

      IF v_shelterluv_id IS NOT NULL THEN
        INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system)
        VALUES (v_cat_id, 'shelterluv_animal_id', v_shelterluv_id, 'shelterluv')
        ON CONFLICT DO NOTHING;
      END IF;

      -- Store all chips for newly created cat too
      IF array_length(v_all_chips, 1) IS NOT NULL THEN
        FOR i IN 1..array_length(v_all_chips, 1) LOOP
          INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system)
          VALUES (v_cat_id, 'microchip', v_all_chips[i], 'shelterluv')
          ON CONFLICT DO NOTHING;
        END LOOP;
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
    'shelterluv_animal_id', COALESCE(v_shelterluv_api_id, v_shelterluv_id),
    'all_chips', to_jsonb(v_all_chips)
  );
END;
$function$;

BEGIN;

-- =============================================================================
-- Step 2: Merge SL duplicate cats into ClinicHQ originals FIRST
-- Match SL cats to CHQ cats by looking up the raw microchip from shelterluv_raw
-- and finding the CHQ cat with that same microchip.
-- This MUST happen before backfill to avoid unique constraint violations.
-- =============================================================================

DO $$
DECLARE
  v_rec RECORD;
  v_merged INT := 0;
  v_skipped INT := 0;
BEGIN
  FOR v_rec IN
    -- Find SL cats whose RAW payload microchip matches an existing CHQ cat
    SELECT DISTINCT ON (sl.cat_id)
      sl.cat_id AS sl_cat_id,
      chq.cat_id AS chq_cat_id,
      sr.payload#>>'{Microchips,0,Id}' AS microchip
    FROM sot.cats sl
    JOIN sot.cat_identifiers ci ON ci.cat_id = sl.cat_id AND ci.id_type = 'shelterluv_animal_id'
    JOIN source.shelterluv_raw sr ON sr.source_record_id = ci.id_value AND sr.record_type = 'animal'
    JOIN sot.cats chq ON chq.microchip = sr.payload#>>'{Microchips,0,Id}'
      AND chq.source_system <> 'shelterluv'
      AND chq.merged_into_cat_id IS NULL
    WHERE sl.source_system = 'shelterluv'
      AND sl.merged_into_cat_id IS NULL
      AND sr.payload#>>'{Microchips,0,Id}' IS NOT NULL
      AND LENGTH(sr.payload#>>'{Microchips,0,Id}') >= 9
      AND sl.cat_id <> chq.cat_id
    ORDER BY sl.cat_id, sr.fetched_at DESC
  LOOP
    BEGIN
      PERFORM sot.merge_cats(v_rec.sl_cat_id, v_rec.chq_cat_id, 'MIG_2871: SL/CHQ microchip dedup'::text, 'system'::text);
      v_merged := v_merged + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      RAISE WARNING 'Failed to merge SL cat % into CHQ cat %: %',
        v_rec.sl_cat_id, v_rec.chq_cat_id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Step 2: Merged % SL cats into CHQ originals (% skipped)', v_merged, v_skipped;
END $$;

-- =============================================================================
-- Step 3: Backfill microchips on REMAINING SL cats (non-duplicates)
-- Only cats that weren't merged and don't conflict with existing microchips.
-- =============================================================================

-- Use a DO block to backfill one-by-one to handle SL-to-SL microchip duplicates safely
DO $$
DECLARE
  v_rec RECORD;
  v_backfilled INT := 0;
  v_skipped INT := 0;
BEGIN
  FOR v_rec IN
    SELECT DISTINCT ON (ci.cat_id)
      ci.cat_id,
      sr.payload#>>'{Microchips,0,Id}' AS raw_microchip
    FROM sot.cat_identifiers ci
    JOIN source.shelterluv_raw sr
      ON sr.source_record_id = ci.id_value
      AND sr.record_type = 'animal'
    JOIN sot.cats c ON c.cat_id = ci.cat_id
      AND c.microchip IS NULL
      AND c.merged_into_cat_id IS NULL
    WHERE ci.id_type = 'shelterluv_animal_id'
      AND sr.payload#>>'{Microchips,0,Id}' IS NOT NULL
      AND LENGTH(sr.payload#>>'{Microchips,0,Id}') >= 9
    ORDER BY ci.cat_id, sr.fetched_at DESC
  LOOP
    BEGIN
      UPDATE sot.cats
      SET microchip = v_rec.raw_microchip
      WHERE cat_id = v_rec.cat_id
        AND microchip IS NULL
        AND merged_into_cat_id IS NULL;
      v_backfilled := v_backfilled + 1;
    EXCEPTION WHEN unique_violation THEN
      v_skipped := v_skipped + 1;
      -- Microchip already on another active cat — this is an SL-to-SL duplicate
    END;
  END LOOP;

  RAISE NOTICE 'Step 3: Backfilled % microchips (% skipped due to SL-SL duplicates)', v_backfilled, v_skipped;
END $$;

-- =============================================================================
-- Step 4: Verify — recount
-- =============================================================================

DO $$
DECLARE
  v_sl_cats INT;
  v_sl_with_chip INT;
  v_duplicate_chips INT;
  v_foster_links INT;
BEGIN
  SELECT COUNT(*) INTO v_sl_cats
  FROM sot.cats WHERE source_system = 'shelterluv' AND merged_into_cat_id IS NULL;

  SELECT COUNT(*) INTO v_sl_with_chip
  FROM sot.cats WHERE source_system = 'shelterluv' AND microchip IS NOT NULL AND merged_into_cat_id IS NULL;

  SELECT COUNT(*) INTO v_duplicate_chips
  FROM sot.cats sl
  JOIN sot.cats chq ON chq.microchip = sl.microchip AND chq.source_system <> 'shelterluv' AND chq.merged_into_cat_id IS NULL
  WHERE sl.source_system = 'shelterluv' AND sl.merged_into_cat_id IS NULL AND sl.microchip IS NOT NULL;

  SELECT COUNT(*) INTO v_foster_links
  FROM sot.person_cat WHERE relationship_type = 'foster';

  RAISE NOTICE 'Post-merge summary:';
  RAISE NOTICE '  SL cats remaining (not merged): %', v_sl_cats;
  RAISE NOTICE '  SL cats with microchip: %', v_sl_with_chip;
  RAISE NOTICE '  Remaining duplicates (should be 0): %', v_duplicate_chips;
  RAISE NOTICE '  Total foster links: %', v_foster_links;
END $$;

COMMIT;
