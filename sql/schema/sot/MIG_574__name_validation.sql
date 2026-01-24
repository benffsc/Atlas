\echo '=== MIG_574: Name Validation and Cleaning ==='
\echo 'Adds microchip detection and name cleaning to prevent duplicate people'
\echo 'Defense-in-depth: cleans names at source + validates in Data Engine'

-- ============================================================================
-- PART 1: Create name cleaning function
-- ============================================================================

\echo 'Creating clean_person_name function...'

CREATE OR REPLACE FUNCTION trapper.clean_person_name(p_name TEXT)
RETURNS TEXT AS $$
DECLARE
  v_cleaned TEXT;
BEGIN
  IF p_name IS NULL THEN RETURN NULL; END IF;

  v_cleaned := TRIM(p_name);

  -- Remove 9+ digit numbers (microchips, IDs)
  v_cleaned := TRIM(REGEXP_REPLACE(v_cleaned, '\s*[0-9]{9,}\s*', ' ', 'g'));

  -- Remove common garbage prefixes (Med Hold, ShelterLuv internal patterns)
  v_cleaned := REGEXP_REPLACE(v_cleaned, '(?i)^(med\s*hold|medical\s*hold)\s*:?\s*', '', 'g');
  v_cleaned := REGEXP_REPLACE(v_cleaned, '(?i)^feral\s*wild[0-9]*\s*', '', 'g');

  -- Remove trailing/leading special characters
  v_cleaned := TRIM(BOTH ' :-' FROM v_cleaned);

  -- Collapse multiple spaces
  v_cleaned := TRIM(REGEXP_REPLACE(v_cleaned, '\s+', ' ', 'g'));

  -- Return NULL if nothing meaningful left
  IF v_cleaned = '' OR LENGTH(v_cleaned) < 2 THEN
    RETURN NULL;
  END IF;

  RETURN v_cleaned;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.clean_person_name IS
'Cleans person names by removing microchip numbers (9+ digits), common garbage prefixes like "Med Hold" and "feralwild", and normalizing whitespace.
Returns NULL if nothing meaningful remains after cleaning.
Used in MIG_574 to prevent duplicates from bad ClinicHQ/ShelterLuv data.';

-- ============================================================================
-- PART 2: Update is_garbage_name to detect microchips
-- ============================================================================

\echo 'Updating is_garbage_name to detect microchip patterns...'

