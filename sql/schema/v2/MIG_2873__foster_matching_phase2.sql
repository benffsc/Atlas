-- MIG_2873: Foster matching phase 2 — disambiguated names, multi-chip, founder exclusion (FFS-329, FFS-330)
--
-- MIG_2870 matched 1,570/2,748 (57%) foster cats via name-based matching, but only
-- when exactly ONE person had a given last name. 1,178 cats remain unmatched.
--
-- Gaps addressed:
-- 1. Donna Best/Vicki Carino cats excluded (FFSC founders, not real fosters)
-- 2. 15 cats matchable via secondary microchips (Microchips[1], [2]) — MIG_2871 only checked [0]
-- 3. Major foster parents skipped due to ambiguous last names (Clark: 137 cats, Canepa: 56,
--    Carr: 42, Williamson: 55). Disambiguate via SL foster event count.
-- 4. Compound chip format: "981020053778657 (981020053752169)" in Microchips[0].Id
--
-- Also updates process_shelterluv_animal() for future multi-chip handling.
--
-- Expected outcome: ~57% → ~76% match rate (~530 additional matches)

-- =============================================================================
-- Step 0: Update process_shelterluv_animal() for multi-chip support (FFS-330)
-- Outside transaction so function persists even if data steps need retry.
-- =============================================================================

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
        -- Extract primary chip (digits before parentheses)
        v_chip_parsed := (REGEXP_MATCH(v_chip_raw, '^(\d{9,15})'))[1];
        IF v_chip_parsed IS NOT NULL THEN
          v_all_chips := array_append(v_all_chips, v_chip_parsed);
          IF v_microchip IS NULL THEN
            v_microchip := v_chip_parsed;
          END IF;
        END IF;
        -- Extract secondary chip from parentheses
        v_secondary_chip := (REGEXP_MATCH(v_chip_raw, '\((\d{9,15})\)'))[1];
        IF v_secondary_chip IS NOT NULL THEN
          v_all_chips := array_append(v_all_chips, v_secondary_chip);
        END IF;
      ELSE
        -- Standard chip format
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
-- Step 1: Exclude Donna Best / Vicki Carino cats from foster matching
-- These are FFSC founders, not real fosters. ~7 cats affected.
-- =============================================================================

DO $$
DECLARE
  v_excluded INT;
BEGIN
  UPDATE ops.ffsc_foster_cross_match fcm
  SET match_status = 'founder_excluded'
  FROM sot.cats c
  WHERE c.cat_id = fcm.cat_id
    AND c.merged_into_cat_id IS NULL
    AND fcm.match_status NOT IN ('matched', 'name_matched')
    AND (
      c.name ILIKE '%donna best%'
      OR c.name ILIKE '%vicki carino%'
      OR c.name ILIKE '%carino/best%'
      OR c.name ILIKE '%carino%best%'
      OR c.name ILIKE '%best/carino%'
    );

  GET DIAGNOSTICS v_excluded = ROW_COUNT;
  RAISE NOTICE 'Step 1: Excluded % Donna Best/Vicki Carino cats as founder_excluded', v_excluded;
END $$;


-- =============================================================================
-- Step 2: Multi-microchip matching (FFS-330)
-- For unmatched cats with microchips, search ALL SL Microchips array positions
-- (not just [0]). Also handles compound format "chip1 (chip2)".
-- ~15 cats expected to match.
-- =============================================================================

DO $$
DECLARE
  v_rec RECORD;
  v_sl_record_id TEXT;
  v_sl_cat_id UUID;
  v_matched INT := 0;
  v_merged INT := 0;
