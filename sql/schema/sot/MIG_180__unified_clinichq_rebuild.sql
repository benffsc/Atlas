-- MIG_180__unified_clinichq_rebuild.sql
-- Unified ClinicHQ Rebuild with Change Tracking
--
-- CORE PRINCIPLES:
--   1. CAT: Microchip is the ONLY key
--   2. PERSON: Real humans only (email OR phone + valid name)
--   3. ORGANIZATION: Internal accounts link to departments, NOT fake people
--   4. PLACE: Google-normalized address is the key
--   5. CHANGE TRACKING: All updates are logged for audit
--
-- DEPENDS ON: MIG_170 (organizations), MIG_171 (canonical), MIG_172 (ffsc), MIG_175 (visits)
--
-- MANUAL APPLY:
--   cd /Users/benmisdiaz/Projects/Atlas
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_180__unified_clinichq_rebuild.sql

\echo ''
\echo '╔═══════════════════════════════════════════════════════════════════╗'
\echo '║  MIG_180: Unified ClinicHQ Rebuild with Change Tracking           ║'
\echo '║  Clean separation: People, Organizations, Places                  ║'
\echo '╚═══════════════════════════════════════════════════════════════════╝'
\echo ''

-- ============================================================
-- PART 1: Change Tracking System
-- ============================================================

\echo 'Creating change tracking table...'

