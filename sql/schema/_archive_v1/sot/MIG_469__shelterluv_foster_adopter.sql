-- MIG_469: ShelterLuv Foster + Adopter Role Capture
--
-- Enhances ShelterLuv processing to:
-- 1. Assign adopter role to people from adoption outcomes
-- 2. Detect and capture foster relationships from animal records
-- 3. Create unified processor for ShelterLuv animals
--
-- MANUAL APPLY:
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_469__shelterluv_foster_adopter.sql

\echo ''
\echo '╔══════════════════════════════════════════════════════════════════════╗'
\echo '║  MIG_469: ShelterLuv Foster + Adopter Role Capture                   ║'
\echo '╚══════════════════════════════════════════════════════════════════════╝'
\echo ''

-- ============================================================================
-- PART 1: Update process_shelterluv_outcomes to create adopter role
-- ============================================================================

\echo 'Updating process_shelterluv_outcomes to create adopter role...'

CREATE OR REPLACE FUNCTION trapper.process_shelterluv_outcomes(
    p_batch_size INT DEFAULT 500
)
RETURNS TABLE (
    outcomes_processed INT,
    people_created INT,
    people_matched INT,
    relationships_created INT,
    places_created INT,
    places_tagged INT,
    adopter_roles_created INT,
    errors INT
) AS $$
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
    v_adopter_roles INT := 0;
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
    -- Process unprocessed outcome records with person data
    FOR v_rec IN
        SELECT
            sr.id AS staged_record_id,
            sr.payload,
            sr.source_row_id
        FROM trapper.staged_records sr
        LEFT JOIN trapper.data_engine_match_decisions d ON d.staged_record_id = sr.id
        WHERE sr.source_system = 'shelterluv'
          AND sr.source_table = 'outcomes'
          AND d.decision_id IS NULL  -- Not yet processed
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

            -- Normalize identifiers
            v_email_norm := LOWER(TRIM(v_rec.payload->>'Outcome To Email'));
            v_phone_norm := trapper.norm_phone_us(v_rec.payload->>'Outcome To Phone');

            -- Determine relationship type based on outcome
            v_outcome_type := v_rec.payload->>'Outcome Type';
            v_relationship_type := CASE
                WHEN v_outcome_type = 'Adoption' THEN 'adopter'
                WHEN v_outcome_type = 'Return to Owner' THEN 'owner'
                ELSE 'other'
            END;

            -- Determine context type for place
            v_context_type := CASE
                WHEN v_outcome_type = 'Adoption' THEN 'adopter_residence'
                WHEN v_outcome_type = 'Return to Owner' THEN 'colony_site'
                ELSE NULL
            END;

            -- 1. Find cat via shelterluv_id
            SELECT ci.cat_id INTO v_cat_id
            FROM trapper.cat_identifiers ci
            WHERE ci.id_type = 'shelterluv_id'
              AND ci.id_value = v_rec.payload->>'Animal ID';

            IF v_cat_id IS NULL THEN
                -- Try by microchip (handle scientific notation conversion)
                DECLARE
                    v_microchip TEXT;
                BEGIN
                    v_microchip := TRIM(v_rec.payload->>'Microchip Number');
                    -- Handle scientific notation (9.8102E+14 -> 981020000000000)
                    IF v_microchip ~ '^[0-9.]+E\+[0-9]+$' THEN
                        v_microchip := TRIM(TO_CHAR(v_microchip::NUMERIC, '999999999999999'));
                    END IF;
                    IF v_microchip IS NOT NULL AND v_microchip != '' THEN
                        SELECT ci.cat_id INTO v_cat_id
                        FROM trapper.cat_identifiers ci
                        WHERE ci.id_type = 'microchip'
                          AND ci.id_value = v_microchip;
                    END IF;
                END;
            END IF;

            -- Skip if no cat found
            IF v_cat_id IS NULL THEN
                INSERT INTO trapper.data_engine_match_decisions (
                    staged_record_id, decision_type, decision_reason, source_system
                ) VALUES (
                    v_rec.staged_record_id, 'rejected', 'no_cat_found', 'shelterluv'
                ) ON CONFLICT DO NOTHING;
                CONTINUE;
            END IF;

            -- 2. Find or create person
            v_person_exists := FALSE;

            -- Check if person exists by email
            IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
                SELECT pi.person_id INTO v_person_id
                FROM trapper.person_identifiers pi
                WHERE pi.id_type = 'email' AND pi.id_value_norm = v_email_norm
                LIMIT 1;

                IF v_person_id IS NOT NULL THEN
                    v_person_exists := TRUE;
                    v_people_matched := v_people_matched + 1;
                END IF;
            END IF;

            -- If not found by email, try phone
            IF v_person_id IS NULL AND v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
                SELECT pi.person_id INTO v_person_id
                FROM trapper.person_identifiers pi
                WHERE pi.id_type = 'phone' AND pi.id_value_norm = v_phone_norm
                LIMIT 1;

                IF v_person_id IS NOT NULL THEN
                    v_person_exists := TRUE;
                    v_people_matched := v_people_matched + 1;
                END IF;
            END IF;

            -- Create new person if not found
            IF v_person_id IS NULL THEN
                v_person_id := trapper.find_or_create_person(
                    p_email := v_email_norm,
                    p_phone := v_rec.payload->>'Outcome To Phone',
                    p_first_name := SPLIT_PART(v_rec.payload->>'Outcome To Person Name', ' ', 1),
                    p_last_name := NULLIF(TRIM(SUBSTRING(v_rec.payload->>'Outcome To Person Name' FROM POSITION(' ' IN v_rec.payload->>'Outcome To Person Name'))), ''),
                    p_address := NULL,
                    p_source_system := 'shelterluv'
                );

                IF v_person_id IS NOT NULL THEN
                    v_people_created := v_people_created + 1;
                END IF;
            END IF;

            -- Skip if no person could be created
            IF v_person_id IS NULL THEN
                INSERT INTO trapper.data_engine_match_decisions (
                    staged_record_id, decision_type, decision_reason, source_system
                ) VALUES (
                    v_rec.staged_record_id, 'rejected', 'no_person_created', 'shelterluv'
                ) ON CONFLICT DO NOTHING;
                CONTINUE;
            END IF;

            -- 3. Create person_cat_relationship
            INSERT INTO trapper.person_cat_relationships (
                person_id, cat_id, relationship_type, confidence,
                source_system, source_table
            ) VALUES (
                v_person_id, v_cat_id, v_relationship_type, 'high',
                'shelterluv', 'outcomes'
            ) ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table) DO NOTHING;

            IF FOUND THEN
                v_relationships_created := v_relationships_created + 1;
            END IF;

            -- NEW: Assign adopter role if this is an adoption
            IF v_outcome_type = 'Adoption' THEN
                PERFORM trapper.assign_person_role(v_person_id, 'adopter', 'shelterluv');
                v_adopter_roles := v_adopter_roles + 1;
            END IF;

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

                -- Check if place already exists
                SELECT p.place_id INTO v_place_id
                FROM trapper.places p
                WHERE p.normalized_address = trapper.normalize_address(v_address)
                LIMIT 1;

                IF v_place_id IS NOT NULL THEN
                    v_place_exists := TRUE;
                ELSE
                    -- Create new place using centralized function
                    v_place_id := trapper.find_or_create_place_deduped(
                        p_formatted_address := v_address,
                        p_display_name := v_rec.payload->>'Outcome To Person Name' || ' residence',
                        p_source_system := 'shelterluv'
                    );

                    IF v_place_id IS NOT NULL THEN
                        v_places_created := v_places_created + 1;
                    END IF;
                END IF;

                -- 5. Assign place context
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

                -- Link person to place
                IF v_place_id IS NOT NULL THEN
                    INSERT INTO trapper.person_place_relationships (
                        person_id, place_id, role, source_system, source_table
                    ) VALUES (
                        v_person_id, v_place_id, 'resident', 'shelterluv', 'outcomes'
                    ) ON CONFLICT ON CONSTRAINT uq_person_place_role DO NOTHING;
                END IF;
            END IF;

            -- Mark staged record as processed
            UPDATE trapper.staged_records
            SET is_processed = true,
                processed_at = NOW(),
                processor_name = 'process_shelterluv_outcomes',
                resulting_entity_type = 'relationship',
                resulting_entity_id = v_person_id
            WHERE id = v_rec.staged_record_id;

            -- Mark in match decisions
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

    RETURN QUERY SELECT
        v_processed,
        v_people_created,
        v_people_matched,
        v_relationships_created,
        v_places_created,
        v_places_tagged,
        v_adopter_roles,
        v_errors;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_shelterluv_outcomes IS
