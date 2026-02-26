-- MIG_2532: Complete Request Field Coverage
--
-- Based on INTAKE_REQUEST_DATA_FLOW_AUDIT.md findings:
-- - 15 fields not being carried from intake to request
-- - 5 Beacon-critical fields (peak_count, etc.) missing
-- - Entity enrichment opportunities identified
--
-- This migration adds missing columns so intake→request conversion
-- doesn't lose data and requests can properly enrich entities.
--
-- Created: 2026-02-26

\echo ''
\echo '=============================================='
\echo '  MIG_2532: Complete Request Field Coverage'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Add missing columns to ops.requests
-- ============================================================================

\echo '1. Adding missing columns to ops.requests...'

-- Third-party report tracking (affects requester intelligence)
ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS is_third_party_report BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS third_party_relationship TEXT;

COMMENT ON COLUMN ops.requests.is_third_party_report IS
'Whether the requester is reporting on behalf of someone else (neighbor, volunteer, etc.).
If TRUE, requester may NOT be the resident/caretaker at the location.';

COMMENT ON COLUMN ops.requests.third_party_relationship IS
'Relationship of requester to the actual property/cats: neighbor, family_member, concerned_citizen, ffsc_volunteer, other';

-- Service area tracking
ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS county TEXT;

COMMENT ON COLUMN ops.requests.county IS
'County where cats are located. Primary service area is Sonoma.
Used for routing out-of-area requests and service planning.';

-- Emergency tracking (drives priority but was not stored)
ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS is_emergency BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN ops.requests.is_emergency IS
'Whether this was flagged as an emergency at intake.
Emergencies: injured cat, immediate danger, etc.';

-- Colony observation data (CRITICAL FOR BEACON)
ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS peak_count INTEGER,
ADD COLUMN IF NOT EXISTS awareness_duration TEXT;

COMMENT ON COLUMN ops.requests.peak_count IS
'Maximum number of cats observed at once (last week).
CRITICAL for Beacon population estimation using Chapman mark-recapture.';

COMMENT ON COLUMN ops.requests.awareness_duration IS
'How long requester has been aware of cats: days, weeks, months, years.
Helps understand colony establishment vs recent sighting.';

-- Kitten tracking (missing from previous migration)
ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS kitten_contained TEXT,
ADD COLUMN IF NOT EXISTS mom_fixed TEXT,
ADD COLUMN IF NOT EXISTS can_bring_in TEXT;

COMMENT ON COLUMN ops.requests.kitten_contained IS
'Whether kittens are contained/accessible: yes, no, unknown';

COMMENT ON COLUMN ops.requests.mom_fixed IS
'Whether mother cat is already fixed: yes, no, unknown';

COMMENT ON COLUMN ops.requests.can_bring_in IS
'Whether requester can bring kittens/cats in themselves: yes, no, maybe';

-- Feeding logistics (call sheet captures but not stored)
ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS feeding_location TEXT,
ADD COLUMN IF NOT EXISTS feeding_time TEXT;

COMMENT ON COLUMN ops.requests.feeding_location IS
'Where cats are fed: back_porch, side_yard, garage, etc.
Important for trap placement planning.';

COMMENT ON COLUMN ops.requests.feeding_time IS
'What time cats are typically fed: 6pm, morning, evening, etc.
Important for scheduling trapping.';

-- Triage tracking (preserve for analytics)
ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS triage_category TEXT,
ADD COLUMN IF NOT EXISTS received_by TEXT;

COMMENT ON COLUMN ops.requests.triage_category IS
'Category assigned at triage: high_priority_tnr, standard_tnr, wellness, owned_cat, out_of_area, needs_review.
Preserved from intake for reporting and analytics.';

COMMENT ON COLUMN ops.requests.received_by IS
'Staff member who received the call or reviewed the submission.
For accountability and follow-up.';

\echo '   Added: is_third_party_report, third_party_relationship'
\echo '   Added: county'
\echo '   Added: is_emergency'
\echo '   Added: peak_count, awareness_duration (Beacon critical)'
\echo '   Added: kitten_contained, mom_fixed, can_bring_in'
\echo '   Added: feeding_location, feeding_time'
\echo '   Added: triage_category, received_by'

