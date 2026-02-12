-- MIG_1010: V2 Architecture - Dual-Write Trigger Fixes
-- Phase 1.5, Part 3: Fix column mappings and add missing triggers
--
-- Fixes:
-- 1. Cat trigger uses display_name but V2 expects name (G-5)
-- 2. Missing person_identifiers dual-write trigger (G-14)
-- 3. Missing cat_identifiers dual-write trigger (G-15)
-- 4. Missing place_contexts dual-write trigger (G-7)
-- 5. Intake trigger uses matched_person_id but V2 expects person_id

\echo ''
\echo '=============================================='
\echo '  MIG_1010: Dual-Write Trigger Fixes'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. FIX CAT DUAL-WRITE TRIGGER (display_name → name)
-- ============================================================================

\echo '1. Fixing cat dual-write trigger (display_name → name)...'

CREATE OR REPLACE FUNCTION atlas.dual_write_cats()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT atlas.is_dual_write_enabled() THEN
        RETURN NEW;
    END IF;

    INSERT INTO sot.cats (
        cat_id,
        name,  -- V2 uses 'name', not 'display_name'
        microchip,
        clinichq_animal_id,
        shelterluv_animal_id,
        sex,
        breed,
        primary_color,
        secondary_color,
        ear_tip,
        altered_status,
        is_altered,
        ownership_type,
        is_deceased,
        deceased_at,
        data_quality,
        data_source,
        merged_into_cat_id,
        source_system,
        source_record_id,
        created_at,
        updated_at,
        source_created_at,
        migrated_at,
        original_created_at
    ) VALUES (
        NEW.cat_id,
        NEW.display_name,  -- Map V1 display_name to V2 name
        NEW.microchip,
        NEW.clinichq_animal_id,
        NEW.shelterluv_animal_id,
        LOWER(NEW.sex::TEXT),  -- V2 expects lowercase
        NEW.breed,
        NEW.primary_color,
        NEW.secondary_color,
        NEW.ear_tip,
        NEW.altered_status,
        COALESCE(NEW.is_altered, FALSE),
        -- Map ownership_type: V2 includes barn/foster
        CASE NEW.ownership_type::TEXT
            WHEN 'Feral' THEN 'feral'
            WHEN 'Owned' THEN 'owned'
            WHEN 'Stray' THEN 'stray'
            WHEN 'Community' THEN 'community'
            ELSE COALESCE(LOWER(NEW.ownership_type::TEXT), 'unknown')
        END,
        COALESCE(NEW.is_deceased, FALSE),
        NEW.deceased_at,
        CASE COALESCE(NEW.data_quality, 'normal')
            WHEN 'low' THEN 'incomplete'
            ELSE COALESCE(NEW.data_quality, 'normal')
        END,
        NEW.data_source,
        NEW.merged_into_cat_id,
        NEW.source_system,
        NEW.source_record_id,
        NOW(),
        NOW(),
        NEW.source_created_at,
        NOW(),
        NEW.created_at
    )
    ON CONFLICT (cat_id) DO UPDATE SET
        name = EXCLUDED.name,
        microchip = EXCLUDED.microchip,
        clinichq_animal_id = EXCLUDED.clinichq_animal_id,
        shelterluv_animal_id = EXCLUDED.shelterluv_animal_id,
        sex = EXCLUDED.sex,
        breed = EXCLUDED.breed,
        primary_color = EXCLUDED.primary_color,
        secondary_color = EXCLUDED.secondary_color,
        ear_tip = EXCLUDED.ear_tip,
        altered_status = EXCLUDED.altered_status,
        is_altered = EXCLUDED.is_altered,
        ownership_type = EXCLUDED.ownership_type,
        is_deceased = EXCLUDED.is_deceased,
        deceased_at = EXCLUDED.deceased_at,
        data_quality = EXCLUDED.data_quality,
        merged_into_cat_id = EXCLUDED.merged_into_cat_id,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION atlas.dual_write_cats IS 'Fixed dual-write trigger: maps V1 display_name to V2 name, handles lowercase/enum mappings';

\echo '   Fixed: display_name → name mapping'

-- ============================================================================
-- 2. ADD PERSON IDENTIFIERS DUAL-WRITE TRIGGER (G-14)
-- ============================================================================

