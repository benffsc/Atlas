-- MIG_200: Third-Party Report Support
-- Allows volunteers and others to submit intake forms for situations they've heard about
-- These submissions need follow-up to get property owner permission
--
-- Use case: A volunteer hears about cats from a community member but won't be
-- involved in the actual trapping. The intake captures the info, but staff
-- needs to reach out to get proper access/permission.

\echo '=============================================='
\echo 'MIG_200: Third-Party Report Support'
\echo '=============================================='

-- Add third-party report fields to web_intake_submissions
ALTER TABLE trapper.web_intake_submissions
  ADD COLUMN IF NOT EXISTS is_third_party_report BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS third_party_relationship TEXT,
  ADD COLUMN IF NOT EXISTS property_owner_name TEXT,
  ADD COLUMN IF NOT EXISTS property_owner_phone TEXT,
  ADD COLUMN IF NOT EXISTS property_owner_email TEXT;

COMMENT ON COLUMN trapper.web_intake_submissions.is_third_party_report IS
  'True if submitter is reporting on behalf of someone else (volunteer, neighbor heard about it, etc.)';
COMMENT ON COLUMN trapper.web_intake_submissions.third_party_relationship IS
  'Relationship to the situation: volunteer, neighbor, family_member, concerned_citizen, etc.';
COMMENT ON COLUMN trapper.web_intake_submissions.property_owner_name IS
  'Name of property owner/primary contact if known (for third-party reports)';
COMMENT ON COLUMN trapper.web_intake_submissions.property_owner_phone IS
  'Phone of property owner if known';
COMMENT ON COLUMN trapper.web_intake_submissions.property_owner_email IS
  'Email of property owner if known';

-- Update the triage view to include third-party report flag
DROP VIEW IF EXISTS trapper.v_intake_triage_queue;
CREATE OR REPLACE VIEW trapper.v_intake_triage_queue AS
SELECT
  w.submission_id,
  w.submitted_at,
  w.first_name || ' ' || w.last_name AS submitter_name,
  w.email,
  w.phone,
  w.cats_address,
  w.cats_city,
  w.ownership_status,
  w.cat_count_estimate,
  w.fixed_status,
  w.has_kittens,
  w.has_medical_concerns,
  w.is_emergency,
  w.situation_description,
  w.triage_category,
  w.triage_score,
  w.triage_reasons,
  w.status,
  w.final_category,
  w.created_request_id,
  -- Third-party report fields
  w.is_third_party_report,
  w.third_party_relationship,
  w.property_owner_name,
  w.property_owner_phone,
  w.property_owner_email,
  -- Age of submission
  NOW() - w.submitted_at AS age,
  -- Flag if older than 48 hours and not reviewed
  CASE WHEN w.status IN ('new', 'triaged') AND NOW() - w.submitted_at > INTERVAL '48 hours'
       THEN TRUE ELSE FALSE END AS overdue,
  -- Legacy fields
  w.source,
  w.is_legacy,
  w.legacy_status,
  w.legacy_submission_status,
  w.geo_confidence,
  w.geo_formatted_address,
  w.geo_lat,
  w.geo_lng,
  w.matched_person_id,
  w.review_notes
FROM trapper.web_intake_submissions w
WHERE w.status NOT IN ('request_created', 'archived')
ORDER BY
  -- Emergencies first
  w.is_emergency DESC,
  -- Then by triage score
  w.triage_score DESC,
  -- Then by submission time
  w.submitted_at ASC;

-- Update the triage function to account for third-party reports
-- They should get flagged for needs_review since we need to contact the property owner
CREATE OR REPLACE FUNCTION trapper.compute_intake_triage(p_submission_id UUID)
RETURNS TABLE (
  category trapper.intake_triage_category,
  score INTEGER,
  reasons JSONB
) AS $$
DECLARE
  v_sub RECORD;
  v_score INTEGER := 0;
  v_reasons JSONB := '[]'::JSONB;
  v_category trapper.intake_triage_category;
