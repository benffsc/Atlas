-- MIG_2945: Kitten Priority Scoring System
-- FFS-559: Dedicated kitten assessment queue prioritizer
--
-- Context: During kitten season, FFSC receives far more kitten cases than staff
-- can assess in person. This extracts kitten scoring from the flat +35 bonus in
-- compute_intake_triage() into a dedicated 0-100 scoring function so staff can
-- sort kitten cases against each other independently.
--
-- Scoring weights calibrated against ASPCA FSA, Alley Cat Allies age-based
-- decision trees, Modified Feline Apgar (neonatal), and Kitten Lady milestones.

\echo 'MIG_2945: Creating kitten priority scoring system...'

-- ============================================================================
-- 1a. NEW COLUMNS ON ops.intake_submissions
-- ============================================================================

ALTER TABLE ops.intake_submissions
  ADD COLUMN IF NOT EXISTS kitten_priority_score INT,
  ADD COLUMN IF NOT EXISTS kitten_assessment_outcome TEXT,
  ADD COLUMN IF NOT EXISTS kitten_assessed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kitten_redirect_destination TEXT;

\echo 'Added kitten priority columns to ops.intake_submissions'

-- ============================================================================
-- 1b. NEW FUNCTION: ops.compute_kitten_priority()
-- ============================================================================

CREATE OR REPLACE FUNCTION ops.compute_kitten_priority(
    p_kitten_age TEXT,
    p_kitten_behavior TEXT,
    p_kitten_contained TEXT,
    p_mom_present TEXT,
    p_mom_fixed TEXT,
    p_can_bring_in TEXT,
    p_kitten_count INT DEFAULT NULL,
    p_has_medical_concerns BOOLEAN DEFAULT FALSE
) RETURNS TABLE(score INT, reasons JSONB)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_score INT := 0;
    v_reasons JSONB := '[]'::jsonb;
    v_age_score INT := 0;
    v_behavior_score INT := 0;
    v_mom_score INT := 0;
    v_medical_score INT := 0;
    v_containment_score INT := 0;
    v_count_score INT := 0;
    v_is_young BOOLEAN := FALSE;