CREATE OR REPLACE FUNCTION trapper.is_garbage_name(name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF name IS NULL OR TRIM(name) = '' THEN
        RETURN TRUE;
    END IF;

    -- Normalize for comparison
    name := LOWER(TRIM(name));

    -- Known garbage patterns (existing)
    IF name IN (
        'unknown', 'n/a', 'na', 'none', 'no name', 'test', 'xxx', 'zzz',
        'owner', 'client', 'customer', 'person', 'somebody', 'someone',
        'anonymous', 'anon', 'no owner', 'unknown owner', 'lost owner',
        'stray', 'feral', 'community cat', 'barn cat', 'outdoor cat'
    ) THEN
        RETURN TRUE;
    END IF;

    -- Too short (likely garbage)
    IF LENGTH(name) < 2 THEN
        RETURN TRUE;
    END IF;

    -- All same character
    IF name ~ '^(.)\1*$' THEN
        RETURN TRUE;
    END IF;

    -- NEW: Contains microchip number pattern (9+ consecutive digits)
    IF name ~ '[0-9]{9,}' THEN
        RETURN TRUE;
    END IF;

    -- NEW: Name is only numbers
    IF name ~ '^[0-9]+$' THEN
        RETURN TRUE;
    END IF;

    -- NEW: ShelterLuv internal patterns (feralwild + numbers)
    IF name ~ '^feral\s*wild[0-9]+' THEN
        RETURN TRUE;
    END IF;

    -- NEW: Med Hold patterns
    IF name ~ '^med\s*hold' OR name ~ '^medical\s*hold' THEN
        RETURN TRUE;
    END IF;

    -- Looks like an address (starts with number + space)
    IF name ~ '^\d+\s' THEN
        RETURN TRUE;
    END IF;

    -- Internal account patterns (existing)
    IF name ~ '(ff\s*foster|ffsc\s*foster|rebooking|fire\s*cat|barn\s*cat)' THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.is_garbage_name IS
'Detects garbage person names including:
- Microchip patterns (9+ consecutive digits)
- ShelterLuv internal codes (feralwild + numbers)
- Medical hold prefixes
- Known garbage values (unknown, n/a, test, etc.)
- Internal account patterns
Updated in MIG_574 for duplicate prevention.';

-- ============================================================================
-- PART 3: Add exact_phone_only matching rule
-- ============================================================================

\echo 'Adding exact_phone_only matching rule...'

INSERT INTO trapper.data_engine_matching_rules (
    rule_name, rule_category, primary_signal, base_confidence,
    weight_multiplier, auto_match_threshold, review_threshold, reject_threshold,
    conditions, is_active, priority, description
) VALUES (
    'exact_phone_only', 'exact', 'phone', 1.000,
    1.000, 0.500, 0.200, 0.000,
    '{}', true, 1,
    'Match on exact phone alone, regardless of name differences. Phone is a strong unique identifier.'
) ON CONFLICT (rule_name) DO UPDATE SET
    conditions = '{}',
    priority = 1,
    description = EXCLUDED.description,
    updated_at = NOW();

-- ============================================================================
-- PART 4: Create wrapper function for Data Engine with name cleaning
-- ============================================================================

\echo 'Creating data_engine_resolve_identity_clean wrapper...'

-- This wrapper cleans names before calling the main resolve function
-- It provides an additional layer of defense without modifying the core function

CREATE OR REPLACE FUNCTION trapper.data_engine_resolve_identity_clean(
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'unknown',
    p_staged_record_id UUID DEFAULT NULL,
    p_job_id UUID DEFAULT NULL
)
RETURNS TABLE (
    person_id UUID,
    decision_type TEXT,
    confidence_score NUMERIC,
    household_id UUID,
    decision_id UUID
) AS $$
BEGIN
    -- Clean names before passing to main function
    RETURN QUERY SELECT *
    FROM trapper.data_engine_resolve_identity(
        p_email,
        p_phone,
        trapper.clean_person_name(p_first_name),
        trapper.clean_person_name(p_last_name),
        p_address,
        p_source_system,
        p_staged_record_id,
        p_job_id
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_resolve_identity_clean IS
'Wrapper around data_engine_resolve_identity that cleans names before processing.
Removes microchip numbers and garbage prefixes from first/last names.
Use this function instead of direct calls for ClinicHQ and ShelterLuv data.';

-- ============================================================================
-- PART 5: Update process_clinichq_owner_info to use clean names
-- ============================================================================

\echo 'Updating process_clinichq_owner_info to clean names at source...'

-- Get the current function and update it to use clean_person_name
-- This is a CREATE OR REPLACE so it preserves the function behavior while adding cleaning

CREATE OR REPLACE FUNCTION trapper.process_clinichq_owner_info(
    p_batch_size INT DEFAULT 500
)
RETURNS TABLE (
    processed INT,
    people_created INT,
    people_matched INT,
    places_created INT,
    places_matched INT,
    appointments_linked INT,
    errors INT
) AS $$
DECLARE
    v_processed INT := 0;
    v_people_created INT := 0;
    v_people_matched INT := 0;
    v_places_created INT := 0;
    v_places_matched INT := 0;
    v_appointments_linked INT := 0;
    v_errors INT := 0;
    v_rec RECORD;
    v_person_id UUID;
    v_place_id UUID;
    v_decision_type TEXT;
    v_first_clean TEXT;
    v_last_clean TEXT;
BEGIN
    -- Process owner_info records
    FOR v_rec IN
        SELECT DISTINCT ON (sr.id)
            sr.id as staged_record_id,
            sr.payload,
            -- CRITICAL: Clean names to remove microchips
            trapper.clean_person_name(NULLIF(TRIM(sr.payload->>'Owner First Name'), '')) as first_name,
            trapper.clean_person_name(NULLIF(TRIM(sr.payload->>'Owner Last Name'), '')) as last_name,
            LOWER(TRIM(NULLIF(sr.payload->>'Owner Email', ''))) as email,
            trapper.norm_phone_us(
                COALESCE(
                    NULLIF(TRIM(sr.payload->>'Owner Cell Phone'), ''),
                    NULLIF(TRIM(sr.payload->>'Owner Phone'), '')
                )
            ) as phone,
            NULLIF(TRIM(sr.payload->>'Owner Address'), '') as address,
            sr.payload->>'Number' as appointment_number,
            sr.payload->>'Date' as appointment_date
        FROM trapper.staged_records sr
        WHERE sr.source_system = 'clinichq'
          AND sr.source_table = 'owner_info'
          AND NOT sr.is_processed
        ORDER BY sr.id
        LIMIT p_batch_size
    LOOP
        BEGIN
            -- Skip if no usable identifiers after cleaning
            IF v_rec.email IS NULL AND v_rec.phone IS NULL THEN
                UPDATE trapper.staged_records
                SET is_processed = TRUE, processed_at = NOW()
                WHERE id = v_rec.staged_record_id;
                v_processed := v_processed + 1;
                CONTINUE;
            END IF;

            -- Resolve identity using Data Engine
            SELECT de.person_id, de.decision_type INTO v_person_id, v_decision_type
            FROM trapper.data_engine_resolve_identity(
                v_rec.email,
                v_rec.phone,
                v_rec.first_name,  -- Already cleaned above
                v_rec.last_name,   -- Already cleaned above
                v_rec.address,
                'clinichq',
                v_rec.staged_record_id
            ) de;

            IF v_person_id IS NOT NULL THEN
                IF v_decision_type IN ('new_entity', 'household_member') THEN
                    v_people_created := v_people_created + 1;
                ELSE
                    v_people_matched := v_people_matched + 1;
                END IF;

                -- Create/link place if address provided
                IF v_rec.address IS NOT NULL AND v_rec.address != '' THEN
                    v_place_id := trapper.find_or_create_place_deduped(
                        p_formatted_address := v_rec.address,
                        p_display_name := NULL,
                        p_lat := NULL,
                        p_lng := NULL,
                        p_source_system := 'clinichq'
                    );

                    IF v_place_id IS NOT NULL THEN
                        -- Link person to place
                        INSERT INTO trapper.person_place_relationships (
                            person_id, place_id, role, source_system
                        ) VALUES (
                            v_person_id, v_place_id, 'resident', 'clinichq'
                        ) ON CONFLICT (person_id, place_id, role) DO NOTHING;

                        v_places_created := v_places_created + 1;
                    END IF;
                END IF;

                -- Link to appointment if we have appointment number
                IF v_rec.appointment_number IS NOT NULL THEN
                    UPDATE trapper.sot_appointments
                    SET person_id = v_person_id,
                        owner_email = v_rec.email,
                        owner_phone = v_rec.phone,
                        updated_at = NOW()
                    WHERE appointment_number = v_rec.appointment_number
                      AND person_id IS NULL;

                    IF FOUND THEN
                        v_appointments_linked := v_appointments_linked + 1;
                    END IF;
                END IF;
            END IF;

            -- Mark as processed
            UPDATE trapper.staged_records
            SET is_processed = TRUE, processed_at = NOW()
            WHERE id = v_rec.staged_record_id;

            v_processed := v_processed + 1;

        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            RAISE WARNING 'Error processing owner_info record %: %', v_rec.staged_record_id, SQLERRM;
        END;
    END LOOP;

    RETURN QUERY SELECT v_processed, v_people_created, v_people_matched,
                        v_places_created, v_places_matched, v_appointments_linked, v_errors;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_clinichq_owner_info IS
'Processes ClinicHQ owner_info records from staged_records.
Creates/matches people, links to places and appointments.
Updated in MIG_574: Cleans names using clean_person_name() to remove microchip numbers.';

-- ============================================================================
-- PART 6: Verification queries
-- ============================================================================

\echo ''
\echo '=== Verification ==='

-- Test clean_person_name
\echo 'Testing clean_person_name:'
SELECT
    'Joan 900085001746221' as input,
    trapper.clean_person_name('Joan 900085001746221') as output,
    'Joan' as expected;

SELECT
    '981020053490273' as input,
    trapper.clean_person_name('981020053490273') as output,
    'NULL' as expected;

SELECT
    'Med Hold Joe 981020045714827' as input,
    trapper.clean_person_name('Med Hold Joe 981020045714827') as output,
    'Joe' as expected;

-- Test is_garbage_name
\echo ''
\echo 'Testing is_garbage_name with microchip patterns:'
SELECT
    'Joan 900085001746221' as name,
    trapper.is_garbage_name('Joan 900085001746221') as is_garbage,
    TRUE as expected;

SELECT
    'feralwild241030115' as name,
    trapper.is_garbage_name('feralwild241030115') as is_garbage,
    TRUE as expected;

SELECT
    'John Smith' as name,
    trapper.is_garbage_name('John Smith') as is_garbage,
    FALSE as expected;

-- Verify matching rules
\echo ''
\echo 'Email and phone matching rules:'
SELECT rule_name, priority, base_confidence, auto_match_threshold, conditions
FROM trapper.data_engine_matching_rules
WHERE primary_signal IN ('email', 'phone') AND is_active
ORDER BY priority;

\echo ''
\echo 'MIG_574 complete: Name validation and cleaning added'
\echo 'Defense layers activated:'
\echo '  1. clean_person_name() - strips microchips from names'
\echo '  2. is_garbage_name() - rejects names with microchip patterns'
\echo '  3. exact_phone_only rule - matches on phone regardless of name'
\echo '  4. process_clinichq_owner_info() - cleans names at source'
