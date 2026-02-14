-- MIG_247: Auto-Create Places for Requests
--
-- Problem: When requests are created with raw_address but no place_id,
-- no place gets created and the address isn't geocoded.
--
-- This is inconsistent with intake submissions where addresses get
-- geocoded via find_or_create_place_deduped.
--
-- Fix: Update promote_intake_request to auto-create places from raw_address
-- using find_or_create_place_deduped, which auto-queues for geocoding.

\echo ''
\echo '=============================================='
\echo 'MIG_247: Auto-Create Places for Requests'
\echo '=============================================='
\echo ''

-- Update promote_intake_request to create places from raw_address
CREATE OR REPLACE FUNCTION trapper.promote_intake_request(
    p_raw_id UUID,
    p_promoted_by TEXT DEFAULT 'system'
)
RETURNS UUID AS $$
DECLARE
    raw RECORD;
    validation_result JSONB;
    new_request_id UUID;
    resolved_place_id UUID;
    resolved_person_id UUID;
BEGIN
    SELECT * INTO raw FROM trapper.raw_intake_request WHERE raw_id = p_raw_id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- Skip if already processed
    IF raw.intake_status IN ('promoted', 'rejected', 'duplicate') THEN
        RETURN raw.promoted_request_id;
    END IF;

    -- Validate first
    validation_result := trapper.validate_intake_request(p_raw_id);

    IF NOT (validation_result->>'valid')::BOOLEAN THEN
        -- Mark as rejected with validation errors
        UPDATE trapper.raw_intake_request
        SET intake_status = 'rejected',
            validation_errors = validation_result->'errors',
            validated_at = NOW()
        WHERE raw_id = p_raw_id;
        RETURN NULL;
    END IF;

    -- Mark as validating
    UPDATE trapper.raw_intake_request SET intake_status = 'validating' WHERE raw_id = p_raw_id;

    -- Resolve place_id: Use provided place_id, OR create from raw_address
    resolved_place_id := raw.place_id;

    -- If no place_id but we have raw_address, create the place
    -- This uses find_or_create_place_deduped which auto-queues for geocoding
    IF resolved_place_id IS NULL AND raw.raw_address IS NOT NULL AND raw.raw_address != '' THEN
        resolved_place_id := trapper.find_or_create_place_deduped(
            raw.raw_address,     -- p_formatted_address
            NULL,                -- p_display_name (will use address)
            NULL,                -- p_lat (triggers geocoding queue)
            NULL,                -- p_lng
            'atlas_ui'           -- p_source_system
        );

        RAISE NOTICE 'Created place % from raw_address for request intake %', resolved_place_id, p_raw_id;
    END IF;

    -- Resolve person_id: Use provided person_id, OR create from raw contact info
    resolved_person_id := raw.requester_person_id;

    -- If no person_id but we have contact info, create/find the person
    IF resolved_person_id IS NULL AND (
        raw.raw_requester_email IS NOT NULL OR raw.raw_requester_phone IS NOT NULL
    ) THEN
        resolved_person_id := trapper.find_or_create_person(
            raw.raw_requester_email,
            raw.raw_requester_phone,
            raw.raw_requester_name,  -- Will be split into first/last if needed
            NULL,                    -- Last name separate field not in raw table
            NULL,                    -- Display name
            'atlas_ui'               -- Source system
        );

        -- Link person to place if both exist
        IF resolved_person_id IS NOT NULL AND resolved_place_id IS NOT NULL THEN
            INSERT INTO trapper.person_place_relationships (
                person_id, place_id, role, confidence, source_system
            ) VALUES (
                resolved_person_id, resolved_place_id, 'requester', 'high', 'atlas_ui'
            )
            ON CONFLICT (person_id, place_id, role) DO NOTHING;
        END IF;
    END IF;

    -- Create the SoT request
    INSERT INTO trapper.sot_requests (
        -- Location
        place_id,
        property_type,
        location_description,
        -- Contact
        requester_person_id,
        property_owner_contact,
        best_contact_times,
        property_owner_name,
        property_owner_phone,
        authorization_pending,
        -- Permission & Access
        permission_status,
        access_notes,
        traps_overnight_safe,
        access_without_contact,
        -- About the Cats
        estimated_cat_count,
        wellness_cat_count,
        count_confidence,
        colony_duration,
        eartip_count,
        eartip_estimate,
        cats_are_friendly,
        -- Kittens
        has_kittens,
        kitten_count,
        kitten_age_weeks,
        -- Feeding
        is_being_fed,
        feeder_name,
        feeding_schedule,
        best_times_seen,
        -- Urgency
        urgency_reasons,
        urgency_deadline,
        urgency_notes,
        priority,
        -- Content
        summary,
        notes,
        internal_notes,
        request_purpose,
        -- Metadata
        data_source,
        source_system,
        created_by
    ) VALUES (
        resolved_place_id,
        NULLIF(raw.raw_property_type, '')::trapper.property_type,
        raw.raw_location_description,
        resolved_person_id,
        raw.raw_property_owner_contact,
        raw.raw_best_contact_times,
        raw.raw_property_owner_name,
        raw.raw_property_owner_phone,
        COALESCE(raw.raw_authorization_pending, FALSE),
        COALESCE(NULLIF(raw.raw_permission_status, '')::trapper.permission_status, 'unknown'),
        raw.raw_access_notes,
        raw.raw_traps_overnight_safe,
        raw.raw_access_without_contact,
        raw.raw_estimated_cat_count,
        raw.raw_wellness_cat_count,
        COALESCE(NULLIF(raw.raw_count_confidence, '')::trapper.count_confidence, 'unknown'),
        COALESCE(NULLIF(raw.raw_colony_duration, '')::trapper.colony_duration, 'unknown'),
        raw.raw_eartip_count,
        COALESCE(NULLIF(raw.raw_eartip_estimate, '')::trapper.eartip_estimate, 'unknown'),
        raw.raw_cats_are_friendly,
        COALESCE(raw.raw_has_kittens, FALSE),
        raw.raw_kitten_count,
        raw.raw_kitten_age_weeks,
        raw.raw_is_being_fed,
        raw.raw_feeder_name,
        raw.raw_feeding_schedule,
        raw.raw_best_times_seen,
        raw.raw_urgency_reasons,
        raw.raw_urgency_deadline,
        raw.raw_urgency_notes,
        COALESCE(NULLIF(raw.raw_priority, '')::trapper.request_priority, 'normal'),
        raw.raw_summary,
        raw.raw_notes,
        raw.raw_internal_notes,
        COALESCE(NULLIF(raw.raw_request_purpose, '')::trapper.request_purpose, 'tnr'),
        'app',
        'atlas_ui',
        p_promoted_by
    )
    RETURNING request_id INTO new_request_id;

    -- Update the raw record with promotion status
    UPDATE trapper.raw_intake_request
    SET intake_status = 'promoted',
        promoted_request_id = new_request_id,
        promoted_at = NOW(),
        validated_at = NOW()
    WHERE raw_id = p_raw_id;

    -- Log audit event
    INSERT INTO trapper.intake_audit_log (raw_table, raw_id, sot_table, sot_id, action, changes, promoted_by, promotion_reason)
    VALUES ('raw_intake_request', p_raw_id, 'sot_requests', new_request_id, 'create',
           jsonb_build_object(
               'place_id', resolved_place_id,
               'person_id', resolved_person_id,
               'place_created_from_address', (raw.place_id IS NULL AND raw.raw_address IS NOT NULL),
               'person_created_from_contact', (raw.requester_person_id IS NULL AND resolved_person_id IS NOT NULL),
               'summary', raw.raw_summary,
               'priority', raw.raw_priority
           ),
           p_promoted_by, 'New request from intake');

    RETURN new_request_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.promote_intake_request IS