'Processes ShelterLuv outcome records to create:
- Person records for adopters/owners
- Person-cat relationships
- Places for adopter addresses
- Place context tags (adopter_residence)
- person_roles(role=adopter) for adoptions  -- NEW in MIG_469
Uses centralized functions for entity creation.';

-- ============================================================================
-- PART 2: Create processor for ShelterLuv animals (foster detection)
-- ============================================================================

\echo 'Creating process_shelterluv_animal processor for foster detection...'

CREATE OR REPLACE FUNCTION trapper.process_shelterluv_animal(p_staged_record_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_record RECORD;
  v_cat_id UUID;
  v_microchip TEXT;
  v_animal_name TEXT;
  v_sex TEXT;
  v_breed TEXT;
  v_status TEXT;
  v_hold_reason TEXT;
  v_hold_for TEXT;
  v_foster_person_id UUID;
  v_foster_email TEXT;
  v_foster_phone TEXT;
  v_is_foster BOOLEAN := false;
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
  v_status := v_record.payload->>'Status';
  v_hold_reason := v_record.payload->>'Hold Reason';
  v_hold_for := v_record.payload->>'Hold For';

  -- Detect foster from status/hold fields
  v_is_foster := (
    v_status ILIKE '%foster%'
    OR v_hold_reason ILIKE '%foster%'
    OR v_hold_for IS NOT NULL AND v_hold_for != ''
  );

  -- Find or create cat by microchip
  IF v_microchip IS NOT NULL AND LENGTH(v_microchip) >= 9 THEN
    v_cat_id := trapper.find_or_create_cat_by_microchip(
      p_microchip := v_microchip,
      p_name := v_animal_name,
      p_sex := v_sex,
      p_breed := v_breed,
      p_source_system := 'shelterluv'
    );

    -- Add ShelterLuv ID as identifier if available
    IF v_record.payload->>'Animal ID' IS NOT NULL THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system)
      VALUES (v_cat_id, 'shelterluv_id', v_record.payload->>'Animal ID', 'shelterluv')
      ON CONFLICT (cat_id, id_type, id_value) DO NOTHING;
    END IF;
  ELSE
    -- No microchip - try to find by ShelterLuv ID
    IF v_record.payload->>'Animal ID' IS NOT NULL THEN
      SELECT ci.cat_id INTO v_cat_id
      FROM trapper.cat_identifiers ci
      WHERE ci.id_type = 'shelterluv_id'
        AND ci.id_value = v_record.payload->>'Animal ID';
    END IF;
  END IF;

  -- Process foster relationship if detected
  IF v_is_foster AND v_hold_for IS NOT NULL THEN
    -- Try to find foster person by name in hold_for field
    -- This is a simplified approach - real foster tracking would need more data

    -- Check if Hold For has an email or phone embedded
    v_foster_email := NULL;
    v_foster_phone := NULL;

    -- Look for the foster person by name similarity
    SELECT person_id INTO v_foster_person_id
    FROM trapper.sot_people
    WHERE merged_into_person_id IS NULL
      AND (
        display_name ILIKE '%' || v_hold_for || '%'
        OR display_name ILIKE v_hold_for || '%'
      )
    LIMIT 1;

    -- If found, create foster role and relationship
    IF v_foster_person_id IS NOT NULL AND v_cat_id IS NOT NULL THEN
      -- Assign foster role
      PERFORM trapper.assign_person_role(v_foster_person_id, 'foster', 'shelterluv');

      -- Create fosterer relationship to cat
      INSERT INTO trapper.person_cat_relationships (
        person_id, cat_id, relationship_type, confidence,
        source_system, source_table
      ) VALUES (
        v_foster_person_id, v_cat_id, 'fosterer', 'medium',
        'shelterluv', 'animals'
      ) ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table) DO NOTHING;
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
    'foster_person_id', v_foster_person_id
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_shelterluv_animal IS
'Unified Data Engine processor for ShelterLuv animal records.
Creates cats via microchip, detects foster status, creates foster relationships.';

