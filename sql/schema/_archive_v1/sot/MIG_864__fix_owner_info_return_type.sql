\echo '=== MIG_864: Fix process_clinichq_owner_info Return Type ==='
\echo 'MIG_808 could not replace the function because it changed JSONB → TABLE.'
\echo 'This migration drops the old JSONB version and applies the MIG_808 TABLE version.'
\echo ''

-- Drop the old JSONB version (single-arg)
DROP FUNCTION IF EXISTS trapper.process_clinichq_owner_info(INT);

\echo 'Dropped old JSONB version'

-- Create guard function (from MIG_808, was applied via psql but needs to be in migration)
CREATE OR REPLACE FUNCTION trapper.should_link_person_to_place(p_person_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_person RECORD;
BEGIN
  SELECT
    p.is_system_account,
    p.display_name,
    EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.person_id = p.person_id
        AND pi.id_type = 'email'
        AND pi.id_value_norm LIKE '%@forgottenfelines.%'
    ) as has_ffsc_email,
    EXISTS (
      SELECT 1 FROM trapper.person_roles pr
      WHERE pr.person_id = p.person_id
        AND pr.trapper_type IN ('coordinator', 'head_trapper')
        AND pr.ended_at IS NULL
    ) as is_ffsc_staff
  INTO v_person
  FROM trapper.sot_people p
  WHERE p.person_id = p_person_id;

  IF NOT FOUND THEN RETURN TRUE; END IF;
  IF COALESCE(v_person.is_system_account, FALSE) THEN RETURN FALSE; END IF;
  IF trapper.is_organization_name(v_person.display_name) THEN
    UPDATE trapper.sot_people SET is_system_account = TRUE WHERE person_id = p_person_id;
    RETURN FALSE;
  END IF;
  IF v_person.has_ffsc_email THEN
    UPDATE trapper.sot_people SET is_system_account = TRUE WHERE person_id = p_person_id;
    RETURN FALSE;
  END IF;
  IF v_person.is_ffsc_staff THEN RETURN FALSE; END IF;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.should_link_person_to_place(UUID) IS
'MIG_864: Guard function preventing system accounts and FFSC staff from being
linked as "residents" to places via owner_info processing.
Checks: is_system_account flag, organization name patterns, FFSC email, staff roles.';

\echo 'Created should_link_person_to_place guard function'

-- Recreate with TABLE return type (from MIG_808)
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
                v_rec.first_name,
                v_rec.last_name,
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
                -- GUARD: Only link person to place if they're not a system account
                IF v_rec.address IS NOT NULL AND v_rec.address != ''
                   AND trapper.should_link_person_to_place(v_person_id)
                THEN
                    v_place_id := trapper.find_or_create_place_deduped(
                        p_formatted_address := v_rec.address,
                        p_display_name := NULL,
                        p_lat := NULL,
                        p_lng := NULL,
                        p_source_system := 'clinichq'
                    );

                    IF v_place_id IS NOT NULL THEN
                        INSERT INTO trapper.person_place_relationships (
                            person_id, place_id, role, source_system
                        ) VALUES (
                            v_person_id, v_place_id, 'resident', 'clinichq'
                        ) ON CONFLICT (person_id, place_id, role) DO NOTHING;

                        v_places_created := v_places_created + 1;
                    END IF;
                END IF;

                -- Link to appointment
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

COMMENT ON FUNCTION trapper.process_clinichq_owner_info(INT) IS
'MIG_864: Processes ClinicHQ owner_info records from staged_records.
Creates/matches people, links to places and appointments.
Includes should_link_person_to_place() guard from MIG_808.
Fixed: Removed start_date reference, changed return type from JSONB to TABLE.';

\echo ''
\echo '=== MIG_864 Complete ==='
\echo 'Fixed process_clinichq_owner_info: dropped JSONB version, created TABLE version'
\echo 'Removed start_date bug, applied MIG_808 system account guard'
