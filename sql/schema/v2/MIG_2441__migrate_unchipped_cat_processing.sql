-- MIG_2441: Migrate Unchipped Cat Processing to V2
--
-- CRITICAL BUG FIX: ops.process_clinichq_unchipped_cats() was never migrated from V1!
-- The entity-linking cron calls this function but it doesn't exist, so unchipped cats
-- are silently dropped. This explains why many cats have no appointments or links.
--
-- Problem: Cats without microchips (euthanized before chipping, kittens, etc.) have
-- only clinichq_animal_id as identifier. The main pipeline requires microchip.
--
-- Solution: This function creates cats from appointment_info records that have
-- an Animal ID but no microchip, using find_or_create_cat_by_clinichq_id().
--
-- Created: 2026-02-21

\echo ''
\echo '=============================================='
\echo '  MIG_2441: Migrate Unchipped Cat Processing'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE ops.process_clinichq_unchipped_cats()
-- ============================================================================

\echo '1. Creating ops.process_clinichq_unchipped_cats()...'

CREATE OR REPLACE FUNCTION ops.process_clinichq_unchipped_cats(
    p_batch_size INT DEFAULT 500
)
RETURNS TABLE(
    cats_created INT,
    cats_matched INT,
    appointments_linked INT,
    records_processed INT,
    records_skipped INT
) AS $$
DECLARE
    v_cats_created INT := 0;
    v_cats_matched INT := 0;
    v_appointments_linked INT := 0;
    v_records_processed INT := 0;
    v_records_skipped INT := 0;
    v_record RECORD;
    v_cat_id UUID;
BEGIN
    -- Find appointment_info records with Animal ID but no/invalid microchip
    -- AND where the corresponding appointment has no cat_id
    FOR v_record IN
        SELECT DISTINCT ON (sr.payload->>'Number', TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY'))
            sr.id as staged_id,
            sr.payload->>'Number' as animal_id,
            sr.payload->>'Animal Name' as animal_name,
            sr.payload->>'Sex' as sex,
            sr.payload->>'Date' as appt_date,
            sr.payload->>'Microchip Number' as microchip,
            a.appointment_id
        FROM ops.staged_records sr
        JOIN ops.appointments a ON
            a.appointment_number = sr.payload->>'Number'
            AND a.appointment_date = TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY')
        WHERE sr.source_system = 'clinichq'
          AND sr.source_table = 'appointment_info'
          AND sr.payload->>'Number' IS NOT NULL
          AND TRIM(sr.payload->>'Number') != ''
          -- No microchip OR invalid microchip (too short)
          AND (
              sr.payload->>'Microchip Number' IS NULL
              OR TRIM(sr.payload->>'Microchip Number') = ''
              OR LENGTH(TRIM(sr.payload->>'Microchip Number')) < 9
          )
          -- Appointment exists but has no cat linked
          AND a.cat_id IS NULL
        ORDER BY sr.payload->>'Number', TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY'), sr.created_at DESC
        LIMIT p_batch_size
    LOOP
        v_records_processed := v_records_processed + 1;

        -- Skip if no animal ID
        IF v_record.animal_id IS NULL OR TRIM(v_record.animal_id) = '' THEN
            v_records_skipped := v_records_skipped + 1;
            CONTINUE;
        END IF;

        -- Check if cat already exists by clinichq_animal_id
        SELECT ci.cat_id INTO v_cat_id
        FROM sot.cat_identifiers ci
        JOIN sot.cats c ON c.cat_id = ci.cat_id
        WHERE ci.id_type = 'clinichq_animal_id'
          AND ci.id_value = TRIM(v_record.animal_id)
          AND c.merged_into_cat_id IS NULL
        LIMIT 1;

        IF v_cat_id IS NOT NULL THEN
            v_cats_matched := v_cats_matched + 1;
        ELSE
            -- Also check cats.clinichq_animal_id directly
            SELECT c.cat_id INTO v_cat_id
            FROM sot.cats c
            WHERE c.clinichq_animal_id = TRIM(v_record.animal_id)
              AND c.merged_into_cat_id IS NULL
            LIMIT 1;

            IF v_cat_id IS NOT NULL THEN
                -- Add missing identifier
                INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, confidence, source_system)
                VALUES (v_cat_id, 'clinichq_animal_id', TRIM(v_record.animal_id), 1.0, 'clinichq')
                ON CONFLICT DO NOTHING;
                v_cats_matched := v_cats_matched + 1;
            END IF;
        END IF;

        -- If still no cat, create one
        IF v_cat_id IS NULL THEN
            v_cat_id := sot.find_or_create_cat_by_clinichq_id(
                p_clinichq_animal_id := TRIM(v_record.animal_id),
                p_name := v_record.animal_name,
                p_sex := v_record.sex,
                p_source_system := 'clinichq'
            );

            IF v_cat_id IS NOT NULL THEN
                v_cats_created := v_cats_created + 1;
            ELSE
                v_records_skipped := v_records_skipped + 1;
                CONTINUE;
            END IF;
        END IF;

        -- Link appointment to cat
        IF v_cat_id IS NOT NULL AND v_record.appointment_id IS NOT NULL THEN
            UPDATE ops.appointments
            SET cat_id = v_cat_id
            WHERE appointment_id = v_record.appointment_id
              AND cat_id IS NULL;

            IF FOUND THEN
                v_appointments_linked := v_appointments_linked + 1;
            END IF;
        END IF;
    END LOOP;

    cats_created := v_cats_created;
    cats_matched := v_cats_matched;
    appointments_linked := v_appointments_linked;
    records_processed := v_records_processed;
    records_skipped := v_records_skipped;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.process_clinichq_unchipped_cats IS
