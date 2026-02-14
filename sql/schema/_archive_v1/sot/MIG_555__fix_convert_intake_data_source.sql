\echo ''
\echo '=============================================='
\echo 'MIG_555: Fix Intake-to-Request Conversion'
\echo '=============================================='
\echo ''
\echo 'Fixes issues from MIG_536 which failed partway through:'
\echo '  1. Adds missing raw_total_cats_reported column'
\echo '  2. Removes invalid data_source column reference'
\echo ''

-- ============================================================================
-- PART 1: Add missing column that MIG_536 tried to add
-- ============================================================================

\echo 'Adding raw_total_cats_reported column (if missing)...'

ALTER TABLE trapper.raw_intake_request
ADD COLUMN IF NOT EXISTS raw_total_cats_reported INTEGER;

COMMENT ON COLUMN trapper.raw_intake_request.raw_total_cats_reported IS
'Total cats reported at location (for colony estimation).
Distinct from raw_estimated_cat_count which is cats still needing TNR.';

-- ============================================================================
-- PART 2: Fix convert_intake_to_request function
-- ============================================================================

\echo 'Fixing convert_intake_to_request function...'

CREATE OR REPLACE FUNCTION trapper.convert_intake_to_request(
  p_submission_id UUID,
  p_converted_by TEXT DEFAULT 'system'
) RETURNS UUID AS $$
DECLARE
  v_sub RECORD;
  v_raw_id UUID;
  v_request_id UUID;
  v_person_id UUID;
  v_place_id UUID;
  v_purpose trapper.request_purpose;
  v_tnr_count INTEGER;
  v_total_count INTEGER;
BEGIN
  SELECT * INTO v_sub FROM trapper.web_intake_submissions WHERE submission_id = p_submission_id;

  IF v_sub IS NULL THEN
    RAISE EXCEPTION 'Submission not found: %', p_submission_id;
  END IF;

  -- Use matched IDs if available
  v_person_id := v_sub.matched_person_id;
  v_place_id := v_sub.matched_place_id;

  -- Determine request purpose from triage
  CASE COALESCE(v_sub.final_category, v_sub.triage_category)
    WHEN 'wellness_only' THEN v_purpose := 'wellness';
    WHEN 'high_priority_tnr' THEN v_purpose := 'tnr';
    WHEN 'standard_tnr' THEN v_purpose := 'tnr';
    ELSE v_purpose := 'tnr';
  END CASE;

  -- Handle cat count semantic (MIG_534):
  -- cats_needing_tnr = cats still needing spay/neuter (TNR target)
  -- cat_count_estimate = total cats at location (colony estimate)
  v_tnr_count := COALESCE(v_sub.cats_needing_tnr, v_sub.cat_count_estimate);
  v_total_count := v_sub.cat_count_estimate;

  -- Step 1: Create raw intake request (staging)
  INSERT INTO trapper.raw_intake_request (
    source_system,
    created_by,
    raw_request_purpose,
    raw_summary,
    raw_notes,
    place_id,
    raw_address,
    raw_location_description,
    requester_person_id,
    raw_requester_name,
    raw_requester_phone,
    raw_requester_email,
    raw_estimated_cat_count,
    raw_total_cats_reported,
    raw_has_kittens,
    raw_kitten_count,
    raw_eartip_estimate,
    raw_priority,
    raw_urgency_notes
  ) VALUES (
    'web_intake',
    p_converted_by,
    v_purpose::TEXT,
    'Web intake: ' || COALESCE(v_sub.cats_city, 'Unknown location') ||
      CASE WHEN v_tnr_count IS NOT NULL
           THEN ' (' || v_tnr_count || ' cats needing TNR)'
           ELSE '' END,
    v_sub.situation_description,
    v_place_id,
    v_sub.cats_address,
    'Submitted via web form',
    v_person_id,
    v_sub.first_name || ' ' || v_sub.last_name,
    v_sub.phone,
    v_sub.email,
    v_tnr_count,
    v_total_count,
    v_sub.has_kittens,
    v_sub.kitten_count,
    CASE v_sub.fixed_status
      WHEN 'none_fixed' THEN 'none'
      WHEN 'some_fixed' THEN 'few'
      WHEN 'most_fixed' THEN 'most'
      WHEN 'all_fixed' THEN 'all'
      ELSE 'unknown'
    END,
    CASE
      WHEN v_sub.is_emergency THEN 'urgent'
      WHEN COALESCE(v_sub.final_category, v_sub.triage_category) = 'high_priority_tnr' THEN 'high'
      ELSE 'normal'
    END,
    CASE WHEN v_sub.has_medical_concerns THEN v_sub.medical_description ELSE NULL END
  )
  RETURNING raw_id INTO v_raw_id;

  -- Step 2: Immediately promote to sot_requests
  -- This returns the actual sot_requests.request_id that the FK expects
  v_request_id := trapper.promote_intake_request(v_raw_id, p_converted_by);

  -- Step 3: Update submission with the PROMOTED request_id (not raw_id)
  UPDATE trapper.web_intake_submissions
  SET status = 'request_created',
      created_request_id = v_request_id,  -- This is now sot_requests.request_id
      updated_at = NOW()
  WHERE submission_id = p_submission_id;

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.convert_intake_to_request IS
'Converts a web intake submission to a full sot_request.
1. Creates raw_intake_request (staging)
2. Immediately promotes to sot_requests
3. Updates submission with the sot_requests.request_id
Returns sot_requests.request_id (not raw_id).';