BEGIN
    -- ====== AGE VULNERABILITY (max 30) ======
    -- Prioritizes cases where delay = highest risk of loss
    IF p_kitten_age IN ('newborn', 'under_4_weeks', '2_3_weeks') THEN
        v_age_score := 30;
        v_is_young := TRUE;
        v_reasons := v_reasons || jsonb_build_array('Neonatal/under 4 weeks - critical care window');
    ELSIF p_kitten_age IN ('4_to_8_weeks', '4_5_weeks', '6_8_weeks', '4_8_weeks') THEN
        v_age_score := 20;
        v_is_young := TRUE;
        v_reasons := v_reasons || jsonb_build_array('4-8 weeks - peak socialization window');
    ELSIF p_kitten_age IN ('8_to_12_weeks', '8_12_weeks', 'weaned') THEN
        v_age_score := 12;
        v_reasons := v_reasons || jsonb_build_array('8-12 weeks - adoptable age');
    ELSIF p_kitten_age IN ('12_to_16_weeks', 'over_12_weeks') THEN
        v_age_score := 5;
    ELSIF p_kitten_age IN ('over_16_weeks') THEN
        v_age_score := 2;
    ELSIF p_kitten_age IN ('mixed', 'mixed_ages') THEN
        v_age_score := 15;
        v_is_young := TRUE;
        v_reasons := v_reasons || jsonb_build_array('Mixed ages - youngest may need urgent care');
    ELSE
        -- unknown or NULL
        v_age_score := 10;
    END IF;
    v_score := v_score + v_age_score;

    -- ====== SOCIALIZATION POTENTIAL (max 20) ======
    -- Friendly kittens = highest foster value, feral = still saveable if young
    IF p_kitten_behavior IN ('friendly', 'friendly_handleable') THEN
        v_behavior_score := 20;
        v_reasons := v_reasons || jsonb_build_array('Friendly/handleable - high foster potential');
    ELSIF p_kitten_behavior IN ('shy', 'shy_can_pick_up', 'shy_handleable') THEN
        v_behavior_score := 15;
        v_reasons := v_reasons || jsonb_build_array('Shy but handleable - socializable');
    ELSIF p_kitten_behavior IN ('feral', 'shy_hissy_young', 'feral_young') THEN
        v_behavior_score := 10;
        v_reasons := v_reasons || jsonb_build_array('Feral/hissy young - may be socializable');
    ELSIF p_kitten_behavior IN ('unhandleable_older') THEN
        v_behavior_score := 3;
    ELSE
        -- unknown, mixed, or NULL
        v_behavior_score := 8;
    END IF;
    v_score := v_score + v_behavior_score;

    -- ====== MOM STATUS (max 20) ======
    -- Absent mom + young kittens = bottle baby risk (highest urgency)
    IF p_mom_present IN ('not_seen', 'no') THEN
        IF v_is_young THEN
            v_mom_score := 20;
            v_reasons := v_reasons || jsonb_build_array('Mom absent + young kittens - possible bottle babies');
        ELSE
            v_mom_score := 12;
            v_reasons := v_reasons || jsonb_build_array('Mom absent');
        END IF;
    ELSIF p_mom_present IN ('comes_goes') THEN
        IF v_is_young THEN
            v_mom_score := 15;
            v_reasons := v_reasons || jsonb_build_array('Mom comes and goes - young kittens at risk');
        ELSE
            v_mom_score := 8;
        END IF;
    ELSIF p_mom_present IN ('yes', 'yes_present') THEN
        IF p_mom_fixed = 'no' OR p_mom_fixed = 'unknown' THEN
            v_mom_score := 10;
            v_reasons := v_reasons || jsonb_build_array('Mom present but unfixed - TNR needed');
        ELSE
            v_mom_score := 5;
        END IF;
    ELSE
        -- unknown or NULL
        v_mom_score := 8;
    END IF;
    v_score := v_score + v_mom_score;

    -- ====== MEDICAL / URGENCY (max 15) ======
    IF COALESCE(p_has_medical_concerns, FALSE) THEN
        v_medical_score := 15;
        v_reasons := v_reasons || jsonb_build_array('Medical concerns reported');
    END IF;
    v_score := v_score + v_medical_score;

    -- ====== CONTAINMENT / TRANSPORT (max 10) ======
    -- Contained + can bring in = easiest to act on quickly
    IF p_kitten_contained = 'yes' AND p_can_bring_in = 'yes' THEN
        v_containment_score := 10;
        v_reasons := v_reasons || jsonb_build_array('Contained and can bring in');
    ELSIF p_kitten_contained = 'yes' THEN
        v_containment_score := 7;
    ELSIF p_kitten_contained = 'some' AND p_can_bring_in = 'yes' THEN
        v_containment_score := 6;
    ELSIF p_can_bring_in = 'yes' THEN
        v_containment_score := 5;
    ELSIF p_can_bring_in = 'need_help' THEN
        v_containment_score := 3;
    ELSE
        v_containment_score := 0;
    END IF;
    v_score := v_score + v_containment_score;

    -- ====== COUNT BONUS (max 5) ======
    IF COALESCE(p_kitten_count, 0) >= 5 THEN
        v_count_score := 5;
        v_reasons := v_reasons || jsonb_build_array('5+ kittens - large litter');
    ELSIF COALESCE(p_kitten_count, 0) >= 3 THEN
        v_count_score := 3;
    ELSIF COALESCE(p_kitten_count, 0) >= 2 THEN
        v_count_score := 1;
    END IF;
    v_score := v_score + v_count_score;

    -- Clamp to 0-100
    v_score := GREATEST(0, LEAST(100, v_score));

    RETURN QUERY SELECT v_score, v_reasons;
END;
$$;