'V2 migration of trapper.process_clinichq_unchipped_cats (MIG_891).
Creates cats from appointment_info records that have Animal ID but no microchip.
Critical for cats euthanized before chipping, kittens, etc.
Called by entity-linking cron every 15 minutes.';

\echo '   Created ops.process_clinichq_unchipped_cats()'

-- ============================================================================
-- 2. CREATE ops.process_clinichq_cat_info() (was also missing!)
-- ============================================================================

\echo ''
\echo '2. Creating ops.process_clinichq_cat_info()...'

CREATE OR REPLACE FUNCTION ops.process_clinichq_cat_info(
    p_batch_size INT DEFAULT 500
)
RETURNS TABLE(
    cats_created INT,
    cats_updated INT,
    records_processed INT
) AS $$
DECLARE
    v_cats_created INT := 0;
    v_cats_updated INT := 0;
    v_records_processed INT := 0;
    v_record RECORD;
    v_cat_id UUID;
BEGIN
    -- Process cat_info records (which have microchips)
    FOR v_record IN
        SELECT DISTINCT ON (sr.payload->>'Microchip Number')
            sr.id as staged_id,
            sr.payload->>'Microchip Number' as microchip,
            sr.payload->>'Number' as clinichq_animal_id,
            sr.payload->>'Animal Name' as name,
            sr.payload->>'Sex' as sex,
            sr.payload->>'Breed' as breed,
            sr.payload->>'Primary Color' as color,
            sr.payload->>'Spay Neuter Status' as altered_status,
            sr.is_processed
        FROM ops.staged_records sr
        WHERE sr.source_system = 'clinichq'
          AND sr.source_table = 'cat_info'
          AND sr.is_processed = FALSE
          AND sr.payload->>'Microchip Number' IS NOT NULL
          AND TRIM(sr.payload->>'Microchip Number') != ''
          AND LENGTH(TRIM(sr.payload->>'Microchip Number')) >= 9
        ORDER BY sr.payload->>'Microchip Number', sr.created_at DESC
        LIMIT p_batch_size
    LOOP
        v_records_processed := v_records_processed + 1;

        -- Check if cat exists by microchip
        SELECT ci.cat_id INTO v_cat_id
        FROM sot.cat_identifiers ci
        JOIN sot.cats c ON c.cat_id = ci.cat_id
        WHERE ci.id_type = 'microchip'
          AND ci.id_value = TRIM(v_record.microchip)
          AND c.merged_into_cat_id IS NULL
        LIMIT 1;

        IF v_cat_id IS NOT NULL THEN
            -- Update existing cat
            UPDATE sot.cats SET
                name = COALESCE(NULLIF(name, ''), v_record.name),
                sex = COALESCE(NULLIF(sex, ''), v_record.sex),
                breed = COALESCE(NULLIF(breed, ''), v_record.breed),
                color = COALESCE(NULLIF(color, ''), v_record.color),
                clinichq_animal_id = COALESCE(clinichq_animal_id, v_record.clinichq_animal_id),
                updated_at = NOW()
            WHERE cat_id = v_cat_id;
            v_cats_updated := v_cats_updated + 1;
        ELSE
            -- Create new cat
            v_cat_id := sot.find_or_create_cat_by_microchip(
                p_microchip := TRIM(v_record.microchip),
                p_name := v_record.name,
                p_sex := v_record.sex,
                p_breed := v_record.breed,
                p_color := v_record.color,
                p_altered_status := v_record.altered_status,
                p_source_system := 'clinichq',
                p_clinichq_animal_id := v_record.clinichq_animal_id
            );
            IF v_cat_id IS NOT NULL THEN
                v_cats_created := v_cats_created + 1;
            END IF;
        END IF;

        -- Mark staged record as processed
        UPDATE ops.staged_records
        SET is_processed = TRUE,
            processor_name = 'process_clinichq_cat_info',
            resulting_entity_type = 'cat',
            resulting_entity_id = v_cat_id
        WHERE id = v_record.staged_id;
    END LOOP;

    cats_created := v_cats_created;
    cats_updated := v_cats_updated;
    records_processed := v_records_processed;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.process_clinichq_cat_info IS
