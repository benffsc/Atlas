-- MIG_051__extract_cats_from_petlink.sql
-- Extract cats from petlink.pets microchip registry
--
-- PURPOSE:
--   Petlink has 8,280 verified microchips with only 15 in canonical tables.
--   This extracts the remaining ~8,265 missing cats.
--
-- DATA SOURCE:
--   petlink.pets - microchip registry data with owner info
--   Fields: Microchip, Name, Breed, Owner, First Name, Name_2 (last), Email, City, State, Zip Code
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_051__extract_cats_from_petlink.sql

\echo '============================================'
\echo 'MIG_051: Extract Cats from Petlink'
\echo '============================================'

-- ============================================
-- PART 1: Helper function to clean cat names
-- ============================================
\echo ''
\echo 'Creating helper function to clean petlink cat names...'

CREATE OR REPLACE FUNCTION trapper.clean_petlink_cat_name(raw_name TEXT, microchip TEXT)
RETURNS TEXT AS $$
DECLARE
    cleaned TEXT;
BEGIN
    -- Remove microchip from name if present (common pattern: "Pricilla 981020053524791")
    cleaned := TRIM(raw_name);

    IF microchip IS NOT NULL AND LENGTH(microchip) > 0 THEN
        cleaned := TRIM(REPLACE(cleaned, microchip, ''));
    END IF;

    -- Remove common noise patterns
    cleaned := TRIM(REGEXP_REPLACE(cleaned, '\s+', ' ', 'g'));  -- collapse multiple spaces
    cleaned := TRIM(REGEXP_REPLACE(cleaned, '^\d+\s*', ''));    -- leading numbers
    cleaned := TRIM(REGEXP_REPLACE(cleaned, '\s*\d+$', ''));    -- trailing numbers

    -- If nothing left, return NULL
    IF cleaned = '' THEN
        RETURN NULL;
    END IF;

    RETURN cleaned;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- PART 2: Extract cats from petlink
-- ============================================
\echo ''
\echo 'Creating upsert_cats_from_petlink function...'

CREATE OR REPLACE FUNCTION trapper.upsert_cats_from_petlink()
RETURNS TABLE (
    cats_created INT,
    cats_updated INT,
    identifiers_added INT,
    owners_linked INT
) AS $$
DECLARE
    v_cats_created INT := 0;
    v_cats_updated INT := 0;
    v_identifiers_added INT := 0;
    v_owners_linked INT := 0;

    v_rec RECORD;
    v_cat_id UUID;
    v_existing_cat_id UUID;
    v_microchip TEXT;
    v_clean_name TEXT;
    v_owner_person_id UUID;
    v_petlink_id TEXT;
BEGIN
    FOR v_rec IN
        SELECT
            sr.id AS staged_record_id,
            sr.source_system,
            sr.source_table,
            TRIM(sr.payload->>'Microchip') AS microchip,
            TRIM(sr.payload->>'Name') AS raw_name,
            TRIM(sr.payload->>'Breed') AS breed,
            TRIM(sr.payload->>'ID') AS petlink_id,
            TRIM(sr.payload->>'Owner') AS owner_id,
            TRIM(sr.payload->>'First Name') AS owner_first_name,
            TRIM(sr.payload->>'Name_2') AS owner_last_name,
            TRIM(sr.payload->>'Email') AS owner_email,
            TRIM(sr.payload->>'City') AS owner_city,
            TRIM(sr.payload->>'State') AS owner_state,
            TRIM(sr.payload->>'Zip Code') AS owner_zip,
            TRIM(sr.payload->>'Status') AS status
        FROM trapper.staged_records sr
        WHERE sr.source_system = 'petlink'
          AND sr.source_table = 'pets'
          AND sr.payload->>'Microchip' IS NOT NULL
          AND TRIM(sr.payload->>'Microchip') != ''
          AND LENGTH(TRIM(sr.payload->>'Microchip')) >= 9
    LOOP
        v_microchip := v_rec.microchip;
        v_petlink_id := v_rec.petlink_id;
        v_clean_name := trapper.clean_petlink_cat_name(v_rec.raw_name, v_microchip);

        -- Check if cat already exists by microchip
        SELECT ci.cat_id INTO v_existing_cat_id
        FROM trapper.cat_identifiers ci
        WHERE ci.id_type = 'microchip'
          AND ci.id_value = v_microchip;

        IF v_existing_cat_id IS NOT NULL THEN
            -- Cat exists, update if we have better data
            v_cat_id := v_existing_cat_id;

            UPDATE trapper.sot_cats
            SET
                display_name = COALESCE(display_name, v_clean_name),
                breed = COALESCE(breed, v_rec.breed),
                updated_at = NOW()
            WHERE cat_id = v_cat_id
              AND (display_name IS NULL OR breed IS NULL);

            IF FOUND THEN
                v_cats_updated := v_cats_updated + 1;
            END IF;
        ELSE
            -- Create new cat
            INSERT INTO trapper.sot_cats (
                display_name,
                breed,
                data_source
            ) VALUES (
                COALESCE(v_clean_name, 'Unknown (Petlink ' || v_microchip || ')'),
                v_rec.breed,
                'petlink'
            )
            RETURNING cat_id INTO v_cat_id;

            v_cats_created := v_cats_created + 1;
        END IF;

        -- Add microchip identifier
        INSERT INTO trapper.cat_identifiers (
            cat_id, id_type, id_value, source_system, source_table
        ) VALUES (
            v_cat_id, 'microchip', v_microchip, 'petlink', 'pets'
        )
        ON CONFLICT (id_type, id_value) DO NOTHING;

        IF FOUND THEN
            v_identifiers_added := v_identifiers_added + 1;
        END IF;

        -- Try to link to owner by email if we can find them
        IF v_rec.owner_email IS NOT NULL AND v_rec.owner_email != '' THEN
            SELECT pi.person_id INTO v_owner_person_id
            FROM trapper.person_identifiers pi
            WHERE pi.id_type = 'email'
              AND pi.id_value_norm = LOWER(v_rec.owner_email);

            -- If we found an owner, link them
            IF v_owner_person_id IS NOT NULL THEN
                INSERT INTO trapper.person_cat_relationships (
                    person_id,
                    cat_id,
                    relationship_type,
                    source_system,
                    source_table,
                    confidence
                ) VALUES (
                    v_owner_person_id,
                    v_cat_id,
                    'owner',
                    'petlink',
                    'pets',
                    'high'
                )
                ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table) DO NOTHING;

                IF FOUND THEN
                    v_owners_linked := v_owners_linked + 1;
                END IF;
            END IF;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_cats_created, v_cats_updated, v_identifiers_added, v_owners_linked;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 3: Extract microchips from appointment_info
