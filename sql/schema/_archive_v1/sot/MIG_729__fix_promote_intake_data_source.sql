\echo '=== MIG_729: Fix promote_intake_request data_source type cast ==='

-- The promote_intake_request function needs to cast source_system TEXT to data_source enum

CREATE OR REPLACE FUNCTION trapper.promote_intake_request(
    p_raw_id UUID,
    p_promoted_by TEXT DEFAULT 'system'
)
RETURNS UUID AS $$
DECLARE
    raw RECORD;
    new_request_id UUID;
    resolved_person_id UUID;
    resolved_place_id UUID;
    v_source_record_id TEXT;
    v_data_source trapper.data_source;
BEGIN
    SELECT * INTO raw FROM trapper.raw_intake_request WHERE raw_id = p_raw_id;

    IF NOT FOUND THEN
        RAISE NOTICE 'Raw intake request not found: %', p_raw_id;
        RETURN NULL;
    END IF;

    IF raw.intake_status = 'promoted' THEN
        RAISE NOTICE 'Request already promoted: %', raw.promoted_request_id;
        RETURN raw.promoted_request_id;
    END IF;

    -- Resolve person_id
    IF raw.requester_person_id IS NOT NULL THEN
        resolved_person_id := raw.requester_person_id;
    ELSIF raw.raw_requester_email IS NOT NULL OR raw.raw_requester_phone IS NOT NULL THEN
        resolved_person_id := trapper.find_or_create_person(
            p_email := raw.raw_requester_email,
            p_phone := raw.raw_requester_phone,
            p_first_name := split_part(COALESCE(raw.raw_requester_name, ''), ' ', 1),
            p_last_name := nullif(trim(substring(COALESCE(raw.raw_requester_name, '') from position(' ' in COALESCE(raw.raw_requester_name, '')))), ''),
            p_address := raw.raw_address,
            p_source_system := raw.source_system
        );
    END IF;

    -- Resolve place_id
    IF raw.place_id IS NOT NULL THEN
        resolved_place_id := raw.place_id;
    ELSIF raw.raw_address IS NOT NULL THEN
        resolved_place_id := trapper.find_or_create_place_deduped(
            p_formatted_address := raw.raw_address,
            p_source_system := raw.source_system
        );
    END IF;

    -- Determine source_record_id
    v_source_record_id := CASE
        WHEN raw.source_submission_id IS NOT NULL THEN raw.source_submission_id::TEXT
        ELSE p_raw_id::TEXT
    END;

    -- Convert source_system to data_source enum
    -- Default to 'app' if the source_system isn't a valid enum value
    BEGIN
        v_data_source := raw.source_system::trapper.data_source;
    EXCEPTION WHEN invalid_text_representation THEN
        v_data_source := 'app'::trapper.data_source;
    END;

    INSERT INTO trapper.sot_requests (
        place_id,
        property_type,
        location_description,
        requester_person_id,
        property_owner_contact,
        best_contact_times,
        property_owner_name,
        property_owner_phone,
        authorization_pending,
        permission_status,
        access_notes,
        traps_overnight_safe,
        access_without_contact,
        estimated_cat_count,
        total_cats_reported,
        cat_count_semantic,
        wellness_cat_count,
        count_confidence,
        colony_duration,
        eartip_count,
        eartip_estimate,
        cats_are_friendly,
        has_kittens,
        kitten_count,
        kitten_age_weeks,
        is_being_fed,
        feeder_name,
        feeding_schedule,
        best_times_seen,
        urgency_reasons,
        urgency_deadline,
        urgency_notes,
        priority,
        summary,
        notes,
        internal_notes,
        request_purpose,
        data_source,
        source_system,
        source_record_id,
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
        raw.raw_total_cats_reported,
        'needs_tnr',
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
        v_data_source,  -- Use properly cast enum
        raw.source_system,
        v_source_record_id,
        p_promoted_by
    )
    RETURNING request_id INTO new_request_id;

    -- Update raw record as promoted
    UPDATE trapper.raw_intake_request
    SET intake_status = 'promoted',
        promoted_request_id = new_request_id,
        promoted_at = NOW(),
        promoted_by = p_promoted_by
    WHERE raw_id = p_raw_id;

    -- Log to audit
    INSERT INTO trapper.intake_audit_log (
        raw_table, raw_id, sot_table, sot_id,
        action, promoted_by, promotion_reason
    ) VALUES (
        'raw_intake_request', p_raw_id, 'sot_requests', new_request_id,
        'create', p_promoted_by, 'standard_promotion'
    );

    RETURN new_request_id;
END;
$$ LANGUAGE plpgsql;

\echo 'Fixed promote_intake_request function with proper data_source enum cast'