COMMENT ON FUNCTION ops.compute_kitten_priority IS
'Compute kitten priority score (0-100) for queue prioritization.
This is a queue prioritizer, NOT a decision tool — the actual take-in vs TNR
decision is made on the spot during in-person assessment.
Factors: age vulnerability (30), socialization potential (20), mom status (20),
medical urgency (15), containment/transport (10), count bonus (5).
FFS-559.';

\echo 'Created ops.compute_kitten_priority()'

-- ============================================================================
-- 1c. UPDATE compute_intake_triage() — replace flat kitten block
-- ============================================================================

CREATE OR REPLACE FUNCTION ops.compute_intake_triage(
    p_ownership_status TEXT,
    p_cat_count INT,
    p_fixed_status TEXT,
    p_has_kittens BOOLEAN,
    p_kitten_age TEXT,
    p_kitten_behavior TEXT,
    p_kitten_contained TEXT,
    p_mom_present TEXT,
    p_mom_fixed TEXT,
    p_can_bring_in TEXT,
    p_is_emergency BOOLEAN,
    p_has_medical_concerns BOOLEAN,
    p_awareness_duration TEXT,
    p_has_property_access BOOLEAN,
    p_is_property_owner BOOLEAN,
    p_county TEXT,
    p_is_third_party BOOLEAN,
    p_feeds_cat BOOLEAN,
    p_feeding_frequency TEXT,
    p_feeding_duration TEXT
) RETURNS TABLE(category TEXT, score INT, reasons JSONB)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_score INT := 0;
    v_reasons JSONB := '[]'::jsonb;
    v_category TEXT := 'needs_review';
    v_kitten_score INT;
    v_kitten_reasons JSONB;