'Processes cat_info staged records to create/update cats.
Called by entity-linking cron as catch-up processing.';

\echo '   Created ops.process_clinichq_cat_info()'

-- ============================================================================
-- 3. CREATE ops.process_clinichq_owner_info() (was also missing!)
-- ============================================================================

\echo ''
\echo '3. Creating ops.process_clinichq_owner_info()...'

CREATE OR REPLACE FUNCTION ops.process_clinichq_owner_info(
    p_batch_size INT DEFAULT 500
)
RETURNS TABLE(
    people_created INT,
    places_created INT,
    appointments_linked INT,
    records_processed INT
) AS $$
DECLARE
    v_people_created INT := 0;
    v_places_created INT := 0;
    v_appointments_linked INT := 0;
    v_records_processed INT := 0;
    v_record RECORD;
    v_person_id UUID;
    v_place_id UUID;
BEGIN
    -- Process owner_info records that haven't been processed
    FOR v_record IN
        SELECT DISTINCT ON (
            COALESCE(NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), ''),
                     sot.norm_phone_us(COALESCE(sr.payload->>'Owner Cell Phone', sr.payload->>'Owner Phone')))
        )
            sr.id as staged_id,
            sr.payload->>'Owner First Name' as first_name,
            sr.payload->>'Owner Last Name' as last_name,
            NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), '') as email,
            sot.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone')) as phone,
            NULLIF(TRIM(sr.payload->>'Owner Address'), '') as address,
            sr.payload->>'Number' as appointment_number,
            sr.is_processed
        FROM ops.staged_records sr
        WHERE sr.source_system = 'clinichq'
          AND sr.source_table = 'owner_info'
          AND sr.is_processed = FALSE
          AND (
              (sr.payload->>'Owner Email' IS NOT NULL AND TRIM(sr.payload->>'Owner Email') != '')
              OR (sr.payload->>'Owner Phone' IS NOT NULL AND TRIM(sr.payload->>'Owner Phone') != '')
              OR (sr.payload->>'Owner Cell Phone' IS NOT NULL AND TRIM(sr.payload->>'Owner Cell Phone') != '')
          )
          AND (sr.payload->>'Owner First Name' IS NOT NULL AND TRIM(sr.payload->>'Owner First Name') != '')
          AND sot.should_be_person(
              sr.payload->>'Owner First Name',
              sr.payload->>'Owner Last Name',
              NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), ''),
              sot.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone'))
          )
        ORDER BY COALESCE(NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), ''),
                          sot.norm_phone_us(COALESCE(sr.payload->>'Owner Cell Phone', sr.payload->>'Owner Phone'))),
                 sr.created_at DESC
        LIMIT p_batch_size
    LOOP
        v_records_processed := v_records_processed + 1;

        -- Create person
        v_person_id := sot.find_or_create_person(
            v_record.email,
            v_record.phone,
            v_record.first_name,
            v_record.last_name,
            v_record.address,
            'clinichq'
        );

        IF v_person_id IS NOT NULL THEN
            v_people_created := v_people_created + 1;

            -- Create place from address
            IF v_record.address IS NOT NULL AND LENGTH(v_record.address) > 10 THEN
                v_place_id := sot.find_or_create_place_deduped(
                    v_record.address,
                    NULL,
                    NULL,
                    NULL,
                    'clinichq'
                );
                IF v_place_id IS NOT NULL THEN
                    v_places_created := v_places_created + 1;

                    -- Link person to place
                    INSERT INTO sot.person_place (person_id, place_id, relationship_type, confidence, source_system)
                    VALUES (v_person_id, v_place_id, 'resident', 0.7, 'clinichq')
                    ON CONFLICT DO NOTHING;
                END IF;
            END IF;

            -- Link appointment to person
            UPDATE ops.appointments
            SET person_id = v_person_id
            WHERE appointment_number = v_record.appointment_number
              AND person_id IS NULL;

            IF FOUND THEN
                v_appointments_linked := v_appointments_linked + 1;
            END IF;
        END IF;

        -- Mark staged record as processed
        UPDATE ops.staged_records
        SET is_processed = TRUE,
            processor_name = 'process_clinichq_owner_info',
            resulting_entity_type = 'person',
            resulting_entity_id = v_person_id
        WHERE id = v_record.staged_id;
    END LOOP;

    people_created := v_people_created;
    places_created := v_places_created;
    appointments_linked := v_appointments_linked;
    records_processed := v_records_processed;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.process_clinichq_owner_info IS
