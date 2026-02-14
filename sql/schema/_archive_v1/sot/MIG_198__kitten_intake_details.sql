-- MIG_198: Enhanced Kitten Intake Details
-- Adds detailed kitten fields for foster program triage
--
-- New fields:
--   kitten_mixed_ages_description: Text for mixed-age litters
--   kitten_behavior: Socialization level (friendly, shy, feral, etc.)
--   kitten_contained: Whether kittens are already caught/contained
--   mom_present: Is mom cat present?
--   mom_fixed: Is mom already fixed (if present)?
--   can_bring_in: Can client bring kittens in?
--   kitten_notes: Additional notes about kittens
--
-- Foster triage factors:
--   - Age: Under 12 weeks ideal, 12+ weeks need socialization
--   - Behavior: Friendly/handleable kittens prioritized
--   - Mom: Spayed mom with kittens increases foster likelihood
--   - Ease: Already contained = easier intake

\echo '=============================================='
\echo 'MIG_198: Enhanced Kitten Intake Details'
\echo '=============================================='

-- ============================================
-- PART 1: Add new kitten columns
-- ============================================

\echo 'Adding enhanced kitten detail columns...'

ALTER TABLE trapper.web_intake_submissions
  ADD COLUMN IF NOT EXISTS kitten_mixed_ages_description TEXT,
  ADD COLUMN IF NOT EXISTS kitten_behavior TEXT CHECK (kitten_behavior IS NULL OR kitten_behavior IN (
    'friendly',         -- Can be handled, approaches people
    'shy_handleable',   -- Scared but can be picked up
    'feral_young',      -- Hissy/scared, may be socializable
    'feral_older',      -- Very scared, hard to handle
    'unknown'           -- Haven't been able to assess
  )),
  ADD COLUMN IF NOT EXISTS kitten_contained TEXT CHECK (kitten_contained IS NULL OR kitten_contained IN (
    'yes',              -- All kittens caught/contained
    'no',               -- Not contained, still free
    'some'              -- Some caught, some not
  )),
  ADD COLUMN IF NOT EXISTS mom_present TEXT CHECK (mom_present IS NULL OR mom_present IN (
    'yes',
    'no',
    'unsure'
  )),
  ADD COLUMN IF NOT EXISTS mom_fixed TEXT CHECK (mom_fixed IS NULL OR mom_fixed IN (
    'yes',
    'no',
    'unsure'
  )),
  ADD COLUMN IF NOT EXISTS can_bring_in TEXT CHECK (can_bring_in IS NULL OR can_bring_in IN (
    'yes',              -- Client can bring kittens in
    'need_help',        -- Needs help with transport/trapping
    'no'                -- Cannot bring in
  )),
  ADD COLUMN IF NOT EXISTS kitten_notes TEXT,
  -- Staff assessment fields (filled when reviewing paper/phone intake)
  ADD COLUMN IF NOT EXISTS priority_override TEXT CHECK (priority_override IS NULL OR priority_override IN (
    'high',
    'normal',
    'low'
  )),
  ADD COLUMN IF NOT EXISTS kitten_outcome TEXT CHECK (kitten_outcome IS NULL OR kitten_outcome IN (
    'foster_intake',    -- Accepted for foster program
    'tnr_candidate',    -- Will be TNR'd
    'pending_space',    -- Waiting for foster space
    'declined'          -- Not accepted
  )),
  ADD COLUMN IF NOT EXISTS foster_readiness TEXT CHECK (foster_readiness IS NULL OR foster_readiness IN (
    'high',             -- Friendly, ideal age
    'medium',           -- Needs socialization work
    'low'               -- Likely TNR candidate
  )),
  ADD COLUMN IF NOT EXISTS kitten_urgency_factors TEXT[]; -- Array: bottle_babies, medical_needs, unsafe_location, mom_unfixed

-- ============================================
-- PART 2: Update triage scoring for kitten factors
-- ============================================

