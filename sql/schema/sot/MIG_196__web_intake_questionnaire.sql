-- MIG_196: Web Intake Questionnaire with Smart Triage
-- Single public form that triages owned vs unknown, high vs low priority
--
-- Problem: Two separate forms (owned vs unknown) advertises owned cat services
-- Solution: One questionnaire that classifies submissions based on answers
--
-- Triage Categories:
--   high_priority_tnr: Many unfixed cats, kittens, urgent situations
--   standard_tnr: Typical TNR request (few cats, manageable)
--   wellness_only: Already altered cats needing care
--   owned_cat_low: Appears owned, low priority (may redirect)
--   out_of_county: Outside Sonoma County service area
--   needs_review: Ambiguous, requires human triage

\echo '=============================================='
\echo 'MIG_196: Web Intake Questionnaire'
\echo '=============================================='

-- ============================================
-- PART 1: Triage category enum
-- ============================================

\echo 'Creating triage category enum...'

DO $$ BEGIN
  CREATE TYPE trapper.intake_triage_category AS ENUM (
    'high_priority_tnr',   -- 10+ unfixed cats, kittens, emergencies
    'standard_tnr',        -- Typical TNR (2-9 cats, unfixed)
    'wellness_only',       -- All/most already altered
    'owned_cat_low',       -- Owned cat, low priority
    'out_of_county',       -- Outside service area
    'needs_review'         -- Ambiguous, human review needed
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- PART 2: Web intake submission table
-- ============================================

\echo 'Creating web_intake_submissions table...'

CREATE TABLE IF NOT EXISTS trapper.web_intake_submissions (
  submission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Submission metadata
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT,

  -- Contact Information
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  requester_address TEXT,
  requester_city TEXT,
  requester_zip TEXT,

  -- Location of Cats
  cats_address TEXT NOT NULL,
  cats_city TEXT,
  cats_zip TEXT,
  county TEXT,

  -- Key Triage Questions (structured)
  -- Q1: Cat ownership status
  ownership_status TEXT NOT NULL CHECK (ownership_status IN (
    'unknown_stray',      -- Unknown/stray cats I've been seeing
    'community_colony',   -- Community cats being fed by someone
    'my_cat',             -- My own cat(s)
    'neighbors_cat',      -- Neighbor's cat(s)
    'unsure'              -- Not sure
  )),

  -- Q2: How many cats?
  cat_count_estimate INTEGER,
  cat_count_text TEXT,  -- Free text if they don't know exact number

  -- Q3: Fixed status
  fixed_status TEXT NOT NULL CHECK (fixed_status IN (
    'none_fixed',         -- None are fixed (no ear tips)
    'some_fixed',         -- Some have ear tips
    'most_fixed',         -- Most have ear tips
    'all_fixed',          -- All have ear tips
    'unknown'             -- Don't know / can't tell
  )),

  -- Q4: Kittens
  has_kittens BOOLEAN,
  kitten_count INTEGER,
  kitten_age_estimate TEXT,  -- 'newborn', 'eyes_open', 'weaned', 'unknown'

  -- Q5: How long aware of cats?
  awareness_duration TEXT CHECK (awareness_duration IN (
    'under_1_week',
    'under_1_month',
    '1_to_6_months',
    '6_to_12_months',
    'over_1_year',
    'unknown'
  )),

  -- Q6: Medical concerns
  has_medical_concerns BOOLEAN,
  medical_description TEXT,
  is_emergency BOOLEAN DEFAULT FALSE,

  -- Q7: Feeding
  cats_being_fed BOOLEAN,
  feeder_info TEXT,  -- Who feeds, schedule

  -- Q8: Access/Permission
  has_property_access BOOLEAN,
  access_notes TEXT,
  is_property_owner BOOLEAN,

  -- Q9: Situation description (free text)
  situation_description TEXT,

  -- Q10: How did you hear about us?
  referral_source TEXT,

  -- Media attachments (URLs or file references)
  media_urls TEXT[],

  -- Computed Triage
  triage_category trapper.intake_triage_category,
  triage_score INTEGER,  -- Numeric priority score (higher = more urgent)
  triage_reasons JSONB,  -- Array of reasons for the triage decision
  triage_computed_at TIMESTAMPTZ,

  -- Human Review
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  final_category trapper.intake_triage_category,  -- After human review

  -- Linking to SoT
  matched_person_id UUID REFERENCES trapper.sot_people(person_id),
  matched_place_id UUID REFERENCES trapper.places(place_id),
  created_request_id UUID REFERENCES trapper.sot_requests(request_id),

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new',           -- Just submitted
    'triaged',       -- Auto-triaged, awaiting review
    'reviewed',      -- Human reviewed
    'request_created', -- Converted to request
    'redirected',    -- Redirected elsewhere (owned cat resources, etc)
    'archived'       -- Closed without action
  )),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_web_intake_status ON trapper.web_intake_submissions(status);