-- ============================================
\echo ''
\echo 'Creating upsert_microchips_from_appointments function...'

CREATE OR REPLACE FUNCTION trapper.upsert_microchips_from_appointments()
RETURNS TABLE (
    cats_created INT,
    microchips_added INT
) AS $$
DECLARE
    v_cats_created INT := 0;
    v_microchips_added INT := 0;

    v_rec RECORD;
    v_cat_id UUID;
    v_existing_cat_id UUID;
    v_microchip TEXT;
    v_clean_name TEXT;
BEGIN
    -- Process appointment_info records that have microchips not already in cat_identifiers
    FOR v_rec IN
        SELECT
            sr.id AS staged_record_id,
            TRIM(sr.payload->>'Microchip Number') AS microchip,
            TRIM(sr.payload->>'Animal Name') AS animal_name,
            TRIM(sr.payload->>'Breed') AS breed,
            TRIM(sr.payload->>'Sex') AS sex,
            TRIM(sr.payload->>'Spay Neuter Status') AS altered_status,
            TRIM(sr.payload->>'Primary Color') AS primary_color
        FROM trapper.staged_records sr
        WHERE sr.source_system = 'clinichq'
          AND sr.source_table = 'appointment_info'
          AND sr.payload->>'Microchip Number' IS NOT NULL
          AND TRIM(sr.payload->>'Microchip Number') != ''
          AND LENGTH(TRIM(sr.payload->>'Microchip Number')) >= 9
          -- Only process microchips not already in identifiers
          AND NOT EXISTS (
              SELECT 1 FROM trapper.cat_identifiers ci
              WHERE ci.id_type = 'microchip'
                AND ci.id_value = TRIM(sr.payload->>'Microchip Number')
          )
    LOOP
        v_microchip := v_rec.microchip;
        v_clean_name := trapper.clean_petlink_cat_name(v_rec.animal_name, v_microchip);

        -- Create new cat for this microchip
        INSERT INTO trapper.sot_cats (
            display_name,
            sex,
            altered_status,
            breed,
            primary_color,
            data_source
        ) VALUES (
            COALESCE(v_clean_name, 'Unknown (Clinic ' || v_microchip || ')'),
            v_rec.sex,
            v_rec.altered_status,
            v_rec.breed,
            v_rec.primary_color,
            'clinichq'
        )
        RETURNING cat_id INTO v_cat_id;

        v_cats_created := v_cats_created + 1;

        -- Add microchip identifier
        INSERT INTO trapper.cat_identifiers (
            cat_id, id_type, id_value, source_system, source_table
        ) VALUES (
            v_cat_id, 'microchip', v_microchip, 'clinichq', 'appointment_info'
        )
        ON CONFLICT (id_type, id_value) DO NOTHING;

        IF FOUND THEN
            v_microchips_added := v_microchips_added + 1;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_cats_created, v_microchips_added;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_051 Complete'
\echo '============================================'

\echo ''
\echo 'Functions created:'
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'trapper'
  AND routine_name IN (
      'clean_petlink_cat_name',
      'upsert_cats_from_petlink',
      'upsert_microchips_from_appointments'
  )
ORDER BY routine_name;

\echo ''
\echo 'To extract cats, run:'
\echo '  SELECT * FROM trapper.upsert_cats_from_petlink();'
\echo '  SELECT * FROM trapper.upsert_microchips_from_appointments();'
\echo ''
