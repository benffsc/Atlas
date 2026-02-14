\echo ''
\echo '=============================================='
\echo 'MIG_536: Intake Cat Count Semantic Integration'
\echo '=============================================='
\echo ''
\echo 'Updates intake-to-request conversion to properly handle'
\echo 'cats_needing_tnr vs cat_count_estimate distinction.'
\echo ''

-- ============================================================================
-- PART 1: Add raw_total_cats_reported to raw_intake_request
-- ============================================================================

\echo 'Adding raw_total_cats_reported column...'

ALTER TABLE trapper.raw_intake_request
ADD COLUMN IF NOT EXISTS raw_total_cats_reported INTEGER;

COMMENT ON COLUMN trapper.raw_intake_request.raw_total_cats_reported IS
'Total cats reported at location (for colony estimation).
Distinct from raw_estimated_cat_count which is cats still needing TNR.';

-- ============================================================================
-- PART 2: Update convert_intake_to_request to use cats_needing_tnr
-- ============================================================================

\echo 'Updating convert_intake_to_request function...'

CREATE OR REPLACE FUNCTION trapper.convert_intake_to_request(
  p_submission_id UUID,
  p_converted_by TEXT DEFAULT 'system'
) RETURNS UUID AS $$
DECLARE
  v_sub RECORD;
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
  -- For TNR tracking, prefer cats_needing_tnr if provided
  v_tnr_count := COALESCE(v_sub.cats_needing_tnr, v_sub.cat_count_estimate);
  v_total_count := v_sub.cat_count_estimate;

  -- Create raw intake request
  INSERT INTO trapper.raw_intake_request (
    -- Source tracking
    source_system,
    data_source,
    created_by,

    -- Request basics
    raw_request_purpose,
    raw_summary,
    raw_notes,

    -- Location
    place_id,
    raw_address,
    raw_location_description,

    -- Contact
    requester_person_id,
    raw_requester_name,
    raw_requester_phone,
    raw_requester_email,

    -- Cats - TNR count vs total count
    raw_estimated_cat_count,
    raw_total_cats_reported,
    raw_has_kittens,
    raw_kitten_count,
    raw_eartip_estimate,

    -- Priority based on triage
    raw_priority,
    raw_urgency_notes
  ) VALUES (
    'web_intake',
    'web_form',
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

    v_tnr_count,      -- Cats needing TNR (primary operational metric)
    v_total_count,    -- Total cats (for colony estimation)
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
  RETURNING raw_id INTO v_request_id;

  -- Update submission status
  UPDATE trapper.web_intake_submissions
  SET status = 'request_created',
      created_request_id = v_request_id,
      updated_at = NOW()
  WHERE submission_id = p_submission_id;

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.convert_intake_to_request IS
'Converts a web intake submission to a raw_intake_request.
Uses cats_needing_tnr (if provided) as the TNR target for operational tracking.
Uses cat_count_estimate as total colony size for Beacon estimation.
The promote step will set cat_count_semantic = needs_tnr on the sot_request.';

-- ============================================================================
-- PART 3: Update promote_intake_request to set semantic fields
-- ============================================================================

\echo 'Updating promote_intake_request function...'

-- Get the current function definition and update it
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
            p_raw_address := raw.raw_address,
            p_source_system := raw.source_system
        );
    END IF;

    -- Resolve place (use existing or create)
    IF raw.place_id IS NOT NULL THEN
        resolved_place_id := raw.place_id;
    ELSIF raw.raw_address IS NOT NULL THEN
        resolved_place_id := trapper.find_or_create_place_deduped(
            p_raw_address := raw.raw_address,
            p_source_system := raw.source_system
        );
    END IF;

    -- Create the SoT request with explicit semantic fields
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
        raw.raw_total_cats_reported,  -- New: total for colony estimation
        'needs_tnr',                   -- New: explicit semantic for new requests
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
               'priority', raw.raw_priority,
               'cat_count_semantic', 'needs_tnr'
           ),
           p_promoted_by, 'New request from intake');

    RETURN new_request_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.promote_intake_request IS
'Validates and promotes a raw intake request to sot_requests.
Auto-creates places from raw_address using find_or_create_place_deduped
(which auto-queues for geocoding). Auto-creates people from contact info.
Sets cat_count_semantic = needs_tnr and total_cats_reported explicitly.
Returns the new request_id or NULL if validation failed.';

-- ============================================================================
-- PART 4: Update find_or_create_request to set semantic explicitly
-- ============================================================================

\echo 'Checking find_or_create_request...'

-- The find_or_create_request function relies on DEFAULT value which is fine,
-- but let's add a parameter for total_cats_reported for completeness

-- First check if the function exists and needs updating
DO $$
BEGIN
    -- Check if function already has total_cats_reported parameter
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'trapper'
        AND p.proname = 'find_or_create_request'
        AND p.proargtypes::text LIKE '%total_cats%'
    ) THEN
        RAISE NOTICE 'find_or_create_request needs total_cats_reported parameter - will be added in separate migration if needed';
    END IF;
END $$;

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_536 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  - Added raw_total_cats_reported to raw_intake_request table'
\echo '  - Updated convert_intake_to_request to use cats_needing_tnr for TNR count'
\echo '  - Updated promote_intake_request to explicitly set:'
\echo '    * cat_count_semantic = needs_tnr'
\echo '    * total_cats_reported from raw data'
\echo ''
\echo 'Flow for new intakes:'
\echo '  1. Web form collects: cat_count_estimate (total), cats_needing_tnr (unfixed)'
\echo '  2. convert_intake_to_request: uses cats_needing_tnr for raw_estimated_cat_count'
\echo '  3. promote_intake_request: sets estimated_cat_count AND total_cats_reported'
\echo '  4. Colony estimate uses total_cats_reported for Beacon'
\echo ''