-- ============================================================================
-- PART 3: Fix promote_intake_request to handle missing columns gracefully
-- ============================================================================

\echo 'Updating promote_intake_request function...'

CREATE OR REPLACE FUNCTION trapper.promote_intake_request(
    p_raw_id UUID,
    p_promoted_by TEXT DEFAULT 'system'
) RETURNS UUID AS $$
DECLARE
    raw RECORD;
    new_request_id UUID;
    resolved_person_id UUID;
    resolved_place_id UUID;
BEGIN
    -- Get the raw intake request
    SELECT * INTO raw FROM trapper.raw_intake_request WHERE raw_id = p_raw_id;

    IF NOT FOUND THEN
        RAISE NOTICE 'Raw intake request not found: %', p_raw_id;
        RETURN NULL;
    END IF;

    -- Check if already promoted
    IF raw.intake_status = 'promoted' THEN
        RAISE NOTICE 'Request already promoted: %', raw.promoted_request_id;
        RETURN raw.promoted_request_id;
    END IF;

    -- Resolve person (use existing or create)
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

    -- Resolve place (use existing or create)
    IF raw.place_id IS NOT NULL THEN
        resolved_place_id := raw.place_id;
    ELSIF raw.raw_address IS NOT NULL THEN
        resolved_place_id := trapper.find_or_create_place_deduped(
            p_formatted_address := raw.raw_address,
            p_source_system := raw.source_system
        );
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
        total_cats_reported,
        cat_count_semantic,
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
        'web_intake',
        'web_intake',
        p_promoted_by
    )
    RETURNING request_id INTO new_request_id;

    -- Update the raw record
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
               'cat_count_semantic', 'needs_tnr'
           ),
           p_promoted_by, 'New request from intake');

    RETURN new_request_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo 'Verifying raw_intake_request columns...'

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'trapper'
  AND table_name = 'raw_intake_request'
  AND column_name IN ('source_system', 'raw_total_cats_reported')
ORDER BY column_name;

\echo ''
\echo '=============================================='
\echo 'MIG_555 Complete!'
\echo '=============================================='
\echo ''
\echo 'Fixed:'
\echo '  - Added raw_total_cats_reported column'
\echo '  - Removed invalid data_source from convert_intake_to_request'
\echo '  - Updated promote_intake_request to use web_intake as data_source'
\echo ''
