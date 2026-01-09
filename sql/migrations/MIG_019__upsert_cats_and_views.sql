-- MIG_019__upsert_cats_and_views.sql
-- Cat Upsert Function + Unified Views
--
-- Creates:
--   - trapper.upsert_cats_from_clinichq(): extracts cats from staged ClinicHQ data
--   - trapper.v_cats_unified: unified cat view with identifiers and owners
--   - trapper.v_people_with_cats: people view with cat counts
--
-- Purpose:
--   - Deterministically upsert cats from ClinicHQ staged records
--   - Link cats to owners when owner is already in sot_people
--   - Provide surfaceable views for queries and UI
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_019__upsert_cats_and_views.sql

\echo '============================================'
\echo 'MIG_019: Cat Upsert Function + Views'
\echo '============================================'

-- ============================================
-- PART 1: Upsert Cats from ClinicHQ
-- ============================================
\echo ''
\echo 'Creating upsert_cats_from_clinichq function...'

CREATE OR REPLACE FUNCTION trapper.upsert_cats_from_clinichq()
RETURNS TABLE (
    cats_created INT,
    identifiers_added INT,
    rels_added INT
) AS $$
DECLARE
    v_cats_created INT := 0;
    v_identifiers_added INT := 0;
    v_rels_added INT := 0;

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
            sr.payload->>'Owner Email' AS owner_email,
            sr.payload->>'Owner Phone' AS owner_phone,
            sr.payload->>'Owner Cell Phone' AS owner_cell
        FROM trapper.staged_records sr
        WHERE sr.source_system = 'clinichq'
          AND sr.source_table = 'owner_info'
          AND sr.payload->>'Number' IS NOT NULL
          AND sr.payload->>'Number' != ''
    LOOP
        v_animal_id := TRIM(v_rec.animal_number);

        -- Find the cat by clinichq_animal_id
        SELECT ci.cat_id INTO v_cat_id
        FROM trapper.cat_identifiers ci
        WHERE ci.id_type = 'clinichq_animal_id'
          AND ci.id_value = v_animal_id;

        IF v_cat_id IS NULL THEN
            CONTINUE;  -- Cat not found, skip
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

    RETURN QUERY SELECT v_cats_created, v_identifiers_added, v_rels_added;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.upsert_cats_from_clinichq IS
'Upserts cats from ClinicHQ staged records (cat_info + owner_info).
Creates sot_cats, cat_identifiers, and person_cat_relationships.
Only links to owners that are already in sot_people.';

-- ============================================
-- PART 2: Generic Upsert Wrapper
-- ============================================
\echo 'Creating upsert_cats_from_observations wrapper...'

CREATE OR REPLACE FUNCTION trapper.upsert_cats_from_observations(
    p_source_table TEXT DEFAULT NULL
)
RETURNS TABLE (
    cats_created INT,
    identifiers_added INT,
    rels_added INT
) AS $$
BEGIN
    -- For now, only ClinicHQ is implemented
    -- Future: add Shelterluv, PetLink handlers
    IF p_source_table IS NULL OR p_source_table IN ('cat_info', 'owner_info') THEN
        RETURN QUERY SELECT * FROM trapper.upsert_cats_from_clinichq();
    ELSE
        -- Return zeros for unsupported sources
        RETURN QUERY SELECT 0, 0, 0;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.upsert_cats_from_observations IS
'Generic cat upsert wrapper. Currently supports ClinicHQ (cat_info, owner_info).
Future: Shelterluv, PetLink support.';

-- ============================================
-- PART 3: v_cats_unified View
-- ============================================
\echo ''
\echo 'Creating v_cats_unified view...'