CREATE INDEX IF NOT EXISTS idx_web_intake_triage ON trapper.web_intake_submissions(triage_category);
CREATE INDEX IF NOT EXISTS idx_web_intake_submitted ON trapper.web_intake_submissions(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_intake_email ON trapper.web_intake_submissions(lower(email));

-- ============================================
-- PART 3: Triage scoring function
-- ============================================

\echo 'Creating triage scoring function...'

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
-- PART 4: Auto-triage trigger
-- ============================================

\echo 'Creating auto-triage trigger...'

CREATE OR REPLACE FUNCTION trapper.trigger_auto_triage()
RETURNS TRIGGER AS $$
DECLARE
  v_triage RECORD;
BEGIN
  SELECT * INTO v_triage FROM trapper.compute_intake_triage(NEW.submission_id);

  NEW.triage_category := v_triage.category;
  NEW.triage_score := v_triage.score;
  NEW.triage_reasons := v_triage.reasons;
  NEW.triage_computed_at := NOW();
  NEW.status := 'triaged';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_triage_intake ON trapper.web_intake_submissions;
CREATE TRIGGER trg_auto_triage_intake
  BEFORE INSERT ON trapper.web_intake_submissions
  FOR EACH ROW
  EXECUTE FUNCTION trapper.trigger_auto_triage();

-- ============================================
-- PART 5: View for triage queue
-- ============================================

\echo 'Creating triage queue view...'

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
  -- Age of submission
  NOW() - w.submitted_at AS age,
  -- Flag if older than 48 hours and not reviewed
  CASE WHEN w.status IN ('new', 'triaged') AND NOW() - w.submitted_at > INTERVAL '48 hours'
       THEN TRUE ELSE FALSE END AS overdue
FROM trapper.web_intake_submissions w
WHERE w.status NOT IN ('request_created', 'archived')
ORDER BY
  -- Emergencies first
  w.is_emergency DESC,
  -- Then by triage score
  w.triage_score DESC,
  -- Then by submission time
  w.submitted_at ASC;

-- ============================================
-- PART 6: Function to convert to request
-- ============================================

\echo 'Creating convert-to-request function...'

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

    -- Cats
    raw_estimated_cat_count,
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
      CASE WHEN v_sub.cat_count_estimate IS NOT NULL
           THEN ' (' || v_sub.cat_count_estimate || ' cats)'
           ELSE '' END,
    v_sub.situation_description,

    v_place_id,
    v_sub.cats_address,
    'Submitted via web form',

    v_person_id,
    v_sub.first_name || ' ' || v_sub.last_name,
    v_sub.phone,
    v_sub.email,

    v_sub.cat_count_estimate,
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

-- ============================================
-- PART 7: Person matching function
-- ============================================

\echo 'Creating person matching function...'

CREATE OR REPLACE FUNCTION trapper.match_intake_to_person(p_submission_id UUID)
RETURNS UUID AS $$
DECLARE
  v_sub RECORD;
  v_person_id UUID;
BEGIN
  SELECT * INTO v_sub FROM trapper.web_intake_submissions WHERE submission_id = p_submission_id;

  IF v_sub IS NULL THEN
    RETURN NULL;
  END IF;

  -- Try to match by email first (most reliable)
  SELECT pi.person_id INTO v_person_id
  FROM trapper.person_identifiers pi
  WHERE pi.id_type = 'email'
    AND lower(pi.id_value) = lower(v_sub.email)
  LIMIT 1;

  IF v_person_id IS NOT NULL THEN
    UPDATE trapper.web_intake_submissions
    SET matched_person_id = v_person_id
    WHERE submission_id = p_submission_id;
    RETURN v_person_id;
  END IF;

  -- Try to match by phone
  IF v_sub.phone IS NOT NULL THEN
    SELECT pi.person_id INTO v_person_id
    FROM trapper.person_identifiers pi
    WHERE pi.id_type = 'phone'
      AND pi.id_value_norm = regexp_replace(v_sub.phone, '[^0-9]', '', 'g')
    LIMIT 1;

    IF v_person_id IS NOT NULL THEN
      UPDATE trapper.web_intake_submissions
      SET matched_person_id = v_person_id
      WHERE submission_id = p_submission_id;
      RETURN v_person_id;
    END IF;
  END IF;

  -- Try to match by name (fuzzy - last resort)
  SELECT p.person_id INTO v_person_id
  FROM trapper.sot_people p
  WHERE lower(p.first_name) = lower(v_sub.first_name)
    AND lower(p.last_name) = lower(v_sub.last_name)
  LIMIT 1;

  IF v_person_id IS NOT NULL THEN
    UPDATE trapper.web_intake_submissions
    SET matched_person_id = v_person_id
    WHERE submission_id = p_submission_id;
  END IF;

  RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

\echo ''
\echo 'MIG_196 complete!'
\echo ''
\echo 'Created:'
\echo '  - Type: trapper.intake_triage_category'
\echo '  - Table: trapper.web_intake_submissions'
\echo '  - Function: trapper.compute_intake_triage(submission_id)'
\echo '  - Trigger: auto-triages on INSERT'
\echo '  - View: trapper.v_intake_triage_queue'
\echo '  - Function: trapper.convert_intake_to_request(submission_id)'
\echo '  - Function: trapper.match_intake_to_person(submission_id)'
\echo ''
\echo 'Triage Categories:'
\echo '  - high_priority_tnr: 10+ unfixed cats, kittens, emergencies (score 60+)'
\echo '  - standard_tnr: Typical TNR 2-9 unfixed cats (score 25-59)'
\echo '  - wellness_only: All cats already fixed'
\echo '  - owned_cat_low: My own cat - redirect to low-cost resources'
\echo '  - out_of_county: Outside Sonoma County'
\echo '  - needs_review: Ambiguous situation'
\echo ''
\echo 'Scoring factors:'
\echo '  - Cat count: 1=5pts, 2-4=10pts, 5-9=25pts, 10+=40pts'
\echo '  - Fixed status: none=30pts, some=20pts, most=10pts, all=0pts'
\echo '  - Kittens: +35pts (newborn +15 extra)'
\echo '  - Emergency: +50pts'
\echo '  - Medical concerns: +20pts'
\echo '  - New situation (<1wk): +15pts'