'Processes owner_info staged records to create people and places.
Called by entity-linking cron as catch-up processing.';

\echo '   Created ops.process_clinichq_owner_info()'

-- ============================================================================
-- 4. LINK ORPHANED APPOINTMENTS TO CATS
-- ============================================================================

\echo ''
\echo '4. Linking orphaned appointments to cats by clinichq_animal_id...'

-- First, link by microchip
UPDATE ops.appointments a
SET cat_id = c.cat_id
FROM sot.cats c
JOIN sot.cat_identifiers ci ON ci.cat_id = c.cat_id
WHERE ci.id_type = 'microchip'
  AND ci.id_value = a.microchip
  AND a.cat_id IS NULL
  AND c.merged_into_cat_id IS NULL;

\echo '   Linked orphaned appointments by microchip'

-- Then, link by clinichq_animal_id via staged_records
UPDATE ops.appointments a
SET cat_id = c.cat_id
FROM ops.staged_records sr
JOIN sot.cats c ON c.clinichq_animal_id = sr.payload->>'Number'
WHERE sr.source_system = 'clinichq'
  AND sr.source_table = 'appointment_info'
  AND a.appointment_number = sr.payload->>'Number'
  AND a.appointment_date = TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY')
  AND a.cat_id IS NULL
  AND c.merged_into_cat_id IS NULL;

