\echo '=== MIG_812: Fix VolunteerHub sync bugs ==='
\echo 'Fixes:'
\echo '  1. match_volunteerhub_volunteer: role_type → role column name'
\echo '  2. person_roles CHECK: add caretaker to allowed roles'
\echo '  3. enrich_from_volunteerhub: fix payload key spacing + add is_processed filter'

-- ============================================================================
-- 1. Add 'caretaker' to person_roles role CHECK constraint
-- ============================================================================
\echo '--- Adding caretaker to person_roles role CHECK ---'

ALTER TABLE trapper.person_roles DROP CONSTRAINT IF EXISTS person_roles_role_check;

ALTER TABLE trapper.person_roles ADD CONSTRAINT person_roles_role_check
  CHECK (role = ANY (ARRAY[
    'trapper', 'foster', 'volunteer', 'staff', 'caretaker',
    'board_member', 'donor'
  ]));

COMMENT ON CONSTRAINT person_roles_role_check ON trapper.person_roles IS
  'MIG_812: Added caretaker role for VH Approved Colony Caretakers group';

-- ============================================================================
-- 2. Fix match_volunteerhub_volunteer: role_type → role
-- ============================================================================
\echo '--- Fixing match_volunteerhub_volunteer column name ---'

CREATE OR REPLACE FUNCTION trapper.match_volunteerhub_volunteer(p_volunteerhub_id text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_vol RECORD;
    v_result RECORD;
    v_person_id UUID;
    v_confidence NUMERIC;
    v_method TEXT;
BEGIN
    -- Get the volunteer record
    SELECT * INTO v_vol
    FROM trapper.volunteerhub_volunteers
    WHERE volunteerhub_id = p_volunteerhub_id;

    IF v_vol IS NULL THEN
        RETURN NULL;
    END IF;

    -- First try exact email match (highest confidence)
    IF v_vol.email_norm IS NOT NULL THEN
        SELECT sp.person_id INTO v_person_id
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = v_vol.email_norm
          AND sp.merged_into_person_id IS NULL
        LIMIT 1;

        IF v_person_id IS NOT NULL THEN
            v_confidence := 1.0;
            v_method := 'email';
        END IF;
    END IF;

    -- Try phone match
    IF v_person_id IS NULL AND v_vol.phone_norm IS NOT NULL AND LENGTH(v_vol.phone_norm) = 10 THEN
        SELECT sp.person_id INTO v_person_id
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
        WHERE pi.id_type = 'phone'
          AND pi.id_value_norm = v_vol.phone_norm
          AND sp.merged_into_person_id IS NULL
        LIMIT 1;

        IF v_person_id IS NOT NULL THEN
            v_confidence := 0.9;
            v_method := 'phone';
        END IF;
    END IF;

    -- If still no match, use Data Engine for fuzzy matching / new person creation
    IF v_person_id IS NULL THEN
        SELECT * INTO v_result FROM trapper.data_engine_resolve_identity(
            p_email := v_vol.email,
            p_phone := v_vol.phone,
            p_first_name := v_vol.first_name,
            p_last_name := v_vol.last_name,
            p_address := v_vol.full_address,
            p_source_system := 'volunteerhub',
            p_staged_record_id := NULL,
            p_job_id := NULL
        );

        v_person_id := v_result.person_id;
        v_confidence := v_result.confidence_score;
        v_method := 'data_engine/' || COALESCE(v_result.decision_type, 'unknown');
    END IF;

    -- Update the volunteer record with match result
    IF v_person_id IS NOT NULL THEN
        UPDATE trapper.volunteerhub_volunteers
        SET matched_person_id = v_person_id,
            matched_at = NOW(),
            match_confidence = v_confidence,
            match_method = v_method,
            sync_status = 'matched',
            synced_at = NOW()
        WHERE volunteerhub_id = p_volunteerhub_id;

        -- Add volunteer role if not exists (FIXED: was role_type, now role)
        INSERT INTO trapper.person_roles (person_id, role, role_status, source_system, source_record_id, started_at)
        VALUES (v_person_id, 'volunteer', 'active', 'volunteerhub', p_volunteerhub_id, CURRENT_DATE)
        ON CONFLICT (person_id, role) DO UPDATE SET
            role_status = 'active',
            updated_at = NOW();

        RAISE NOTICE 'Matched volunteer % to person % via % (confidence: %)',
            p_volunteerhub_id, v_person_id, v_method, v_confidence;
    ELSE
        UPDATE trapper.volunteerhub_volunteers
        SET sync_status = 'unmatched',
            synced_at = NOW()
        WHERE volunteerhub_id = p_volunteerhub_id;
    END IF;

    RETURN v_person_id;
END;
$function$;

COMMENT ON FUNCTION trapper.match_volunteerhub_volunteer(text) IS
  'MIG_812: Fixed role_type→role, added data_engine decision_type to method, improved null checks';

-- ============================================================================
-- 3. Fix enrich_from_volunteerhub: payload key spacing + is_processed filter
-- ============================================================================
\echo '--- Fixing enrich_from_volunteerhub ---'

CREATE OR REPLACE FUNCTION trapper.enrich_from_volunteerhub(p_batch_size integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_processed INT := 0;
    v_phones_added INT := 0;
    v_places_added INT := 0;
    v_places_updated INT := 0;
    v_skipped INT := 0;
    v_errors INT := 0;
    v_record RECORD;
    v_person_id UUID;
    v_place_id UUID;
    v_phone_norm TEXT;
    v_address TEXT;
    v_existing_place_id UUID;
    v_existing_address TEXT;
BEGIN
    FOR v_record IN
        SELECT
            sr.id as staged_id,
            sr.source_row_id,
            -- Handle both single-space and double-space key formats
            COALESCE(sr.payload->>'Email', sr.payload->>'email') as email,
            COALESCE(sr.payload->>'Name - FirstName', sr.payload->>'Name -  FirstName') as first_name,
            COALESCE(sr.payload->>'Name - LastName', sr.payload->>'Name -  LastName') as last_name,
            COALESCE(sr.payload->>'Mobile Phone', sr.payload->>'mobile phone') as mobile_phone,
            COALESCE(sr.payload->>'Home Phone', sr.payload->>'home phone') as home_phone,
            COALESCE(
                sr.payload->>'Street Address - Address1',
                sr.payload->>'Street Address  - Address1'
            ) as street1,
            COALESCE(
                sr.payload->>'Street Address - Address2',
                sr.payload->>'Street Address  - Address2'
            ) as street2,
            COALESCE(
                sr.payload->>'Street Address - City',
                sr.payload->>'Street Address  - City'
            ) as city,
            COALESCE(
                sr.payload->>'Street Address - State',
                sr.payload->>'Street Address  - State'
            ) as state,
            COALESCE(
                sr.payload->>'Street Address - PostalCode',
                sr.payload->>'Street Address  - PostalCode'
            ) as zip,
            sr.is_processed
        FROM trapper.staged_records sr
        WHERE sr.source_system = 'volunteerhub'
          AND sr.source_table = 'users'
          AND sr.is_processed = FALSE
          AND COALESCE(sr.payload->>'Email', sr.payload->>'email', '') != ''
        ORDER BY sr.created_at
        LIMIT p_batch_size
    LOOP
        v_processed := v_processed + 1;

        BEGIN
            -- Find person by email
            SELECT pi.person_id INTO v_person_id
            FROM trapper.person_identifiers pi
            JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
            WHERE pi.id_type = 'email'
              AND pi.id_value_norm = LOWER(TRIM(v_record.email))
              AND sp.merged_into_person_id IS NULL
            LIMIT 1;

            IF v_person_id IS NULL THEN
                v_skipped := v_skipped + 1;
                -- Still mark as processed so we don't retry indefinitely
                UPDATE trapper.staged_records
                SET is_processed = TRUE, processed_at = NOW()
                WHERE id = v_record.staged_id;
                CONTINUE;
            END IF;

            -- Add Mobile Phone if not exists
            IF v_record.mobile_phone IS NOT NULL AND TRIM(v_record.mobile_phone) != '' THEN
                v_phone_norm := trapper.norm_phone_us(v_record.mobile_phone);
                IF v_phone_norm IS NOT NULL AND LENGTH(v_phone_norm) = 10 THEN
                    INSERT INTO trapper.person_identifiers (
                        person_id, id_type, id_value_norm, id_value_raw, source_system, confidence
                    ) VALUES (
                        v_person_id, 'phone', v_phone_norm, v_record.mobile_phone, 'volunteerhub', 0.9
                    )
                    ON CONFLICT (id_type, id_value_norm) DO NOTHING;

                    IF FOUND THEN
                        v_phones_added := v_phones_added + 1;
                    END IF;
                END IF;
            END IF;

            -- Add Home Phone if not exists
            IF v_record.home_phone IS NOT NULL AND TRIM(v_record.home_phone) != '' THEN
                v_phone_norm := trapper.norm_phone_us(v_record.home_phone);
                IF v_phone_norm IS NOT NULL AND LENGTH(v_phone_norm) = 10 THEN
                    INSERT INTO trapper.person_identifiers (
                        person_id, id_type, id_value_norm, id_value_raw, source_system, confidence
                    ) VALUES (
                        v_person_id, 'phone', v_phone_norm, v_record.home_phone, 'volunteerhub', 0.8
                    )
                    ON CONFLICT (id_type, id_value_norm) DO NOTHING;

                    IF FOUND THEN
                        v_phones_added := v_phones_added + 1;
                    END IF;
                END IF;
            END IF;

            -- Add/update place relationship if address exists
            IF v_record.street1 IS NOT NULL AND TRIM(v_record.street1) != ''
               AND v_record.city IS NOT NULL AND TRIM(v_record.city) != '' THEN

                -- Build full address
                v_address := CONCAT_WS(', ',
                    TRIM(v_record.street1),
                    NULLIF(TRIM(COALESCE(v_record.street2, '')), ''),
                    TRIM(v_record.city),
                    TRIM(COALESCE(v_record.state, 'CA')),
                    TRIM(v_record.zip)
                );

                -- Check for existing VH-sourced place relationship
                SELECT ppr.place_id, p.formatted_address
                INTO v_existing_place_id, v_existing_address
                FROM trapper.person_place_relationships ppr
                JOIN trapper.places p ON p.place_id = ppr.place_id
                WHERE ppr.person_id = v_person_id
                  AND ppr.source_system = 'volunteerhub'
                LIMIT 1;

                IF v_existing_place_id IS NULL THEN
                    -- No VH place yet — check if person has ANY place
                    IF NOT EXISTS (
                        SELECT 1 FROM trapper.person_place_relationships
                        WHERE person_id = v_person_id
                    ) THEN
                        -- No place at all: create one
                        v_place_id := trapper.find_or_create_place_deduped(
                            v_address, NULL, NULL, NULL, 'volunteerhub'
                        );

                        IF v_place_id IS NOT NULL THEN
                            INSERT INTO trapper.person_place_relationships (
                                person_id, place_id, role, source_system, confidence, note
                            ) VALUES (
                                v_person_id, v_place_id, 'resident', 'volunteerhub', 0.85,
                                'From VolunteerHub volunteer profile'
                            )
                            ON CONFLICT DO NOTHING;

                            IF FOUND THEN
                                v_places_added := v_places_added + 1;
                            END IF;
                        END IF;
                    END IF;

                ELSE
                    -- Has existing VH place — check if address changed
                    -- Normalize for comparison
                    IF trapper.normalize_address(v_address) != trapper.normalize_address(COALESCE(v_existing_address, '')) THEN
                        -- Address changed: create new place and update relationship
                        v_place_id := trapper.find_or_create_place_deduped(
                            v_address, NULL, NULL, NULL, 'volunteerhub'
                        );

                        IF v_place_id IS NOT NULL AND v_place_id != v_existing_place_id THEN
                            -- Close old relationship
                            UPDATE trapper.person_place_relationships
                            SET valid_to = NOW(),
                                note = COALESCE(note, '') || '; Replaced via VH sync ' || NOW()::date::text
                            WHERE person_id = v_person_id
                              AND place_id = v_existing_place_id
                              AND source_system = 'volunteerhub'
                              AND valid_to IS NULL;

                            -- Create new relationship
                            INSERT INTO trapper.person_place_relationships (
                                person_id, place_id, role, source_system, confidence, note
                            ) VALUES (
                                v_person_id, v_place_id, 'resident', 'volunteerhub', 0.85,
                                'Updated from VolunteerHub profile'
                            )
                            ON CONFLICT DO NOTHING;

                            IF FOUND THEN
                                v_places_updated := v_places_updated + 1;
                            END IF;
                        END IF;
                    END IF;
                END IF;
            END IF;

            -- Mark as processed
            UPDATE trapper.staged_records
            SET is_processed = TRUE, processed_at = NOW()
            WHERE id = v_record.staged_id
              AND is_processed = FALSE;

        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            RAISE NOTICE 'Error processing VolunteerHub user %: %', v_record.source_row_id, SQLERRM;
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'processed', v_processed,
        'phones_added', v_phones_added,
        'places_added', v_places_added,
        'places_updated', v_places_updated,
        'skipped', v_skipped,
        'errors', v_errors
    );
END;
$function$;

COMMENT ON FUNCTION trapper.enrich_from_volunteerhub(integer) IS
  'MIG_812: Fixed payload key spacing, added is_processed filter, added address change detection for recurring syncs';

-- ============================================================================
-- Summary
-- ============================================================================
\echo ''
\echo '=== MIG_812 Complete ==='
\echo 'Fixed:'
\echo '  1. person_roles CHECK now includes caretaker'
\echo '  2. match_volunteerhub_volunteer: role_type → role'
\echo '  3. enrich_from_volunteerhub: fixed key spacing, is_processed filter, address updates'