-- ============================================================================
-- 2. Add missing columns to ops.intake_submissions
-- ============================================================================

\echo ''
\echo '2. Adding missing columns to ops.intake_submissions...'

-- These are captured in call sheet but not stored
ALTER TABLE ops.intake_submissions
ADD COLUMN IF NOT EXISTS feeding_location TEXT,
ADD COLUMN IF NOT EXISTS feeding_time TEXT,
ADD COLUMN IF NOT EXISTS dogs_on_site TEXT,
ADD COLUMN IF NOT EXISTS trap_savvy TEXT,
ADD COLUMN IF NOT EXISTS previous_tnr TEXT,
ADD COLUMN IF NOT EXISTS best_trapping_time TEXT,
ADD COLUMN IF NOT EXISTS important_notes TEXT[];

COMMENT ON COLUMN ops.intake_submissions.feeding_location IS
'Where cats are fed (call sheet: "Where Do Cats Eat?")';

COMMENT ON COLUMN ops.intake_submissions.feeding_time IS
'What time cats are fed (call sheet: "What Time?")';

COMMENT ON COLUMN ops.intake_submissions.dogs_on_site IS
'Dogs present at location: yes, no (call sheet checkbox)';

COMMENT ON COLUMN ops.intake_submissions.trap_savvy IS
'Whether cats are trap-savvy: yes, no, unknown';

COMMENT ON COLUMN ops.intake_submissions.previous_tnr IS
'Previous TNR at location: yes, no, partial';

COMMENT ON COLUMN ops.intake_submissions.best_trapping_time IS
'Best day/time for trapping (call sheet free text)';

COMMENT ON COLUMN ops.intake_submissions.important_notes IS
'Array of important flags from call sheet checkboxes:
withhold_food, other_feeders, cats_cross_property, pregnant_suspected,
injured_priority, caller_can_help, wildlife_concerns, neighbor_issues, urgent';

\echo '   Added intake columns: feeding_location, feeding_time, dogs_on_site,'
\echo '   trap_savvy, previous_tnr, best_trapping_time, important_notes[]'

-- ============================================================================
-- 3. Update convert_intake_to_request function to map ALL fields
-- ============================================================================

