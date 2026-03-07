-- ============================================================================
-- MIG_2863: Wire enrich_person_from_request into convert_intake_to_request
-- ============================================================================
-- The convert function already calls enrich_place_from_request() but never
-- calls enrich_person_from_request(). This adds the call and maps
-- requester_role_at_submission from intake submission data.
--
-- FFS-296
-- ============================================================================

\echo ''
\echo '=========================================='
\echo 'MIG_2863: Wire enrich in convert'
\echo '=========================================='

\echo ''
\echo '1. Updating convert_intake_to_request() with person enrichment...'

CREATE OR REPLACE FUNCTION ops.convert_intake_to_request(
  p_submission_id UUID,
  p_converted_by TEXT DEFAULT 'system'
)
RETURNS UUID AS $$
DECLARE
  v_sub RECORD;
  v_request_id UUID;
  v_place_id UUID;
  v_requester_id UUID;
  v_site_contact_id UUID;
  v_priority TEXT;
BEGIN
  -- Fetch submission
  SELECT * INTO v_sub
  FROM ops.intake_submissions
  WHERE submission_id = p_submission_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submission not found: %', p_submission_id;
  END IF;

  IF v_sub.converted_to_request_id IS NOT NULL THEN
    RAISE EXCEPTION 'Submission already converted to request: %', v_sub.converted_to_request_id;
  END IF;

  -- Get place_id (FIX: was linked_place_id, actual column is place_id)
  v_place_id := v_sub.place_id;

  -- Get requester person_id
  v_requester_id := v_sub.matched_person_id;

  -- Handle third-party reports: create site contact from property owner info
  IF v_sub.is_third_party_report AND v_sub.property_owner_email IS NOT NULL THEN
    SELECT sot.find_or_create_person(
      v_sub.property_owner_email,
      v_sub.property_owner_phone,
      SPLIT_PART(v_sub.property_owner_name, ' ', 1),
      CASE WHEN POSITION(' ' IN v_sub.property_owner_name) > 0
           THEN SUBSTRING(v_sub.property_owner_name FROM POSITION(' ' IN v_sub.property_owner_name) + 1)
           ELSE NULL END,
      NULL,
      'web_intake'
    ) INTO v_site_contact_id;
  END IF;

  -- Determine priority
  v_priority := CASE
    WHEN v_sub.is_emergency THEN 'urgent'
    WHEN v_sub.has_medical_concerns AND v_sub.medical_description ILIKE '%urgent%' THEN 'high'
    WHEN v_sub.triage_category = 'high_priority_tnr' THEN 'high'
    WHEN v_sub.kitten_age_estimate IN ('under_4_weeks', 'newborn') THEN 'urgent'
    WHEN v_sub.kitten_age_estimate IN ('4_to_8_weeks', '2-3 weeks', '4-5 weeks') THEN 'high'
    ELSE 'normal'
  END;

  -- Create request with ALL structured fields mapped
  INSERT INTO ops.requests (
    status, priority, summary, notes,
    is_third_party_report, third_party_relationship,
    requester_role_at_submission,
    county, is_emergency,
    estimated_cat_count, total_cats_reported, count_confidence, peak_count,
    cat_name, cat_description,
    colony_duration, awareness_duration, eartip_count_observed,
    has_kittens, kitten_count, kitten_age_estimate, kitten_behavior,
    mom_present, kitten_contained, mom_fixed, can_bring_in,
    is_being_fed, feeder_name, feeding_frequency, feeding_location, feeding_time,
    has_medical_concerns, medical_description,
    handleability, fixed_status,
    property_type, is_property_owner, has_property_access, access_notes,
    dogs_on_site, trap_savvy, previous_tnr,
    triage_category, received_by,
    place_id, requester_person_id, site_contact_person_id, requester_is_site_contact,
    source_system, source_record_id, source_created_at
  ) VALUES (
    'new',
    v_priority,
    COALESCE(
      v_sub.cat_name,
      CASE
        WHEN v_sub.cat_count_estimate = 1 THEN 'Single cat'
        WHEN v_sub.cat_count_estimate <= 3 THEN v_sub.cat_count_estimate || ' cats'
        ELSE 'Colony (' || COALESCE(v_sub.cat_count_estimate::TEXT, '?') || ' cats)'
      END
    ) || ' - ' || COALESCE(v_sub.cats_city, 'Unknown location'),
    v_sub.situation_description,
    COALESCE(v_sub.is_third_party_report, FALSE),
    v_sub.third_party_relationship,
    -- FFS-296: Map requester role from intake submission
    CASE
      WHEN COALESCE(v_sub.is_third_party_report, FALSE)
        THEN COALESCE(v_sub.third_party_relationship, 'referrer')
      ELSE COALESCE(v_sub.requester_relationship, 'resident')
    END,
    v_sub.county,
    COALESCE(v_sub.is_emergency, FALSE),
    COALESCE(v_sub.cats_needing_tnr, v_sub.cat_count_estimate),
    v_sub.cat_count_estimate,
    v_sub.count_confidence,
    v_sub.peak_count,
    v_sub.cat_name,
    v_sub.cat_description,
    v_sub.colony_duration,
    v_sub.awareness_duration,
    v_sub.eartip_count_observed,
    COALESCE(v_sub.has_kittens, FALSE),
    v_sub.kitten_count,
    v_sub.kitten_age_estimate,
    v_sub.kitten_behavior,
    v_sub.mom_present,
    v_sub.kitten_contained,
    v_sub.mom_fixed,
    v_sub.can_bring_in,
    COALESCE(v_sub.feeds_cat, v_sub.cats_being_fed, FALSE),
    v_sub.feeder_info,
    v_sub.feeding_frequency,
    v_sub.feeding_location,
    v_sub.feeding_time,
    COALESCE(v_sub.has_medical_concerns, FALSE),
    v_sub.medical_description,
    v_sub.handleability::TEXT,
    v_sub.fixed_status::TEXT,
    NULL, -- property_type: not in intake_submissions
    v_sub.is_property_owner,
    v_sub.has_property_access,
    v_sub.access_notes,
    v_sub.dogs_on_site,
    v_sub.trap_savvy,
    v_sub.previous_tnr,
    v_sub.triage_category::TEXT,
    v_sub.reviewed_by,
    v_place_id,
    v_requester_id,
    COALESCE(v_site_contact_id, CASE WHEN v_sub.is_third_party_report THEN NULL ELSE v_requester_id END),
    NOT COALESCE(v_sub.is_third_party_report, FALSE),
    'web_intake',
    p_submission_id::TEXT,
    v_sub.created_at
  )
  RETURNING request_id INTO v_request_id;

  -- Update submission with conversion info
  UPDATE ops.intake_submissions
  SET converted_to_request_id = v_request_id,
      converted_at = NOW(),
      converted_by = p_converted_by
  WHERE submission_id = p_submission_id;

  -- Enrich place with request data (if place linked)
  IF v_place_id IS NOT NULL THEN
    PERFORM ops.enrich_place_from_request(v_request_id);
  END IF;

  -- FFS-296: Link requestor to place
  PERFORM ops.enrich_person_from_request(v_request_id);

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql;

\echo '   Updated convert_intake_to_request() with person enrichment + role mapping'

\echo ''
\echo '=========================================='
\echo 'MIG_2863 Complete'
\echo '=========================================='
\echo ''
\echo 'Added: requester_role_at_submission mapping from intake data'
\echo 'Added: PERFORM ops.enrich_person_from_request() call'
\echo ''
\echo 'NEXT: Backfill existing requests (MIG_2864)'