BEGIN
    -- ====== OUT OF COUNTY CHECK ======
    IF p_county IS NOT NULL AND LOWER(p_county) NOT LIKE '%sonoma%' THEN
        RETURN QUERY SELECT 'out_of_county'::TEXT, 0, jsonb_build_array('Outside Sonoma County service area');
        RETURN;
    END IF;

    -- ====== OWNED CAT CHECK ======
    IF p_ownership_status = 'my_cat' THEN
        v_score := 5;
        v_reasons := v_reasons || jsonb_build_array('Owned pet - redirect to low-cost resources');
        IF p_is_emergency THEN
            v_score := v_score + 50;
            v_reasons := v_reasons || jsonb_build_array('Marked as emergency');
        END IF;
        RETURN QUERY SELECT 'owned_cat_low'::TEXT, v_score, v_reasons;
        RETURN;
    END IF;

    -- ====== ALL FIXED CHECK ======
    IF p_fixed_status = 'all_fixed' THEN
        RETURN QUERY SELECT 'wellness_only'::TEXT, 5, jsonb_build_array('All cats already fixed - wellness services only');
        RETURN;
    END IF;

    -- ====== CAT COUNT SCORING ======
    IF p_cat_count >= 10 THEN
        v_score := v_score + 40;
        v_reasons := v_reasons || jsonb_build_array('Large colony (10+ cats)');
    ELSIF p_cat_count >= 5 THEN
        v_score := v_score + 25;
        v_reasons := v_reasons || jsonb_build_array('Medium colony (5-9 cats)');
    ELSIF p_cat_count >= 2 THEN
        v_score := v_score + 10;
        v_reasons := v_reasons || jsonb_build_array('Multiple cats');
    ELSE
        v_score := v_score + 5;
    END IF;

    -- ====== FIXED STATUS SCORING ======
    IF p_fixed_status = 'none_fixed' THEN
        v_score := v_score + 30;
        v_reasons := v_reasons || jsonb_build_array('No cats fixed - full TNR needed');
    ELSIF p_fixed_status = 'some_fixed' THEN
        v_score := v_score + 20;
        v_reasons := v_reasons || jsonb_build_array('Some cats need fixing');
    ELSIF p_fixed_status = 'most_fixed' THEN
        v_score := v_score + 10;
    ELSIF p_fixed_status = 'unknown' THEN
        v_score := v_score + 15;
    END IF;

    -- ====== KITTEN SCORING (via dedicated function) ======
    IF p_has_kittens THEN
        SELECT kp.score, kp.reasons INTO v_kitten_score, v_kitten_reasons
        FROM ops.compute_kitten_priority(
            p_kitten_age, p_kitten_behavior, p_kitten_contained,
            p_mom_present, p_mom_fixed, p_can_bring_in,
            NULL, p_has_medical_concerns
        ) kp;

        -- Cap contribution to overall triage at 55
        v_score := v_score + LEAST(v_kitten_score, 55);
        v_reasons := v_reasons || v_kitten_reasons;
    END IF;

    -- ====== EMERGENCY ======
    IF p_is_emergency THEN
        v_score := v_score + 50;
        v_reasons := v_reasons || jsonb_build_array('Marked as emergency');
    END IF;

    -- ====== MEDICAL CONCERNS ======
    -- Only add medical bonus if NOT already counted via kitten scoring
    IF p_has_medical_concerns AND NOT COALESCE(p_has_kittens, FALSE) THEN
        v_score := v_score + 20;
        v_reasons := v_reasons || jsonb_build_array('Medical concerns noted');
    END IF;

    -- ====== AWARENESS DURATION ======
    IF p_awareness_duration = 'less_than_week' THEN
        v_score := v_score + 15;
        v_reasons := v_reasons || jsonb_build_array('Recently noticed - may be new colony');
    ELSIF p_awareness_duration = 'less_than_month' THEN
        v_score := v_score + 10;
    ELSIF p_awareness_duration = 'over_year' THEN
        v_score := v_score + 0;
    END IF;

    -- ====== FEEDING BEHAVIOR (MIG_270) ======
    IF p_feeds_cat = TRUE THEN
        IF p_feeding_frequency = 'daily' THEN
            v_score := v_score + 5;
            v_reasons := v_reasons || jsonb_build_array('Active caretaker (daily feeding)');
        ELSIF p_feeding_frequency IN ('few_times_week', 'occasionally') THEN
            v_score := v_score + 3;
        END IF;
        IF p_feeding_duration = 'over_year' THEN
            v_reasons := v_reasons || jsonb_build_array('Established colony (feeding 1+ years)');
        END IF;
    ELSIF p_feeds_cat = FALSE THEN
        v_score := v_score + 5;
        v_reasons := v_reasons || jsonb_build_array('Unfed cat - may need immediate TNR');
    END IF;

    -- ====== PROPERTY ACCESS ======
    IF p_is_property_owner AND p_has_property_access THEN
        v_score := v_score + 5;
    ELSIF p_has_property_access = FALSE THEN
        v_score := v_score - 5;
        v_reasons := v_reasons || jsonb_build_array('Access may be difficult');
    END IF;

    -- ====== THIRD-PARTY REPORT (MIG_269) ======
    IF p_is_third_party THEN
        v_reasons := v_reasons || jsonb_build_array('Third-party report - need to contact property owner');
    END IF;

    -- ====== DETERMINE CATEGORY ======
    IF p_is_third_party AND p_ownership_status IS DISTINCT FROM 'community_cat' THEN
        v_category := 'needs_review';
    ELSIF p_ownership_status = 'unsure' THEN
        v_category := 'needs_review';
    ELSIF v_score >= 60 THEN
        v_category := 'high_priority_tnr';
    ELSIF v_score >= 25 THEN
        v_category := 'standard_tnr';
    ELSE
        v_category := 'needs_review';
    END IF;

    RETURN QUERY SELECT v_category, v_score, v_reasons;
END;
$$;

\echo 'Updated ops.compute_intake_triage() to use compute_kitten_priority()'

-- ============================================================================
-- 1d. UPDATE v_intake_triage_queue VIEW
-- ============================================================================

DROP VIEW IF EXISTS ops.v_intake_triage_queue;

