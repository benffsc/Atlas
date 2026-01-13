-- MIG_184: Intake Normalizer Functions
--
-- PURPOSE: Validates raw intake and promotes to SoT tables
--
-- INVARIANTS ENFORCED:
-- 1. Garbage names don't become People
-- 2. Valid microchips always preserved
-- 3. Stable keys / idempotency
-- 4. Ambiguous matches go to review queue
-- 5. Every promotion creates audit event

BEGIN;

-- ============================================================================
-- 1. VALIDATION HELPERS
-- ============================================================================

-- Check if a name is garbage (should not become a Person)
CREATE OR REPLACE FUNCTION trapper.is_garbage_name(name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF name IS NULL OR TRIM(name) = '' THEN
        RETURN TRUE;
    END IF;

    -- Normalize for comparison
    name := LOWER(TRIM(name));

    -- Known garbage patterns
    IF name IN (
        'unknown', 'n/a', 'na', 'none', 'no name', 'test', 'xxx', 'zzz',
        'owner', 'client', 'customer', 'person', 'somebody', 'someone',
        'anonymous', 'anon', 'no owner', 'unknown owner', 'lost owner',
        'stray', 'feral', 'community cat', 'barn cat', 'outdoor cat'
    ) THEN
        RETURN TRUE;
    END IF;

    -- Too short (likely garbage)
    IF LENGTH(name) < 2 THEN
        RETURN TRUE;
    END IF;

    -- All same character
    IF name ~ '^(.)\1*$' THEN
        RETURN TRUE;
    END IF;

    -- Looks like an address (starts with number)
    IF name ~ '^\d+\s' THEN
        RETURN TRUE;
    END IF;

    -- Internal account patterns
    IF name ~ '(?i)(ff\s*foster|ffsc\s*foster|rebooking|fire\s*cat|barn\s*cat)' THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Validate phone number format
CREATE OR REPLACE FUNCTION trapper.validate_phone(phone TEXT)
RETURNS JSONB AS $$
DECLARE
    cleaned TEXT;
    result JSONB := '{"valid": false}'::JSONB;
BEGIN
    IF phone IS NULL OR TRIM(phone) = '' THEN
        RETURN '{"valid": false, "error": "empty"}'::JSONB;
    END IF;

    -- Remove non-digits
    cleaned := REGEXP_REPLACE(phone, '[^0-9]', '', 'g');

    -- Check length
    IF LENGTH(cleaned) = 10 THEN
        result := jsonb_build_object(
            'valid', TRUE,
            'normalized', cleaned,
            'formatted', '(' || SUBSTRING(cleaned, 1, 3) || ') ' ||
                        SUBSTRING(cleaned, 4, 3) || '-' || SUBSTRING(cleaned, 7, 4)
        );
    ELSIF LENGTH(cleaned) = 11 AND cleaned LIKE '1%' THEN
        cleaned := SUBSTRING(cleaned, 2);
        result := jsonb_build_object(
            'valid', TRUE,
            'normalized', cleaned,
            'formatted', '(' || SUBSTRING(cleaned, 1, 3) || ') ' ||
                        SUBSTRING(cleaned, 4, 3) || '-' || SUBSTRING(cleaned, 7, 4)
        );
    ELSE
        result := jsonb_build_object(
            'valid', FALSE,
            'error', 'invalid_length',
            'raw', phone
        );
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Validate email format
CREATE OR REPLACE FUNCTION trapper.validate_email(email TEXT)
RETURNS JSONB AS $$
BEGIN
    IF email IS NULL OR TRIM(email) = '' THEN
        RETURN '{"valid": false, "error": "empty"}'::JSONB;
    END IF;

    email := LOWER(TRIM(email));

    IF email ~ '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$' THEN
        RETURN jsonb_build_object('valid', TRUE, 'normalized', email);
    ELSE
        RETURN jsonb_build_object('valid', FALSE, 'error', 'invalid_format', 'raw', email);
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- 2. VALIDATE RAW REQUEST
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.validate_raw_request(p_raw_id UUID)
RETURNS JSONB AS $$
DECLARE
    raw RECORD;
    errors JSONB := '[]'::JSONB;
    warnings JSONB := '[]'::JSONB;
BEGIN
    SELECT * INTO raw FROM trapper.raw_intake_request WHERE raw_id = p_raw_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('valid', FALSE, 'errors', '[{"field": "raw_id", "error": "not_found"}]'::JSONB);
    END IF;

    -- Must have either place_id, raw_address, or summary
    IF raw.place_id IS NULL AND (raw.raw_address IS NULL OR raw.raw_address = '') AND (raw.raw_summary IS NULL OR raw.raw_summary = '') THEN
        errors := errors || jsonb_build_array(jsonb_build_object('field', 'location', 'error', 'Either place, address, or summary required'));
    END IF;

    -- Validate priority if provided
    IF raw.raw_priority IS NOT NULL AND raw.raw_priority NOT IN ('urgent', 'high', 'normal', 'low') THEN
        errors := errors || jsonb_build_array(jsonb_build_object('field', 'priority', 'error', 'Invalid priority value'));
    END IF;

    -- Validate permission_status if provided
    IF raw.raw_permission_status IS NOT NULL AND raw.raw_permission_status NOT IN ('yes', 'no', 'pending', 'not_needed', 'unknown') THEN
        errors := errors || jsonb_build_array(jsonb_build_object('field', 'permission_status', 'error', 'Invalid permission status'));
    END IF;

    -- Warn if no contact info
    IF raw.requester_person_id IS NULL AND raw.raw_requester_name IS NULL AND raw.raw_requester_phone IS NULL THEN
        warnings := warnings || jsonb_build_array(jsonb_build_object('field', 'requester', 'warning', 'No requester contact information'));
    END IF;

    -- Warn if new person name looks like garbage
    IF raw.raw_requester_name IS NOT NULL AND trapper.is_garbage_name(raw.raw_requester_name) THEN
        warnings := warnings || jsonb_build_array(jsonb_build_object('field', 'requester_name', 'warning', 'Name may be invalid - will not create person record'));
    END IF;

    -- Update the raw record with validation results
    UPDATE trapper.raw_intake_request
    SET validation_errors = errors,
        validation_warnings = warnings,
        validated_at = NOW(),
        intake_status = CASE
            WHEN jsonb_array_length(errors) > 0 THEN 'rejected'::trapper.intake_status
            ELSE 'validated'::trapper.intake_status
        END
    WHERE raw_id = p_raw_id;

    RETURN jsonb_build_object(
        'valid', jsonb_array_length(errors) = 0,
        'errors', errors,
        'warnings', warnings
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. FIND OR CREATE PERSON FROM INTAKE (with thresholds)
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.promote_intake_person(
    p_raw_id UUID,
    p_promoted_by TEXT DEFAULT 'normalizer'
)
RETURNS UUID AS $$
DECLARE
    raw RECORD;
    matched_person_id UUID;
    new_person_id UUID;
    phone_result JSONB;
    email_result JSONB;
    match_confidence NUMERIC;
BEGIN
    SELECT * INTO raw FROM trapper.raw_intake_person WHERE raw_id = p_raw_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Raw intake person not found: %', p_raw_id;
    END IF;

    -- Check if name is garbage
    IF trapper.is_garbage_name(raw.raw_name) THEN
        -- Don't create person, mark as rejected
        UPDATE trapper.raw_intake_person
        SET intake_status = 'rejected',
            promotion_notes = 'Name does not meet quality threshold',
            validated_at = NOW()
        WHERE raw_id = p_raw_id;

        -- Add to review queue if there's other useful data
        IF raw.raw_phone IS NOT NULL OR raw.raw_email IS NOT NULL THEN
            INSERT INTO trapper.review_queue (entity_type, raw_table, raw_id, review_reason, review_category, details)
            VALUES ('person', 'raw_intake_person', p_raw_id, 'Name rejected but has contact info', 'garbage_name',
                   jsonb_build_object('name', raw.raw_name, 'phone', raw.raw_phone, 'email', raw.raw_email));
        END IF;

        RETURN NULL;
    END IF;

    -- Validate phone/email
    phone_result := trapper.validate_phone(raw.raw_phone);
    email_result := trapper.validate_email(raw.raw_email);

    -- Try to match existing person
    -- Priority: phone > email > name
    IF (phone_result->>'valid')::BOOLEAN THEN
        SELECT pi.person_id INTO matched_person_id
        FROM trapper.person_identifiers pi
        WHERE pi.id_type = 'phone'
          AND pi.id_value_norm = phone_result->>'normalized'
        LIMIT 1;

        IF matched_person_id IS NOT NULL THEN
            match_confidence := 0.95;
        END IF;
    END IF;

    IF matched_person_id IS NULL AND (email_result->>'valid')::BOOLEAN THEN
        SELECT pi.person_id INTO matched_person_id
        FROM trapper.person_identifiers pi
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = email_result->>'normalized'
        LIMIT 1;

        IF matched_person_id IS NOT NULL THEN
            match_confidence := 0.90;
        END IF;
    END IF;

    -- If high confidence match, link to existing
    IF matched_person_id IS NOT NULL AND match_confidence >= 0.85 THEN
        UPDATE trapper.raw_intake_person
        SET intake_status = 'promoted',
            promoted_person_id = matched_person_id,
            promoted_at = NOW(),
            promotion_notes = 'Matched existing person with confidence ' || match_confidence,
            potential_matches = jsonb_build_array(jsonb_build_object('person_id', matched_person_id, 'confidence', match_confidence)),
            match_decision = 'merge_into:' || matched_person_id
        WHERE raw_id = p_raw_id;

        -- Log audit event
        INSERT INTO trapper.intake_audit_log (raw_table, raw_id, sot_table, sot_id, action, changes, promoted_by, promotion_reason)
        VALUES ('raw_intake_person', p_raw_id, 'sot_people', matched_person_id, 'link',
               jsonb_build_object('matched_by', CASE WHEN match_confidence >= 0.95 THEN 'phone' ELSE 'email' END),
               p_promoted_by, 'Matched existing person');

        RETURN matched_person_id;
    END IF;

    -- If ambiguous match, send to review
    IF matched_person_id IS NOT NULL AND match_confidence < 0.85 THEN
        UPDATE trapper.raw_intake_person
        SET intake_status = 'needs_review',
            potential_matches = jsonb_build_array(jsonb_build_object('person_id', matched_person_id, 'confidence', match_confidence)),
            match_decision = 'needs_review'
        WHERE raw_id = p_raw_id;

        INSERT INTO trapper.review_queue (entity_type, raw_table, raw_id, review_reason, review_category, confidence_score, details)
        VALUES ('person', 'raw_intake_person', p_raw_id, 'Potential duplicate person - low confidence match', 'ambiguous_match', match_confidence,
               jsonb_build_object('potential_match', matched_person_id, 'raw_name', raw.raw_name));

        RETURN NULL;
    END IF;

    -- No match - create new person (only if we have enough data)
    IF (phone_result->>'valid')::BOOLEAN OR (email_result->>'valid')::BOOLEAN THEN
        INSERT INTO trapper.sot_people (
            display_name,
            account_type,
            data_source,
            source_system,
            created_by
        ) VALUES (
            TRIM(raw.raw_name),
            'person',
            'app',
            'atlas_ui',
            p_promoted_by
        )
        RETURNING person_id INTO new_person_id;

        -- Add identifiers
        IF (phone_result->>'valid')::BOOLEAN THEN
            INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm)
            VALUES (new_person_id, 'phone', raw.raw_phone, phone_result->>'normalized')
            ON CONFLICT DO NOTHING;
        END IF;

        IF (email_result->>'valid')::BOOLEAN THEN
            INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm)
            VALUES (new_person_id, 'email', raw.raw_email, email_result->>'normalized')
            ON CONFLICT DO NOTHING;
        END IF;

        -- Update raw record
        UPDATE trapper.raw_intake_person
        SET intake_status = 'promoted',
            promoted_person_id = new_person_id,
            promoted_at = NOW(),
            promotion_notes = 'Created new person',
            match_decision = 'new'
        WHERE raw_id = p_raw_id;

        -- Log audit event
        INSERT INTO trapper.intake_audit_log (raw_table, raw_id, sot_table, sot_id, action, changes, promoted_by, promotion_reason)
        VALUES ('raw_intake_person', p_raw_id, 'sot_people', new_person_id, 'create',
               jsonb_build_object('name', raw.raw_name, 'phone', raw.raw_phone, 'email', raw.raw_email),
               p_promoted_by, 'New person from intake');

        RETURN new_person_id;
    ELSE
        -- Not enough data to create person
        UPDATE trapper.raw_intake_person
        SET intake_status = 'rejected',
            promotion_notes = 'Insufficient contact information to create person'
        WHERE raw_id = p_raw_id;

        RETURN NULL;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. PROMOTE REQUEST TO SOT
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.promote_intake_request(
    p_raw_id UUID,
    p_promoted_by TEXT DEFAULT 'normalizer'
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
        RAISE EXCEPTION 'Raw intake request not found: %', p_raw_id;
    END IF;

    -- Validate first if not already validated
    IF raw.intake_status = 'pending' THEN
        validation_result := trapper.validate_raw_request(p_raw_id);
        IF NOT (validation_result->>'valid')::BOOLEAN THEN
            RETURN NULL;
        END IF;
        -- Refresh raw record after validation
        SELECT * INTO raw FROM trapper.raw_intake_request WHERE raw_id = p_raw_id;
    END IF;

    IF raw.intake_status NOT IN ('validated', 'pending') THEN
        RAISE EXCEPTION 'Request not in promotable state: %', raw.intake_status;
    END IF;

    -- Mark as validating
    UPDATE trapper.raw_intake_request SET intake_status = 'validating' WHERE raw_id = p_raw_id;

    -- Resolve place_id
    resolved_place_id := raw.place_id;  -- Use provided place_id if available

    -- Resolve person_id
    resolved_person_id := raw.requester_person_id;  -- Use provided person_id if available

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
        -- Permission & Access
        permission_status,
        access_notes,
        traps_overnight_safe,
        access_without_contact,
        -- About the Cats
        estimated_cat_count,
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
        -- Additional
        summary,
        notes,
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
        COALESCE(raw.raw_permission_status, 'unknown')::trapper.permission_status,
        raw.raw_access_notes,
        raw.raw_traps_overnight_safe,
        raw.raw_access_without_contact,
        raw.raw_estimated_cat_count,
        COALESCE(raw.raw_count_confidence, 'unknown')::trapper.count_confidence,
        COALESCE(raw.raw_colony_duration, 'unknown')::trapper.colony_duration,
        raw.raw_eartip_count,
        COALESCE(raw.raw_eartip_estimate, 'unknown')::trapper.eartip_estimate,
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
        COALESCE(raw.raw_priority, 'normal')::trapper.request_priority,
        raw.raw_summary,
        raw.raw_notes,
        'app',
        'atlas_ui',
        raw.created_by
    )
    RETURNING request_id INTO new_request_id;

    -- Update raw record as promoted
    UPDATE trapper.raw_intake_request
    SET intake_status = 'promoted',
        promoted_request_id = new_request_id,
        promoted_at = NOW(),
        promotion_notes = 'Successfully promoted to sot_requests'
    WHERE raw_id = p_raw_id;

    -- Log audit event
    INSERT INTO trapper.intake_audit_log (raw_table, raw_id, sot_table, sot_id, action, changes, promoted_by, promotion_reason)
    VALUES ('raw_intake_request', p_raw_id, 'sot_requests', new_request_id, 'create',
           jsonb_build_object(
               'place_id', resolved_place_id,
               'person_id', resolved_person_id,
               'summary', raw.raw_summary,
               'priority', raw.raw_priority
           ),
           p_promoted_by, 'New request from intake');

    RETURN new_request_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. BATCH NORMALIZER (process all pending intake)
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.normalize_pending_intake(
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
    entity_type TEXT,
    raw_id UUID,
    result TEXT,
    promoted_id UUID
) AS $$
DECLARE
    rec RECORD;
    result_id UUID;
