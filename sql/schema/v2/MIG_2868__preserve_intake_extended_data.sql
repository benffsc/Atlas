-- ============================================================================
-- MIG_2868: Preserve Dropped Intake Fields in Request Conversion
-- ============================================================================
-- Problem: convert_intake_to_request() silently drops 8+ fields with no
-- corresponding ops.requests column. Staff lose valuable triage context.
--
-- Fix: Add intake_extended_data JSONB column to ops.requests and update
-- convert_intake_to_request() to dump unmapped fields there.
--
-- FFS-309
-- ============================================================================

\echo ''
\echo '================================================'
\echo '  MIG_2868: Preserve Intake Extended Data'
\echo '================================================'
\echo ''

-- ============================================================================
-- 1. Add intake_extended_data column to ops.requests
-- ============================================================================

\echo '1. Adding intake_extended_data column to ops.requests...'

ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS intake_extended_data JSONB;

COMMENT ON COLUMN ops.requests.intake_extended_data IS
'JSONB blob preserving intake_submissions fields that have no dedicated ops.requests column.
Populated by convert_intake_to_request(). Fields: best_trapping_time, important_notes,
kitten_notes, ownership_status, observation_time_of_day, feeding_duration, cat_comes_inside,
referral_source, kitten_mixed_ages_description, kitten_outcome, foster_readiness,
kitten_urgency_factors, feeding_situation. FFS-309.';

\echo '   Added intake_extended_data column'

-- ============================================================================
-- 2. Update convert_intake_to_request() to populate it
-- ============================================================================

\echo ''
\echo '2. Updating convert_intake_to_request() to preserve extended data...'

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
  v_extended_data JSONB;
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

  -- Get place_id
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

  -- Build extended data JSONB for fields without dedicated columns
  v_extended_data := jsonb_strip_nulls(jsonb_build_object(
    'best_trapping_time', v_sub.best_trapping_time,
    'important_notes', v_sub.important_notes,
    'kitten_notes', v_sub.kitten_notes,
    'ownership_status', v_sub.ownership_status,
    'observation_time_of_day', v_sub.observation_time_of_day,
    'feeding_duration', v_sub.feeding_duration,
    'cat_comes_inside', v_sub.cat_comes_inside,
    'referral_source', v_sub.referral_source,
    'kitten_mixed_ages_description', v_sub.kitten_mixed_ages_description,
    'kitten_outcome', v_sub.kitten_outcome,
    'foster_readiness', v_sub.foster_readiness,
    'kitten_urgency_factors', v_sub.kitten_urgency_factors,
    'feeding_situation', v_sub.feeding_situation
  ));

  -- Don't store empty object
  IF v_extended_data = '{}'::jsonb THEN
    v_extended_data := NULL;
  END IF;

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
    source_system, source_record_id, source_created_at,
    intake_extended_data
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
    v_sub.created_at,
    v_extended_data
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

COMMENT ON FUNCTION ops.convert_intake_to_request IS
'V2/MIG_2868: Converts an intake submission to a request.
Maps all structured fields from intake_submissions to ops.requests.
Fields without dedicated columns are preserved in intake_extended_data JSONB.
Handles third-party property owner creation, priority calculation,
place enrichment, and person-place linking. FFS-296, FFS-309.';

\echo '   Updated convert_intake_to_request() to preserve extended data'

-- ============================================================================
-- 3. Backfill existing converted requests
-- ============================================================================

\echo ''
\echo '3. Backfilling intake_extended_data for previously converted requests...'

WITH backfill AS (
  UPDATE ops.requests r
  SET intake_extended_data = jsonb_strip_nulls(jsonb_build_object(
    'best_trapping_time', s.best_trapping_time,
    'important_notes', s.important_notes,
    'kitten_notes', s.kitten_notes,
    'ownership_status', s.ownership_status,
    'observation_time_of_day', s.observation_time_of_day,
    'feeding_duration', s.feeding_duration,
    'cat_comes_inside', s.cat_comes_inside,
    'referral_source', s.referral_source,
    'kitten_mixed_ages_description', s.kitten_mixed_ages_description,
    'kitten_outcome', s.kitten_outcome,
    'foster_readiness', s.foster_readiness,
    'kitten_urgency_factors', s.kitten_urgency_factors,
    'feeding_situation', s.feeding_situation
  ))
  FROM ops.intake_submissions s
  WHERE s.converted_to_request_id = r.request_id
    AND r.intake_extended_data IS NULL
    AND r.source_system = 'web_intake'
    -- Only backfill if at least one field has data
    AND (
      s.best_trapping_time IS NOT NULL OR
      s.important_notes IS NOT NULL OR
      s.kitten_notes IS NOT NULL OR
      s.ownership_status IS NOT NULL OR
      s.observation_time_of_day IS NOT NULL OR
      s.feeding_duration IS NOT NULL OR
      s.cat_comes_inside IS NOT NULL OR
      s.referral_source IS NOT NULL OR
      s.kitten_mixed_ages_description IS NOT NULL
    )
  RETURNING r.request_id
)
SELECT COUNT(*) as requests_backfilled FROM backfill;

-- ============================================================================
-- 4. Summary
-- ============================================================================

\echo ''
\echo '================================================'
\echo '  MIG_2868 Complete (FFS-309)'
\echo '================================================'
\echo ''
\echo 'Added: ops.requests.intake_extended_data JSONB column'
\echo 'Updated: convert_intake_to_request() preserves unmapped fields'
\echo 'Backfilled: existing converted requests with available data'
\echo ''
\echo 'Preserved fields: best_trapping_time, important_notes, kitten_notes,'
\echo '  ownership_status, observation_time_of_day, feeding_duration,'
\echo '  cat_comes_inside, referral_source, kitten_mixed_ages_description,'
\echo '  kitten_outcome, foster_readiness, kitten_urgency_factors, feeding_situation'
\echo ''
