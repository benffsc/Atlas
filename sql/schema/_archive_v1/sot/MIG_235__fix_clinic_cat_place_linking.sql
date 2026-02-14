\echo '=== MIG_235: Fix Clinic Cat-Place Linking ==='
\echo 'Links cats from clinic appointments to their locations via owner contact info'

-- The issue: clinic pipeline tries to link cats via appointment.person_id,
-- but person_id is often NULL. This function links via owner email/phone instead.

CREATE OR REPLACE FUNCTION trapper.link_clinic_cats_to_places()
RETURNS TABLE(
    cats_linked INT,
    places_found INT,
    relationships_created INT
) AS $$
DECLARE
    v_cats_linked INT := 0;
    v_places_found INT := 0;
    v_relationships_created INT := 0;
BEGIN
    -- Create cat-place relationships by chaining:
    -- 1. cat_identifiers (microchip) → sot_cats
    -- 2. staged_records (owner_info with matching email/phone) → person contact
    -- 3. person_identifiers → sot_people
    -- 4. person_place_relationships → places

    -- Insert new cat-place relationships
    WITH clinic_cats_with_places AS (
        SELECT DISTINCT
            c.cat_id,
            ppr.place_id,
            'appointment_site' as relationship_type,
            'high' as confidence
        FROM trapper.sot_cats c
        -- Get microchip for this cat
        JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id
            AND ci.id_type = 'microchip'
        -- Find staged owner_info records with this microchip
        JOIN trapper.staged_records sr ON sr.source_table = 'owner_info'
            AND (
                sr.payload->>'Microchip Number' = ci.id_value
                OR sr.payload->>'Pet ID' = ci.id_value
            )
        -- Get owner email from staged record
        JOIN trapper.person_identifiers pi ON (
            (pi.id_type = 'email' AND pi.id_value_norm = LOWER(TRIM(sr.payload->>'Owner Email')))
            OR (pi.id_type = 'phone' AND pi.id_value_norm = RIGHT(REGEXP_REPLACE(COALESCE(sr.payload->>'Owner Cell Phone', sr.payload->>'Owner Phone'), '[^0-9]', '', 'g'), 10))
        )
        -- Get places for this person
        JOIN trapper.person_place_relationships ppr ON ppr.person_id = pi.person_id
        WHERE
            -- Only cats without an existing place relationship
            NOT EXISTS (
                SELECT 1 FROM trapper.cat_place_relationships cpr
                WHERE cpr.cat_id = c.cat_id AND cpr.place_id = ppr.place_id
            )
            -- Only for real cats (not merged)
            AND c.merged_into_cat_id IS NULL
    ),
    inserted AS (
        INSERT INTO trapper.cat_place_relationships (
            cat_id, place_id, relationship_type, confidence, source_system, source_table
        )
        SELECT
            cat_id,
            place_id,
            relationship_type,
            confidence,
            'clinic_linking',
            'mig_235_backfill'
        FROM clinic_cats_with_places
        ON CONFLICT (cat_id, place_id) DO NOTHING
        RETURNING cat_id, place_id
    )
    SELECT
        COUNT(DISTINCT cat_id),
        COUNT(DISTINCT place_id),
        COUNT(*)
    INTO v_cats_linked, v_places_found, v_relationships_created
    FROM inserted;

    RAISE NOTICE 'Cat-place linking complete: % cats linked to % places (% relationships created)',
        v_cats_linked, v_places_found, v_relationships_created;

    RETURN QUERY SELECT v_cats_linked, v_places_found, v_relationships_created;
END;
$$ LANGUAGE plpgsql;

-- Alternative simpler approach: link via sot_appointments directly
CREATE OR REPLACE FUNCTION trapper.link_appointment_cats_to_places()
RETURNS TABLE(
    cats_linked INT,
    places_found INT,
    relationships_created INT
) AS $$
DECLARE
    v_cats_linked INT := 0;
    v_places_found INT := 0;
    v_relationships_created INT := 0;
BEGIN
    -- Link cats from appointments where we have both cat_id and can find place via owner
    WITH appointment_cat_places AS (
        SELECT DISTINCT
            a.cat_id,
            ppr.place_id,
            'appointment_site' as relationship_type,
            'high' as confidence
        FROM trapper.sot_appointments a
        -- Need cat_id
        WHERE a.cat_id IS NOT NULL
        -- Find owner by booking info
        AND EXISTS (
            SELECT 1 FROM trapper.person_identifiers pi
            WHERE (
                (pi.id_type = 'email' AND a.owner_email IS NOT NULL AND pi.id_value_norm = LOWER(TRIM(a.owner_email)))
                OR (pi.id_type = 'phone' AND a.owner_phone IS NOT NULL AND pi.id_value_norm = RIGHT(REGEXP_REPLACE(a.owner_phone, '[^0-9]', '', 'g'), 10))
            )
        )
        -- Get place via person
        JOIN trapper.person_identifiers pi ON (
            (pi.id_type = 'email' AND a.owner_email IS NOT NULL AND pi.id_value_norm = LOWER(TRIM(a.owner_email)))
            OR (pi.id_type = 'phone' AND a.owner_phone IS NOT NULL AND pi.id_value_norm = RIGHT(REGEXP_REPLACE(a.owner_phone, '[^0-9]', '', 'g'), 10))
        )
        JOIN trapper.person_place_relationships ppr ON ppr.person_id = pi.person_id
        -- Exclude existing relationships
        WHERE NOT EXISTS (
            SELECT 1 FROM trapper.cat_place_relationships cpr
            WHERE cpr.cat_id = a.cat_id AND cpr.place_id = ppr.place_id
        )
    ),
    inserted AS (
        INSERT INTO trapper.cat_place_relationships (
            cat_id, place_id, relationship_type, confidence, source_system, source_table
        )
        SELECT
            cat_id,
            place_id,
            relationship_type,
            confidence,
            'appointment_linking',
            'mig_235_appointments'
        FROM appointment_cat_places
        ON CONFLICT (cat_id, place_id) DO NOTHING
        RETURNING cat_id, place_id
    )
    SELECT
        COUNT(DISTINCT cat_id),
        COUNT(DISTINCT place_id),
        COUNT(*)
    INTO v_cats_linked, v_places_found, v_relationships_created
    FROM inserted;

    RAISE NOTICE 'Appointment cat-place linking: % cats linked to % places (% relationships)',
        v_cats_linked, v_places_found, v_relationships_created;

    RETURN QUERY SELECT v_cats_linked, v_places_found, v_relationships_created;
END;
$$ LANGUAGE plpgsql;

-- Check current state
SELECT
    (SELECT COUNT(*) FROM trapper.sot_cats WHERE merged_into_cat_id IS NULL) as total_cats,
    (SELECT COUNT(DISTINCT cat_id) FROM trapper.cat_place_relationships) as cats_with_places,
    (SELECT COUNT(*) FROM trapper.sot_appointments WHERE cat_id IS NOT NULL) as appointments_with_cats;

\echo 'MIG_235 complete: Run SELECT * FROM trapper.link_appointment_cats_to_places(); to execute linking'