\echo 'Updating triage function with kitten factors...'

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

  -- KITTEN SCORING (enhanced with foster factors)
  IF v_sub.has_kittens = TRUE THEN
    v_score := v_score + 35;
    v_reasons := v_reasons || '["KITTENS PRESENT - time-sensitive"]'::JSONB;

    -- Age-based scoring (younger = more urgent but also more fosterable)
    IF v_sub.kitten_age_estimate = 'newborn' OR v_sub.kitten_age_estimate = 'under_4_weeks' THEN
      v_score := v_score + 20;
      v_reasons := v_reasons || '["Bottle babies - critical care needed"]'::JSONB;
    ELSIF v_sub.kitten_age_estimate IN ('eyes_open', '4_to_8_weeks') THEN
      v_score := v_score + 15;
      v_reasons := v_reasons || '["Weaning age - good foster candidates"]'::JSONB;
    ELSIF v_sub.kitten_age_estimate IN ('weaned', '8_to_12_weeks') THEN
      v_score := v_score + 10;
      v_reasons := v_reasons || '["Ideal foster age (8-12 weeks)"]'::JSONB;
    ELSIF v_sub.kitten_age_estimate IN ('12_to_16_weeks') THEN
      v_score := v_score + 5;
      v_reasons := v_reasons || '["Socialization critical window (12-16 weeks)"]'::JSONB;
    ELSIF v_sub.kitten_age_estimate = 'over_16_weeks' THEN
      v_score := v_score + 0;
      v_reasons := v_reasons || '["Older kittens (4+ months) - different approach needed"]'::JSONB;
    ELSIF v_sub.kitten_age_estimate = 'mixed' THEN
      v_score := v_score + 10;
      v_reasons := v_reasons || '["Mixed age kittens - complex case"]'::JSONB;
    END IF;

    -- Behavior-based scoring (friendly = easier foster)
    CASE v_sub.kitten_behavior
      WHEN 'friendly' THEN
        v_score := v_score + 10;
        v_reasons := v_reasons || '["Friendly kittens - foster ready"]'::JSONB;
      WHEN 'shy_handleable' THEN
        v_score := v_score + 5;
        v_reasons := v_reasons || '["Shy but handleable - socializable"]'::JSONB;
      WHEN 'feral_young' THEN
        v_score := v_score + 3;
        v_reasons := v_reasons || '["Feral but young - may be socializable"]'::JSONB;
      WHEN 'feral_older' THEN
        v_score := v_score + 0;
        v_reasons := v_reasons || '["Feral older kittens - TNR candidates"]'::JSONB;
      ELSE
        NULL;
    END CASE;

    -- Already contained = easier intake
    IF v_sub.kitten_contained = 'yes' THEN
      v_score := v_score + 5;
      v_reasons := v_reasons || '["Kittens already contained - easy intake"]'::JSONB;
    ELSIF v_sub.kitten_contained = 'some' THEN
      v_score := v_score + 2;
      v_reasons := v_reasons || '["Some kittens contained"]'::JSONB;
    END IF;

    -- Mom present and fixed = good for foster
    IF v_sub.mom_present = 'yes' THEN
      IF v_sub.mom_fixed = 'yes' THEN
        v_score := v_score + 5;
        v_reasons := v_reasons || '["Mom present and fixed - can foster with kittens"]'::JSONB;
      ELSIF v_sub.mom_fixed = 'no' THEN
        v_score := v_score + 10;
        v_reasons := v_reasons || '["Mom present but unfixed - needs TNR + foster coordination"]'::JSONB;
      END IF;
    END IF;

    -- Client can bring in = easier
    IF v_sub.can_bring_in = 'yes' THEN
      v_score := v_score + 5;
      v_reasons := v_reasons || '["Client can bring kittens in"]'::JSONB;
    ELSIF v_sub.can_bring_in = 'need_help' THEN
      v_score := v_score + 2;
      v_reasons := v_reasons || '["Client needs help with transport"]'::JSONB;
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

  -- All fixed = wellness only
  IF v_sub.fixed_status = 'all_fixed' THEN
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