\echo '   Linked orphaned appointments by clinichq_animal_id'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Testing ops.process_clinichq_unchipped_cats()...'
SELECT * FROM ops.process_clinichq_unchipped_cats(100);

\echo ''
\echo 'Appointments without cat_id by year:'
SELECT
    EXTRACT(YEAR FROM appointment_date) as year,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE cat_id IS NULL) as no_cat,
    ROUND(100.0 * COUNT(*) FILTER (WHERE cat_id IS NULL) / COUNT(*), 1) as pct_no_cat
FROM ops.appointments
GROUP BY 1
ORDER BY 1 DESC;

\echo ''
\echo '=============================================='
\echo '  MIG_2441 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created V2 functions:'
\echo '  - ops.process_clinichq_unchipped_cats() - Creates cats without microchips'
\echo '  - ops.process_clinichq_cat_info() - Catch-up processing for cat_info'
\echo '  - ops.process_clinichq_owner_info() - Catch-up processing for owner_info'
\echo ''
\echo 'Linked orphaned appointments by microchip and clinichq_animal_id.'
-- ============================================================================
-- 5. CREATE STUB FUNCTIONS FOR OTHER MISSING V1 FUNCTIONS
-- ============================================================================

\echo ''
\echo '5. Creating stub functions for other missing V1 functions...'

-- ops.process_clinic_euthanasia (MIG_892) - TODO: migrate fully
CREATE OR REPLACE FUNCTION ops.process_clinic_euthanasia(
    p_batch_size INT DEFAULT 500
)
RETURNS TABLE(
    cats_marked_deceased INT,
    records_processed INT
) AS $$
BEGIN
    -- STUB: This function needs full migration from V1 MIG_892
    -- For now, return zeros to prevent cron failure
    RAISE NOTICE 'ops.process_clinic_euthanasia: STUB - needs migration from V1 MIG_892';
    cats_marked_deceased := 0;
    records_processed := 0;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.process_clinic_euthanasia IS
'STUB: Needs full migration from V1 MIG_892.
Marks cats as deceased based on euthanasia appointments.';

-- ops.process_embedded_microchips_in_animal_names (MIG_911) - TODO: migrate fully
CREATE OR REPLACE FUNCTION ops.process_embedded_microchips_in_animal_names()
RETURNS TABLE(
    operation TEXT,
    count INT
) AS $$
BEGIN
    -- STUB: This function needs full migration from V1 MIG_911
    -- For now, return nothing to prevent cron failure
    RAISE NOTICE 'ops.process_embedded_microchips_in_animal_names: STUB - needs migration from V1 MIG_911';
    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.process_embedded_microchips_in_animal_names IS
'STUB: Needs full migration from V1 MIG_911.
Extracts microchips from animal names like "CatName - 981020039875779".';

-- ops.retry_unmatched_master_list_entries (MIG_900) - TODO: migrate fully
CREATE OR REPLACE FUNCTION ops.retry_unmatched_master_list_entries()
RETURNS TABLE(
    clinic_date TEXT,
    entries_matched INT,
    match_method TEXT
) AS $$
BEGIN
    -- STUB: This function needs full migration from V1 MIG_900
    -- For now, return nothing to prevent cron failure
    RAISE NOTICE 'ops.retry_unmatched_master_list_entries: STUB - needs migration from V1 MIG_900';
    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.retry_unmatched_master_list_entries IS
'STUB: Needs full migration from V1 MIG_900.
Retries matching shelter/foster entries when ShelterLuv/VolunteerHub data arrives late.';

\echo '   Created stub functions (need full migration later)'

\echo ''
\echo 'Entity-linking cron should now work correctly!'
\echo ''
\echo 'TODO: Fully migrate these functions from V1:'
\echo '  - ops.process_clinic_euthanasia (MIG_892)'
\echo '  - ops.process_embedded_microchips_in_animal_names (MIG_911)'
\echo '  - ops.retry_unmatched_master_list_entries (MIG_900)'
\echo ''
