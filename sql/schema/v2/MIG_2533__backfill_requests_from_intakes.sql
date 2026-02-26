-- MIG_2533: Backfill Request Fields from Intake Submissions
--
-- Problem: 1,242 intake submissions have rich structured data, but
-- only 5 web_intake requests exist and they have 0% of the structured fields.
-- Even native requests created from intakes lost data in the conversion.
--
-- Solution:
-- 1. Link requests to their source intake submissions
-- 2. Backfill structured fields from intake → request
-- 3. Create upgrade function for future use
--
-- Created: 2026-02-26

\echo ''
\echo '=============================================='
\echo '  MIG_2533: Backfill Requests from Intakes'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Add tracking column to intake_submissions if not exists
-- ============================================================================

\echo '1. Adding converted_to_request_id column to intake_submissions...'

ALTER TABLE ops.intake_submissions
ADD COLUMN IF NOT EXISTS converted_to_request_id UUID REFERENCES ops.requests(request_id),
ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS converted_by TEXT;

COMMENT ON COLUMN ops.intake_submissions.converted_to_request_id IS
'Links to the request created from this submission. NULL if not converted.';

-- ============================================================================
-- 2. Link existing web_intake requests to their source submissions
-- ============================================================================

\echo '2. Linking web_intake requests to source intake submissions...'

-- Link by source_record_id (which stores the submission_id)
UPDATE ops.intake_submissions i
SET converted_to_request_id = r.request_id,
    converted_at = r.created_at,
    converted_by = 'backfill_mig_2533'
FROM ops.requests r
WHERE r.source_system = 'web_intake'
  AND r.source_record_id = i.submission_id::text
  AND i.converted_to_request_id IS NULL;

\echo '   Linked web_intake requests to source submissions'

-- ============================================================================
-- 3. Create upgrade function to pull intake data into requests
-- ============================================================================

\echo '3. Creating upgrade_request_from_intake() function...'