\echo ''
\echo '2. Creating person_identifiers dual-write trigger...'

CREATE OR REPLACE FUNCTION atlas.dual_write_person_identifiers()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT atlas.is_dual_write_enabled() THEN
        RETURN NEW;
    END IF;

    INSERT INTO sot.person_identifiers (
        id,
        person_id,
        id_type,
        id_value_raw,
        id_value_norm,
        confidence,
        source_system,
        source_table,
        source_row_id,
        created_at
    ) VALUES (
        NEW.id,
        NEW.person_id,
        -- Map V1 id_type to V2 (handle atlas_id → external_id)
        CASE NEW.id_type::TEXT
            WHEN 'atlas_id' THEN 'external_id'
            WHEN 'airtable_id' THEN 'external_id'
            WHEN 'clinichq_id' THEN 'external_id'
            WHEN 'shelterluv_id' THEN 'external_id'
            WHEN 'volunteerhub_id' THEN 'external_id'
            ELSE COALESCE(NEW.id_type::TEXT, 'external_id')
        END,
        NEW.id_value_raw,
        NEW.id_value_norm,
        COALESCE(NEW.confidence, 1.0),
        NEW.source_system,
        NEW.source_table,
        NEW.source_row_id,
        NOW()
    )
    ON CONFLICT (id_type, id_value_norm) DO UPDATE SET
        confidence = GREATEST(sot.person_identifiers.confidence, EXCLUDED.confidence);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dual_write_person_identifiers ON trapper.person_identifiers;

CREATE TRIGGER trg_dual_write_person_identifiers
    AFTER INSERT OR UPDATE ON trapper.person_identifiers
    FOR EACH ROW EXECUTE FUNCTION atlas.dual_write_person_identifiers();

COMMENT ON FUNCTION atlas.dual_write_person_identifiers IS 'Dual-write trigger: mirrors trapper.person_identifiers to sot.person_identifiers';

\echo '   Created person_identifiers dual-write trigger'

-- ============================================================================
-- 3. ADD CAT IDENTIFIERS DUAL-WRITE TRIGGER (G-15)
-- ============================================================================

\echo ''
\echo '3. Creating cat_identifiers dual-write trigger...'

CREATE OR REPLACE FUNCTION atlas.dual_write_cat_identifiers()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT atlas.is_dual_write_enabled() THEN
        RETURN NEW;
    END IF;

    INSERT INTO sot.cat_identifiers (
        id,
        cat_id,
        id_type,
        id_value_raw,
        id_value_norm,
        confidence,
        source_system,
        source_table,
        source_row_id,
        created_at
    ) VALUES (
        NEW.id,
        NEW.cat_id,
        -- Map V1 id_type to V2
        CASE NEW.id_type::TEXT
            WHEN 'airtable_id' THEN 'airtable_id'
            WHEN 'clinichq_animal_id' THEN 'clinichq_animal_id'
            WHEN 'shelterluv_animal_id' THEN 'shelterluv_animal_id'
            WHEN 'petlink_id' THEN 'petlink_id'
            WHEN 'microchip' THEN 'microchip'
            ELSE 'microchip'  -- Default to microchip for unknown types
        END,
        NEW.id_value_raw,
        NEW.id_value_norm,
        COALESCE(NEW.confidence, 1.0),
        NEW.source_system,
        NEW.source_table,
        NEW.source_row_id,
        NOW()
    )
    ON CONFLICT (cat_id, id_type, id_value_norm) DO UPDATE SET
        confidence = GREATEST(sot.cat_identifiers.confidence, EXCLUDED.confidence);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dual_write_cat_identifiers ON trapper.cat_identifiers;

CREATE TRIGGER trg_dual_write_cat_identifiers
    AFTER INSERT OR UPDATE ON trapper.cat_identifiers
    FOR EACH ROW EXECUTE FUNCTION atlas.dual_write_cat_identifiers();

COMMENT ON FUNCTION atlas.dual_write_cat_identifiers IS 'Dual-write trigger: mirrors trapper.cat_identifiers to sot.cat_identifiers';

\echo '   Created cat_identifiers dual-write trigger'