'Validates and promotes a raw intake request to sot_requests.
Auto-creates places from raw_address using find_or_create_place_deduped
(which auto-queues for geocoding). Auto-creates people from contact info.
Returns the new request_id or NULL if validation failed.';

-- ============================================
-- Also add a helper to link intake submissions to places
-- ============================================

\echo ''
\echo 'Updating intake submission place linking...'

-- Function to link intake submission to place (with geocoding)
CREATE OR REPLACE FUNCTION trapper.link_intake_submission_to_place(
    p_submission_id UUID
) RETURNS UUID AS $$
DECLARE
    submission RECORD;
    v_place_id UUID;
    v_full_address TEXT;
BEGIN
    SELECT * INTO submission
    FROM trapper.web_intake_submissions
    WHERE submission_id = p_submission_id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- If already has a place_id, just return it
    IF submission.place_id IS NOT NULL THEN
        RETURN submission.place_id;
    END IF;

    -- Build full address from parts
    v_full_address := submission.cats_address;
    IF submission.cats_city IS NOT NULL AND submission.cats_city != '' THEN
        v_full_address := v_full_address || ', ' || submission.cats_city;
    END IF;
    IF submission.cats_zip IS NOT NULL AND submission.cats_zip != '' THEN
        v_full_address := v_full_address || ' ' || submission.cats_zip;
    END IF;

    -- Find or create place (auto-queues for geocoding if no coords)
    v_place_id := trapper.find_or_create_place_deduped(
        v_full_address,
        NULL,
        submission.geo_latitude,
        submission.geo_longitude,
        'web_intake'
    );

    -- Update the submission with the place_id
    UPDATE trapper.web_intake_submissions
    SET place_id = v_place_id,
        matched_place_id = v_place_id,
        updated_at = NOW()
    WHERE submission_id = p_submission_id;

    RETURN v_place_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_intake_submission_to_place IS