BEGIN
  FOR v_rec IN
    SELECT fcm.id, c.cat_id, c.microchip
    FROM ops.ffsc_foster_cross_match fcm
    JOIN sot.cats c ON c.cat_id = fcm.cat_id AND c.merged_into_cat_id IS NULL
    WHERE fcm.match_status = 'no_sl_match'
      AND c.microchip IS NOT NULL
  LOOP
    -- Search ALL microchip positions in SL raw data
    -- Handles both exact match and compound format extraction
    SELECT sr.source_record_id INTO v_sl_record_id
    FROM source.shelterluv_raw sr,
         jsonb_array_elements(sr.payload->'Microchips') chip
    WHERE sr.record_type = 'animal'
      AND sr.payload->'Microchips' IS NOT NULL
      AND (
        -- Exact match at any position
        TRIM(chip->>'Id') = v_rec.microchip
        -- Compound format: chip is inside parentheses
        OR (chip->>'Id' ~ '\(' AND
            (REGEXP_MATCH(chip->>'Id', '\((\d{9,15})\)'))[1] = v_rec.microchip)
        -- Compound format: chip is before parentheses
        OR (chip->>'Id' ~ '\(' AND
            (REGEXP_MATCH(chip->>'Id', '^(\d{9,15})'))[1] = v_rec.microchip)
      )
    LIMIT 1;

    IF v_sl_record_id IS NOT NULL THEN
      -- Check if a separate SL cat entity exists for this record
      SELECT ci.cat_id INTO v_sl_cat_id
      FROM sot.cat_identifiers ci
      JOIN sot.cats c2 ON c2.cat_id = ci.cat_id AND c2.merged_into_cat_id IS NULL
      WHERE ci.id_type = 'shelterluv_animal_id'
        AND ci.id_value = v_sl_record_id
        AND ci.cat_id <> v_rec.cat_id;

      -- If SL cat exists and is different, merge SL into the CHQ cat
      IF v_sl_cat_id IS NOT NULL THEN
        BEGIN
          PERFORM sot.merge_cats(v_sl_cat_id, v_rec.cat_id,
            'MIG_2873: secondary chip match', 'system');
          v_merged := v_merged + 1;
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'Step 2: Failed to merge SL cat % into CHQ cat %: %',
            v_sl_cat_id, v_rec.cat_id, SQLERRM;
        END;
      END IF;

      UPDATE ops.ffsc_foster_cross_match
      SET shelterluv_record_id = v_sl_record_id,
          match_status = 'sl_matched_secondary_chip',
          name_match_source = 'secondary_microchip'
      WHERE id = v_rec.id;

      v_matched := v_matched + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Step 2: Matched % cats via secondary microchips (% merged)', v_matched, v_merged;
END $$;


-- =============================================================================
-- Step 3: Disambiguated foster name matching (FFS-329)
-- For cat names with (LastName) pattern where MIG_2870 skipped due to ambiguity
-- (multiple SL persons with that last name), use SL foster event count to
-- pick the correct person.
-- Safety: require >=5 foster events AND >=2x the runner-up's count.
-- =============================================================================

DO $$
DECLARE
  v_rec RECORD;
  v_person_id UUID;
  v_link_id UUID;
  v_matched INT := 0;
  v_skipped INT := 0;
  v_not_resolved INT := 0;