CREATE TABLE IF NOT EXISTS trapper.data_changes (
    change_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,  -- 'visit', 'person', 'cat', 'place'
    entity_key TEXT NOT NULL,   -- Unique key for the entity (microchip, person_id, etc.)
    field_name TEXT NOT NULL,   -- Which field changed
    old_value TEXT,
    new_value TEXT,
    change_source TEXT NOT NULL DEFAULT 'clinichq_ingest',
    ingest_run_id UUID,
    source_file TEXT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_changes_entity ON trapper.data_changes(entity_type, entity_key);
CREATE INDEX IF NOT EXISTS idx_data_changes_time ON trapper.data_changes(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_changes_run ON trapper.data_changes(ingest_run_id) WHERE ingest_run_id IS NOT NULL;

COMMENT ON TABLE trapper.data_changes IS
'Audit log for all data changes. Tracks when fields change between ingests.
Example: Marsha Ferina → Marcia Ferina correction is logged here.';

-- ============================================================
-- PART 2: Function to log a change
-- ============================================================

\echo 'Creating log_data_change function...'

CREATE OR REPLACE FUNCTION trapper.log_data_change(
    p_entity_type TEXT,
    p_entity_key TEXT,
    p_field_name TEXT,
    p_old_value TEXT,
    p_new_value TEXT,
    p_change_source TEXT DEFAULT 'clinichq_ingest',
    p_ingest_run_id UUID DEFAULT NULL,
    p_source_file TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_change_id UUID;
BEGIN
    -- Only log if values are actually different
    IF p_old_value IS DISTINCT FROM p_new_value THEN
        INSERT INTO trapper.data_changes (
            entity_type, entity_key, field_name,
            old_value, new_value, change_source,
            ingest_run_id, source_file
        ) VALUES (
            p_entity_type, p_entity_key, p_field_name,
            p_old_value, p_new_value, p_change_source,
            p_ingest_run_id, p_source_file
        )
        RETURNING change_id INTO v_change_id;

        RETURN v_change_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PART 3: Updated build_clinichq_visits with change tracking
-- ============================================================

\echo 'Creating build_clinichq_visits_v2 with change tracking...'

CREATE OR REPLACE FUNCTION trapper.build_clinichq_visits_v2(p_run_id UUID DEFAULT NULL)
RETURNS TABLE(visits_created INT, visits_updated INT, visits_skipped INT, changes_logged INT) AS $$
DECLARE
    v_created INT := 0;
    v_updated INT := 0;
    v_skipped INT := 0;
    v_changes INT := 0;
    v_rec RECORD;
    v_existing RECORD;
    v_microchip TEXT;
    v_visit_date DATE;
    v_appt_num TEXT;
    v_visit_key TEXT;
BEGIN
    FOR v_rec IN
        SELECT
            COALESCE(
                NULLIF(TRIM(appt.payload->>'Microchip Number'), ''),
                NULLIF(TRIM(cat.payload->>'Microchip Number'), ''),
                NULLIF(TRIM(owner.payload->>'Microchip Number'), '')
            ) AS microchip,
            COALESCE(
                appt.payload->>'Date',
                cat.payload->>'Date',
                owner.payload->>'Date'
            ) AS visit_date_str,
            COALESCE(
                appt.payload->>'Number',
                cat.payload->>'Number',
                owner.payload->>'Number'
            ) AS appointment_number,
            cat.payload->>'Animal Name' AS animal_name,
            cat.payload->>'Sex' AS sex,
            cat.payload->>'Breed' AS breed,
            cat.payload->>'Primary Color' AS primary_color,
            cat.payload->>'Secondary Color' AS secondary_color,
            cat.payload->>'Weight' AS weight,
            cat.payload->>'Age Years' AS age_years,
            cat.payload->>'Age Months' AS age_months,
            cat.payload->>'Spay Neuter Status' AS altered_status,
            owner.payload->>'Owner First Name' AS client_first_name,
            owner.payload->>'Owner Last Name' AS client_last_name,
            owner.payload->>'Owner Email' AS client_email,
            owner.payload->>'Owner Phone' AS client_phone,
            owner.payload->>'Owner Cell Phone' AS client_cell_phone,
            owner.payload->>'Owner Address' AS client_address,
            owner.payload->>'Ownership' AS ownership_type,
            owner.payload->>'ClientType' AS client_type,
            appt.payload->>'Vet Name' AS vet_name,
            appt.payload->>'Technician' AS technician,
            appt.payload->>'Temperature' AS temperature,
            appt.payload->>'Body Composition Score' AS body_score,
            appt.payload->>'Spay' AS is_spay,
            appt.payload->>'Neuter' AS is_neuter,
            appt.payload->>'No Surgery Reason' AS no_surgery_reason,
            appt.payload->>'Pregnant' AS is_pregnant,
            appt.payload->>'Lactating' AS is_lactating,
            appt.payload->>'In Heat' AS is_in_heat,
            appt.payload->>'FeLV/FIV (SNAP test, in-house)' AS felv_fiv_result,
            COALESCE(appt.source_file, cat.source_file, owner.source_file) AS source_file,
            GREATEST(appt.created_at, cat.created_at, owner.created_at) AS record_time
        FROM trapper.staged_records appt
        FULL OUTER JOIN trapper.staged_records cat
            ON cat.source_system = 'clinichq'
            AND cat.source_table = 'cat_info'
            AND cat.payload->>'Microchip Number' = appt.payload->>'Microchip Number'
            AND cat.payload->>'Number' = appt.payload->>'Number'
        FULL OUTER JOIN trapper.staged_records owner
            ON owner.source_system = 'clinichq'
            AND owner.source_table = 'owner_info'
            AND owner.payload->>'Microchip Number' = COALESCE(appt.payload->>'Microchip Number', cat.payload->>'Microchip Number')
            AND owner.payload->>'Number' = COALESCE(appt.payload->>'Number', cat.payload->>'Number')
        WHERE (appt.source_system = 'clinichq' AND appt.source_table = 'appointment_info')
           OR (cat.source_system = 'clinichq' AND cat.source_table = 'cat_info')
           OR (owner.source_system = 'clinichq' AND owner.source_table = 'owner_info')
    LOOP
        v_microchip := TRIM(v_rec.microchip);
        v_appt_num := TRIM(COALESCE(v_rec.appointment_number, ''));

        -- Skip if no microchip or invalid
        IF v_microchip IS NULL OR LENGTH(v_microchip) < 9 THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        -- Parse date
        BEGIN
            v_visit_date := TO_DATE(v_rec.visit_date_str, 'MM/DD/YYYY');
        EXCEPTION WHEN OTHERS THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
        END;

        IF v_visit_date IS NULL OR v_appt_num = '' THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        v_visit_key := v_microchip || '|' || v_visit_date::TEXT || '|' || v_appt_num;

        -- Check if visit already exists
        SELECT * INTO v_existing
        FROM trapper.clinichq_visits
        WHERE microchip = v_microchip
          AND visit_date = v_visit_date
          AND appointment_number = v_appt_num;

        IF v_existing IS NOT NULL THEN
            -- Log changes for fields that differ
            IF v_existing.client_first_name IS DISTINCT FROM v_rec.client_first_name THEN
                PERFORM trapper.log_data_change('visit', v_visit_key, 'client_first_name',
                    v_existing.client_first_name, v_rec.client_first_name, 'clinichq_ingest', p_run_id, v_rec.source_file);
                v_changes := v_changes + 1;
            END IF;

            IF v_existing.client_last_name IS DISTINCT FROM v_rec.client_last_name THEN
                PERFORM trapper.log_data_change('visit', v_visit_key, 'client_last_name',
                    v_existing.client_last_name, v_rec.client_last_name, 'clinichq_ingest', p_run_id, v_rec.source_file);
                v_changes := v_changes + 1;
            END IF;

            IF v_existing.client_cell_phone IS DISTINCT FROM v_rec.client_cell_phone THEN
                PERFORM trapper.log_data_change('visit', v_visit_key, 'client_cell_phone',
                    v_existing.client_cell_phone, v_rec.client_cell_phone, 'clinichq_ingest', p_run_id, v_rec.source_file);
                v_changes := v_changes + 1;
            END IF;

            IF v_existing.client_email IS DISTINCT FROM NULLIF(LOWER(TRIM(v_rec.client_email)), '') THEN
                PERFORM trapper.log_data_change('visit', v_visit_key, 'client_email',
                    v_existing.client_email, NULLIF(LOWER(TRIM(v_rec.client_email)), ''), 'clinichq_ingest', p_run_id, v_rec.source_file);
                v_changes := v_changes + 1;
            END IF;

            IF v_existing.client_address IS DISTINCT FROM v_rec.client_address THEN
                PERFORM trapper.log_data_change('visit', v_visit_key, 'client_address',
                    v_existing.client_address, v_rec.client_address, 'clinichq_ingest', p_run_id, v_rec.source_file);
                v_changes := v_changes + 1;
            END IF;

            IF v_existing.animal_name IS DISTINCT FROM v_rec.animal_name THEN
                PERFORM trapper.log_data_change('visit', v_visit_key, 'animal_name',
                    v_existing.animal_name, v_rec.animal_name, 'clinichq_ingest', p_run_id, v_rec.source_file);
                v_changes := v_changes + 1;
            END IF;

            -- Update the record with new values (latest wins)
            UPDATE trapper.clinichq_visits SET
                animal_name = COALESCE(v_rec.animal_name, animal_name),
                client_first_name = COALESCE(v_rec.client_first_name, client_first_name),
                client_last_name = COALESCE(v_rec.client_last_name, client_last_name),
                client_email = COALESCE(NULLIF(LOWER(TRIM(v_rec.client_email)), ''), client_email),
                client_cell_phone = COALESCE(v_rec.client_cell_phone, client_cell_phone),
                client_phone = COALESCE(v_rec.client_phone, client_phone),
                client_address = COALESCE(v_rec.client_address, client_address),
                source_file = v_rec.source_file,
                ingest_run_id = COALESCE(p_run_id, ingest_run_id)
            WHERE microchip = v_microchip
              AND visit_date = v_visit_date
              AND appointment_number = v_appt_num;

            v_updated := v_updated + 1;
        ELSE
            -- Insert new visit
            INSERT INTO trapper.clinichq_visits (
                microchip, visit_date, appointment_number,
                animal_name, sex, breed, primary_color, secondary_color,
                weight_lbs, age_years, age_months, altered_status,
                client_first_name, client_last_name, client_email,
                client_phone, client_cell_phone, client_address,
                ownership_type, client_type,
                vet_name, technician, temperature, body_composition_score,
                is_spay, is_neuter, no_surgery_reason,
                is_pregnant, is_lactating, is_in_heat,
                felv_fiv_result, source_file, ingest_run_id
            ) VALUES (
                v_microchip, v_visit_date, v_appt_num,
                v_rec.animal_name, v_rec.sex, v_rec.breed,
                v_rec.primary_color, v_rec.secondary_color,
                NULLIF(v_rec.weight, '')::NUMERIC,
                NULLIF(v_rec.age_years, '')::INT,
                NULLIF(v_rec.age_months, '')::INT,
                v_rec.altered_status,
                v_rec.client_first_name, v_rec.client_last_name,
                NULLIF(LOWER(TRIM(v_rec.client_email)), ''),
                NULLIF(TRIM(v_rec.client_phone), ''),
                NULLIF(TRIM(v_rec.client_cell_phone), ''),
                v_rec.client_address,
                v_rec.ownership_type, v_rec.client_type,
                v_rec.vet_name, v_rec.technician,
                trapper.safe_temp(v_rec.temperature),
                v_rec.body_score,
                COALESCE(v_rec.is_spay, '') IN ('Yes', 'TRUE', '1', 'true'),
                COALESCE(v_rec.is_neuter, '') IN ('Yes', 'TRUE', '1', 'true'),
                NULLIF(v_rec.no_surgery_reason, ''),
                COALESCE(v_rec.is_pregnant, '') IN ('Yes', 'TRUE', '1', 'true'),
                COALESCE(v_rec.is_lactating, '') IN ('Yes', 'TRUE', '1', 'true'),
                COALESCE(v_rec.is_in_heat, '') IN ('Yes', 'TRUE', '1', 'true'),
                CASE
                    WHEN v_rec.felv_fiv_result ILIKE '%negative%' THEN 'negative'
                    WHEN v_rec.felv_fiv_result ILIKE '%positive%' THEN 'positive'
                    ELSE NULL
                END,
                v_rec.source_file,
                p_run_id
            );

            v_created := v_created + 1;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_created, v_updated, v_skipped, v_changes;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.build_clinichq_visits_v2 IS
'Builds clinichq_visits from staged_records with CHANGE TRACKING.
When a record is updated (e.g., Marsha → Marcia), the change is logged to data_changes.';

-- ============================================================
-- PART 4: Cat-Organization relationship table
-- ============================================================

\echo 'Creating cat-organization relationship table...'

CREATE TABLE IF NOT EXISTS trapper.cat_organization_relationships (
    relationship_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES trapper.organizations(org_id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL DEFAULT 'program_cat',
    original_account_name TEXT,  -- Store "FF Foster" for traceability
    source_system TEXT DEFAULT 'clinichq',
    source_table TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(cat_id, org_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_cat_org_rel_cat ON trapper.cat_organization_relationships(cat_id);
CREATE INDEX IF NOT EXISTS idx_cat_org_rel_org ON trapper.cat_organization_relationships(org_id);

COMMENT ON TABLE trapper.cat_organization_relationships IS
'Links cats to FFSC departments when the "owner" is an internal account like "FF Foster".
Preserves the original account name for traceability.';

-- ============================================================
-- PART 5: find_or_create_cat_by_microchip (unchanged)
-- ============================================================

\echo 'Creating find_or_create_cat_by_microchip function...'

CREATE OR REPLACE FUNCTION trapper.find_or_create_cat_by_microchip(
    p_microchip TEXT,
    p_name TEXT DEFAULT NULL,
    p_sex TEXT DEFAULT NULL,
    p_breed TEXT DEFAULT NULL,
    p_altered_status TEXT DEFAULT NULL,
    p_primary_color TEXT DEFAULT NULL,
    p_secondary_color TEXT DEFAULT NULL,
    p_ownership_type TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'clinichq'
)
RETURNS UUID AS $$
DECLARE
    v_cat_id UUID;
    v_microchip TEXT;
BEGIN
    v_microchip := TRIM(p_microchip);

    IF v_microchip IS NULL OR LENGTH(v_microchip) < 9 THEN
        RETURN NULL;
    END IF;

    -- Find existing cat by microchip
    SELECT ci.cat_id INTO v_cat_id
    FROM trapper.cat_identifiers ci
    WHERE ci.id_type = 'microchip' AND ci.id_value = v_microchip;

    IF v_cat_id IS NOT NULL THEN
        -- Update with new info (COALESCE preserves existing)
        UPDATE trapper.sot_cats SET
            display_name = COALESCE(display_name, p_name, 'Unknown'),
            sex = COALESCE(sex, p_sex),
            breed = COALESCE(breed, p_breed),
            altered_status = COALESCE(altered_status, p_altered_status),
            primary_color = COALESCE(primary_color, p_primary_color),
            secondary_color = COALESCE(secondary_color, p_secondary_color),
            ownership_type = COALESCE(ownership_type, p_ownership_type),
            data_source = 'clinichq',
            updated_at = NOW()
        WHERE cat_id = v_cat_id;

        RETURN v_cat_id;
    END IF;

    -- Create new cat
    INSERT INTO trapper.sot_cats (
        display_name, sex, breed, altered_status,
        primary_color, secondary_color, ownership_type,
        data_source, needs_microchip
    ) VALUES (
        COALESCE(p_name, 'Unknown (Clinic ' || v_microchip || ')'),
        p_sex, p_breed, p_altered_status,
        p_primary_color, p_secondary_color, p_ownership_type,
        'clinichq', FALSE
    )
    RETURNING cat_id INTO v_cat_id;

    -- Create microchip identifier
    INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
    VALUES (v_cat_id, 'microchip', v_microchip, p_source_system, 'unified_rebuild');

    RETURN v_cat_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PART 6: find_or_create_person (ONLY for real people)
-- ============================================================

\echo 'Creating find_or_create_person function...'

CREATE OR REPLACE FUNCTION trapper.find_or_create_person(
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'clinichq'
)
RETURNS UUID AS $$
DECLARE
    v_person_id UUID;
    v_email_norm TEXT;
    v_phone_norm TEXT;
    v_display_name TEXT;
BEGIN
    v_email_norm := LOWER(TRIM(NULLIF(p_email, '')));
    v_phone_norm := trapper.norm_phone_us(p_phone);
    v_display_name := TRIM(CONCAT_WS(' ', NULLIF(TRIM(p_first_name), ''), NULLIF(TRIM(p_last_name), '')));

    -- REJECT internal accounts - they should not become people
    IF trapper.is_internal_account(v_display_name) THEN
        RETURN NULL;
    END IF;
    IF v_email_norm IS NOT NULL AND v_email_norm LIKE '%@forgottenfelines.org' THEN
        RETURN NULL;
    END IF;

    -- Must have at least email OR phone
    IF v_email_norm IS NULL AND v_phone_norm IS NULL THEN
        RETURN NULL;
    END IF;

    -- Try to find by email first
    IF v_email_norm IS NOT NULL THEN
        SELECT pi.person_id INTO v_person_id
        FROM trapper.person_identifiers pi
        WHERE pi.id_type = 'email' AND pi.id_value_norm = v_email_norm;

        IF v_person_id IS NOT NULL THEN
            RETURN trapper.canonical_person_id(v_person_id);
        END IF;
    END IF;

    -- Try to find by phone
    IF v_phone_norm IS NOT NULL AND LENGTH(v_phone_norm) >= 10 THEN
        IF NOT EXISTS (SELECT 1 FROM trapper.identity_phone_blacklist WHERE phone_norm = v_phone_norm) THEN
            SELECT pi.person_id INTO v_person_id
            FROM trapper.person_identifiers pi
            WHERE pi.id_type = 'phone' AND pi.id_value_norm = v_phone_norm;

            IF v_person_id IS NOT NULL THEN
                v_person_id := trapper.canonical_person_id(v_person_id);

                -- Add email if we matched by phone
                IF v_email_norm IS NOT NULL THEN
                    INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system)
                    VALUES (v_person_id, 'email', p_email, v_email_norm, p_source_system)
                    ON CONFLICT DO NOTHING;
                END IF;

                RETURN v_person_id;
            END IF;
        END IF;
    END IF;

    -- Must have valid name to create new person
    IF NOT trapper.is_valid_person_name(v_display_name) THEN
        RETURN NULL;
    END IF;

    -- Create new person (real human)
    INSERT INTO trapper.sot_people (display_name, is_canonical)
    VALUES (v_display_name, TRUE)
    RETURNING person_id INTO v_person_id;

    -- Add identifiers
    IF v_email_norm IS NOT NULL THEN
        INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system, source_table)
        VALUES (v_person_id, 'email', p_email, v_email_norm, p_source_system, 'unified_rebuild');
    END IF;

    IF v_phone_norm IS NOT NULL AND LENGTH(v_phone_norm) >= 10 THEN
        IF NOT EXISTS (SELECT 1 FROM trapper.identity_phone_blacklist WHERE phone_norm = v_phone_norm) THEN
            INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system, source_table)
            VALUES (v_person_id, 'phone', p_phone, v_phone_norm, p_source_system, 'unified_rebuild');
        END IF;
    END IF;

    IF p_address IS NOT NULL AND TRIM(p_address) != '' THEN
        INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system, source_table)
        VALUES (v_person_id, 'address', p_address, LOWER(TRIM(p_address)), p_source_system, 'unified_rebuild')
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_or_create_person IS
'Creates/finds REAL PEOPLE only. Returns NULL for internal accounts.
Internal accounts should be linked via cat_organization_relationships instead.';

-- ============================================================
-- PART 7: link_cat_to_organization (for internal accounts)
-- ============================================================

\echo 'Creating link_cat_to_organization function...'

CREATE OR REPLACE FUNCTION trapper.link_cat_to_organization(
    p_cat_id UUID,
    p_account_name TEXT,
    p_source_system TEXT DEFAULT 'clinichq'
)
RETURNS UUID AS $$
DECLARE
    v_org_code TEXT;
    v_org_id UUID;
    v_rel_id UUID;
BEGIN
    IF p_cat_id IS NULL OR p_account_name IS NULL THEN
        RETURN NULL;
    END IF;

    -- Get the department code for this internal account
    v_org_code := trapper.get_internal_account_department(p_account_name);

    -- Get org_id
    SELECT org_id INTO v_org_id
    FROM trapper.organizations
    WHERE org_code = v_org_code;

    IF v_org_id IS NULL THEN
        -- Fallback to CLINIC department
        SELECT org_id INTO v_org_id
        FROM trapper.organizations
        WHERE org_code = 'CLINIC';
    END IF;

    IF v_org_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Create relationship
    INSERT INTO trapper.cat_organization_relationships (
        cat_id, org_id, relationship_type, original_account_name,
        source_system, source_table
    ) VALUES (
        p_cat_id, v_org_id, 'program_cat', p_account_name,
        p_source_system, 'unified_rebuild'
    )
    ON CONFLICT (cat_id, org_id, relationship_type) DO UPDATE SET
        original_account_name = EXCLUDED.original_account_name
    RETURNING relationship_id INTO v_rel_id;

    RETURN v_rel_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PART 8: process_clinichq_visit_v2 (with org linking)
-- ============================================================

\echo 'Creating process_clinichq_visit_v2 function...'

CREATE OR REPLACE FUNCTION trapper.process_clinichq_visit_v2(
    p_microchip TEXT,
    p_animal_name TEXT,
    p_sex TEXT,
    p_breed TEXT,
    p_altered_status TEXT,
    p_ownership_type TEXT,
    p_client_email TEXT,
    p_client_phone TEXT,
    p_client_cell_phone TEXT,
    p_client_first_name TEXT,
    p_client_last_name TEXT,
    p_client_address TEXT
)
RETURNS TABLE(cat_id UUID, person_id UUID, org_id UUID, place_id UUID) AS $$
DECLARE
    v_cat_id UUID;
    v_person_id UUID;
    v_org_id UUID;
    v_place_id UUID;
    v_phone TEXT;
    v_display_name TEXT;
    v_is_internal BOOLEAN;
BEGIN
    -- 1. Find or create cat by microchip
    v_cat_id := trapper.find_or_create_cat_by_microchip(
        p_microchip, p_animal_name, p_sex, p_breed,
        p_altered_status, NULL, NULL, p_ownership_type
    );

    IF v_cat_id IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID;
        RETURN;
    END IF;

    -- 2. Check if this is an internal account
    v_display_name := TRIM(CONCAT_WS(' ', NULLIF(TRIM(p_client_first_name), ''), NULLIF(TRIM(p_client_last_name), '')));
    v_is_internal := trapper.is_internal_account(v_display_name);

    IF v_is_internal THEN
        -- Link cat to organization instead of creating fake person
        SELECT trapper.link_cat_to_organization(v_cat_id, v_display_name, 'clinichq') INTO v_org_id;
    ELSE
        -- Try to create/find real person
        v_phone := COALESCE(NULLIF(TRIM(p_client_cell_phone), ''), p_client_phone);
        v_person_id := trapper.find_or_create_person(
            p_client_email, v_phone,
            p_client_first_name, p_client_last_name,
            p_client_address, 'clinichq'
        );

        -- Link person to cat if found
        IF v_person_id IS NOT NULL THEN
            INSERT INTO trapper.person_cat_relationships (
                person_id, cat_id, relationship_type, confidence,
                source_system, source_table
            ) VALUES (
                v_person_id, v_cat_id, 'owner', 'high',
                'clinichq', 'unified_rebuild'
            )
            ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table) DO NOTHING;
        END IF;
    END IF;

    -- 3. Create/find place (if address provided and not FFSC office)
    IF p_client_address IS NOT NULL AND TRIM(p_client_address) != '' THEN
        IF trapper.is_ffsc_office_address(p_client_address) THEN
            SELECT place_id INTO v_place_id
            FROM trapper.places WHERE display_name = 'FFSC Office - Unknown Origin';
        ELSE
            -- Queue for geocoding (simplified - just store normalized address)
            INSERT INTO trapper.places (display_name, formatted_address, place_kind, is_address_backed)
            VALUES (p_client_address, p_client_address, 'unknown', FALSE)
            ON CONFLICT DO NOTHING;

            SELECT place_id INTO v_place_id
            FROM trapper.places WHERE formatted_address = p_client_address LIMIT 1;
        END IF;

        -- Link person to place
        IF v_person_id IS NOT NULL AND v_place_id IS NOT NULL THEN
            INSERT INTO trapper.person_place_relationships (person_id, place_id, role, confidence, source_system, source_table)
            VALUES (v_person_id, v_place_id, 'owner', 0.9, 'clinichq', 'unified_rebuild')
            ON CONFLICT DO NOTHING;
        END IF;

        -- Link cat to place
        IF v_place_id IS NOT NULL THEN
            INSERT INTO trapper.cat_place_relationships (cat_id, place_id, relationship_type, confidence, source_system, source_table)
            VALUES (v_cat_id, v_place_id, 'booking_site', 'medium', 'clinichq', 'unified_rebuild')
            ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    RETURN QUERY SELECT v_cat_id, v_person_id, v_org_id, v_place_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PART 9: View recent changes
-- ============================================================

\echo 'Creating v_recent_data_changes view...'

CREATE OR REPLACE VIEW trapper.v_recent_data_changes AS
SELECT
    dc.change_id,
    dc.entity_type,
    dc.entity_key,
    dc.field_name,
    dc.old_value,
    dc.new_value,
    dc.change_source,
    dc.source_file,
    dc.changed_at,
    -- Human-readable description
    CASE
        WHEN dc.entity_type = 'visit' THEN
            'Visit ' || split_part(dc.entity_key, '|', 3) || ' on ' || split_part(dc.entity_key, '|', 2) ||
            ': ' || dc.field_name || ' changed from "' || COALESCE(dc.old_value, 'NULL') ||
            '" to "' || COALESCE(dc.new_value, 'NULL') || '"'
        ELSE
            dc.entity_type || ' ' || dc.entity_key || ': ' || dc.field_name || ' changed'
    END AS change_description
FROM trapper.data_changes dc
ORDER BY dc.changed_at DESC;

COMMENT ON VIEW trapper.v_recent_data_changes IS
'Shows recent data changes in human-readable format.
Use this to audit what changed between ingests (e.g., Marsha → Marcia).';

-- ============================================================
-- PART 10: Verification
-- ============================================================

\echo ''
\echo '═══════════════════════════════════════════════════════════════════'
\echo 'MIG_180 Complete - Change Tracking + Clean Architecture'
\echo '═══════════════════════════════════════════════════════════════════'
\echo ''
\echo 'NEW TABLES:'
\echo '  - data_changes (audit log for all field changes)'
\echo '  - cat_organization_relationships (cats linked to FFSC departments)'
\echo ''
\echo 'NEW FUNCTIONS:'
\echo '  - log_data_change() - Record a field change'
\echo '  - build_clinichq_visits_v2() - Rebuild visits WITH change tracking'
\echo '  - link_cat_to_organization() - Link internal account cats to departments'
\echo '  - process_clinichq_visit_v2() - Process visit with org linking'
\echo ''
\echo 'NEW VIEWS:'
\echo '  - v_recent_data_changes - Human-readable change log'
\echo ''
\echo 'ARCHITECTURE:'
\echo '  - sot_people = ONLY real humans'
\echo '  - organizations = FFSC + departments'
\echo '  - Internal accounts (FF Foster, etc.) → cat_organization_relationships'
\echo ''
\echo 'NEXT STEPS:'
\echo '  1. Run: SELECT * FROM trapper.build_clinichq_visits_v2();'
\echo '  2. Check: SELECT * FROM trapper.v_recent_data_changes LIMIT 20;'
\echo ''

SELECT 'MIG_180 Complete' AS status;