-- ============================================================================
-- PART 3: Backfill adopter roles for existing adoption relationships
-- ============================================================================

\echo 'Backfilling adopter roles for existing adoption relationships...'

INSERT INTO trapper.person_roles (person_id, role, role_status, source_system)
SELECT DISTINCT pcr.person_id, 'adopter', 'active', 'shelterluv'
FROM trapper.person_cat_relationships pcr
WHERE pcr.relationship_type = 'adopter'
  AND pcr.source_system = 'shelterluv'
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_roles pr
    WHERE pr.person_id = pcr.person_id AND pr.role = 'adopter'
  )
ON CONFLICT (person_id, role) DO NOTHING;

SELECT 'Adopter roles backfilled' AS status, COUNT(*) AS count
FROM trapper.person_roles WHERE role = 'adopter';

-- ============================================================================
-- PART 4: Summary statistics
-- ============================================================================

\echo ''
\echo 'Current role distribution:'
SELECT role, COUNT(*) AS count
FROM trapper.person_roles
GROUP BY role
ORDER BY count DESC;

\echo ''
\echo 'Pending ShelterLuv records:'
SELECT source_table, COUNT(*) AS pending
FROM trapper.staged_records
WHERE source_system = 'shelterluv'
  AND is_processed = false
GROUP BY source_table;

\echo ''
\echo '╔══════════════════════════════════════════════════════════════════════╗'
\echo '║  MIG_469 COMPLETE - ShelterLuv Foster + Adopter Role Capture         ║'
\echo '╠══════════════════════════════════════════════════════════════════════╣'
\echo '║  Updated functions:                                                  ║'
\echo '║    - process_shelterluv_outcomes(): Now creates adopter role         ║'
\echo '║                                                                      ║'
\echo '║  New functions:                                                      ║'
\echo '║    - process_shelterluv_animal(): Creates cats + detects fosters     ║'
\echo '║                                                                      ║'
\echo '║  Now capturing:                                                      ║'
\echo '║    - person_roles(role=adopter) from adoption outcomes               ║'
\echo '║    - person_roles(role=foster) from animal hold status               ║'
\echo '║    - person_cat_relationships(type=fosterer)                         ║'
\echo '╚══════════════════════════════════════════════════════════════════════╝'
\echo ''
