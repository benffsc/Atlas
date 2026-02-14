\echo '=== MIG_465: Process ShelterLuv Outcomes ==='
\echo 'Creates adopter relationships and place contexts from ShelterLuv outcome data'
\echo ''

-- ============================================================================
-- 1. Create process_shelterluv_outcomes function
-- ============================================================================

\echo 'Creating process_shelterluv_outcomes function...'

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
                -- Mark as processed but no cat found
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

    RETURN QUERY SELECT
        v_processed,
        v_people_created,
        v_people_matched,
        v_relationships_created,
        v_places_created,
        v_places_tagged,
        v_errors;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_shelterluv_outcomes IS
'Processes ShelterLuv outcome records to create:
- Person records for adopters/owners
- Person-cat relationships
- Places for adopter addresses
- Place context tags (adopter_residence)
Uses centralized functions for entity creation.';

-- ============================================================================
-- 2. Create view for foster/adopter queries
-- ============================================================================

\echo ''
\echo 'Creating adopter/foster query views...'

CREATE OR REPLACE VIEW trapper.v_person_cat_history AS
SELECT
    p.person_id,
    p.display_name AS person_name,
    p.primary_email,
    p.primary_phone,
    c.cat_id,
    c.name AS cat_name,
    c.microchip,
    pcr.relationship_type,
    pcr.confidence,
    pcr.source_system,
    pcr.created_at AS relationship_created_at,
    -- Count cats per person by type
    COUNT(*) OVER (PARTITION BY p.person_id, pcr.relationship_type) AS cats_with_this_relationship,
    COUNT(*) OVER (PARTITION BY p.person_id) AS total_cats_linked
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_people p ON p.person_id = pcr.person_id
JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
WHERE p.merged_into_person_id IS NULL
  AND c.merged_into_cat_id IS NULL;

COMMENT ON VIEW trapper.v_person_cat_history IS
'Shows person-cat relationships with aggregated counts. Enables queries like "how many cats has X fostered/adopted?"';

-- ============================================================================
-- 3. Create function to query foster/adopter history
-- ============================================================================

\echo ''
\echo 'Creating query function for foster/adopter history...'

CREATE OR REPLACE FUNCTION trapper.query_person_cat_history(
    p_person_name TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL,
    p_relationship_type TEXT DEFAULT NULL
)
RETURNS TABLE (
    person_id UUID,
    person_name TEXT,
    email TEXT,
    relationship_type TEXT,
    cat_count BIGINT,
    cat_names TEXT[],
    cat_microchips TEXT[],
    sources TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        pcr.person_id,
        p.display_name,
        p.primary_email,
        pcr.relationship_type,
        COUNT(DISTINCT pcr.cat_id),
        ARRAY_AGG(DISTINCT c.name ORDER BY c.name) FILTER (WHERE c.name IS NOT NULL),
        ARRAY_AGG(DISTINCT c.microchip ORDER BY c.microchip) FILTER (WHERE c.microchip IS NOT NULL),
        ARRAY_AGG(DISTINCT pcr.source_system ORDER BY pcr.source_system)
    FROM trapper.person_cat_relationships pcr
    JOIN trapper.sot_people p ON p.person_id = pcr.person_id
    JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
    WHERE p.merged_into_person_id IS NULL
      AND c.merged_into_cat_id IS NULL
      AND (p_person_name IS NULL OR p.display_name ILIKE '%' || p_person_name || '%')
      AND (p_email IS NULL OR p.primary_email ILIKE '%' || p_email || '%')
      AND (p_relationship_type IS NULL OR pcr.relationship_type = p_relationship_type)
    GROUP BY pcr.person_id, p.display_name, p.primary_email, pcr.relationship_type
    ORDER BY COUNT(DISTINCT pcr.cat_id) DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.query_person_cat_history IS
'Query function for finding people by their cat relationships.
Example: SELECT * FROM trapper.query_person_cat_history(''Smith'', NULL, ''adopter'');';

-- ============================================================================
-- 4. Verification
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Outcome records available for processing:'
SELECT
    payload->>'Outcome Type' as outcome_type,
    COUNT(*) as count
FROM trapper.staged_records sr
LEFT JOIN trapper.data_engine_match_decisions d ON d.staged_record_id = sr.id
WHERE sr.source_system = 'shelterluv'
  AND sr.source_table = 'outcomes'
  AND d.decision_id IS NULL
  AND sr.payload->>'Outcome Type' IN ('Adoption', 'Return to Owner')
GROUP BY 1;

\echo ''
\echo 'Run to process outcomes:'
\echo '  SELECT * FROM trapper.process_shelterluv_outcomes(500);'
\echo ''

\echo '=== MIG_465 Complete ==='
\echo 'Created:'
\echo '  - process_shelterluv_outcomes() function'
\echo '  - v_person_cat_history view'
\echo '  - query_person_cat_history() function'
\echo ''
