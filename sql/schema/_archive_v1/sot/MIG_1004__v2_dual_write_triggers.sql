-- MIG_1004: V2 Architecture - Dual-Write Triggers
-- Phase 1, Part 5: Keep V1 and V2 in sync during migration
--
-- Creates triggers that mirror writes from V1 (trapper.*) to V2 (sot.*, ops.*)
-- This ensures current workflows continue working while we migrate.
--
-- CONTROL: Set atlas.dual_write_enabled to FALSE to disable mirroring
--
-- TIMESTAMP PRESERVATION:
-- - V2 created_at = NOW() (migration timestamp)
-- - V2 original_created_at = V1 created_at (preserved original)
-- - V2 source_created_at = V1 source_created_at (if exists)
-- - V2 migrated_at = NOW() (when mirrored)

-- ============================================================================
-- CONFIGURATION
-- ============================================================================

-- Create extension for config if not exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Configuration table for dual-write control
CREATE TABLE IF NOT EXISTS atlas.config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default: dual-write enabled
INSERT INTO atlas.config (key, value) VALUES ('dual_write_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- Helper function to check if dual-write is enabled
CREATE OR REPLACE FUNCTION atlas.is_dual_write_enabled()
RETURNS BOOLEAN AS $$
DECLARE
    v_enabled TEXT;
BEGIN
    SELECT value INTO v_enabled FROM atlas.config WHERE key = 'dual_write_enabled';
    RETURN COALESCE(v_enabled, 'true') = 'true';
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION atlas.is_dual_write_enabled IS 'Check if dual-write mirroring is enabled';

-- ============================================================================
-- PEOPLE DUAL-WRITE TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION atlas.dual_write_people()
RETURNS TRIGGER AS $$
BEGIN
    -- Skip if dual-write is disabled
    IF NOT atlas.is_dual_write_enabled() THEN
        RETURN NEW;
    END IF;

    -- Insert or update in V2
    INSERT INTO sot.people (
        person_id,
        display_name,
        first_name,
        last_name,
        primary_email,
        primary_phone,
        entity_type,
        is_organization,
        is_system_account,
        is_verified,
        data_quality,
        data_source,
        merged_into_person_id,
        source_system,
        source_record_id,
        created_at,
        updated_at,
        source_created_at,
        migrated_at,
        original_created_at
    ) VALUES (
        NEW.person_id,
        NEW.display_name,
        NEW.first_name,
        NEW.last_name,
        NEW.primary_email,
        NEW.primary_phone,
        COALESCE(NEW.entity_type, 'person'),
        COALESCE(NEW.is_organization, FALSE),
        COALESCE(NEW.is_system_account, FALSE),
        COALESCE(NEW.is_verified, FALSE),
        COALESCE(NEW.data_quality, 'normal'),
        NEW.data_source,
        NEW.merged_into_person_id,
        NEW.source_system,
        NEW.source_record_id,
        NOW(),
        NOW(),
        NEW.source_created_at,
        NOW(),
        NEW.created_at  -- Preserve V1 created_at
    )
    ON CONFLICT (person_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        primary_email = EXCLUDED.primary_email,
        primary_phone = EXCLUDED.primary_phone,
        entity_type = EXCLUDED.entity_type,
        is_organization = EXCLUDED.is_organization,
        is_system_account = EXCLUDED.is_system_account,
        is_verified = EXCLUDED.is_verified,
        data_quality = EXCLUDED.data_quality,
        merged_into_person_id = EXCLUDED.merged_into_person_id,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trg_dual_write_people ON trapper.sot_people;

-- Create trigger
CREATE TRIGGER trg_dual_write_people
    AFTER INSERT OR UPDATE ON trapper.sot_people
    FOR EACH ROW EXECUTE FUNCTION atlas.dual_write_people();

COMMENT ON FUNCTION atlas.dual_write_people IS 'Dual-write trigger: mirrors trapper.sot_people to sot.people';

-- ============================================================================
-- CATS DUAL-WRITE TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION atlas.dual_write_cats()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT atlas.is_dual_write_enabled() THEN
        RETURN NEW;
    END IF;

    INSERT INTO sot.cats (
        cat_id,
        name,
        microchip,
        clinichq_animal_id,
        shelterluv_animal_id,
        sex,
        breed,
        primary_color,
        secondary_color,
        ear_tip,
        altered_status,
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
        NEW.display_name,
        NEW.microchip,
        NEW.clinichq_animal_id,
        NEW.shelterluv_animal_id,
        NEW.sex,
        NEW.breed,
        NEW.primary_color,
        NEW.secondary_color,
        NEW.ear_tip,
        NEW.altered_status,
        NEW.ownership_type,
        COALESCE(NEW.is_deceased, FALSE),
        NEW.deceased_at,
        COALESCE(NEW.data_quality, 'normal'),
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
        ownership_type = EXCLUDED.ownership_type,
        is_deceased = EXCLUDED.is_deceased,
        deceased_at = EXCLUDED.deceased_at,
        data_quality = EXCLUDED.data_quality,
        merged_into_cat_id = EXCLUDED.merged_into_cat_id,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dual_write_cats ON trapper.sot_cats;

CREATE TRIGGER trg_dual_write_cats
    AFTER INSERT OR UPDATE ON trapper.sot_cats
    FOR EACH ROW EXECUTE FUNCTION atlas.dual_write_cats();

COMMENT ON FUNCTION atlas.dual_write_cats IS 'Dual-write trigger: mirrors trapper.sot_cats to sot.cats';

-- ============================================================================
-- PLACES DUAL-WRITE TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION atlas.dual_write_places()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT atlas.is_dual_write_enabled() THEN
        RETURN NEW;
    END IF;

    INSERT INTO sot.places (
        place_id,
        display_name,
        formatted_address,
        sot_address_id,
        is_address_backed,
        location,
        service_zone,
        place_kind,
        place_origin,
        parent_place_id,
        unit_identifier,
        disease_risk,
        disease_risk_notes,
        watch_list,
        watch_list_reason,
        has_cat_activity,
        data_source,
        location_type,
        quality_tier,
        merged_into_place_id,
        last_activity_at,
        created_at,
        updated_at,
        migrated_at,
        original_created_at
    ) VALUES (
        NEW.place_id,
        NEW.display_name,
        NEW.formatted_address,
        NEW.sot_address_id,
        COALESCE(NEW.is_address_backed, FALSE),
        NEW.location,
        NEW.service_zone,
        COALESCE(NEW.place_kind, 'unknown'),
        NEW.place_origin,
        NEW.parent_place_id,
        NEW.unit_identifier,
        COALESCE(NEW.disease_risk, FALSE),
        NEW.disease_risk_notes,
        COALESCE(NEW.watch_list, FALSE),
        NEW.watch_list_reason,
        COALESCE(NEW.has_cat_activity, FALSE),
        NEW.data_source,
        NEW.location_type,
        NEW.quality_tier,
        NEW.merged_into_place_id,
        NEW.last_activity_at,
        NOW(),
        NOW(),
        NOW(),
        NEW.created_at
    )
    ON CONFLICT (place_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        formatted_address = EXCLUDED.formatted_address,
        sot_address_id = EXCLUDED.sot_address_id,
        is_address_backed = EXCLUDED.is_address_backed,
        location = EXCLUDED.location,
        service_zone = EXCLUDED.service_zone,
        place_kind = EXCLUDED.place_kind,
        parent_place_id = EXCLUDED.parent_place_id,
        unit_identifier = EXCLUDED.unit_identifier,
        disease_risk = EXCLUDED.disease_risk,
        disease_risk_notes = EXCLUDED.disease_risk_notes,
        watch_list = EXCLUDED.watch_list,
        watch_list_reason = EXCLUDED.watch_list_reason,
        has_cat_activity = EXCLUDED.has_cat_activity,
        merged_into_place_id = EXCLUDED.merged_into_place_id,
        last_activity_at = EXCLUDED.last_activity_at,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dual_write_places ON trapper.places;

CREATE TRIGGER trg_dual_write_places
    AFTER INSERT OR UPDATE ON trapper.places
    FOR EACH ROW EXECUTE FUNCTION atlas.dual_write_places();

COMMENT ON FUNCTION atlas.dual_write_places IS 'Dual-write trigger: mirrors trapper.places to sot.places';

-- ============================================================================
-- REQUESTS DUAL-WRITE TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION atlas.dual_write_requests()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT atlas.is_dual_write_enabled() THEN
        RETURN NEW;
    END IF;

    INSERT INTO ops.requests (
        request_id,
        status,
        priority,
        hold_reason,
        summary,
        notes,
        estimated_cat_count,
        total_cats_reported,
        cat_count_semantic,
        place_id,
        requester_person_id,
        assignment_status,
        no_trapper_reason,
        resolved_at,
        last_activity_at,
        source_system,
        source_record_id,
        created_at,
        updated_at,
        source_created_at,
        migrated_at,
        original_created_at
    ) VALUES (
        NEW.request_id,
        NEW.status::TEXT,
        COALESCE(NEW.priority::TEXT, 'normal'),
        NEW.hold_reason::TEXT,
        NEW.summary,
        NEW.notes,
        NEW.estimated_cat_count,
        NEW.total_cats_reported,
        COALESCE(NEW.cat_count_semantic, 'needs_tnr'),
        NEW.place_id,
        NEW.requester_person_id,
        COALESCE(NEW.assignment_status, 'pending'),
        NEW.no_trapper_reason,
        NEW.resolved_at,
        NEW.last_activity_at,
        NEW.source_system,
        NEW.source_record_id,
        NOW(),
        NOW(),
        NEW.source_created_at,
        NOW(),
        NEW.created_at
    )
    ON CONFLICT (request_id) DO UPDATE SET
        status = EXCLUDED.status,
        priority = EXCLUDED.priority,
        hold_reason = EXCLUDED.hold_reason,
        summary = EXCLUDED.summary,
        notes = EXCLUDED.notes,
        estimated_cat_count = EXCLUDED.estimated_cat_count,
        total_cats_reported = EXCLUDED.total_cats_reported,
        cat_count_semantic = EXCLUDED.cat_count_semantic,
        place_id = EXCLUDED.place_id,
        requester_person_id = EXCLUDED.requester_person_id,
        assignment_status = EXCLUDED.assignment_status,
        no_trapper_reason = EXCLUDED.no_trapper_reason,
        resolved_at = EXCLUDED.resolved_at,
        last_activity_at = EXCLUDED.last_activity_at,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dual_write_requests ON trapper.sot_requests;

CREATE TRIGGER trg_dual_write_requests
    AFTER INSERT OR UPDATE ON trapper.sot_requests
    FOR EACH ROW EXECUTE FUNCTION atlas.dual_write_requests();

COMMENT ON FUNCTION atlas.dual_write_requests IS 'Dual-write trigger: mirrors trapper.sot_requests to ops.requests';

-- ============================================================================
-- INTAKE SUBMISSIONS DUAL-WRITE TRIGGER
-- ============================================================================

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
        person_id,
        place_id,
        request_id,
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
        NEW.matched_person_id,
        NEW.matched_place_id,
        NEW.created_request_id,
        NEW.status,
        NOW(),
        NOW(),
        NEW.submitted_at  -- Use submitted_at as original created_at for intakes
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

DROP TRIGGER IF EXISTS trg_dual_write_intake ON trapper.web_intake_submissions;

CREATE TRIGGER trg_dual_write_intake
    AFTER INSERT OR UPDATE ON trapper.web_intake_submissions
    FOR EACH ROW EXECUTE FUNCTION atlas.dual_write_intake_submissions();

COMMENT ON FUNCTION atlas.dual_write_intake_submissions IS 'Dual-write trigger: mirrors trapper.web_intake_submissions to ops.intake_submissions';

-- ============================================================================
-- APPOINTMENTS DUAL-WRITE TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION atlas.dual_write_appointments()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT atlas.is_dual_write_enabled() THEN
        RETURN NEW;
    END IF;

    INSERT INTO ops.appointments (
        appointment_id,
        cat_id,
        person_id,
        place_id,
        inferred_place_id,
        appointment_date,
        appointment_number,
        service_type,
        is_spay,
        is_neuter,
        is_alteration,
        vet_name,
        technician,
        temperature,
        medical_notes,
        is_lactating,
        is_pregnant,
        is_in_heat,
        owner_email,
        owner_phone,
        owner_first_name,
        owner_last_name,
        owner_address,
        source_system,
        source_record_id,
        source_row_hash,
        created_at,
        updated_at,
        migrated_at,
        original_created_at
    ) VALUES (
        NEW.appointment_id,
        NEW.cat_id,
        NEW.person_id,
        NEW.place_id,
        NEW.inferred_place_id,
        NEW.appointment_date,
        NEW.appointment_number,
        NEW.service_type,
        COALESCE(NEW.is_spay, FALSE),
        COALESCE(NEW.is_neuter, FALSE),
        COALESCE(NEW.is_spay, FALSE) OR COALESCE(NEW.is_neuter, FALSE),
        NEW.vet_name,
        NEW.technician,
        NEW.temperature,
        NEW.medical_notes,
        NEW.is_lactating,
        NEW.is_pregnant,
        NEW.is_in_heat,
        NEW.owner_email,
        NEW.owner_phone,
        NEW.owner_first_name,
        NEW.owner_last_name,
        NEW.owner_address,
        COALESCE(NEW.source_system, 'clinichq'),
        NEW.source_record_id,
        NEW.source_row_hash,
        NOW(),
        NOW(),
        NOW(),
        NEW.created_at
    )
    ON CONFLICT (appointment_id) DO UPDATE SET
        cat_id = EXCLUDED.cat_id,
        person_id = EXCLUDED.person_id,
        place_id = EXCLUDED.place_id,
        inferred_place_id = EXCLUDED.inferred_place_id,
        service_type = EXCLUDED.service_type,
        is_spay = EXCLUDED.is_spay,
        is_neuter = EXCLUDED.is_neuter,
        is_alteration = EXCLUDED.is_alteration,
        vet_name = EXCLUDED.vet_name,
        technician = EXCLUDED.technician,
        temperature = EXCLUDED.temperature,
        medical_notes = EXCLUDED.medical_notes,
        is_lactating = EXCLUDED.is_lactating,
        is_pregnant = EXCLUDED.is_pregnant,
        is_in_heat = EXCLUDED.is_in_heat,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dual_write_appointments ON trapper.sot_appointments;

CREATE TRIGGER trg_dual_write_appointments
    AFTER INSERT OR UPDATE ON trapper.sot_appointments
    FOR EACH ROW EXECUTE FUNCTION atlas.dual_write_appointments();

COMMENT ON FUNCTION atlas.dual_write_appointments IS 'Dual-write trigger: mirrors trapper.sot_appointments to ops.appointments';

-- ============================================================================
-- RELATIONSHIP DUAL-WRITE TRIGGERS
-- ============================================================================

-- Person-Cat relationships
CREATE OR REPLACE FUNCTION atlas.dual_write_person_cat()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT atlas.is_dual_write_enabled() THEN
        RETURN NEW;
    END IF;

    INSERT INTO sot.person_cat (
        id,
        person_id,
        cat_id,
        relationship_type,
        evidence_type,
        confidence,
        source_system,
        source_table,
        created_at,
        migrated_at
    ) VALUES (
        NEW.id,
        NEW.person_id,
        NEW.cat_id,
        NEW.relationship_type,
        COALESCE(NEW.evidence_type, 'inferred'),
        COALESCE(NEW.confidence, 0.8),
        NEW.source_system,
        NEW.source_table,
        NOW(),
        NOW()
    )
    ON CONFLICT (person_id, cat_id, relationship_type) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dual_write_person_cat ON trapper.person_cat_relationships;

CREATE TRIGGER trg_dual_write_person_cat
    AFTER INSERT ON trapper.person_cat_relationships
    FOR EACH ROW EXECUTE FUNCTION atlas.dual_write_person_cat();

-- Cat-Place relationships
CREATE OR REPLACE FUNCTION atlas.dual_write_cat_place()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT atlas.is_dual_write_enabled() THEN
        RETURN NEW;
    END IF;

    INSERT INTO sot.cat_place (
        id,
        cat_id,
        place_id,
        relationship_type,
        evidence_type,
        confidence,
        source_system,
        source_table,
        created_at,
        migrated_at
    ) VALUES (
        NEW.id,
        NEW.cat_id,
        NEW.place_id,
        NEW.relationship_type,
        COALESCE(NEW.evidence_type, 'inferred'),
        COALESCE(NEW.confidence, 0.8),
        NEW.source_system,
        NEW.source_table,
        NOW(),
        NOW()
    )
    ON CONFLICT (cat_id, place_id, relationship_type) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dual_write_cat_place ON trapper.cat_place_relationships;

CREATE TRIGGER trg_dual_write_cat_place
    AFTER INSERT ON trapper.cat_place_relationships
    FOR EACH ROW EXECUTE FUNCTION atlas.dual_write_cat_place();

-- Person-Place relationships
CREATE OR REPLACE FUNCTION atlas.dual_write_person_place()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT atlas.is_dual_write_enabled() THEN
        RETURN NEW;
    END IF;

    INSERT INTO sot.person_place (
        id,
        person_id,
        place_id,
        relationship_type,
        evidence_type,
        confidence,
        is_primary,
        source_system,
        source_table,
        created_at,
        migrated_at
    ) VALUES (
        NEW.id,
        NEW.person_id,
        NEW.place_id,
        COALESCE(NEW.relationship_type, 'resident'),
        COALESCE(NEW.evidence_type, 'inferred'),
        COALESCE(NEW.confidence, 0.8),
        COALESCE(NEW.is_primary, FALSE),
        NEW.source_system,
        NEW.source_table,
        NOW(),
        NOW()
    )
    ON CONFLICT (person_id, place_id, relationship_type) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dual_write_person_place ON trapper.person_place_relationships;

CREATE TRIGGER trg_dual_write_person_place
    AFTER INSERT ON trapper.person_place_relationships
    FOR EACH ROW EXECUTE FUNCTION atlas.dual_write_person_place();

-- ============================================================================
-- HELPER FUNCTIONS FOR CONTROLLING DUAL-WRITE
-- ============================================================================

-- Enable dual-write
CREATE OR REPLACE FUNCTION atlas.enable_dual_write()
RETURNS VOID AS $$
BEGIN
    UPDATE atlas.config SET value = 'true', updated_at = NOW() WHERE key = 'dual_write_enabled';
    RAISE NOTICE 'Dual-write ENABLED: V1 writes will be mirrored to V2';
END;
$$ LANGUAGE plpgsql;

-- Disable dual-write
CREATE OR REPLACE FUNCTION atlas.disable_dual_write()
RETURNS VOID AS $$
BEGIN
    UPDATE atlas.config SET value = 'false', updated_at = NOW() WHERE key = 'dual_write_enabled';
    RAISE NOTICE 'Dual-write DISABLED: V1 writes will NOT be mirrored to V2';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION atlas.enable_dual_write IS 'Enable dual-write mirroring from V1 to V2';
COMMENT ON FUNCTION atlas.disable_dual_write IS 'Disable dual-write mirroring from V1 to V2';

-- ============================================================================
-- VERIFY
-- ============================================================================
DO $$
DECLARE
    v_triggers TEXT[] := ARRAY[
        'trg_dual_write_people',
        'trg_dual_write_cats',
        'trg_dual_write_places',
        'trg_dual_write_requests',
        'trg_dual_write_intake',
        'trg_dual_write_appointments',
        'trg_dual_write_person_cat',
        'trg_dual_write_cat_place',
        'trg_dual_write_person_place'
    ];
    v_trigger TEXT;
    v_missing TEXT[];
BEGIN
    FOREACH v_trigger IN ARRAY v_triggers LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.triggers
            WHERE trigger_name = v_trigger
        ) THEN
            v_missing := array_append(v_missing, v_trigger);
        END IF;
    END LOOP;

    IF array_length(v_missing, 1) > 0 THEN
        RAISE WARNING 'Some triggers may not be created (source tables may not exist yet): %', array_to_string(v_missing, ', ');
    ELSE
        RAISE NOTICE 'V2 dual-write triggers created successfully';
    END IF;

    RAISE NOTICE 'Dual-write is currently: %',
        CASE WHEN atlas.is_dual_write_enabled() THEN 'ENABLED' ELSE 'DISABLED' END;
END $$;