BEGIN

  -- -----------------------------------------------------------------
  -- Phase 3a: Build foster event counts per SL person
  -- -----------------------------------------------------------------

  CREATE TEMP TABLE tmp_sl_foster_event_counts AS
  SELECT
    ep->>'Id' AS sl_person_id,
    COUNT(*) AS foster_event_count
  FROM source.shelterluv_raw sr,
       jsonb_array_elements(sr.payload->'AssociatedRecords') ep
  WHERE sr.record_type = 'event'
    AND sr.payload->>'Type' = 'Outcome.Foster'
    AND ep->>'Type' = 'Person'
  GROUP BY ep->>'Id';

  RAISE NOTICE 'Step 3a: Built foster event counts for % SL persons',
    (SELECT COUNT(*) FROM tmp_sl_foster_event_counts);

  -- -----------------------------------------------------------------
  -- Phase 3b: For each ambiguous last name, pick the SL person with
  -- the MOST foster events. Safety: >=5 events AND >=2x runner-up.
  -- -----------------------------------------------------------------

  -- Get all unmatched foster names that need disambiguation
  CREATE TEMP TABLE tmp_unmatched_foster_names AS
  SELECT DISTINCT extracted_foster_name
  FROM ops.ffsc_foster_cross_match
  WHERE match_status IN ('no_microchip', 'no_sl_match', 'no_foster_name', 'no_foster_email')
    AND extracted_foster_name IS NOT NULL
    AND extracted_foster_name <> 'ffsc';

  -- For each name, find the SL person with the most foster events
  -- Only include when: >=5 events AND >=2x the second-place person
  CREATE TEMP TABLE tmp_disambiguated_fosters AS
  WITH ranked AS (
    SELECT
      LOWER(sp.payload->>'Lastname') AS last_name,
      sp.payload->>'Firstname' AS first_name,
      sp.payload->>'Email' AS email,
      sp.source_record_id AS sl_person_id,
      COALESCE(fc.foster_event_count, 0) AS foster_event_count,
      ROW_NUMBER() OVER (
        PARTITION BY LOWER(sp.payload->>'Lastname')
        ORDER BY COALESCE(fc.foster_event_count, 0) DESC
      ) AS rn
    FROM source.shelterluv_raw sp
    LEFT JOIN tmp_sl_foster_event_counts fc ON fc.sl_person_id = sp.source_record_id
    WHERE sp.record_type = 'person'
      AND LOWER(sp.payload->>'Lastname') IN (
        SELECT extracted_foster_name FROM tmp_unmatched_foster_names
      )
  ),
  top_two AS (
    SELECT
      last_name,
      MAX(CASE WHEN rn = 1 THEN first_name END) AS first_name,
      MAX(CASE WHEN rn = 1 THEN email END) AS email,
      MAX(CASE WHEN rn = 1 THEN sl_person_id END) AS sl_person_id,
      MAX(CASE WHEN rn = 1 THEN foster_event_count END) AS top_count,
      MAX(CASE WHEN rn = 2 THEN foster_event_count END) AS runner_up_count
    FROM ranked
    WHERE rn <= 2
    GROUP BY last_name
  )
  SELECT
    last_name, first_name, email, sl_person_id, top_count AS foster_event_count
  FROM top_two
  WHERE top_count >= 5
    AND (runner_up_count IS NULL OR top_count >= runner_up_count * 2);

  RAISE NOTICE 'Step 3b: % disambiguated foster last names (>=5 events, >=2x runner-up)',
    (SELECT COUNT(*) FROM tmp_disambiguated_fosters);

  -- Log top disambiguated fosters for auditability
  PERFORM (
    SELECT string_agg(
      format('  %s %s: %s events (email: %s)',
        df.first_name, df.last_name, df.foster_event_count, COALESCE(df.email, 'none')),
      E'\n'
    )
    FROM (
      SELECT * FROM tmp_disambiguated_fosters ORDER BY foster_event_count DESC LIMIT 20
    ) df
  );

  -- -----------------------------------------------------------------
  -- Phase 3c: Resolve persons and create foster links
  -- -----------------------------------------------------------------

  FOR v_rec IN
    SELECT fcm.id, fcm.cat_id, fcm.extracted_foster_name,
           df.email, df.first_name, df.last_name, df.foster_event_count
    FROM ops.ffsc_foster_cross_match fcm
    JOIN tmp_disambiguated_fosters df ON df.last_name = fcm.extracted_foster_name
    WHERE fcm.match_status IN ('no_microchip', 'no_sl_match', 'no_foster_name', 'no_foster_email')
      AND fcm.extracted_foster_name IS NOT NULL
  LOOP
    BEGIN
      -- Resolve person via Data Engine (requires email)
      IF v_rec.email IS NOT NULL AND TRIM(v_rec.email) <> '' THEN
        v_person_id := sot.find_or_create_person(
          v_rec.email,
          NULL,           -- phone
          v_rec.first_name,
          v_rec.last_name,
          NULL,           -- address
          'shelterluv'
        );
      ELSE
        v_person_id := NULL;
      END IF;

      IF v_person_id IS NOT NULL THEN
        -- Link foster person to cat
        -- Confidence 'low' = 0.5 (event-disambiguated, not VH-verified)
        v_link_id := sot.link_person_to_cat(
          v_person_id,
          v_rec.cat_id,
          'foster',
          'cross_system_match',
          'shelterluv',
          'low'
        );

        UPDATE ops.ffsc_foster_cross_match
        SET foster_person_id = v_person_id,
            foster_email = v_rec.email,
            foster_first_name = v_rec.first_name,
            foster_last_name = v_rec.last_name,
            person_cat_link_id = v_link_id,
            match_status = 'name_matched',
            name_match_source = 'sl_event_disambiguated'
        WHERE id = v_rec.id;

        v_matched := v_matched + 1;
      ELSE
        -- Person not resolved (no email or rejected by should_be_person)
        UPDATE ops.ffsc_foster_cross_match
        SET match_status = 'name_not_resolved',
            name_match_source = 'sl_event_disambiguated'
        WHERE id = v_rec.id;
        v_not_resolved := v_not_resolved + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      RAISE WARNING 'Step 3c: Skip cat %: %', v_rec.cat_id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Step 3c: Matched % cats via disambiguated foster names (% not resolved, % skipped)',
    v_matched, v_not_resolved, v_skipped;

  -- Cleanup temp tables
  DROP TABLE tmp_sl_foster_event_counts;
  DROP TABLE tmp_unmatched_foster_names;
  DROP TABLE tmp_disambiguated_fosters;

