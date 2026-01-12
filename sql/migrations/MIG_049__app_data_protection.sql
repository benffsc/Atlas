-- MIG_049__app_data_protection.sql
-- Data Protection for App-Created Records
--
-- PURPOSE:
--   Ensure that records created in the Atlas app (data_source='app') are not
--   accidentally overwritten or deleted by automated ingestion pipelines.
--
-- PROTECTION RULES:
--   1. Records with data_source='app' are PROTECTED from automated updates
--   2. Records with verified_at NOT NULL are PROTECTED
--   3. Protected records can still be manually edited via the app
--   4. Extraction pipelines MUST check is_protected() before modifying
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_049__app_data_protection.sql

\echo '============================================'
\echo 'MIG_049: App Data Protection'
\echo '============================================'

-- ============================================
-- PART 1: Protection Check Functions
-- ============================================
\echo ''
\echo 'Creating is_protected helper functions...'

-- Check if a cat is protected
CREATE OR REPLACE FUNCTION trapper.is_cat_protected(p_cat_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_protected BOOLEAN;
BEGIN
    SELECT (data_source = 'app' OR verified_at IS NOT NULL)
    INTO v_protected
    FROM trapper.sot_cats
    WHERE cat_id = p_cat_id;

    RETURN COALESCE(v_protected, FALSE);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.is_cat_protected IS
'Returns true if a cat record is protected from automated updates.
Protected = data_source is "app" OR has been manually verified.';

-- Check if a person is protected
CREATE OR REPLACE FUNCTION trapper.is_person_protected(p_person_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_protected BOOLEAN;
BEGIN
    SELECT (data_source = 'app' OR verified_at IS NOT NULL)
    INTO v_protected
    FROM trapper.sot_people
    WHERE person_id = p_person_id;

    RETURN COALESCE(v_protected, FALSE);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.is_person_protected IS
'Returns true if a person record is protected from automated updates.
Protected = data_source is "app" OR has been manually verified.';

-- Check if a place is protected
CREATE OR REPLACE FUNCTION trapper.is_place_protected(p_place_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_protected BOOLEAN;
BEGIN
    SELECT (data_source = 'app' OR verified_at IS NOT NULL)
    INTO v_protected
    FROM trapper.places
    WHERE place_id = p_place_id;

    RETURN COALESCE(v_protected, FALSE);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.is_place_protected IS
'Returns true if a place record is protected from automated updates.
Protected = data_source is "app" OR has been manually verified.';

-- ============================================
-- PART 2: Update upsert_cats_from_clinichq to Skip Protected
-- ============================================
\echo ''
\echo 'Updating upsert_cats_from_clinichq with protection...'

-- Drop existing function (return type changed to include cats_skipped_protected)
DROP FUNCTION IF EXISTS trapper.upsert_cats_from_clinichq();

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
            -- ========== PROTECTION CHECK ==========
            IF trapper.is_cat_protected(v_existing_cat_id) THEN
                v_cats_skipped := v_cats_skipped + 1;
                CONTINUE;  -- Skip protected records
            END IF;

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
                display_name, sex, altered_status, breed, primary_color, birth_year,
                data_source
            ) VALUES (
                v_rec.animal_name,
                v_rec.sex,
                v_rec.altered_status,
                v_rec.breed,
                v_rec.primary_color,
                CASE WHEN v_rec.age_years IS NOT NULL
                     THEN EXTRACT(YEAR FROM NOW())::INT - v_rec.age_years
                     ELSE NULL END,
                'legacy_import'  -- Explicitly mark as legacy import
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

        IF v_rec.owner_email IS NOT NULL AND v_rec.owner_email != '' THEN
            SELECT pi.person_id INTO v_owner_person_id
            FROM trapper.person_identifiers pi
            WHERE pi.id_type = 'email'
              AND pi.id_value_norm = trapper.norm_email(v_rec.owner_email);

            IF v_owner_person_id IS NOT NULL THEN
                v_owner_person_id := trapper.canonical_person_id(v_owner_person_id);
            END IF;
        END IF;

        IF v_owner_person_id IS NULL AND v_rec.owner_phone IS NOT NULL AND v_rec.owner_phone != '' THEN
            SELECT pi.person_id INTO v_owner_person_id
            FROM trapper.person_identifiers pi
            WHERE pi.id_type = 'phone'
              AND pi.id_value_norm = trapper.norm_phone_us(v_rec.owner_phone);

            IF v_owner_person_id IS NOT NULL THEN
                v_owner_person_id := trapper.canonical_person_id(v_owner_person_id);
            END IF;
        END IF;

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
'Upserts cats from ClinicHQ staged records with PROTECTION for app-created data.
- Protected records (data_source="app" or verified) are SKIPPED
- Returns count of skipped protected records
- Only links to owners already in sot_people';

-- ============================================
-- PART 3: Protection Rules Documentation
-- ============================================
\echo ''
\echo 'Creating data protection rules view...'

CREATE OR REPLACE VIEW trapper.v_data_protection_rules AS
SELECT
    'protected_sources' AS rule_id,
    'Records with data_source=''app'' are protected' AS rule,
    'App-created records cannot be modified by ingestion pipelines' AS description
UNION ALL SELECT
    'verified_protection', 'Records with verified_at IS NOT NULL are protected',
    'Manually verified records cannot be modified by ingestion pipelines'
UNION ALL SELECT
    'protection_check', 'Pipelines MUST call is_*_protected() before updates',
    'Use is_cat_protected(), is_person_protected(), is_place_protected()'
UNION ALL SELECT
    'manual_override', 'Protected records CAN be edited via the app UI',
    'Protection only blocks automated ingestion, not manual edits'
UNION ALL SELECT
    'deletion_safety', 'Protected records should NOT be deleted by pipelines',
    'Only app UI should allow deletion of protected records';

COMMENT ON VIEW trapper.v_data_protection_rules IS
'Documents data protection rules for app-created records.
Query this view to understand protection behavior.';

-- ============================================
-- PART 4: Protection Status Views
-- ============================================
\echo ''
\echo 'Creating protection status views...'

-- Cats protection summary
CREATE OR REPLACE VIEW trapper.v_cat_protection_summary AS
SELECT
    data_source::TEXT,
    COUNT(*) AS total,
    COUNT(verified_at) AS verified_count,
    COUNT(*) FILTER (WHERE trapper.is_cat_protected(cat_id)) AS protected_count
FROM trapper.sot_cats
GROUP BY data_source;

COMMENT ON VIEW trapper.v_cat_protection_summary IS
'Summary of cat protection status by data source.';

-- People protection summary
CREATE OR REPLACE VIEW trapper.v_person_protection_summary AS
SELECT
    data_source::TEXT,
    COUNT(*) AS total,
    COUNT(verified_at) AS verified_count,
    COUNT(*) FILTER (WHERE trapper.is_person_protected(person_id)) AS protected_count
FROM trapper.sot_people
GROUP BY data_source;

COMMENT ON VIEW trapper.v_person_protection_summary IS
'Summary of person protection status by data source.';

-- Places protection summary
CREATE OR REPLACE VIEW trapper.v_place_protection_summary AS
SELECT
    data_source::TEXT,
    COUNT(*) AS total,
    COUNT(verified_at) AS verified_count,
    COUNT(*) FILTER (WHERE trapper.is_place_protected(place_id)) AS protected_count
FROM trapper.places
GROUP BY data_source;

COMMENT ON VIEW trapper.v_place_protection_summary IS
'Summary of place protection status by data source.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_049 Complete'
\echo '============================================'

\echo ''
\echo 'Protection functions created:'
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'trapper'
  AND routine_name LIKE '%_protected'
ORDER BY routine_name;

\echo ''
\echo 'Current protection status:'
SELECT * FROM trapper.v_cat_protection_summary;

\echo ''
\echo 'Data protection rules:'
SELECT rule_id, rule FROM trapper.v_data_protection_rules;

\echo ''
\echo 'MIG_049 applied. App-created records are now protected.'
\echo ''