-- ============================================================================
-- 4. ADD PLACE CONTEXTS DUAL-WRITE TRIGGER (G-7)
-- ============================================================================

\echo ''
\echo '4. Creating place_contexts dual-write trigger...'

CREATE OR REPLACE FUNCTION atlas.dual_write_place_contexts()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT atlas.is_dual_write_enabled() THEN
        RETURN NEW;
    END IF;

    -- Only sync if context_type exists in V2
    IF NOT EXISTS (SELECT 1 FROM atlas.place_context_types WHERE context_type = NEW.context_type) THEN
        RAISE NOTICE 'Skipping dual-write: context_type % not in V2', NEW.context_type;
        RETURN NEW;
    END IF;

    -- Only sync if place exists in V2
    IF NOT EXISTS (SELECT 1 FROM sot.places WHERE place_id = NEW.place_id) THEN
        RAISE NOTICE 'Skipping dual-write: place_id % not in V2', NEW.place_id;
        RETURN NEW;
    END IF;

    INSERT INTO sot.place_contexts (
        id,
        place_id,
        context_type,
        valid_from,
        valid_to,
        confidence,
        is_verified,
        evidence_type,
        evidence_notes,
        organization_name,
        known_org_id,
        source_system,
        source_record_id,
        assigned_by,
        created_at,
        updated_at,
        v1_context_id
    ) VALUES (
        gen_random_uuid(),
        NEW.place_id,
        NEW.context_type,
        COALESCE(NEW.valid_from::TIMESTAMPTZ, NOW()),
        NEW.valid_to::TIMESTAMPTZ,
        COALESCE(NEW.confidence, 0.80),
        COALESCE(NEW.is_verified, FALSE),
        COALESCE(NEW.evidence_type, 'inferred'),
        NEW.evidence_notes,
        NEW.organization_name,
        NEW.known_org_id,
        COALESCE(NEW.source_system, 'v1_trigger'),
        NEW.source_record_id,
        COALESCE(NEW.assigned_by, 'system'),
        NOW(),
        NOW(),
        NEW.context_id  -- Store V1 context_id for audit
    )
    ON CONFLICT (place_id, context_type, valid_to) DO UPDATE SET
        confidence = GREATEST(sot.place_contexts.confidence, EXCLUDED.confidence),
        updated_at = NOW(),
        -- Don't overwrite verified with non-verified
        is_verified = sot.place_contexts.is_verified OR EXCLUDED.is_verified,
        evidence_type = COALESCE(sot.place_contexts.evidence_type, EXCLUDED.evidence_type);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dual_write_place_contexts ON trapper.place_contexts;

CREATE TRIGGER trg_dual_write_place_contexts
    AFTER INSERT OR UPDATE ON trapper.place_contexts
    FOR EACH ROW EXECUTE FUNCTION atlas.dual_write_place_contexts();

COMMENT ON FUNCTION atlas.dual_write_place_contexts IS 'Dual-write trigger: mirrors trapper.place_contexts to sot.place_contexts';

\echo '   Created place_contexts dual-write trigger'

-- ============================================================================
-- 5. FIX INTAKE SUBMISSIONS TRIGGER (matched_person_id → person_id)
-- ============================================================================

\echo ''
\echo '5. Fixing intake_submissions dual-write trigger...'