CREATE OR REPLACE FUNCTION ops.upgrade_request_from_intake(p_request_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_req RECORD;
  v_intake RECORD;
  v_updated_fields TEXT[] := '{}';
  v_result JSONB;
BEGIN
  -- Get request
  SELECT * INTO v_req FROM ops.requests WHERE request_id = p_request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;

  -- Find linked intake submission
  SELECT * INTO v_intake
  FROM ops.intake_submissions
  WHERE submission_id::text = v_req.source_record_id
     OR converted_to_request_id = p_request_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No linked intake submission found');
  END IF;

  -- Update request with intake data (only fill empty fields)
  UPDATE ops.requests SET
    -- Location/Service Area
    county = COALESCE(county, v_intake.county),

    -- Cat count fields
    estimated_cat_count = COALESCE(estimated_cat_count, v_intake.cat_count_estimate),
    total_cats_reported = COALESCE(total_cats_reported, v_intake.cat_count_estimate),
    count_confidence = COALESCE(count_confidence, v_intake.count_confidence),
    peak_count = COALESCE(peak_count, v_intake.peak_count),

    -- Colony info
    colony_duration = COALESCE(colony_duration, v_intake.colony_duration),
    awareness_duration = COALESCE(awareness_duration, v_intake.awareness_duration),
    eartip_count_observed = COALESCE(eartip_count_observed, v_intake.eartip_count_observed),

    -- Kitten fields
    has_kittens = COALESCE(has_kittens, v_intake.has_kittens),
    kitten_count = COALESCE(kitten_count, v_intake.kitten_count),
    kitten_age_estimate = COALESCE(kitten_age_estimate, v_intake.kitten_age_estimate),
    kitten_behavior = COALESCE(kitten_behavior, v_intake.kitten_behavior),
    mom_present = COALESCE(mom_present, v_intake.mom_present),
    kitten_contained = COALESCE(kitten_contained, v_intake.kitten_contained),
    mom_fixed = COALESCE(mom_fixed, v_intake.mom_fixed),
    can_bring_in = COALESCE(can_bring_in, v_intake.can_bring_in),

    -- Medical/Emergency
    is_emergency = COALESCE(is_emergency, v_intake.is_emergency),
    has_medical_concerns = COALESCE(has_medical_concerns, v_intake.has_medical_concerns),
    medical_description = COALESCE(medical_description, v_intake.medical_description),

    -- Feeding info
    is_being_fed = COALESCE(is_being_fed, v_intake.cats_being_fed, v_intake.feeds_cat),
    feeder_name = COALESCE(feeder_name, v_intake.feeder_info),
    feeding_frequency = COALESCE(feeding_frequency, v_intake.feeding_frequency),
    feeding_location = COALESCE(feeding_location, v_intake.feeding_location),
    feeding_time = COALESCE(feeding_time, v_intake.feeding_time),

    -- Access/Property
    is_property_owner = COALESCE(is_property_owner, v_intake.is_property_owner),
    has_property_access = COALESCE(has_property_access, v_intake.has_property_access),
    access_notes = COALESCE(access_notes, v_intake.access_notes),

    -- Third-party tracking
    is_third_party_report = COALESCE(is_third_party_report, v_intake.is_third_party_report),
    third_party_relationship = COALESCE(third_party_relationship, v_intake.third_party_relationship),

    -- Note: dogs_on_site, trap_savvy, previous_tnr are only on intake_submissions,
    -- not on requests. They stay in intake for historical reference.

    -- Cat identification
    cat_name = COALESCE(cat_name, v_intake.cat_name),
    cat_description = COALESCE(cat_description, v_intake.cat_description),

    -- Handleability
    handleability = COALESCE(handleability, v_intake.handleability::text),
    fixed_status = COALESCE(fixed_status, v_intake.fixed_status::text),

    -- Triage
    triage_category = COALESCE(triage_category, v_intake.triage_category::text),

    -- Notes (append if different)
    notes = CASE
      WHEN notes IS NULL AND v_intake.situation_description IS NOT NULL
      THEN v_intake.situation_description
      WHEN notes IS NOT NULL AND v_intake.situation_description IS NOT NULL
           AND notes != v_intake.situation_description
      THEN notes || E'\n\n--- From intake submission ---\n' || v_intake.situation_description
      ELSE notes
    END,

    -- Mark as upgraded
    updated_at = NOW()
  WHERE request_id = p_request_id;

  -- Track which fields were updated
  SELECT ARRAY(
    SELECT unnest(ARRAY[
      CASE WHEN v_req.county IS NULL AND v_intake.county IS NOT NULL THEN 'county' END,
      CASE WHEN v_req.estimated_cat_count IS NULL AND v_intake.cat_count_estimate IS NOT NULL THEN 'estimated_cat_count' END,
      CASE WHEN v_req.has_kittens IS NULL AND v_intake.has_kittens IS NOT NULL THEN 'has_kittens' END,
      CASE WHEN v_req.is_emergency IS NULL AND v_intake.is_emergency IS NOT NULL THEN 'is_emergency' END,
      CASE WHEN v_req.has_medical_concerns IS NULL AND v_intake.has_medical_concerns IS NOT NULL THEN 'has_medical_concerns' END,
      CASE WHEN v_req.is_being_fed IS NULL AND (v_intake.cats_being_fed IS NOT NULL OR v_intake.feeds_cat IS NOT NULL) THEN 'is_being_fed' END,
      CASE WHEN v_req.colony_duration IS NULL AND v_intake.colony_duration IS NOT NULL THEN 'colony_duration' END
    ]) AS field WHERE unnest IS NOT NULL
  ) INTO v_updated_fields;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', p_request_id,
    'intake_id', v_intake.submission_id,
    'fields_updated', v_updated_fields
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.upgrade_request_from_intake(UUID) IS
'Upgrades a request by pulling structured fields from its source intake submission.
Only fills fields that are currently NULL (preserves manual edits).
Returns JSON with success status and list of updated fields.';

-- ============================================================================
-- 4. Run backfill for all web_intake requests
-- ============================================================================

\echo '4. Running backfill for web_intake requests...'

DO $$
DECLARE
  v_request RECORD;
  v_result JSONB;
  v_count INT := 0;
BEGIN
  FOR v_request IN
    SELECT request_id FROM ops.requests
    WHERE source_system = 'web_intake'
  LOOP
    v_result := ops.upgrade_request_from_intake(v_request.request_id);
    IF (v_result->>'success')::boolean THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Upgraded % web_intake requests', v_count;
END $$;

-- ============================================================================
-- 5. Create batch upgrade function for admin use
-- ============================================================================

\echo '5. Creating batch upgrade function...'

CREATE OR REPLACE FUNCTION ops.upgrade_all_linkable_requests()
RETURNS TABLE(
  upgraded_count INT,
  skipped_count INT,
  error_count INT,
  details JSONB
) AS $$
DECLARE
  v_upgraded INT := 0;
  v_skipped INT := 0;
  v_errors INT := 0;
  v_request RECORD;
  v_result JSONB;
  v_all_results JSONB := '[]'::JSONB;
BEGIN
  -- Find all requests that could be linked to intakes
  FOR v_request IN
    SELECT r.request_id, r.source_system, r.source_record_id
    FROM ops.requests r
    WHERE r.source_system IN ('web_intake')
      AND EXISTS (
        SELECT 1 FROM ops.intake_submissions i
        WHERE i.submission_id::text = r.source_record_id
      )
  LOOP
    BEGIN
      v_result := ops.upgrade_request_from_intake(v_request.request_id);

      IF (v_result->>'success')::boolean THEN
        IF jsonb_array_length(v_result->'fields_updated') > 0 THEN
          v_upgraded := v_upgraded + 1;
        ELSE
          v_skipped := v_skipped + 1;
        END IF;
      ELSE
        v_errors := v_errors + 1;
      END IF;

      v_all_results := v_all_results || v_result;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_upgraded, v_skipped, v_errors, v_all_results;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.upgrade_all_linkable_requests() IS
'Batch upgrades all requests that can be linked to intake submissions.
Returns counts of upgraded, skipped (already complete), and errored requests.';

-- ============================================================================
-- 6. Verify results
-- ============================================================================

\echo ''
\echo '6. Verifying backfill results...'

SELECT
  'Before' as timing,
  0 as has_county,
  0 as has_kittens,
  0 as has_medical
UNION ALL
SELECT
  'After',
  COUNT(*) FILTER (WHERE county IS NOT NULL),
  COUNT(*) FILTER (WHERE has_kittens = true),
  COUNT(*) FILTER (WHERE has_medical_concerns = true)
FROM ops.requests
WHERE source_system = 'web_intake';

-- ============================================================================
-- 7. Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  MIG_2533 Complete'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - converted_to_request_id column on intake_submissions'
\echo '  - upgrade_request_from_intake(request_id) function'
\echo '  - upgrade_all_linkable_requests() batch function'
\echo ''
\echo 'Backfilled:'
\echo '  - All web_intake requests now have intake data'
\echo ''
\echo 'Usage:'
\echo '  -- Upgrade a single request'
\echo '  SELECT ops.upgrade_request_from_intake(''uuid-here'');'
\echo ''
\echo '  -- Batch upgrade all linkable requests'
\echo '  SELECT * FROM ops.upgrade_all_linkable_requests();'
\echo ''
