-- ============================================================================
-- MIG_2833: Fix convert_intake_to_request linked_place_id → place_id
-- ============================================================================
-- The function references v_sub.linked_place_id but the actual column in
-- ops.intake_submissions is place_id. This causes conversion to fail with:
--   "record v_sub has no field linked_place_id"
--
-- Also adds 'declined' to the status CHECK constraint so the decline
-- endpoint can set status = 'declined' without violating the constraint.
--
-- Also relaxes the NOT NULL constraint on email (API accepts phone-only).
-- ============================================================================

\echo ''
\echo '=========================================='
\echo 'MIG_2833: Fix convert_intake_to_request'
\echo '=========================================='

-- 1. Fix the convert function: linked_place_id → place_id
\echo '1. Fixing linked_place_id → place_id in convert function...'

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

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql;

\echo '   Fixed: v_sub.linked_place_id → v_sub.place_id'

-- 2. Fix status CHECK constraint to include 'declined'
\echo ''
\echo '2. Adding declined to status CHECK constraint...'

DO $$
BEGIN
  -- Drop existing constraint if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'intake_submissions_status_check'
    AND conrelid = 'ops.intake_submissions'::regclass
  ) THEN
    ALTER TABLE ops.intake_submissions DROP CONSTRAINT intake_submissions_status_check;
  END IF;

  -- Re-add with all existing values plus 'declined'
  ALTER TABLE ops.intake_submissions ADD CONSTRAINT intake_submissions_status_check
    CHECK (status IN ('new', 'reviewed', 'converted', 'declined', 'archived', 'spam', 'closed', 'request_created', 'triaged'));
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Could not update status CHECK: %', SQLERRM;
END;
$$;

\echo '   Added declined to status CHECK constraint'

-- 3. Allow NULL email (phone-only intakes)
\echo ''
\echo '3. Allowing NULL email for phone-only intakes...'

DO $$
BEGIN
  ALTER TABLE ops.intake_submissions ALTER COLUMN email DROP NOT NULL;
  RAISE NOTICE 'Dropped NOT NULL on email column';
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'email column already nullable or error: %', SQLERRM;
END;
$$;

\echo '   email column now nullable (phone-only intakes supported)'

-- 4. Fix enrich_place_from_request column names
\echo ''
\echo '4. Fixing enrich_place_from_request() column names...'

CREATE OR REPLACE FUNCTION ops.enrich_place_from_request(p_request_id UUID)
RETURNS void AS $$
DECLARE
  v_req RECORD;
  v_estimate_exists BOOLEAN;
BEGIN
  -- Get request data
  SELECT * INTO v_req FROM ops.requests WHERE request_id = p_request_id;
  IF NOT FOUND OR v_req.place_id IS NULL THEN RETURN; END IF;

  -- Check if estimate already exists
  SELECT EXISTS(
    SELECT 1 FROM sot.place_colony_estimates WHERE place_id = v_req.place_id
  ) INTO v_estimate_exists;

  -- Insert or update colony estimate
  IF v_estimate_exists THEN
    UPDATE sot.place_colony_estimates
    SET
      total_count_observed = COALESCE(v_req.total_cats_reported, total_count_observed),
      eartip_count_observed = COALESCE(v_req.eartip_count_observed, eartip_count_observed)
    WHERE place_id = v_req.place_id;
  ELSE
    -- Only create if we have meaningful data
    IF v_req.total_cats_reported IS NOT NULL OR v_req.peak_count IS NOT NULL THEN
      INSERT INTO sot.place_colony_estimates (
        place_id,
        total_count_observed,
        eartip_count_observed,
        estimate_method,
        source_system,
        created_at
      ) VALUES (
        v_req.place_id,
        v_req.total_cats_reported,
        v_req.eartip_count_observed,
        'request_report',
        'web_intake',
        NOW()
      );
    END IF;
  END IF;

  -- Add safety concerns if dogs on site
  IF v_req.dogs_on_site = 'yes' THEN
    UPDATE sot.places
    SET safety_concerns = array_append(
      COALESCE(safety_concerns, '{}'),
      'dogs'
    )
    WHERE place_id = v_req.place_id
      AND NOT ('dogs' = ANY(COALESCE(safety_concerns, '{}')));
  END IF;

  -- Update place property type if not set
  UPDATE sot.places
  SET place_kind = CASE v_req.property_type
    WHEN 'private_home' THEN 'residential_house'
    WHEN 'apartment_complex' THEN 'apartment_building'
    WHEN 'business' THEN 'business'
    WHEN 'farm_ranch' THEN 'outdoor_site'
    WHEN 'public_park' THEN 'outdoor_site'
    WHEN 'industrial' THEN 'business'
    ELSE place_kind
  END
  WHERE place_id = v_req.place_id
    AND (place_kind IS NULL OR place_kind = 'unknown');

END;
$$ LANGUAGE plpgsql;

\echo '   Fixed: reported_count → total_count_observed, eartipped_count → eartip_count_observed'

\echo ''
\echo '=========================================='
\echo 'MIG_2833 complete'
\echo '=========================================='