CREATE VIEW ops.v_intake_triage_queue AS
SELECT
  submission_id,
  submitted_at,
  COALESCE(NULLIF(TRIM(concat(first_name, ' ', last_name)), ''), email) AS submitter_name,
  first_name,
  last_name,
  email,
  phone,
  cats_address,
  cats_city,
  cats_zip,
  ownership_status,
  cat_count_estimate,
  fixed_status,
  has_kittens,
  kitten_count,
  has_medical_concerns,
  is_emergency,
  situation_description,
  call_type,
  cat_name,
  cat_description,
  feeding_situation,
  triage_category,
  triage_score,
  triage_reasons,
  -- Kitten priority scoring (FFS-559)
  kitten_priority_score,
  kitten_assessment_outcome,
  kitten_assessed_at,
  kitten_redirect_destination,
  -- Use submission_status column directly, fall back to mapping from status
  COALESCE(
    submission_status,
    CASE status
      WHEN 'new' THEN 'new'
      WHEN 'triaged' THEN 'in_progress'
      WHEN 'reviewed' THEN 'in_progress'
      WHEN 'request_created' THEN 'complete'
      WHEN 'redirected' THEN 'complete'
      WHEN 'closed' THEN 'complete'
      ELSE 'new'
    END
  ) AS submission_status,
  NULL::timestamptz AS appointment_date,
  priority_override,
  status AS native_status,
  final_category,
  request_id AS created_request_id,
  CASE
    WHEN submitted_at >= now() - interval '24 hours' THEN '< 1 day'
    WHEN submitted_at >= now() - interval '7 days' THEN '1-7 days'
    WHEN submitted_at >= now() - interval '30 days' THEN '1-4 weeks'
    WHEN submitted_at >= now() - interval '90 days' THEN '1-3 months'
    ELSE '> 3 months'
  END AS age,
  submitted_at < now() - interval '7 days' AND status IN ('new', 'triaged') AS overdue,
  migrated_at IS NOT NULL AND source_raw_id IS NOT NULL AS is_legacy,
  NULL::text AS legacy_status,
  NULL::text AS legacy_submission_status,
  NULL::timestamptz AS legacy_appointment_date,
  NULL::text AS legacy_notes,
  source_raw_id::text AS legacy_source_id,
  review_notes,
  person_id AS matched_person_id,
  COALESCE(intake_source, CASE WHEN migrated_at IS NOT NULL THEN 'airtable' ELSE 'web_intake' END) AS intake_source,
  geo_formatted_address,
  geo_latitude,
  geo_longitude,
  geo_confidence,
  last_contacted_at,
  last_contact_method,
  COALESCE(contact_attempt_count, 0) AS contact_attempt_count,
  COALESCE(is_test, false) AS is_test,
  created_at,
  place_id,
  person_id,
  request_id,
  is_third_party_report,
  third_party_relationship,
  property_owner_name,
  property_owner_phone,
  property_owner_email,
  -- MIG_2531/2532 fields for request conversion
  county,
  peak_count,
  awareness_duration,
  medical_description,
  feeding_location,
  feeding_time,
  dogs_on_site,
  trap_savvy,
  previous_tnr,
  kitten_age_estimate,
  kitten_behavior,
  has_property_access,
  access_notes,
  handleability
FROM ops.intake_submissions w
WHERE COALESCE(submission_status, 'new') NOT IN ('archived', 'closed');

\echo 'Updated ops.v_intake_triage_queue with kitten priority columns'

-- ============================================================================
-- 1e. UPDATE TRIGGER to populate kitten_priority_score
-- ============================================================================

CREATE OR REPLACE FUNCTION ops.trigger_auto_triage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_triage RECORD;
    v_kitten RECORD;
