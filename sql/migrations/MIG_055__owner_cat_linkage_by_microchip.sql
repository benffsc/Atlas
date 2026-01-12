-- MIG_055__owner_cat_linkage_by_microchip.sql
-- Fix owner-cat linkage to also match by microchip
--
-- Problem:
--   upsert_cats_from_clinichq() only matches owner_info to cats via clinichq_animal_id
--   using the "Number" field. But many cats (especially from appointment_info) only
--   have microchip identifiers. Owner_info records have "Microchip Number" field that
--   should be used as fallback for matching.
--
-- Example:
--   Cat 900085001746278 was created from appointment_info, has microchip but no clinichq_animal_id
--   Dawan Kaewkhao's owner_info has Microchip Number = 900085001746278 but Number = 24-125 (appointment#)
--   Current function can't link them because it only uses Number -> clinichq_animal_id
--
-- Fix:
--   Add microchip fallback in owner_info processing loop
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_055__owner_cat_linkage_by_microchip.sql

\echo '============================================'
\echo 'MIG_055: Owner-Cat Linkage by Microchip'
\echo '============================================'

\echo ''
\echo 'Updating upsert_cats_from_clinichq with microchip fallback...'

CREATE OR REPLACE FUNCTION trapper.upsert_cats_from_clinichq()
RETURNS TABLE (
    cats_created INT,
    identifiers_added INT,
    rels_added INT,
    cats_skipped_protected INT
) AS $$
DECLARE
    v_cats_created INT := 0;
    v_identifiers_added INT := 0;
    v_rels_added INT := 0;
    v_cats_skipped INT := 0;

    v_rec RECORD;
    v_cat_id UUID;
    v_existing_cat_id UUID;
    v_animal_id TEXT;
    v_microchip TEXT;
    v_owner_person_id UUID;
