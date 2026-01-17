\echo '=== MIG_236: Intake Feeding Behavior Fields ==='
\echo 'Adding feeding behavior questions to better understand cat care relationships'

-- Add feeding behavior columns to web_intake_submissions
ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS feeds_cat BOOLEAN,
ADD COLUMN IF NOT EXISTS feeding_frequency TEXT,
ADD COLUMN IF NOT EXISTS feeding_duration TEXT,
ADD COLUMN IF NOT EXISTS cat_comes_inside TEXT;

COMMENT ON COLUMN trapper.web_intake_submissions.feeds_cat IS 'Does the submitter feed this cat?';
COMMENT ON COLUMN trapper.web_intake_submissions.feeding_frequency IS 'How often: daily, few_times_week, occasionally, rarely, never';
COMMENT ON COLUMN trapper.web_intake_submissions.feeding_duration IS 'How long feeding: just_started, few_weeks, few_months, over_year';
COMMENT ON COLUMN trapper.web_intake_submissions.cat_comes_inside IS 'Does cat come inside: yes_regularly, sometimes, never';

-- Add emergency acknowledgment tracking
ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS emergency_acknowledged BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS emergency_acknowledged_at TIMESTAMPTZ;

COMMENT ON COLUMN trapper.web_intake_submissions.emergency_acknowledged IS 'User acknowledged emergency disclaimer (not a 24hr hospital)';
COMMENT ON COLUMN trapper.web_intake_submissions.emergency_acknowledged_at IS 'When user acknowledged emergency disclaimer';

-- Update the triage scoring to consider feeding behavior
-- Feeding behavior can indicate care level which affects priority
CREATE OR REPLACE FUNCTION trapper.compute_intake_triage_with_feeding(
    p_ownership_status TEXT,
    p_cat_count INT,
    p_fixed_status TEXT,
    p_has_kittens BOOLEAN,
    p_kitten_age TEXT,
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
) RETURNS TABLE(category TEXT, score INT, reasons JSONB) AS $$
DECLARE
    v_score INT := 0;
    v_reasons JSONB := '[]'::jsonb;
    v_category TEXT := 'needs_review';
BEGIN
    -- Base scoring from existing logic
    -- Cat count scoring
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

    -- Fixed status scoring
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

    -- Kitten presence
    IF p_has_kittens THEN
        v_score := v_score + 35;
        v_reasons := v_reasons || jsonb_build_array('Kittens present');
        IF p_kitten_age IN ('newborn', 'under_4_weeks') THEN
            v_score := v_score + 15;
            v_reasons := v_reasons || jsonb_build_array('Newborn/young kittens - urgent');
        END IF;
    END IF;

    -- Emergency
    IF p_is_emergency THEN
        v_score := v_score + 50;
        v_reasons := v_reasons || jsonb_build_array('Marked as emergency');
    END IF;

    -- Medical concerns
    IF p_has_medical_concerns THEN
        v_score := v_score + 20;
        v_reasons := v_reasons || jsonb_build_array('Medical concerns noted');
    END IF;

    -- Feeding behavior scoring (NEW)
    -- Regular feeding indicates established colony with caretaker - good TNR candidate
    IF p_feeds_cat = TRUE THEN
        IF p_feeding_frequency = 'daily' THEN
            v_score := v_score + 5;
            v_reasons := v_reasons || jsonb_build_array('Active caretaker (daily feeding)');
        ELSIF p_feeding_frequency IN ('few_times_week', 'occasionally') THEN
            v_score := v_score + 3;
        END IF;

        -- Long-term feeding indicates established colony
        IF p_feeding_duration = 'over_year' THEN
            v_reasons := v_reasons || jsonb_build_array('Established colony (feeding 1+ years)');
        END IF;
    ELSE
        -- Not feeding may indicate true stray needing more attention
        v_score := v_score + 5;
        v_reasons := v_reasons || jsonb_build_array('Unfed cat - may need immediate TNR');
    END IF;

    -- Access
    IF p_is_property_owner AND p_has_property_access THEN
        v_score := v_score + 5;
    ELSIF NOT p_has_property_access THEN
        v_score := v_score - 5;
        v_reasons := v_reasons || jsonb_build_array('Access may be difficult');
    END IF;

    -- Determine category
    IF p_county IS NOT NULL AND LOWER(p_county) NOT LIKE '%sonoma%' THEN
        v_category := 'out_of_county';
        v_reasons := v_reasons || jsonb_build_array('Outside Sonoma County service area');
    ELSIF p_ownership_status = 'my_cat' THEN
        v_category := 'owned_cat_low';
        v_reasons := v_reasons || jsonb_build_array('Owned pet - redirect to low-cost resources');
    ELSIF p_is_third_party THEN
        v_category := 'needs_review';
        v_reasons := v_reasons || jsonb_build_array('Third-party report - needs verification');
    ELSIF p_fixed_status = 'all_fixed' THEN
        v_category := 'wellness_only';
        v_reasons := v_reasons || jsonb_build_array('All cats already fixed - wellness services only');
    ELSIF v_score >= 60 THEN
        v_category := 'high_priority_tnr';
    ELSIF v_score >= 25 THEN
        v_category := 'standard_tnr';
    ELSE
        v_category := 'needs_review';
    END IF;

    RETURN QUERY SELECT v_category, v_score, v_reasons;
END;
$$ LANGUAGE plpgsql;

\echo 'MIG_236 complete: Added feeding behavior fields and updated triage scoring'