'Links an intake submission to a place. Creates the place if needed
using find_or_create_place_deduped (which auto-queues geocoding).
Uses geo_latitude/longitude if available from previous geocoding.';

-- ============================================
-- Trigger to auto-link place on submission insert
-- ============================================

\echo ''
\echo 'Creating trigger for auto-linking intake submissions to places...'

CREATE OR REPLACE FUNCTION trapper.trigger_link_intake_to_place()
RETURNS TRIGGER AS $$
BEGIN
    -- Only process if cats_address is provided and place_id is not
    IF NEW.cats_address IS NOT NULL AND NEW.cats_address != '' AND NEW.place_id IS NULL THEN
        -- Call the linking function
        NEW.place_id := trapper.link_intake_submission_to_place(NEW.submission_id);
        NEW.matched_place_id := NEW.place_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop if exists and recreate
DROP TRIGGER IF EXISTS trg_intake_auto_link_place ON trapper.web_intake_submissions;

-- Note: We use AFTER INSERT instead of BEFORE INSERT because
-- we need the submission_id to exist for the function call
CREATE TRIGGER trg_intake_auto_link_place
    AFTER INSERT ON trapper.web_intake_submissions
    FOR EACH ROW
    WHEN (NEW.cats_address IS NOT NULL AND NEW.cats_address != '' AND NEW.place_id IS NULL)
    EXECUTE FUNCTION trapper.trigger_link_intake_to_place();

-- Actually, the trigger approach won't work well for updating the row.
-- Instead, let's call link_intake_submission_to_place from the API.
-- Dropping the trigger.
DROP TRIGGER IF EXISTS trg_intake_auto_link_place ON trapper.web_intake_submissions;

\echo ''
\echo 'Note: Call link_intake_submission_to_place() from API after insert'
\echo 'to create and geocode places for intake submissions.'

-- ============================================
-- VERIFICATION
-- ============================================

\echo ''
\echo '=== Verification ==='

-- Check places without geocoding
SELECT
    'Places needing geocoding' as metric,
    COUNT(*) as count
FROM trapper.places
WHERE location IS NULL
  AND geocode_failed = FALSE
  AND merged_into_place_id IS NULL;

-- Check intake submissions without places
SELECT
    'Intake submissions without places' as metric,
    COUNT(*) as count
FROM trapper.web_intake_submissions
WHERE place_id IS NULL
  AND cats_address IS NOT NULL
  AND cats_address != '';

\echo ''
\echo '=== MIG_247 Complete ==='
\echo ''
\echo 'Changes:'
\echo '  - promote_intake_request now creates places from raw_address'
\echo '  - Places created without coords are auto-queued for geocoding'
\echo '  - link_intake_submission_to_place function added'
\echo '  - Audit log tracks place/person creation'
\echo ''
\echo 'To process geocoding queue: GET /api/places/geocode-queue'
\echo ''