CREATE OR REPLACE VIEW trapper.v_cats_unified AS
SELECT
    c.cat_id,
    c.display_name,
    c.sex,
    c.altered_status,
    c.birth_year,
    c.breed,
    c.primary_color,

    -- Aggregated identifiers
    (
        SELECT jsonb_agg(jsonb_build_object(
            'type', ci.id_type,
            'value', ci.id_value,
            'source', ci.source_system
        ) ORDER BY ci.id_type)
        FROM trapper.cat_identifiers ci
        WHERE ci.cat_id = c.cat_id
    ) AS identifiers,

    -- Aggregated owner names
    (
        SELECT string_agg(DISTINCT p.display_name, ', ' ORDER BY p.display_name)
        FROM trapper.person_cat_relationships pcr
        JOIN trapper.sot_people p ON p.person_id = trapper.canonical_person_id(pcr.person_id)
        WHERE pcr.cat_id = c.cat_id
          AND pcr.relationship_type = 'owner'
          AND p.display_name IS NOT NULL
    ) AS owner_names,

    -- Count of owners
    (
        SELECT COUNT(DISTINCT trapper.canonical_person_id(pcr.person_id))
        FROM trapper.person_cat_relationships pcr
        WHERE pcr.cat_id = c.cat_id
          AND pcr.relationship_type = 'owner'
    ) AS owner_count,

    -- Source info
    (
        SELECT DISTINCT ON (ci.source_system) ci.source_system
        FROM trapper.cat_identifiers ci
        WHERE ci.cat_id = c.cat_id
        ORDER BY ci.source_system, ci.created_at DESC
        LIMIT 1
    ) AS primary_source,

    c.created_at,
    c.updated_at

FROM trapper.sot_cats c;

COMMENT ON VIEW trapper.v_cats_unified IS
'Unified view of cats with identifiers and owner info.
Use for queries and UI display.';

-- ============================================
-- PART 4: v_people_with_cats View
-- ============================================
\echo 'Creating v_people_with_cats view...'

CREATE OR REPLACE VIEW trapper.v_people_with_cats AS
SELECT
    p.person_id,
    trapper.canonical_person_id(p.person_id) AS canonical_person_id,
    p.display_name,

    -- Cat count
    (
        SELECT COUNT(DISTINCT pcr.cat_id)
        FROM trapper.person_cat_relationships pcr
        WHERE trapper.canonical_person_id(pcr.person_id) = trapper.canonical_person_id(p.person_id)
    ) AS cat_count,

    -- Cat names aggregated
    (
        SELECT string_agg(DISTINCT c.display_name, ', ' ORDER BY c.display_name)
        FROM trapper.person_cat_relationships pcr
        JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
        WHERE trapper.canonical_person_id(pcr.person_id) = trapper.canonical_person_id(p.person_id)
          AND c.display_name IS NOT NULL
    ) AS cat_names,

    -- Cat IDs aggregated
    (
        SELECT jsonb_agg(DISTINCT pcr.cat_id)
        FROM trapper.person_cat_relationships pcr
        WHERE trapper.canonical_person_id(pcr.person_id) = trapper.canonical_person_id(p.person_id)
    ) AS cat_ids

FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL;  -- Only canonical people

COMMENT ON VIEW trapper.v_people_with_cats IS
'People view with their cat counts and names.
Only shows canonical (non-merged) people.';

-- ============================================
-- PART 5: Cat Stats View
-- ============================================
\echo 'Creating v_cats_stats view...'

CREATE OR REPLACE VIEW trapper.v_cats_stats AS
SELECT
    COUNT(*) AS total_cats,
    COUNT(display_name) AS with_name,
    COUNT(sex) AS with_sex,
    COUNT(altered_status) AS with_altered_status,
    COUNT(breed) AS with_breed,
    (SELECT COUNT(*) FROM trapper.cat_identifiers) AS total_identifiers,
    (SELECT COUNT(*) FROM trapper.person_cat_relationships) AS total_relationships,
    (SELECT COUNT(DISTINCT cat_id) FROM trapper.person_cat_relationships) AS cats_with_owners
FROM trapper.sot_cats;

COMMENT ON VIEW trapper.v_cats_stats IS
'Summary statistics for the cats layer.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_019 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Functions created:'
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'trapper'
  AND routine_name IN ('upsert_cats_from_clinichq', 'upsert_cats_from_observations')
ORDER BY routine_name;

\echo ''
\echo 'Views created:'
SELECT table_name FROM information_schema.views
WHERE table_schema = 'trapper'
  AND table_name IN ('v_cats_unified', 'v_people_with_cats', 'v_cats_stats')
ORDER BY table_name;

\echo ''
\echo 'Next steps:'
\echo '  1. Run: SELECT * FROM trapper.upsert_cats_from_clinichq();'
\echo '  2. Check: SELECT * FROM trapper.v_cats_stats;'
\echo '  3. Query: SELECT * FROM trapper.v_cats_unified LIMIT 10;'
\echo ''
