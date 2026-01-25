-- MIG_613: Comprehensive Fix for Source Record Linking
--
-- Problem: Colony estimates and requests don't properly link back to their
-- original source records, making the data untraceable in the UI.
--
-- Root causes:
-- 1. promote_intake_request hardcodes source_system = 'web_intake' for all records
-- 2. Requests created via atlas_ui don't have source_record_id set
-- 3. add_colony_estimate_from_request doesn't set source_record_id properly
--
-- Comprehensive fix:
-- 1. Add source_submission_id to raw_intake_request for web intake tracking
-- 2. Fix promote_intake_request to use correct source_system from raw record
-- 3. Fix add_colony_estimate_from_request to always set source_record_id
-- 4. Backfill all existing data

\echo ''
\echo '=============================================='
\echo 'MIG_613: Comprehensive Source Record Linking'
\echo '=============================================='
\echo ''

-- ============================================================
-- PART 1: Add source_submission_id to raw_intake_request
-- ============================================================

\echo 'Adding source_submission_id column...'

ALTER TABLE trapper.raw_intake_request
ADD COLUMN IF NOT EXISTS source_submission_id UUID REFERENCES trapper.web_intake_submissions(submission_id);

COMMENT ON COLUMN trapper.raw_intake_request.source_submission_id IS
'Original web_intake_submissions.submission_id if converted from intake.
Used to set source_record_id for traceability.';

-- ============================================================
-- PART 2: Fix convert_intake_to_request
-- ============================================================

\echo 'Fixing convert_intake_to_request...'

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

  v_person_id := v_sub.matched_person_id;
  v_place_id := v_sub.matched_place_id;

  CASE COALESCE(v_sub.final_category, v_sub.triage_category)
    WHEN 'wellness_only' THEN v_purpose := 'wellness';
    WHEN 'high_priority_tnr' THEN v_purpose := 'tnr';
    WHEN 'standard_tnr' THEN v_purpose := 'tnr';
    ELSE v_purpose := 'tnr';
  END CASE;

  v_tnr_count := COALESCE(v_sub.cats_needing_tnr, v_sub.cat_count_estimate);
  v_total_count := v_sub.cat_count_estimate;

  INSERT INTO trapper.raw_intake_request (
    source_system,
    source_submission_id,
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
    p_submission_id,
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

  v_request_id := trapper.promote_intake_request(v_raw_id, p_converted_by);

  UPDATE trapper.web_intake_submissions
  SET status = 'request_created',
      created_request_id = v_request_id,
      updated_at = NOW()
  WHERE submission_id = p_submission_id;

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PART 3: Fix promote_intake_request to use correct source_system
-- ============================================================

\echo 'Fixing promote_intake_request...'

CREATE OR REPLACE FUNCTION trapper.promote_intake_request(
    p_raw_id UUID,
    p_promoted_by TEXT DEFAULT 'system'
) RETURNS UUID AS $$
DECLARE
    raw RECORD;
    new_request_id UUID;
    resolved_person_id UUID;
    resolved_place_id UUID;
    v_source_record_id TEXT;
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

    IF raw.place_id IS NOT NULL THEN
        resolved_place_id := raw.place_id;
    ELSIF raw.raw_address IS NOT NULL THEN
        resolved_place_id := trapper.find_or_create_place_deduped(
            p_formatted_address := raw.raw_address,
            p_source_system := raw.source_system
        );
    END IF;

    -- Determine source_record_id based on source
    -- For web_intake: use the submission_id
    -- For atlas_ui: we'll use the raw_id (and colony estimates will use request_id)
    v_source_record_id := CASE
        WHEN raw.source_submission_id IS NOT NULL THEN raw.source_submission_id::TEXT
        ELSE p_raw_id::TEXT
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
        raw.source_system,  -- Use actual source_system, not hardcoded
        raw.source_system,
        v_source_record_id,
        p_promoted_by
    )
    RETURNING request_id INTO new_request_id;

    UPDATE trapper.raw_intake_request
    SET intake_status = 'promoted',
        promoted_request_id = new_request_id,
        promoted_at = NOW(),
        validated_at = NOW()
    WHERE raw_id = p_raw_id;

    INSERT INTO trapper.intake_audit_log (raw_table, raw_id, sot_table, sot_id, action, changes, promoted_by, promotion_reason)
    VALUES ('raw_intake_request', p_raw_id, 'sot_requests', new_request_id, 'create',
           jsonb_build_object(
               'place_id', resolved_place_id,
               'person_id', resolved_person_id,
               'source_system', raw.source_system,
               'source_record_id', v_source_record_id
           ),
           p_promoted_by, 'New request from intake');

    RETURN new_request_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PART 4: Fix add_colony_estimate_from_request
-- ============================================================

\echo 'Fixing add_colony_estimate_from_request...'

CREATE OR REPLACE FUNCTION trapper.add_colony_estimate_from_request(
    p_request_id UUID
) RETURNS UUID AS $$
DECLARE
    v_request RECORD;
    v_estimate_id UUID;
    v_total_cats INTEGER;
    v_existing UUID;
    v_source_type TEXT;
