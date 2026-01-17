-- MIG_252: Fix source_system column reference in find_or_create_person
--
-- The find_or_create_person function references p.source_system but
-- sot_people has data_source instead.
--
-- MANUAL APPLY:
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_252__fix_source_system_column.sql

\echo ''
\echo '=============================================='
\echo 'MIG_252: Fix source_system column reference'
\echo '=============================================='
\echo ''

-- Drop and recreate the function with the corrected column reference
CREATE OR REPLACE FUNCTION trapper.find_or_create_person(
    p_email TEXT,
    p_phone TEXT,
    p_first_name TEXT,
    p_last_name TEXT,
    p_address TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'unknown'
) RETURNS UUID AS $$
DECLARE
    v_email_norm TEXT;
    v_phone_norm TEXT;
    v_display_name TEXT;
    v_person_id UUID;
    v_existing_person RECORD;
    v_name_sim NUMERIC;
    v_similarity_threshold NUMERIC := 0.5;
    v_new_confidence NUMERIC;
    v_existing_confidence NUMERIC;
BEGIN
    -- Normalize inputs
    v_email_norm := LOWER(TRIM(p_email));
    IF v_email_norm = '' THEN v_email_norm := NULL; END IF;

    v_phone_norm := trapper.norm_phone_us(p_phone);
    IF v_phone_norm = '' OR LENGTH(v_phone_norm) < 10 THEN v_phone_norm := NULL; END IF;

    -- Build display name
    v_display_name := TRIM(CONCAT_WS(' ', INITCAP(TRIM(p_first_name)), INITCAP(TRIM(p_last_name))));
    IF v_display_name = '' THEN v_display_name := NULL; END IF;

    -- Get confidence for new source
    v_new_confidence := trapper.get_source_confidence(p_source_system);

    -- Try to find by email first
    IF v_email_norm IS NOT NULL THEN
        SELECT
            p.person_id,
            p.display_name,
            COALESCE(p.data_source::TEXT, 'unknown') AS source_system
        INTO v_existing_person
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = v_email_norm
          AND p.merged_into_person_id IS NULL
        LIMIT 1;

        IF v_existing_person.person_id IS NOT NULL THEN
            -- Check name similarity
            v_name_sim := trapper.name_similarity(v_display_name, v_existing_person.display_name);
            v_existing_confidence := trapper.get_source_confidence(v_existing_person.source_system);

            IF v_name_sim >= v_similarity_threshold THEN
                -- Names are similar enough - same person
                RETURN trapper.canonical_person_id(v_existing_person.person_id);
            ELSE
                -- Names are different - likely different people sharing email
                RAISE NOTICE 'Email match but name mismatch: "%" vs "%" (similarity: %)',
                    v_display_name, v_existing_person.display_name, v_name_sim;

                -- Only create new if we have a valid name
                IF trapper.is_valid_person_name(v_display_name) THEN
                    -- Create new person
                    INSERT INTO trapper.sot_people (display_name, data_source, is_canonical)
                    VALUES (v_display_name, p_source_system::trapper.data_source, TRUE)
                    RETURNING person_id INTO v_person_id;

                    -- Add email identifier to new person
                    INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system)
                    VALUES (v_person_id, 'email', p_email, v_email_norm, p_source_system)
                    ON CONFLICT DO NOTHING;

                    -- Add phone if available
                    IF v_phone_norm IS NOT NULL AND LENGTH(v_phone_norm) >= 10 THEN
                        IF NOT EXISTS (SELECT 1 FROM trapper.identity_phone_blacklist WHERE phone_norm = v_phone_norm) THEN
                            INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system)
                            VALUES (v_person_id, 'phone', p_phone, v_phone_norm, p_source_system)
                            ON CONFLICT DO NOTHING;
                        END IF;
                    END IF;

                    -- Flag as potential duplicate for review
                    INSERT INTO trapper.potential_person_duplicates (
                        person_id, potential_match_id, match_type, matched_identifier,
                        new_name, existing_name, name_similarity,
                        new_source_system, existing_source_system,
                        new_confidence, existing_confidence
                    ) VALUES (
                        v_person_id, v_existing_person.person_id, 'email_name_mismatch', v_email_norm,
                        v_display_name, v_existing_person.display_name, v_name_sim,
                        p_source_system, v_existing_person.source_system,
                        v_new_confidence, v_existing_confidence
                    ) ON CONFLICT DO NOTHING;

                    RETURN v_person_id;
                ELSE
                    -- No valid name, can't create - fall back to existing
                    RETURN trapper.canonical_person_id(v_existing_person.person_id);
                END IF;
            END IF;
        END IF;
    END IF;

    -- Try to find by phone
    IF v_phone_norm IS NOT NULL AND LENGTH(v_phone_norm) >= 10 THEN
        IF NOT EXISTS (SELECT 1 FROM trapper.identity_phone_blacklist WHERE phone_norm = v_phone_norm) THEN
            SELECT
                p.person_id,
                p.display_name,
                COALESCE(p.data_source::TEXT, 'unknown') AS source_system
            INTO v_existing_person
            FROM trapper.person_identifiers pi
            JOIN trapper.sot_people p ON p.person_id = pi.person_id
            WHERE pi.id_type = 'phone'
              AND pi.id_value_norm = v_phone_norm
              AND p.merged_into_person_id IS NULL
            LIMIT 1;

            IF v_existing_person.person_id IS NOT NULL THEN
                -- Check name similarity
                v_name_sim := trapper.name_similarity(v_display_name, v_existing_person.display_name);
                v_existing_confidence := trapper.get_source_confidence(v_existing_person.source_system);

                IF v_name_sim >= v_similarity_threshold THEN
                    -- Names are similar enough - same person
                    v_person_id := trapper.canonical_person_id(v_existing_person.person_id);

                    -- Add email if we matched by phone
                    IF v_email_norm IS NOT NULL THEN
                        INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system)
                        VALUES (v_person_id, 'email', p_email, v_email_norm, p_source_system)
                        ON CONFLICT DO NOTHING;
                    END IF;

                    RETURN v_person_id;
                ELSE
                    -- Names are different
                    RAISE NOTICE 'Phone match but name mismatch: "%" vs "%" (similarity: %)',
                        v_display_name, v_existing_person.display_name, v_name_sim;

                    IF trapper.is_valid_person_name(v_display_name) THEN
                        -- Create new person
                        INSERT INTO trapper.sot_people (display_name, data_source, is_canonical)
                        VALUES (v_display_name, p_source_system::trapper.data_source, TRUE)
                        RETURNING person_id INTO v_person_id;

                        -- Add identifiers
                        IF v_email_norm IS NOT NULL THEN
                            INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system)
                            VALUES (v_person_id, 'email', p_email, v_email_norm, p_source_system)
                            ON CONFLICT DO NOTHING;
                        END IF;

                        INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system)
                        VALUES (v_person_id, 'phone', p_phone, v_phone_norm, p_source_system)
                        ON CONFLICT DO NOTHING;

                        -- Flag as potential duplicate
                        INSERT INTO trapper.potential_person_duplicates (
                            person_id, potential_match_id, match_type, matched_identifier,
                            new_name, existing_name, name_similarity,
                            new_source_system, existing_source_system,
                            new_confidence, existing_confidence
                        ) VALUES (
                            v_person_id, v_existing_person.person_id, 'phone_name_mismatch', v_phone_norm,
                            v_display_name, v_existing_person.display_name, v_name_sim,
                            p_source_system, v_existing_person.source_system,
                            v_new_confidence, v_existing_confidence
                        ) ON CONFLICT DO NOTHING;

                        RETURN v_person_id;
                    ELSE
                        RETURN trapper.canonical_person_id(v_existing_person.person_id);
                    END IF;
                END IF;
            END IF;
        END IF;
    END IF;

    -- No existing match found - create new person if we have valid data
    IF v_display_name IS NOT NULL AND trapper.is_valid_person_name(v_display_name) THEN
        INSERT INTO trapper.sot_people (display_name, data_source, is_canonical)
        VALUES (v_display_name, p_source_system::trapper.data_source, TRUE)
        RETURNING person_id INTO v_person_id;

        -- Add identifiers
        IF v_email_norm IS NOT NULL THEN
            INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system)
            VALUES (v_person_id, 'email', p_email, v_email_norm, p_source_system)
            ON CONFLICT DO NOTHING;
        END IF;

        IF v_phone_norm IS NOT NULL AND LENGTH(v_phone_norm) >= 10 THEN
            IF NOT EXISTS (SELECT 1 FROM trapper.identity_phone_blacklist WHERE phone_norm = v_phone_norm) THEN
                INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system)
                VALUES (v_person_id, 'phone', p_phone, v_phone_norm, p_source_system)
                ON CONFLICT DO NOTHING;
            END IF;
        END IF;

        RETURN v_person_id;
    END IF;

    -- Couldn't create a person
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_or_create_person IS
'Find existing person by email/phone or create new one.
Fixed in MIG_252: Uses data_source column instead of source_system.';

\echo 'Done! find_or_create_person function updated.'