BEGIN
  SELECT * INTO v_sub FROM trapper.web_intake_submissions WHERE submission_id = p_submission_id;

  IF v_sub IS NULL THEN
    RETURN;
  END IF;

  -- ==========================================
  -- SCORE CALCULATION
  -- Higher score = higher priority
  -- ==========================================

  -- Out of county check (immediate classification)
  IF v_sub.county IS NOT NULL AND lower(v_sub.county) NOT IN ('sonoma', 'sonoma county') THEN
    v_category := 'out_of_county';
    v_reasons := v_reasons || '["Outside Sonoma County service area"]'::JSONB;
    RETURN QUERY SELECT v_category, 0, v_reasons;
    RETURN;
  END IF;

  -- Third-party report check - needs review to get owner permission
  IF v_sub.is_third_party_report = TRUE THEN
    v_reasons := v_reasons || '["THIRD-PARTY REPORT - Need to contact property owner for permission"]'::JSONB;
    -- Don't immediately classify, but note it
  END IF;

  -- Owned cat check
  IF v_sub.ownership_status = 'my_cat' THEN
    v_category := 'owned_cat_low';
    v_score := v_score + 5;
    v_reasons := v_reasons || '["Owned cat - may need to redirect to low-cost clinic resources"]'::JSONB;

    -- Emergency owned cats still get priority
    IF v_sub.is_emergency = TRUE THEN
      v_score := v_score + 50;
      v_reasons := v_reasons || '["EMERGENCY - owned cat with urgent medical need"]'::JSONB;
      v_category := 'needs_review';  -- Human review for emergency owned cats
    END IF;

    RETURN QUERY SELECT v_category, v_score, v_reasons;
    RETURN;
  END IF;

  -- CAT COUNT SCORING
  IF v_sub.cat_count_estimate IS NOT NULL THEN
    IF v_sub.cat_count_estimate >= 10 THEN
      v_score := v_score + 40;
      v_reasons := v_reasons || jsonb_build_array('Large colony: ' || v_sub.cat_count_estimate || '+ cats');
    ELSIF v_sub.cat_count_estimate >= 5 THEN
      v_score := v_score + 25;
      v_reasons := v_reasons || jsonb_build_array('Medium colony: ' || v_sub.cat_count_estimate || ' cats');
    ELSIF v_sub.cat_count_estimate >= 2 THEN
      v_score := v_score + 10;
      v_reasons := v_reasons || jsonb_build_array('Small group: ' || v_sub.cat_count_estimate || ' cats');
    ELSE
      v_score := v_score + 5;
      v_reasons := v_reasons || '["Single cat"]'::JSONB;
    END IF;
  END IF;

  -- FIXED STATUS SCORING
  CASE v_sub.fixed_status
    WHEN 'none_fixed' THEN
      v_score := v_score + 30;
      v_reasons := v_reasons || '["No cats are fixed - TNR needed"]'::JSONB;
    WHEN 'some_fixed' THEN
      v_score := v_score + 20;
      v_reasons := v_reasons || '["Some cats need TNR, some already done"]'::JSONB;
    WHEN 'most_fixed' THEN
      v_score := v_score + 10;
      v_reasons := v_reasons || '["Most cats already fixed"]'::JSONB;
    WHEN 'all_fixed' THEN
      v_score := v_score + 0;
      v_reasons := v_reasons || '["All cats already fixed - wellness only"]'::JSONB;
    ELSE
      v_score := v_score + 15;  -- Unknown gets middle score
      v_reasons := v_reasons || '["Fixed status unknown"]'::JSONB;
  END CASE;

  -- KITTEN SCORING (high priority)
  IF v_sub.has_kittens = TRUE THEN
    v_score := v_score + 35;
    v_reasons := v_reasons || '["KITTENS PRESENT - time-sensitive"]'::JSONB;

    IF v_sub.kitten_age_estimate = 'newborn' THEN
      v_score := v_score + 15;
      v_reasons := v_reasons || '["Newborn kittens - urgent"]'::JSONB;
    END IF;
  END IF;

  -- MEDICAL/EMERGENCY SCORING
  IF v_sub.is_emergency = TRUE THEN
    v_score := v_score + 50;
    v_reasons := v_reasons || '["EMERGENCY flagged by submitter"]'::JSONB;
  ELSIF v_sub.has_medical_concerns = TRUE THEN
    v_score := v_score + 20;
    v_reasons := v_reasons || '["Medical concerns noted"]'::JSONB;
  END IF;

  -- COLONY DURATION (newer = potentially faster growth)
  CASE v_sub.awareness_duration
    WHEN 'under_1_week' THEN
      v_score := v_score + 15;
      v_reasons := v_reasons || '["New situation - may be escalating"]'::JSONB;
    WHEN 'under_1_month' THEN
      v_score := v_score + 10;
      v_reasons := v_reasons || '["Recent awareness (< 1 month)"]'::JSONB;
    WHEN 'over_1_year' THEN
      v_score := v_score + 0;
      v_reasons := v_reasons || '["Long-standing situation (1+ year)"]'::JSONB;
    ELSE
      NULL;  -- No adjustment
  END CASE;

  -- ACCESS AVAILABILITY (bonus for easy scheduling)
  IF v_sub.has_property_access = TRUE AND v_sub.is_property_owner = TRUE THEN
    v_score := v_score + 5;
    v_reasons := v_reasons || '["Full property access available"]'::JSONB;
  ELSIF v_sub.has_property_access = FALSE THEN
    v_score := v_score - 5;
    v_reasons := v_reasons || '["Permission/access may be barrier"]'::JSONB;
  END IF;

  -- ==========================================
  -- CATEGORY ASSIGNMENT
  -- ==========================================

  -- Third-party reports always need review for owner contact
  IF v_sub.is_third_party_report = TRUE THEN
    v_category := 'needs_review';
  -- All fixed = wellness only
  ELSIF v_sub.fixed_status = 'all_fixed' THEN
    v_category := 'wellness_only';
  -- High score = high priority TNR
  ELSIF v_score >= 60 THEN
    v_category := 'high_priority_tnr';
  -- Medium score = standard TNR
  ELSIF v_score >= 25 THEN
    v_category := 'standard_tnr';
  -- Low score with unclear ownership
  ELSIF v_sub.ownership_status IN ('unsure', 'neighbors_cat') THEN
    v_category := 'needs_review';
  ELSE
    v_category := 'standard_tnr';
  END IF;

  RETURN QUERY SELECT v_category, v_score, v_reasons;
END;
$$ LANGUAGE plpgsql;

\echo ''
\echo 'MIG_200 complete!'
\echo ''
\echo 'Added columns to web_intake_submissions:'
\echo '  - is_third_party_report: Boolean flag'
\echo '  - third_party_relationship: volunteer, neighbor, family_member, etc.'
\echo '  - property_owner_name: Name of actual property owner if known'
\echo '  - property_owner_phone: Phone of property owner'
\echo '  - property_owner_email: Email of property owner'
\echo ''
\echo 'Third-party reports are automatically marked as needs_review'
\echo 'since staff needs to contact the property owner for permission.'
\echo ''