END $$;


-- =============================================================================
-- Step 4: Verification
-- =============================================================================

DO $$
DECLARE
  v_summary RECORD;
  v_total_matched INT;
  v_total INT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== MIG_2873 Verification ===';
  RAISE NOTICE '';

  -- Match status breakdown
  FOR v_summary IN
    SELECT match_status, name_match_source, COUNT(*) AS cnt
    FROM ops.ffsc_foster_cross_match
    GROUP BY match_status, name_match_source
    ORDER BY cnt DESC
  LOOP
    RAISE NOTICE '  %-30s (source: %-25s): %',
      v_summary.match_status,
      COALESCE(v_summary.name_match_source, '-'),
      v_summary.cnt;
  END LOOP;

  -- Overall stats
  SELECT COUNT(*) INTO v_total FROM ops.ffsc_foster_cross_match;

  SELECT COUNT(*) INTO v_total_matched
  FROM ops.ffsc_foster_cross_match
  WHERE match_status IN ('matched', 'name_matched', 'sl_matched_with_name',
                          'sl_matched_with_email', 'sl_matched_secondary_chip');

  RAISE NOTICE '';
  RAISE NOTICE 'Total foster cats: %', v_total;
  RAISE NOTICE 'Total matched: % (%.1f%%)', v_total_matched,
    (v_total_matched::numeric / GREATEST(v_total, 1) * 100);
  RAISE NOTICE '';
  RAISE NOTICE 'Total foster person_cat links: %',
    (SELECT COUNT(*) FROM sot.person_cat WHERE relationship_type = 'foster');
  RAISE NOTICE 'Unique foster persons: %',
    (SELECT COUNT(DISTINCT person_id) FROM sot.person_cat WHERE relationship_type = 'foster');

  -- Spot-check: top disambiguated fosters
  RAISE NOTICE '';
  RAISE NOTICE '=== Spot Check: Top disambiguated matches ===';
  FOR v_summary IN
    SELECT fcm.foster_first_name || ' ' || fcm.foster_last_name AS foster_name,
           COUNT(*) AS cat_count
    FROM ops.ffsc_foster_cross_match fcm
    WHERE fcm.name_match_source = 'sl_event_disambiguated'
      AND fcm.match_status = 'name_matched'
    GROUP BY fcm.foster_first_name, fcm.foster_last_name
    ORDER BY COUNT(*) DESC
    LIMIT 10
  LOOP
    RAISE NOTICE '  %: % cats', v_summary.foster_name, v_summary.cat_count;
  END LOOP;
END $$;

COMMIT;