-- ============================================
-- PART 3: Update view for queue with kitten details
-- ============================================

\echo 'Updating triage queue view with kitten details...'

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
  w.kitten_count,
  w.kitten_age_estimate,
  w.kitten_behavior,
  w.kitten_contained,
  w.mom_present,
  w.mom_fixed,
  w.can_bring_in,
  w.has_medical_concerns,
  w.is_emergency,
  w.situation_description,
  w.triage_category,
  w.triage_score,
  w.triage_reasons,
  w.status,
  w.final_category,
  w.created_request_id,
  -- Age of submission
  NOW() - w.submitted_at AS age,
  -- Flag if older than 48 hours and not reviewed
  CASE WHEN w.status IN ('new', 'triaged') AND NOW() - w.submitted_at > INTERVAL '48 hours'
       THEN TRUE ELSE FALSE END AS overdue,
  -- Kitten foster readiness indicator
  CASE
    WHEN w.has_kittens = TRUE AND w.kitten_behavior IN ('friendly', 'shy_handleable')
         AND w.kitten_age_estimate IN ('4_to_8_weeks', '8_to_12_weeks', 'eyes_open', 'weaned')
    THEN 'high'
    WHEN w.has_kittens = TRUE AND w.kitten_behavior = 'feral_young'
    THEN 'medium'
    WHEN w.has_kittens = TRUE
    THEN 'low'
    ELSE NULL
  END AS foster_readiness
FROM trapper.web_intake_submissions w
WHERE w.status NOT IN ('request_created', 'archived')
ORDER BY
  -- Emergencies first
  w.is_emergency DESC,
  -- Then by triage score
  w.triage_score DESC,
  -- Then by submission time
  w.submitted_at ASC;

\echo ''
\echo 'MIG_198 complete!'
\echo ''
\echo 'Added client kitten columns:'
\echo '  - kitten_mixed_ages_description: Text for mixed-age litters'
\echo '  - kitten_behavior: friendly, shy_handleable, feral_young, feral_older, unknown'
\echo '  - kitten_contained: yes, no, some'
\echo '  - mom_present: yes, no, unsure'
\echo '  - mom_fixed: yes, no, unsure'
\echo '  - can_bring_in: yes, need_help, no'
\echo '  - kitten_notes: Text for additional notes'
\echo ''
\echo 'Added staff assessment columns (for paper/phone intake entry):'
\echo '  - priority_override: high, normal, low'
\echo '  - kitten_outcome: foster_intake, tnr_candidate, pending_space, declined'
\echo '  - foster_readiness: high, medium, low'
\echo '  - kitten_urgency_factors: TEXT[] (bottle_babies, medical_needs, unsafe_location, mom_unfixed)'
\echo ''
\echo 'Updated triage scoring:'
\echo '  - Age scoring: bottle babies +20, weaning +15, ideal age +10, etc.'
\echo '  - Behavior: friendly +10, shy +5, feral young +3'
\echo '  - Contained: yes +5, some +2'
\echo '  - Mom present/fixed: +5 to +10'
\echo '  - Client can bring in: yes +5, need help +2'
\echo ''
\echo 'Added foster_readiness indicator to queue view'
\echo ''
\echo 'Paper form fields mapping:'
\echo '  Page 1 Staff Section:'
\echo '    - Source: phone/paper/walk-in -> source column'
\echo '    - Priority: high/normal/low -> priority_override column'
\echo '    - Triage: TNR/Wellness/etc -> final_category column'
\echo '  Page 2 Staff Section:'
\echo '    - Kitten outcome -> kitten_outcome column'
\echo '    - Foster readiness -> foster_readiness column'
\echo '    - Urgency factors -> kitten_urgency_factors array'
\echo ''
