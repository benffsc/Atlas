\echo '=== MIG_873: INV-14 — Microchip Validation Hardening ==='
\echo 'Creates validate_microchip() gatekeeper and integrates into all ingest paths.'
\echo 'Prevents phantom cats from junk identifiers (DQ_004 root cause fix).'
\echo 'Also fixes remaining malformed microchips (16-20 chars).'
\echo ''

-- ============================================================================
-- PHASE 1: CREATE validate_microchip() GATEKEEPER
-- ============================================================================

\echo '--- Phase 1: Creating validate_microchip() ---'

CREATE OR REPLACE FUNCTION trapper.validate_microchip(p_raw TEXT)
RETURNS TABLE(is_valid BOOLEAN, cleaned TEXT, rejection_reason TEXT)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_cleaned TEXT;
  v_digits TEXT;
  v_len INT;
BEGIN
  -- NULL / empty
  IF p_raw IS NULL OR TRIM(p_raw) = '' THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'empty_or_null'::TEXT;
    RETURN;
  END IF;

  -- Basic cleanup: trim whitespace, remove dashes/dots/spaces/parens
  v_cleaned := TRIM(REGEXP_REPLACE(p_raw, '[\s\.\-\(\)]', '', 'g'));
  v_digits := REGEXP_REPLACE(v_cleaned, '[^0-9]', '', 'g');
  v_len := LENGTH(v_digits);

  -- Too short (< 9 digits) — not a real microchip
  IF v_len < 9 THEN
    RETURN QUERY SELECT FALSE, v_digits, 'too_short'::TEXT;
    RETURN;
  END IF;

  -- Too long (> 15 digits) — concatenated or corrupted
  IF v_len > 15 THEN
    RETURN QUERY SELECT FALSE, v_digits, 'too_long_suspect_concatenation'::TEXT;
    RETURN;
  END IF;

  -- All zeros (the phantom Daphne pattern: 000000000, 000000000000000)
  IF v_digits ~ '^0+$' THEN
    RETURN QUERY SELECT FALSE, v_digits, 'all_zeros'::TEXT;
    RETURN;
  END IF;

  -- All same digit (e.g., 111111111, 999999999999999)
  IF v_digits ~ '^(\d)\1+$' THEN
    RETURN QUERY SELECT FALSE, v_digits, 'all_same_digit'::TEXT;
    RETURN;
  END IF;

  -- Known test/sequential patterns
  IF v_digits ~ '^123456789' OR v_digits ~ '^987654321' THEN
    RETURN QUERY SELECT FALSE, v_digits, 'test_pattern'::TEXT;
    RETURN;
  END IF;

  -- ShelterLuv phantom pattern: 981020 prefix followed by all zeros
  -- This catches 981020000000000 and similar scientific notation artifacts
  IF v_digits ~ '^9810200+$' THEN
    RETURN QUERY SELECT FALSE, v_digits, 'shelterluv_phantom_zeros'::TEXT;
    RETURN;
  END IF;

  -- Valid: return cleaned digits
  RETURN QUERY SELECT TRUE, v_digits, NULL::TEXT;
END;
$$;

COMMENT ON FUNCTION trapper.validate_microchip(TEXT) IS
  'INV-14 gatekeeper: validates microchip format before storage or lookup. '
  'Rejects junk patterns (all-zeros, all-same-digit, test sequences, >15 digits, SL phantom pattern). '
  'Must be called by find_or_create_cat_by_microchip() and all ingest paths. '
  'Created by MIG_873 (DQ_004).';

\echo '  → validate_microchip() created'

-- Self-tests
DO $$
DECLARE
  v_result RECORD;