\echo ''
\echo '3. Updating convert_intake_to_request() with complete field mapping...'

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

  -- Get place_id (from linked place or create new)
  v_place_id := v_sub.linked_place_id;

  -- Get requester person_id
  v_requester_id := v_sub.matched_person_id;

  -- Handle third-party reports: create site contact from property owner info
  IF v_sub.is_third_party_report AND v_sub.property_owner_email IS NOT NULL THEN
    -- Try to find or create the property owner as a separate person
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
    -- Core fields
    status,
    priority,
    summary,
    notes,
    -- Third-party tracking (NEW)
    is_third_party_report,
    third_party_relationship,
    -- Service area (NEW)
    county,
    -- Emergency (NEW)
    is_emergency,
    -- Cat count fields
    estimated_cat_count,
    total_cats_reported,
    count_confidence,
    peak_count,  -- NEW: Beacon critical
    -- Cat identification
    cat_name,
    cat_description,
    -- Colony info
    colony_duration,
    awareness_duration,  -- NEW
    eartip_count_observed,
    -- Kitten fields
    has_kittens,
    kitten_count,
    kitten_age_estimate,
    kitten_behavior,
    mom_present,
    kitten_contained,  -- NEW
    mom_fixed,         -- NEW
    can_bring_in,      -- NEW
    -- Feeding info
    is_being_fed,
    feeder_name,
    feeding_frequency,
    feeding_location,  -- NEW
    feeding_time,      -- NEW
    -- Medical
    has_medical_concerns,
    medical_description,
    -- Handleability
    handleability,
    fixed_status,
    -- Property/access
    property_type,
    is_property_owner,
    has_property_access,
    access_notes,
    -- Trapping characteristics (from call sheet)
    dogs_on_site,
    trap_savvy,
    previous_tnr,
    -- Triage (NEW: preserve for analytics)
    triage_category,
    received_by,
    -- Links
    place_id,
    requester_person_id,
    site_contact_person_id,
    requester_is_site_contact,
    -- Provenance
    source_system,
    source_record_id,
    source_created_at
  ) VALUES (
    'new',
    v_priority,
    -- Generate structured summary
    COALESCE(
      v_sub.cat_name,
      CASE
        WHEN v_sub.cat_count_estimate = 1 THEN 'Single cat'
        WHEN v_sub.cat_count_estimate <= 3 THEN v_sub.cat_count_estimate || ' cats'
        ELSE 'Colony (' || COALESCE(v_sub.cat_count_estimate::TEXT, '?') || ' cats)'
      END
    ) || ' - ' || COALESCE(v_sub.cats_city, 'Unknown location'),
    v_sub.situation_description,
    -- Third-party
    COALESCE(v_sub.is_third_party_report, FALSE),
    v_sub.third_party_relationship,
    -- Service area
    v_sub.county,
    -- Emergency
    COALESCE(v_sub.is_emergency, FALSE),
    -- Cat count
    COALESCE(v_sub.cats_needing_tnr, v_sub.cat_count_estimate),
    v_sub.cat_count_estimate,
    v_sub.count_confidence,
    v_sub.peak_count,
    -- Cat identification
    v_sub.cat_name,
    v_sub.cat_description,
    -- Colony info
    v_sub.colony_duration,
    v_sub.awareness_duration,
    v_sub.eartip_count_observed,
    -- Kitten fields
    COALESCE(v_sub.has_kittens, FALSE),
    v_sub.kitten_count,
    v_sub.kitten_age_estimate,
    v_sub.kitten_behavior,
    v_sub.mom_present,
    v_sub.kitten_contained,
    v_sub.mom_fixed,
    v_sub.can_bring_in,
    -- Feeding info
    COALESCE(v_sub.feeds_cat, v_sub.cats_being_fed, FALSE),
    v_sub.feeder_info,
    v_sub.feeding_frequency,
    v_sub.feeding_location,
    v_sub.feeding_time,
    -- Medical
    COALESCE(v_sub.has_medical_concerns, FALSE),
    v_sub.medical_description,
    -- Handleability
    v_sub.handleability::TEXT,
    v_sub.fixed_status::TEXT,
    -- Property/access
    v_sub.property_type,
    v_sub.is_property_owner,
    v_sub.has_property_access,
    v_sub.access_notes,
    -- Trapping characteristics
    v_sub.dogs_on_site,
    v_sub.trap_savvy,
    v_sub.previous_tnr,
    -- Triage
    v_sub.triage_category::TEXT,
    v_sub.reviewed_by,
    -- Links
    v_place_id,
    v_requester_id,
    COALESCE(v_site_contact_id, CASE WHEN v_sub.is_third_party_report THEN NULL ELSE v_requester_id END),
    NOT COALESCE(v_sub.is_third_party_report, FALSE),
    -- Provenance
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

COMMENT ON FUNCTION ops.convert_intake_to_request(UUID, TEXT) IS
'Converts an intake submission to a request with COMPLETE structured field mapping.
MIG_2532: Maps ALL intake fields to request columns.
Also enriches the linked place with colony estimation data.';

-- ============================================================================
-- 4. Create place enrichment function
-- ============================================================================

\echo ''
\echo '4. Creating enrich_place_from_request() function...'

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
      reported_count = COALESCE(v_req.total_cats_reported, reported_count),
      peak_observed = GREATEST(v_req.peak_count, peak_observed),
      eartipped_count = COALESCE(v_req.eartip_count_observed, eartipped_count),
      updated_at = NOW()
    WHERE place_id = v_req.place_id;
  ELSE
    -- Only create if we have meaningful data
    IF v_req.total_cats_reported IS NOT NULL OR v_req.peak_count IS NOT NULL THEN
      INSERT INTO sot.place_colony_estimates (
        place_id,
        reported_count,
        peak_observed,
        eartipped_count,
        source_type,
        created_at
      ) VALUES (
        v_req.place_id,
        v_req.total_cats_reported,
        v_req.peak_count,
        v_req.eartip_count_observed,
        'request_report',
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

COMMENT ON FUNCTION ops.enrich_place_from_request(UUID) IS
'Enriches place data from request information:
- Updates/creates colony estimate with reported counts
- Adds safety concerns (dogs)
- Sets property type if not already set
Called automatically by convert_intake_to_request().';

-- ============================================================================
-- 5. Create person enrichment function
-- ============================================================================

\echo ''
\echo '5. Creating enrich_person_from_request() function...'

CREATE OR REPLACE FUNCTION ops.enrich_person_from_request(p_request_id UUID)
RETURNS void AS $$
DECLARE
  v_req RECORD;
BEGIN
  -- Get request data
  SELECT * INTO v_req FROM ops.requests WHERE request_id = p_request_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- If third-party reporter, mark relationship_type as 'referrer'
  IF v_req.is_third_party_report AND v_req.requester_person_id IS NOT NULL AND v_req.place_id IS NOT NULL THEN
    -- Ensure the requester is NOT marked as resident
    UPDATE sot.person_place
    SET relationship_type = 'referrer',
        notes = COALESCE(notes, '') || ' (Third-party report via request ' || v_req.request_id || ')'
    WHERE person_id = v_req.requester_person_id
      AND place_id = v_req.place_id
      AND relationship_type IN ('resident', 'unknown');
  END IF;

  -- If site contact is different from requester, link them as resident/caretaker
  IF v_req.site_contact_person_id IS NOT NULL
     AND v_req.site_contact_person_id != COALESCE(v_req.requester_person_id, '00000000-0000-0000-0000-000000000000'::UUID)
     AND v_req.place_id IS NOT NULL THEN

    -- Create person_place relationship for site contact
    INSERT INTO sot.person_place (
      person_id,
      place_id,
      relationship_type,
      is_active,
      source_system,
      notes
    ) VALUES (
      v_req.site_contact_person_id,
      v_req.place_id,
      CASE WHEN v_req.is_property_owner THEN 'owner' ELSE 'resident' END,
      TRUE,
      'web_intake',
      'Site contact from request ' || v_req.request_id
    )
    ON CONFLICT (person_id, place_id) DO UPDATE
    SET is_active = TRUE,
        relationship_type = CASE
          WHEN v_req.is_property_owner AND person_place.relationship_type NOT IN ('owner', 'property_manager')
          THEN 'owner'
          ELSE person_place.relationship_type
        END;
  END IF;

END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.enrich_person_from_request(UUID) IS
'Enriches person data from request information:
- Marks third-party reporters as referrers (not residents)
- Links site contacts to places with correct relationship type
- Distinguishes owner vs resident based on is_property_owner flag';

-- ============================================================================
-- 6. Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  MIG_2532 Complete'
\echo '=============================================='
\echo ''
\echo 'Added to ops.requests:'
\echo '  - is_third_party_report, third_party_relationship'
\echo '  - county'
\echo '  - is_emergency'
\echo '  - peak_count, awareness_duration (Beacon critical)'
\echo '  - kitten_contained, mom_fixed, can_bring_in'
\echo '  - feeding_location, feeding_time'
\echo '  - triage_category, received_by'
\echo ''
\echo 'Added to ops.intake_submissions:'
\echo '  - feeding_location, feeding_time'
\echo '  - dogs_on_site, trap_savvy, previous_tnr'
\echo '  - best_trapping_time, important_notes[]'
\echo ''
\echo 'Functions created/updated:'
\echo '  - convert_intake_to_request() - complete field mapping'
\echo '  - enrich_place_from_request() - colony estimates, safety concerns'
\echo '  - enrich_person_from_request() - relationship types, site contacts'
\echo ''
\echo 'NEXT: Update call sheet API to save new intake fields'
\echo ''