BEGIN
    -- Process cat_info staged records (primary source for cat details)
    FOR v_rec IN
        SELECT
            sr.id AS staged_record_id,
            sr.source_system,
            sr.source_table,
            sr.payload->>'Number' AS animal_number,
            sr.payload->>'Animal Name' AS animal_name,
            sr.payload->>'Sex' AS sex,
            sr.payload->>'Spay Neuter Status' AS altered_status,
            sr.payload->>'Breed' AS breed,
            sr.payload->>'Primary Color' AS primary_color,
            sr.payload->>'Microchip Number' AS microchip,
            NULLIF(sr.payload->>'Age Years', '')::INT AS age_years
        FROM trapper.staged_records sr
        WHERE sr.source_system = 'clinichq'
          AND sr.source_table = 'cat_info'
          AND sr.payload->>'Number' IS NOT NULL
          AND sr.payload->>'Number' != ''
    LOOP
        v_animal_id := TRIM(v_rec.animal_number);
        v_microchip := NULLIF(TRIM(COALESCE(v_rec.microchip, '')), '');

        -- Skip if animal_id is empty
        IF v_animal_id IS NULL OR v_animal_id = '' THEN
            CONTINUE;
        END IF;

        -- Check if cat already exists by clinichq_animal_id
        SELECT ci.cat_id INTO v_existing_cat_id
        FROM trapper.cat_identifiers ci
        WHERE ci.id_type = 'clinichq_animal_id'
          AND ci.id_value = v_animal_id;

        IF v_existing_cat_id IS NOT NULL THEN
            -- Cat exists, use it
            v_cat_id := v_existing_cat_id;

            -- Update cat details if needed (fill in missing fields)
            UPDATE trapper.sot_cats
            SET
                display_name = COALESCE(display_name, v_rec.animal_name),
                sex = COALESCE(sex, v_rec.sex),
                altered_status = COALESCE(altered_status, v_rec.altered_status),
                breed = COALESCE(breed, v_rec.breed),
                primary_color = COALESCE(primary_color, v_rec.primary_color),
                birth_year = COALESCE(birth_year,
                    CASE WHEN v_rec.age_years IS NOT NULL
                         THEN EXTRACT(YEAR FROM NOW())::INT - v_rec.age_years
                         ELSE NULL END),
                updated_at = NOW()
            WHERE cat_id = v_cat_id;
        ELSE
            -- Create new cat
            INSERT INTO trapper.sot_cats (
                display_name, sex, altered_status, breed, primary_color, birth_year
            ) VALUES (
                v_rec.animal_name,
                v_rec.sex,
                v_rec.altered_status,
                v_rec.breed,
                v_rec.primary_color,
                CASE WHEN v_rec.age_years IS NOT NULL
                     THEN EXTRACT(YEAR FROM NOW())::INT - v_rec.age_years
                     ELSE NULL END
            )
            RETURNING cat_id INTO v_cat_id;

            v_cats_created := v_cats_created + 1;

            -- Add clinichq_animal_id identifier
            INSERT INTO trapper.cat_identifiers (
                cat_id, id_type, id_value, source_system, source_table
            ) VALUES (
                v_cat_id, 'clinichq_animal_id', v_animal_id, 'clinichq', 'cat_info'
            )
            ON CONFLICT (id_type, id_value) DO NOTHING;

            IF FOUND THEN
                v_identifiers_added := v_identifiers_added + 1;
            END IF;
        END IF;

        -- Add microchip identifier if present and not already added
        IF v_microchip IS NOT NULL AND LENGTH(v_microchip) >= 9 THEN
            INSERT INTO trapper.cat_identifiers (
                cat_id, id_type, id_value, source_system, source_table
            ) VALUES (
                v_cat_id, 'microchip', v_microchip, 'clinichq', 'cat_info'
            )
            ON CONFLICT (id_type, id_value) DO NOTHING;

            IF FOUND THEN
                v_identifiers_added := v_identifiers_added + 1;
            END IF;
        END IF;
    END LOOP;

    -- Process owner_info to create person-cat relationships
    -- Only link when both cat and owner are already in their SoT tables
    FOR v_rec IN
        SELECT
            sr.id AS staged_record_id,
            sr.source_system,
            sr.source_table,
            sr.payload->>'Number' AS animal_number,
            sr.payload->>'Microchip Number' AS microchip,  -- NEW: Also extract microchip
            sr.payload->>'Owner Email' AS owner_email,
            sr.payload->>'Owner Phone' AS owner_phone,
            sr.payload->>'Owner Cell Phone' AS owner_cell
        FROM trapper.staged_records sr
        WHERE sr.source_system = 'clinichq'
          AND sr.source_table = 'owner_info'
    LOOP
        v_animal_id := NULLIF(TRIM(COALESCE(v_rec.animal_number, '')), '');
        v_microchip := NULLIF(TRIM(COALESCE(v_rec.microchip, '')), '');

        v_cat_id := NULL;

        -- STEP 1: Try to find cat by clinichq_animal_id (from Number field)
        IF v_animal_id IS NOT NULL AND v_animal_id != '' THEN
            SELECT ci.cat_id INTO v_cat_id
            FROM trapper.cat_identifiers ci
            WHERE ci.id_type = 'clinichq_animal_id'
              AND ci.id_value = v_animal_id;
        END IF;

        -- STEP 2 (NEW): If not found, try by microchip
        IF v_cat_id IS NULL AND v_microchip IS NOT NULL AND LENGTH(v_microchip) >= 9 THEN
            SELECT ci.cat_id INTO v_cat_id
            FROM trapper.cat_identifiers ci
            WHERE ci.id_type = 'microchip'
              AND ci.id_value = v_microchip;
        END IF;

        -- Skip if cat still not found
        IF v_cat_id IS NULL THEN
            CONTINUE;
        END IF;

        -- Try to find owner by email first, then by phone
        v_owner_person_id := NULL;

        -- Check email
        IF v_rec.owner_email IS NOT NULL AND v_rec.owner_email != '' THEN
            SELECT pi.person_id INTO v_owner_person_id
            FROM trapper.person_identifiers pi
            WHERE pi.id_type = 'email'
              AND pi.id_value_norm = trapper.norm_email(v_rec.owner_email);

            IF v_owner_person_id IS NOT NULL THEN
                v_owner_person_id := trapper.canonical_person_id(v_owner_person_id);
            END IF;
        END IF;

        -- Check phone if no email match
        IF v_owner_person_id IS NULL AND v_rec.owner_phone IS NOT NULL AND v_rec.owner_phone != '' THEN
            SELECT pi.person_id INTO v_owner_person_id
            FROM trapper.person_identifiers pi
            WHERE pi.id_type = 'phone'
              AND pi.id_value_norm = trapper.norm_phone_us(v_rec.owner_phone);

            IF v_owner_person_id IS NOT NULL THEN
                v_owner_person_id := trapper.canonical_person_id(v_owner_person_id);
            END IF;
        END IF;

        -- Check cell phone if no other match
        IF v_owner_person_id IS NULL AND v_rec.owner_cell IS NOT NULL AND v_rec.owner_cell != '' THEN
            SELECT pi.person_id INTO v_owner_person_id
            FROM trapper.person_identifiers pi
            WHERE pi.id_type = 'phone'
              AND pi.id_value_norm = trapper.norm_phone_us(v_rec.owner_cell);

            IF v_owner_person_id IS NOT NULL THEN
                v_owner_person_id := trapper.canonical_person_id(v_owner_person_id);
            END IF;
        END IF;

        -- Create relationship if owner found
        IF v_owner_person_id IS NOT NULL THEN
            INSERT INTO trapper.person_cat_relationships (
                person_id, cat_id, relationship_type, confidence,
                source_system, source_table
            ) VALUES (
                v_owner_person_id, v_cat_id, 'owner', 'high',
                'clinichq', 'owner_info'
            )
            ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table)
            DO NOTHING;

            IF FOUND THEN
                v_rels_added := v_rels_added + 1;
            END IF;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_cats_created, v_identifiers_added, v_rels_added, v_cats_skipped;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.upsert_cats_from_clinichq IS
'Upserts cats from ClinicHQ staged records (cat_info + owner_info).
Creates sot_cats, cat_identifiers, and person_cat_relationships.
Only links to owners that are already in sot_people.
Now matches owner_info to cats by BOTH clinichq_animal_id AND microchip.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'Testing: Looking for Dawan Kaewkhao -> cat 900085001746278 linkage potential...'

SELECT
    p.display_name as person,
    p.person_id::text,
    c.display_name as cat,
    ci.id_value as microchip
FROM trapper.sot_people p
JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
JOIN trapper.staged_records sr ON sr.source_table = 'owner_info'
    AND trapper.norm_email(sr.payload->>'Owner Email') = pi.id_value_norm
JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number'
JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
WHERE p.display_name ILIKE '%Dawan%'
LIMIT 5;

\echo ''
\echo '============================================'
\echo 'MIG_055 Complete'
\echo '============================================'
\echo ''
\echo 'Next: Run trapper.upsert_cats_from_clinichq() to create new linkages'
\echo ''