BEGIN
  -- Should pass: valid ISO 15-digit
  SELECT * INTO v_result FROM trapper.validate_microchip('981020053524791');
  ASSERT v_result.is_valid = TRUE, 'Valid ISO chip should pass';
  ASSERT v_result.cleaned = '981020053524791', 'Should return cleaned value';

  -- Should pass: valid AVID 9-digit
  SELECT * INTO v_result FROM trapper.validate_microchip('044125798');
  ASSERT v_result.is_valid = TRUE, 'AVID 9-digit should pass';

  -- Should pass: formatted chip with dashes
  SELECT * INTO v_result FROM trapper.validate_microchip('981-020-053-524-791');
  ASSERT v_result.is_valid = TRUE, 'Formatted chip should pass after cleaning';
  ASSERT v_result.cleaned = '981020053524791', 'Should strip dashes';

  -- Should reject: all-zeros phantom
  SELECT * INTO v_result FROM trapper.validate_microchip('981020000000000');
  ASSERT v_result.is_valid = FALSE, 'All-zeros phantom should fail';
  ASSERT v_result.rejection_reason = 'shelterluv_phantom_zeros', 'Should identify phantom pattern';

  -- Should reject: too long (concatenated)
  SELECT * INTO v_result FROM trapper.validate_microchip('981020053493286981020053729085');
  ASSERT v_result.is_valid = FALSE, 'Concatenated chips should fail';
  ASSERT v_result.rejection_reason = 'too_long_suspect_concatenation', 'Should identify concatenation';

  -- Should reject: all same digit
  SELECT * INTO v_result FROM trapper.validate_microchip('999999999999999');
  ASSERT v_result.is_valid = FALSE, 'All-same should fail';

  -- Should reject: too short
  SELECT * INTO v_result FROM trapper.validate_microchip('12345');
  ASSERT v_result.is_valid = FALSE, 'Too short should fail';

  -- Should reject: empty
  SELECT * INTO v_result FROM trapper.validate_microchip('');
  ASSERT v_result.is_valid = FALSE, 'Empty should fail';

  -- Should reject: NULL
  SELECT * INTO v_result FROM trapper.validate_microchip(NULL);
  ASSERT v_result.is_valid = FALSE, 'NULL should fail';

  -- Should reject: test pattern
  SELECT * INTO v_result FROM trapper.validate_microchip('123456789012345');
  ASSERT v_result.is_valid = FALSE, 'Test pattern should fail';

  RAISE NOTICE 'All validate_microchip() self-tests passed';
END $$;


-- ============================================================================
-- PHASE 2: UPDATE find_or_create_cat_by_microchip() WITH VALIDATION
-- ============================================================================

\echo ''
\echo '--- Phase 2: Updating find_or_create_cat_by_microchip() ---'