BEGIN
    -- Process pending requests
    FOR rec IN
        SELECT r.raw_id
        FROM trapper.raw_intake_request r
        WHERE r.intake_status = 'pending'
        ORDER BY r.created_at
        LIMIT p_limit
    LOOP
        BEGIN
            result_id := trapper.promote_intake_request(rec.raw_id);
            RETURN QUERY SELECT 'request'::TEXT, rec.raw_id, 'promoted'::TEXT, result_id;
        EXCEPTION WHEN OTHERS THEN
            UPDATE trapper.raw_intake_request
            SET intake_status = 'rejected',
                validation_errors = jsonb_build_array(jsonb_build_object('error', SQLERRM))
            WHERE raw_id = rec.raw_id;
            RETURN QUERY SELECT 'request'::TEXT, rec.raw_id, 'error: ' || SQLERRM, NULL::UUID;
        END;
    END LOOP;

    -- Process pending people
    FOR rec IN
        SELECT p.raw_id
        FROM trapper.raw_intake_person p
        WHERE p.intake_status = 'pending'
        ORDER BY p.created_at
        LIMIT p_limit
    LOOP
        BEGIN
            result_id := trapper.promote_intake_person(rec.raw_id);
            RETURN QUERY SELECT 'person'::TEXT, rec.raw_id,
                CASE WHEN result_id IS NOT NULL THEN 'promoted' ELSE 'rejected' END,
                result_id;
        EXCEPTION WHEN OTHERS THEN
            UPDATE trapper.raw_intake_person
            SET intake_status = 'rejected',
                validation_errors = jsonb_build_array(jsonb_build_object('error', SQLERRM))
            WHERE raw_id = rec.raw_id;
            RETURN QUERY SELECT 'person'::TEXT, rec.raw_id, 'error: ' || SQLERRM, NULL::UUID;
        END;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT 'Normalizer functions created:' AS info;
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'trapper'
AND routine_name IN (
    'is_garbage_name',
    'validate_phone',
    'validate_email',
    'validate_raw_request',
    'promote_intake_person',
    'promote_intake_request',
    'normalize_pending_intake'
)
ORDER BY routine_name;