CREATE OR REPLACE FUNCTION atlas.dual_write_intake_submissions()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT atlas.is_dual_write_enabled() THEN
        RETURN NEW;
    END IF;

    INSERT INTO ops.intake_submissions (
        submission_id,
        submitted_at,
        ip_address,
        user_agent,
        first_name,
        last_name,
        email,
        phone,
        requester_address,
        requester_city,
        requester_zip,
        cats_address,
        cats_city,
        cats_zip,
        county,
        ownership_status,
        cat_count_estimate,
        cat_count_text,
        fixed_status,
        has_kittens,
        kitten_count,
        kitten_age_estimate,
        awareness_duration,
        has_medical_concerns,
        medical_description,
        is_emergency,
        cats_being_fed,
        feeder_info,
        has_property_access,
        access_notes,
        is_property_owner,
        situation_description,
        referral_source,
        media_urls,
        triage_category,
        triage_score,
        triage_reasons,
        triage_computed_at,
        reviewed_by,
        reviewed_at,
        review_notes,
        final_category,
        person_id,   -- V2 uses person_id
        place_id,    -- V2 uses place_id
        request_id,  -- V2 uses request_id
        status,
        created_at,
        migrated_at,
        original_created_at
    ) VALUES (
        NEW.submission_id,
        NEW.submitted_at,
        NEW.ip_address,
        NEW.user_agent,
        NEW.first_name,
        NEW.last_name,
        NEW.email,
        NEW.phone,
        NEW.requester_address,
        NEW.requester_city,
        NEW.requester_zip,
        NEW.cats_address,
        NEW.cats_city,
        NEW.cats_zip,
        NEW.county,
        NEW.ownership_status,
        NEW.cat_count_estimate,
        NEW.cat_count_text,
        NEW.fixed_status,
        NEW.has_kittens,
        NEW.kitten_count,
        NEW.kitten_age_estimate,
        NEW.awareness_duration,
        NEW.has_medical_concerns,
        NEW.medical_description,
        NEW.is_emergency,
        NEW.cats_being_fed,
        NEW.feeder_info,
        NEW.has_property_access,
        NEW.access_notes,
        NEW.is_property_owner,
        NEW.situation_description,
        NEW.referral_source,
        NEW.media_urls,
        NEW.triage_category::TEXT,
        NEW.triage_score,
        NEW.triage_reasons,
        NEW.triage_computed_at,
        NEW.reviewed_by,
        NEW.reviewed_at,
        NEW.review_notes,
        NEW.final_category::TEXT,
        NEW.matched_person_id,   -- V1 column maps to V2 person_id
        NEW.matched_place_id,    -- V1 column maps to V2 place_id
        NEW.created_request_id,  -- V1 column maps to V2 request_id
        CASE NEW.status::TEXT
            WHEN 'archived' THEN 'closed'
            ELSE COALESCE(NEW.status::TEXT, 'pending')
        END,
        NOW(),
        NOW(),
        NEW.submitted_at
    )
    ON CONFLICT (submission_id) DO UPDATE SET
        triage_category = EXCLUDED.triage_category,
        triage_score = EXCLUDED.triage_score,
        triage_reasons = EXCLUDED.triage_reasons,
        triage_computed_at = EXCLUDED.triage_computed_at,
        reviewed_by = EXCLUDED.reviewed_by,
        reviewed_at = EXCLUDED.reviewed_at,
        review_notes = EXCLUDED.review_notes,
        final_category = EXCLUDED.final_category,
        person_id = EXCLUDED.person_id,
        place_id = EXCLUDED.place_id,
        request_id = EXCLUDED.request_id,
        status = EXCLUDED.status;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION atlas.dual_write_intake_submissions IS 'Fixed dual-write trigger: maps V1 matched_* columns to V2 column names';

\echo '   Fixed intake_submissions trigger'

-- ============================================================================
-- 6. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Dual-write triggers installed:'
SELECT
    tgname AS trigger_name,
    relname AS table_name,
    tgenabled AS enabled
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
WHERE tgname LIKE 'trg_dual_write_%'
ORDER BY relname;

\echo ''
\echo 'Dual-write functions updated:'
SELECT
    proname AS function_name,
    pg_get_function_result(oid) AS returns
FROM pg_proc
WHERE proname LIKE 'dual_write_%'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'atlas')
ORDER BY proname;

\echo ''
\echo '=============================================='
\echo '  MIG_1010 Complete'
\echo '=============================================='
\echo 'Fixed:'
\echo '  - Cat trigger: display_name → name mapping'
\echo '  - Cat trigger: ownership_type case handling'
\echo '  - Cat trigger: sex lowercase mapping'
\echo '  - Cat trigger: data_quality mapping'
\echo '  - Intake trigger: matched_* → V2 column names'
\echo ''
\echo 'Added:'
\echo '  - person_identifiers dual-write trigger'
\echo '  - cat_identifiers dual-write trigger'
\echo '  - place_contexts dual-write trigger'
\echo ''
\echo 'REMINDER: Dual-write is still DISABLED'
\echo 'Enable with: UPDATE atlas.config SET value = ''true'' WHERE key = ''dual_write_enabled'';'
\echo ''