CREATE OR REPLACE FUNCTION trapper.find_or_create_cat_by_microchip(
  p_microchip text,
  p_name text DEFAULT NULL,
  p_sex text DEFAULT NULL,
  p_breed text DEFAULT NULL,
  p_altered_status text DEFAULT NULL,
  p_primary_color text DEFAULT NULL,
  p_secondary_color text DEFAULT NULL,
  p_ownership_type text DEFAULT NULL,
  p_source_system text DEFAULT 'clinichq'
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
    v_cat_id UUID;
    v_microchip TEXT;
    v_clean_name TEXT;
    v_validation RECORD;
BEGIN
    -- INV-14: Validate microchip via gatekeeper before any operation
    SELECT * INTO v_validation FROM trapper.validate_microchip(p_microchip);

    IF NOT v_validation.is_valid THEN
        RAISE NOTICE 'find_or_create_cat_by_microchip: rejected "%" (reason: %)',
            p_microchip, v_validation.rejection_reason;
        RETURN NULL;
    END IF;

    v_microchip := v_validation.cleaned;

    -- Clean the name to remove microchips and garbage
    v_clean_name := trapper.clean_cat_name(p_name);
    IF v_clean_name IS NULL OR v_clean_name = '' THEN
        v_clean_name := 'Unknown';
    END IF;

    -- Find existing cat by microchip
    SELECT ci.cat_id INTO v_cat_id
    FROM trapper.cat_identifiers ci
    WHERE ci.id_type = 'microchip' AND ci.id_value = v_microchip;

    IF v_cat_id IS NOT NULL THEN
        UPDATE trapper.sot_cats SET
            display_name = CASE
                WHEN display_name ~ '[0-9]{9,}'
                  OR display_name ~* '^unknown\s*\('
                  OR display_name = 'Unknown'
                THEN v_clean_name
                ELSE COALESCE(NULLIF(display_name, ''), v_clean_name)
            END,
            sex = COALESCE(NULLIF(sex, ''), p_sex),
            breed = COALESCE(NULLIF(breed, ''), p_breed),
            altered_status = COALESCE(NULLIF(altered_status, ''), p_altered_status),
            primary_color = COALESCE(NULLIF(primary_color, ''), p_primary_color),
            secondary_color = COALESCE(NULLIF(secondary_color, ''), p_secondary_color),
            ownership_type = COALESCE(NULLIF(ownership_type, ''), p_ownership_type),
            data_source = 'clinichq',
            updated_at = NOW()
        WHERE cat_id = v_cat_id;

        RETURN v_cat_id;
    END IF;

    -- Create new cat with clean name
    INSERT INTO trapper.sot_cats (
        display_name, sex, breed, altered_status,
        primary_color, secondary_color, ownership_type,
        data_source, needs_microchip
    ) VALUES (
        v_clean_name, p_sex, p_breed, p_altered_status,
        p_primary_color, p_secondary_color, p_ownership_type,
        'clinichq', FALSE
    )
    RETURNING cat_id INTO v_cat_id;

    -- Create microchip identifier
    INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
    VALUES (v_cat_id, 'microchip', v_microchip, p_source_system, 'unified_rebuild');

    RETURN v_cat_id;
END;
$function$;

COMMENT ON FUNCTION trapper.find_or_create_cat_by_microchip(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Central cat creation/lookup by microchip. Uses validate_microchip() (INV-14). '
  'Cleans names via clean_cat_name(). Returns NULL for invalid microchips. '
  'Updated by MIG_873 (DQ_004).';

\echo '  → find_or_create_cat_by_microchip() updated with INV-14 validation'


-- ============================================================================
-- PHASE 3: UPDATE SHELTERLUV PROCESSING FUNCTIONS
-- ============================================================================

\echo ''
\echo '--- Phase 3: Updating ShelterLuv processing functions ---'

-- 3a. process_shelterluv_animal — restructure to handle NULL from validation
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
  v_match_method TEXT := NULL;
BEGIN
  -- Get the staged record
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

  -- Handle scientific notation in microchip
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
  v_shelterluv_id := v_record.payload->>'Internal-ID';

  -- Extract foster person email and name from ShelterLuv fields
  v_foster_email := NULLIF(TRIM(v_record.payload->>'Foster Person Email'), '');
  v_foster_person_name := NULLIF(TRIM(v_record.payload->>'Foster Person Name'), '');

  -- Detect foster from status/hold fields
  v_is_foster := (
    v_status ILIKE '%foster%'
    OR v_hold_reason ILIKE '%foster%'
    OR v_hold_for IS NOT NULL AND v_hold_for != ''
  );

  -- ================================================================
  -- CAT MATCHING: microchip first, then ShelterLuv ID fallback
  -- MIG_873: find_or_create_cat_by_microchip() now validates via
  -- validate_microchip() (INV-14) and returns NULL for junk chips.
  -- Restructured so SL ID fallback runs when chip is rejected.
  -- ================================================================

  -- Try microchip first (validation happens inside find_or_create)
  IF v_microchip IS NOT NULL AND LENGTH(v_microchip) >= 9 THEN
    v_cat_id := trapper.find_or_create_cat_by_microchip(
      p_microchip := v_microchip,
      p_name := v_animal_name,
      p_sex := v_sex,
      p_breed := v_breed,
      p_source_system := 'shelterluv'
    );
  END IF;

  -- Fallback: try ShelterLuv ID if microchip didn't match/was rejected
  IF v_cat_id IS NULL AND v_shelterluv_id IS NOT NULL THEN
    SELECT ci.cat_id INTO v_cat_id
    FROM trapper.cat_identifiers ci
    WHERE ci.id_type = 'shelterluv_id'
      AND ci.id_value = v_shelterluv_id;
  END IF;

  -- If we have a cat, add ShelterLuv ID and record field sources
  IF v_cat_id IS NOT NULL THEN
    IF v_shelterluv_id IS NOT NULL THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
      VALUES (v_cat_id, 'shelterluv_id', v_shelterluv_id, 'shelterluv', 'animals')
      ON CONFLICT (cat_id, id_type, id_value) DO NOTHING;
    END IF;

    -- Record field sources for multi-source transparency (MIG_620)
    v_fields_recorded := trapper.record_cat_field_sources_batch(
      p_cat_id := v_cat_id,
      p_source_system := 'shelterluv',
      p_source_record_id := v_shelterluv_id,
      p_name := v_animal_name,
      p_breed := v_breed,
      p_sex := v_sex,
      p_primary_color := v_primary_color,
      p_secondary_color := v_secondary_color,
      p_altered_status := v_altered_status
    );
  END IF;

  -- ================================================================
  -- FOSTER MATCHING -- EMAIL-FIRST (MIG_828 fix)
  -- ================================================================

  IF v_is_foster AND (v_hold_for IS NOT NULL OR v_foster_email IS NOT NULL) THEN

    -- Strategy 1: Match by Foster Person Email (HIGH confidence)
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

    -- If matched by email, create foster role and relationship
    IF v_foster_person_id IS NOT NULL AND v_cat_id IS NOT NULL THEN
      -- Assign foster role (high confidence -- email-verified)
      PERFORM trapper.assign_person_role(v_foster_person_id, 'foster', 'shelterluv');

      -- Create fosterer relationship to cat
      INSERT INTO trapper.person_cat_relationships (
        person_id, cat_id, relationship_type, confidence,
        source_system, source_table
      ) VALUES (
        v_foster_person_id, v_cat_id, 'fosterer', 'high',
        'shelterluv', 'animals'
      ) ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table) DO NOTHING;

    ELSE
      -- NO MATCH: Queue for manual review instead of guessing by name
      INSERT INTO trapper.shelterluv_unmatched_fosters (
        staged_record_id,
        hold_for_name,
        foster_email,
        foster_person_name,
        cat_id,
        cat_name,
        shelterluv_animal_id,
        match_attempt
      ) VALUES (
        p_staged_record_id,
        COALESCE(v_hold_for, v_foster_person_name, 'unknown'),
        v_foster_email,
        v_foster_person_name,
        v_cat_id,
        v_animal_name,
        v_shelterluv_id,
        CASE
          WHEN v_foster_email IS NULL THEN 'no_email'
          ELSE 'email_not_found'
        END
      ) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Mark as processed
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

\echo '  → process_shelterluv_animal() updated (SL ID fallback when chip rejected)'


-- 3b. process_shelterluv_outcomes — validate microchip before fallback lookup
CREATE OR REPLACE FUNCTION trapper.process_shelterluv_outcomes(p_batch_size integer DEFAULT 500)
 RETURNS TABLE(outcomes_processed integer, people_created integer, people_matched integer,
               relationships_created integer, places_created integer, places_tagged integer, errors integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_rec RECORD;
    v_person_id UUID;
    v_cat_id UUID;
    v_place_id UUID;
    v_processed INT := 0;
    v_people_created INT := 0;
    v_people_matched INT := 0;
    v_relationships_created INT := 0;
    v_places_created INT := 0;
    v_places_tagged INT := 0;
    v_errors INT := 0;
    v_email_norm TEXT;
    v_phone_norm TEXT;
    v_address TEXT;
    v_outcome_type TEXT;
    v_relationship_type TEXT;
    v_context_type TEXT;
    v_person_exists BOOLEAN;
    v_place_exists BOOLEAN;
BEGIN
    FOR v_rec IN
        SELECT sr.id AS staged_record_id, sr.payload, sr.source_row_id
        FROM trapper.staged_records sr
        LEFT JOIN trapper.data_engine_match_decisions d ON d.staged_record_id = sr.id
        WHERE sr.source_system = 'shelterluv'
          AND sr.source_table = 'outcomes'
          AND d.decision_id IS NULL
          AND sr.payload->>'Outcome Type' IN ('Adoption', 'Return to Owner')
          AND (
              sr.payload->>'Outcome To Email' IS NOT NULL AND sr.payload->>'Outcome To Email' != '' OR
              sr.payload->>'Outcome To Phone' IS NOT NULL AND sr.payload->>'Outcome To Phone' != '' OR
              sr.payload->>'Outcome To Person Name' IS NOT NULL AND sr.payload->>'Outcome To Person Name' != ''
          )
        ORDER BY sr.created_at ASC
        LIMIT p_batch_size
    LOOP
        BEGIN
            v_processed := v_processed + 1;
            v_email_norm := LOWER(TRIM(v_rec.payload->>'Outcome To Email'));
            v_phone_norm := trapper.norm_phone_us(v_rec.payload->>'Outcome To Phone');

            v_outcome_type := v_rec.payload->>'Outcome Type';
            v_relationship_type := CASE
                WHEN v_outcome_type = 'Adoption' THEN 'adopter'
                WHEN v_outcome_type = 'Return to Owner' THEN 'owner'
                ELSE 'other'
            END;
            v_context_type := CASE
                WHEN v_outcome_type = 'Adoption' THEN 'adopter_residence'
                WHEN v_outcome_type = 'Return to Owner' THEN 'colony_site'
                ELSE NULL
            END;

            -- 1. Find cat via shelterluv_id, fallback to microchip
            SELECT ci.cat_id INTO v_cat_id
            FROM trapper.cat_identifiers ci
            WHERE ci.id_type = 'shelterluv_id'
              AND ci.id_value = v_rec.payload->>'Animal ID';

            -- MIG_873: Validate microchip before fallback lookup (INV-14)
            IF v_cat_id IS NULL THEN
                DECLARE
                    v_microchip TEXT;
                    v_chip_validation RECORD;
                BEGIN
                    v_microchip := TRIM(v_rec.payload->>'Microchip Number');
                    IF v_microchip ~ '^[0-9.]+E\+[0-9]+$' THEN
                        v_microchip := TRIM(TO_CHAR(v_microchip::NUMERIC, '999999999999999'));
                    END IF;
                    IF v_microchip IS NOT NULL AND v_microchip != '' THEN
                        SELECT * INTO v_chip_validation
                        FROM trapper.validate_microchip(v_microchip);

                        IF v_chip_validation.is_valid THEN
                            SELECT ci.cat_id INTO v_cat_id
                            FROM trapper.cat_identifiers ci
                            WHERE ci.id_type = 'microchip'
                              AND ci.id_value = v_chip_validation.cleaned;
                        ELSE
                            RAISE NOTICE 'SL outcome %: rejected microchip "%" (reason: %)',
                                v_rec.source_row_id, v_microchip, v_chip_validation.rejection_reason;
                        END IF;
                    END IF;
                END;
            END IF;

            IF v_cat_id IS NULL THEN
                INSERT INTO trapper.data_engine_match_decisions (
                    staged_record_id, decision_type, decision_reason, source_system
                ) VALUES (v_rec.staged_record_id, 'rejected', 'no_cat_found', 'shelterluv')
                ON CONFLICT DO NOTHING;
                CONTINUE;
            END IF;

            -- 2. Find or create person (email -> phone -> create new)
            v_person_exists := FALSE;
            IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
                SELECT pi.person_id INTO v_person_id
                FROM trapper.person_identifiers pi
                WHERE pi.id_type = 'email' AND pi.id_value_norm = v_email_norm LIMIT 1;
                IF v_person_id IS NOT NULL THEN
                    v_person_exists := TRUE;
                    v_people_matched := v_people_matched + 1;
                END IF;
            END IF;

            IF v_person_id IS NULL AND v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
                SELECT pi.person_id INTO v_person_id
                FROM trapper.person_identifiers pi
                WHERE pi.id_type = 'phone' AND pi.id_value_norm = v_phone_norm LIMIT 1;
                IF v_person_id IS NOT NULL THEN
                    v_person_exists := TRUE;
                    v_people_matched := v_people_matched + 1;
                END IF;
            END IF;

            IF v_person_id IS NULL THEN
                v_person_id := trapper.find_or_create_person(
                    p_email := v_email_norm,
                    p_phone := v_rec.payload->>'Outcome To Phone',
                    p_first_name := SPLIT_PART(v_rec.payload->>'Outcome To Person Name', ' ', 1),
                    p_last_name := NULLIF(TRIM(SUBSTRING(v_rec.payload->>'Outcome To Person Name'
                        FROM POSITION(' ' IN v_rec.payload->>'Outcome To Person Name'))), ''),
                    p_address := NULL,
                    p_source_system := 'shelterluv'
                );
                IF v_person_id IS NOT NULL THEN
                    v_people_created := v_people_created + 1;
                END IF;
            END IF;

            IF v_person_id IS NULL THEN
                INSERT INTO trapper.data_engine_match_decisions (
                    staged_record_id, decision_type, decision_reason, source_system
                ) VALUES (v_rec.staged_record_id, 'rejected', 'no_person_created', 'shelterluv')
                ON CONFLICT DO NOTHING;
                CONTINUE;
            END IF;

            -- 3. Create person_cat_relationship
            INSERT INTO trapper.person_cat_relationships (
                person_id, cat_id, relationship_type, confidence, source_system, source_table
            ) VALUES (v_person_id, v_cat_id, v_relationship_type, 'high', 'shelterluv', 'outcomes')
            ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table) DO NOTHING;
            IF FOUND THEN v_relationships_created := v_relationships_created + 1; END IF;

            -- 4. Create place from address if available
            v_address := NULLIF(TRIM(CONCAT_WS(', ',
                NULLIF(v_rec.payload->>'Outcome To Street Address 1', ''),
                NULLIF(v_rec.payload->>'Outcome To Street Address 2', ''),
                NULLIF(v_rec.payload->>'Outcome To City', ''),
                NULLIF(v_rec.payload->>'Outcome To State', ''),
                NULLIF(v_rec.payload->>'Outcome To Zip', '')
            )), '');

            IF v_address IS NOT NULL AND LENGTH(v_address) > 10 THEN
                v_place_exists := FALSE;
                SELECT p.place_id INTO v_place_id
                FROM trapper.places p
                WHERE p.normalized_address = trapper.normalize_address(v_address) LIMIT 1;

                IF v_place_id IS NOT NULL THEN
                    v_place_exists := TRUE;
                ELSE
                    v_place_id := trapper.find_or_create_place_deduped(
                        p_formatted_address := v_address,
                        p_display_name := v_rec.payload->>'Outcome To Person Name' || ' residence',
                        p_source_system := 'shelterluv'
                    );
                    IF v_place_id IS NOT NULL THEN v_places_created := v_places_created + 1; END IF;
                END IF;

                -- 5. Assign place context and link person to place
                IF v_place_id IS NOT NULL AND v_context_type IS NOT NULL THEN
                    PERFORM trapper.assign_place_context(
                        p_place_id := v_place_id,
                        p_context_type := v_context_type,
                        p_valid_from := (v_rec.payload->>'Outcome Date')::date,
                        p_evidence_type := 'outcome',
                        p_evidence_entity_id := v_rec.staged_record_id,
                        p_confidence := 0.90,
                        p_source_system := 'shelterluv',
                        p_source_record_id := v_rec.source_row_id,
                        p_assigned_by := 'shelterluv_outcome_processor'
                    );
                    v_places_tagged := v_places_tagged + 1;
                END IF;

                IF v_place_id IS NOT NULL THEN
                    INSERT INTO trapper.person_place_relationships (
                        person_id, place_id, role, source_system, source_table
                    ) VALUES (v_person_id, v_place_id, 'resident', 'shelterluv', 'outcomes')
                    ON CONFLICT ON CONSTRAINT uq_person_place_role DO NOTHING;
                END IF;
            END IF;

            -- Mark as processed
            INSERT INTO trapper.data_engine_match_decisions (
                staged_record_id, decision_type, resulting_person_id, decision_reason, source_system
            ) VALUES (
                v_rec.staged_record_id,
                CASE WHEN v_person_exists THEN 'auto_match' ELSE 'new_entity' END,
                v_person_id,
                CASE WHEN v_person_exists THEN 'matched_by_identifier' ELSE 'created_new_person' END,
                'shelterluv'
            ) ON CONFLICT DO NOTHING;

        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            RAISE NOTICE 'Error processing outcome %: %', v_rec.source_row_id, SQLERRM;
        END;
    END LOOP;

    RETURN QUERY SELECT v_processed, v_people_created, v_people_matched,
        v_relationships_created, v_places_created, v_places_tagged, v_errors;
END;
$function$;

\echo '  → process_shelterluv_outcomes() updated (microchip fallback validated)'


-- ============================================================================
-- PHASE 4: FIX REMAINING MALFORMED MICROCHIPS (16-20 chars)
-- ============================================================================

\echo ''
\echo '--- Phase 4: Fixing remaining malformed microchips ---'

\echo ''
\echo 'Malformed chips before cleanup:'

SELECT ci.cat_identifier_id, ci.cat_id, ci.id_value,
       LENGTH(ci.id_value) as len, ci.source_system
FROM trapper.cat_identifiers ci
WHERE ci.id_type = 'microchip' AND LENGTH(ci.id_value) > 15
ORDER BY LENGTH(ci.id_value), ci.id_value;

DO $$
DECLARE
  v_rec RECORD;
  v_candidate TEXT;
  v_validation RECORD;
  v_existing_cat_id UUID;
  v_cat_has_other_chip BOOLEAN;
  v_fixed INT := 0;
  v_deleted INT := 0;
  v_skipped INT := 0;
BEGIN
  FOR v_rec IN
    SELECT ci.cat_identifier_id, ci.cat_id, ci.id_value,
           LENGTH(ci.id_value) as len, ci.source_system, ci.source_table
    FROM trapper.cat_identifiers ci
    WHERE ci.id_type = 'microchip' AND LENGTH(ci.id_value) > 15
    ORDER BY LENGTH(ci.id_value), ci.id_value
  LOOP
    -- Try to extract valid 15-digit chip from first 15 digits
    v_candidate := SUBSTRING(v_rec.id_value FROM 1 FOR 15);

    SELECT * INTO v_validation FROM trapper.validate_microchip(v_candidate);

    IF NOT v_validation.is_valid THEN
      -- Candidate is also junk (e.g., all-zeros variant) — just delete the record
      DELETE FROM trapper.cat_identifiers WHERE cat_identifier_id = v_rec.cat_identifier_id;
      v_deleted := v_deleted + 1;
      RAISE NOTICE 'Deleted junk chip: % (candidate % also invalid: %)',
          v_rec.id_value, v_candidate, v_validation.rejection_reason;
      CONTINUE;
    END IF;

    -- Check if the cleaned candidate already exists
    SELECT ci.cat_id INTO v_existing_cat_id
    FROM trapper.cat_identifiers ci
    WHERE ci.id_type = 'microchip' AND ci.id_value = v_validation.cleaned;

    IF v_existing_cat_id IS NOT NULL THEN
      IF v_existing_cat_id = v_rec.cat_id THEN
        -- Same cat already has the clean chip — just delete the malformed one
        DELETE FROM trapper.cat_identifiers WHERE cat_identifier_id = v_rec.cat_identifier_id;
        v_deleted := v_deleted + 1;
        RAISE NOTICE 'Deleted duplicate malformed: % (same cat already has %)',
            v_rec.id_value, v_validation.cleaned;
      ELSE
        -- Different cat has the clean chip — likely a duplicate cat from the malformed chip
        -- Delete the malformed identifier; the cats may need merging later
        DELETE FROM trapper.cat_identifiers WHERE cat_identifier_id = v_rec.cat_identifier_id;
        v_deleted := v_deleted + 1;
        RAISE NOTICE 'Deleted malformed: % (clean chip % belongs to cat %, this was cat %)',
            v_rec.id_value, v_validation.cleaned, v_existing_cat_id, v_rec.cat_id;
      END IF;
    ELSE
      -- Clean chip doesn't exist yet — update the malformed record to the clean value
      UPDATE trapper.cat_identifiers
      SET id_value = v_validation.cleaned
      WHERE cat_identifier_id = v_rec.cat_identifier_id;
      v_fixed := v_fixed + 1;
      RAISE NOTICE 'Fixed: % → % (cat %)', v_rec.id_value, v_validation.cleaned, v_rec.cat_id;
    END IF;
  END LOOP;

  RAISE NOTICE 'Malformed chip cleanup: % fixed, % deleted, % skipped', v_fixed, v_deleted, v_skipped;
END $$;


-- ============================================================================
-- PHASE 5: VERIFICATION
-- ============================================================================

\echo ''
\echo '--- Phase 5: Verification ---'

\echo ''
\echo 'Remaining microchips > 15 chars (should be 0):'

SELECT COUNT(*) as remaining_long_chips
FROM trapper.cat_identifiers ci
WHERE ci.id_type = 'microchip' AND LENGTH(ci.id_value) > 15;

\echo ''
\echo 'Remaining all-zeros microchips (should be 0):'

SELECT COUNT(*) as remaining_zeros_chips
FROM trapper.cat_identifiers ci
WHERE ci.id_type = 'microchip' AND ci.id_value ~ '^0+$';

\echo ''
\echo 'Remaining SL phantom pattern chips (should be 0):'

SELECT COUNT(*) as remaining_phantom_chips
FROM trapper.cat_identifiers ci
WHERE ci.id_type = 'microchip' AND ci.id_value ~ '^9810200+$';

\echo ''
\echo 'Validation gate tests:'

DO $$
DECLARE
  v_result UUID;
BEGIN
  -- Phantom chip should be rejected
  v_result := trapper.find_or_create_cat_by_microchip('981020000000000');
  ASSERT v_result IS NULL, 'Phantom chip 981020000000000 should be rejected';

  -- Concatenated chip should be rejected
  v_result := trapper.find_or_create_cat_by_microchip('981020053524791981020053524792');
  ASSERT v_result IS NULL, 'Concatenated chip should be rejected';

  -- All-zeros should be rejected
  v_result := trapper.find_or_create_cat_by_microchip('000000000000000');
  ASSERT v_result IS NULL, 'All-zeros chip should be rejected';

  -- Valid chip should work (this is a real chip from the database)
  v_result := trapper.find_or_create_cat_by_microchip('981020053524791');
  ASSERT v_result IS NOT NULL, 'Valid chip should return a cat_id';

  RAISE NOTICE 'All validation gate tests passed';
END $$;

\echo ''
\echo 'ShelterLuv relationship summary (should be all real cats):'

SELECT
  pcr.relationship_type,
  COUNT(*) as total,
  COUNT(DISTINCT pcr.cat_id) as distinct_cats,
  COUNT(DISTINCT pcr.person_id) as distinct_people
FROM trapper.person_cat_relationships pcr
WHERE pcr.source_system = 'shelterluv'
GROUP BY pcr.relationship_type ORDER BY total DESC;


-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=== MIG_873 Complete ==='
\echo 'INV-14: Microchip Validation Hardening (DQ_004 prevention)'
\echo ''
\echo 'Phase 1: validate_microchip() gatekeeper created'
\echo '  - Rejects: all-zeros, all-same-digit, >15 digits, test patterns, SL phantom'
\echo '  - Returns: is_valid + cleaned value + rejection_reason'
\echo ''
\echo 'Phase 2: find_or_create_cat_by_microchip() hardened'
\echo '  - Calls validate_microchip() before any lookup or creation'
\echo '  - Returns NULL for invalid chips (was: accepted anything >= 9 chars)'
\echo ''
\echo 'Phase 3: ShelterLuv processing functions hardened'
\echo '  - process_shelterluv_animal(): SL ID fallback when chip rejected'
\echo '  - process_shelterluv_outcomes(): microchip fallback lookup validated'
\echo ''
\echo 'Phase 4: Remaining malformed microchips cleaned'
\echo '  - 16-20 char chips: recovered to 15-digit or deleted'
\echo ''
\echo 'Root cause blocked: junk chips from SL XLSX scientific notation'
\echo 'can no longer create phantom cats or match via microchip lookup.'