BEGIN
    -- Skip if triage already manually set (priority_override or already triaged)
    IF NEW.priority_override IS NOT NULL THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_triage FROM ops.compute_intake_triage(
        NEW.ownership_status,
        COALESCE(NEW.cat_count_estimate, 1),
        NEW.fixed_status,
        COALESCE(NEW.has_kittens, FALSE),
        NEW.kitten_age_estimate,
        NEW.kitten_behavior,
        NEW.kitten_contained,
        NEW.mom_present,
        NEW.mom_fixed,
        NEW.can_bring_in,
        COALESCE(NEW.is_emergency, FALSE),
        COALESCE(NEW.has_medical_concerns, FALSE),
        NEW.awareness_duration,
        NEW.has_property_access,
        COALESCE(NEW.is_property_owner, FALSE),
        NEW.county,
        COALESCE(NEW.is_third_party_report, FALSE),
        NEW.feeds_cat,
        NEW.feeding_frequency,
        NEW.feeding_duration
    );

    NEW.triage_category := v_triage.category;
    NEW.triage_score := v_triage.score;
    NEW.triage_reasons := v_triage.reasons;
    NEW.triage_computed_at := NOW();

    -- Compute kitten priority score independently (FFS-559)
    IF COALESCE(NEW.has_kittens, FALSE) THEN
        SELECT * INTO v_kitten FROM ops.compute_kitten_priority(
            NEW.kitten_age_estimate,
            NEW.kitten_behavior,
            NEW.kitten_contained,
            NEW.mom_present,
            NEW.mom_fixed,
            NEW.can_bring_in,
            NEW.kitten_count,
            COALESCE(NEW.has_medical_concerns, FALSE)
        );
        NEW.kitten_priority_score := v_kitten.score;
    ELSE
        NEW.kitten_priority_score := NULL;
    END IF;

    -- Only auto-set status to triaged on INSERT, not UPDATE
    IF TG_OP = 'INSERT' AND NEW.status = 'new' THEN
        NEW.status := 'triaged';
    END IF;

    RETURN NEW;
END;
$$;

\echo 'Updated ops.trigger_auto_triage() with kitten priority scoring'

-- ============================================================================
-- 1f. BACKFILL existing submissions
-- ============================================================================

\echo 'Backfilling kitten_priority_score for existing kitten submissions...'

UPDATE ops.intake_submissions s
SET kitten_priority_score = kp.score
FROM (
    SELECT
        sub.submission_id,
        (ops.compute_kitten_priority(
            sub.kitten_age_estimate,
            sub.kitten_behavior,
            sub.kitten_contained,
            sub.mom_present,
            sub.mom_fixed,
            sub.can_bring_in,
            sub.kitten_count,
            COALESCE(sub.has_medical_concerns, FALSE)
        )).score AS score
    FROM ops.intake_submissions sub
    WHERE sub.has_kittens = TRUE
      AND sub.kitten_priority_score IS NULL
) kp
WHERE s.submission_id = kp.submission_id;

-- Also re-trigger triage to update scores with new kitten logic
UPDATE ops.intake_submissions
SET triage_computed_at = NULL
WHERE has_kittens = TRUE;

\echo 'MIG_2945: Kitten priority scoring system complete'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_kitten_total INT;
    v_kitten_scored INT;
BEGIN
    SELECT COUNT(*), COUNT(kitten_priority_score)
    INTO v_kitten_total, v_kitten_scored
    FROM ops.intake_submissions
    WHERE has_kittens = TRUE;

    RAISE NOTICE 'Kitten backfill: % / % kitten submissions scored', v_kitten_scored, v_kitten_total;
END $$;

-- Show score distribution
SELECT
    CASE
        WHEN kitten_priority_score >= 70 THEN 'high (70-100)'
        WHEN kitten_priority_score >= 40 THEN 'medium (40-69)'
        WHEN kitten_priority_score >= 1 THEN 'low (1-39)'
        ELSE 'none'
    END AS priority_tier,
    COUNT(*) AS cnt,
    ROUND(AVG(kitten_priority_score)) AS avg_score
FROM ops.intake_submissions
WHERE has_kittens = TRUE
GROUP BY 1
ORDER BY 1;