BEGIN
    SELECT
        request_id, place_id, requester_person_id,
        estimated_cat_count, total_cats_reported,
        kitten_count, eartip_count, cat_count_semantic,
        source_created_at, source_system, source_record_id
    INTO v_request
    FROM trapper.sot_requests
    WHERE request_id = p_request_id;

    IF v_request IS NULL OR v_request.place_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Check for existing estimate from this request
    SELECT estimate_id INTO v_existing
    FROM trapper.place_colony_estimates
    WHERE source_entity_type = 'request'
      AND source_entity_id = p_request_id;

    IF v_existing IS NOT NULL THEN
        RETURN v_existing;
    END IF;

    -- Determine which count to use based on semantic
    IF v_request.cat_count_semantic = 'needs_tnr' THEN
        v_total_cats := v_request.total_cats_reported;
    ELSE
        v_total_cats := COALESCE(v_request.total_cats_reported, v_request.estimated_cat_count);
    END IF;

    IF v_total_cats IS NULL OR v_total_cats <= 0 THEN
        RETURN NULL;
    END IF;

    -- Determine source_type based on actual source_system
    v_source_type := CASE v_request.source_system
        WHEN 'web_intake' THEN 'intake_form'
        WHEN 'atlas_ui' THEN 'trapping_request'
        WHEN 'airtable' THEN 'trapping_request'
        WHEN 'airtable_ffsc' THEN 'trapping_request'
        ELSE 'trapping_request'
    END;

    INSERT INTO trapper.place_colony_estimates (
        estimate_id,
        place_id,
        total_cats,
        kitten_count,
        altered_count,
        source_type,
        source_entity_type,
        source_entity_id,
        reported_by_person_id,
        observation_date,
        reported_at,
        is_firsthand,
        source_system,
        source_record_id
    ) VALUES (
        gen_random_uuid(),
        v_request.place_id,
        v_total_cats,
        v_request.kitten_count,
        v_request.eartip_count,
        v_source_type,
        'request',
        v_request.request_id,
        v_request.requester_person_id,
        COALESCE(v_request.source_created_at::date, CURRENT_DATE),
        COALESCE(v_request.source_created_at, NOW()),
        TRUE,
        v_request.source_system,
        -- For colony estimates from requests, use request_id as source_record_id
        -- This allows linking directly to the request
        v_request.request_id::TEXT
    )
    RETURNING estimate_id INTO v_estimate_id;

    RETURN v_estimate_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.add_colony_estimate_from_request IS
'Creates a colony estimate from a request.
- Sets source_record_id to request_id for direct linking
- Uses correct source_type based on source_system
- Handles cat_count_semantic properly';

-- ============================================================
-- PART 5: Backfill existing requests
-- ============================================================

\echo 'Backfilling requests from web_intake_submissions...'

UPDATE trapper.sot_requests r
SET source_record_id = s.submission_id::TEXT
FROM trapper.web_intake_submissions s
WHERE s.created_request_id = r.request_id
  AND (r.source_record_id IS NULL OR r.source_record_id = '')
  AND r.source_system = 'web_intake';

\echo 'Backfilling requests from atlas_ui...'

-- For atlas_ui requests, link via raw_intake_request
UPDATE trapper.sot_requests r
SET source_record_id = rir.raw_id::TEXT
FROM trapper.raw_intake_request rir
WHERE rir.promoted_request_id = r.request_id
  AND (r.source_record_id IS NULL OR r.source_record_id = '')
  AND rir.source_system = 'atlas_ui';

-- Also fix source_system if it was wrongly set to web_intake for atlas_ui
UPDATE trapper.sot_requests r
SET source_system = 'atlas_ui',
    data_source = 'atlas_ui'
FROM trapper.raw_intake_request rir
WHERE rir.promoted_request_id = r.request_id
  AND rir.source_system = 'atlas_ui'
  AND r.source_system = 'web_intake';

-- ============================================================
-- PART 6: Backfill colony estimates
-- ============================================================

\echo 'Backfilling colony estimates from requests...'

-- For estimates linked to requests via source_entity_id,
-- set source_record_id = request_id for direct linking
UPDATE trapper.place_colony_estimates e
SET source_record_id = e.source_entity_id::TEXT
WHERE e.source_entity_type = 'request'
  AND e.source_entity_id IS NOT NULL
  AND (e.source_record_id IS NULL OR e.source_record_id = '');

-- Fix source_type for estimates that came from atlas_ui requests
UPDATE trapper.place_colony_estimates e
SET source_type = 'trapping_request'
FROM trapper.sot_requests r
WHERE e.source_entity_type = 'request'
  AND e.source_entity_id = r.request_id
  AND r.source_system = 'atlas_ui'
  AND e.source_type = 'intake_form';

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Verification...'

SELECT 'Requests without source_record_id' as check_type,
       COUNT(*) as count
FROM trapper.sot_requests
WHERE source_record_id IS NULL OR source_record_id = ''
UNION ALL
SELECT 'Colony estimates without source_record_id (from requests)',
       COUNT(*)
FROM trapper.place_colony_estimates
WHERE source_entity_type = 'request'
  AND (source_record_id IS NULL OR source_record_id = '');

\echo ''
\echo '=============================================='
\echo 'MIG_613 Complete!'
\echo '=============================================='
\echo ''
\echo 'Comprehensive fixes applied:'
\echo '  1. promote_intake_request now uses correct source_system'
\echo '  2. add_colony_estimate_from_request sets source_record_id = request_id'
\echo '  3. Backfilled requests and colony estimates'
\echo '  4. Fixed source_type for atlas_ui-created estimates'
\echo ''
\echo 'All source records should now be clickable in the UI.'
\echo ''
