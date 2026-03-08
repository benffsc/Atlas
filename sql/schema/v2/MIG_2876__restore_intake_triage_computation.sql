-- MIG_2876: Restore Intake Triage Computation
-- FFS-341: compute_intake_triage() function + trigger were never migrated from V1
--
-- Impact: ALL 1,257 intake submissions have NULL triage_score/triage_category
-- since V2 went live (Feb 14). Staff have been working without triage scoring.
--
-- V1 had:
--   trapper.compute_intake_triage(submission_id) — scoring function
--   trapper.trigger_auto_triage() — BEFORE INSERT trigger
-- Both dropped in MIG_2299 without V2 equivalents.
--
-- This migration recreates the function and trigger in ops schema,
-- combining all V1 scoring enhancements (MIG_196, 198, 269, 270).

\echo 'MIG_2876: Restoring intake triage computation...'

-- ============================================================================
-- 1. TRIAGE SCORING FUNCTION
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

    -- ====== KITTEN SCORING ======
    IF p_has_kittens THEN
        v_score := v_score + 35;
        v_reasons := v_reasons || jsonb_build_array('Kittens present');

        -- Kitten age granularity (MIG_198)
        IF p_kitten_age IN ('newborn', 'under_4_weeks') THEN
            v_score := v_score + 20;
            v_reasons := v_reasons || jsonb_build_array('Newborn/young kittens - urgent');
        ELSIF p_kitten_age IN ('eyes_open', '4_to_8_weeks') THEN
            v_score := v_score + 15;
        ELSIF p_kitten_age IN ('weaned', '8_to_12_weeks') THEN
            v_score := v_score + 10;
        ELSIF p_kitten_age = '12_to_16_weeks' THEN
            v_score := v_score + 5;
        ELSIF p_kitten_age = 'mixed' THEN
            v_score := v_score + 10;
            v_reasons := v_reasons || jsonb_build_array('Mixed age kittens');
        END IF;

        -- Kitten behavior (MIG_198)
        IF p_kitten_behavior = 'friendly' THEN
            v_score := v_score + 10;
            v_reasons := v_reasons || jsonb_build_array('Friendly kittens - foster potential');
        ELSIF p_kitten_behavior = 'shy_handleable' THEN
            v_score := v_score + 5;
        ELSIF p_kitten_behavior = 'feral_young' THEN
            v_score := v_score + 3;
        END IF;

        -- Kitten containment (MIG_198)
        IF p_kitten_contained = 'yes' THEN
            v_score := v_score + 5;
        ELSIF p_kitten_contained = 'some' THEN
            v_score := v_score + 2;
        END IF;

        -- Mom status (MIG_198)
        IF p_mom_present = 'yes' THEN
            IF p_mom_fixed = 'no' OR p_mom_fixed = 'unsure' THEN
                v_score := v_score + 10;
                v_reasons := v_reasons || jsonb_build_array('Mom present and unfixed');
            ELSE
                v_score := v_score + 5;
            END IF;
        END IF;

        -- Transport ease (MIG_198)
        IF p_can_bring_in = 'yes' THEN
            v_score := v_score + 5;
        ELSIF p_can_bring_in = 'need_help' THEN
            v_score := v_score + 2;
        END IF;
    END IF;

    -- ====== EMERGENCY ======
    IF p_is_emergency THEN
        v_score := v_score + 50;
        v_reasons := v_reasons || jsonb_build_array('Marked as emergency');
    END IF;

    -- ====== MEDICAL CONCERNS ======
    IF p_has_medical_concerns THEN
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

COMMENT ON FUNCTION ops.compute_intake_triage IS
'Compute triage score and category for an intake submission.
Combines all V1 scoring: base (MIG_196), kitten details (MIG_198),
third-party reports (MIG_269), feeding behavior (MIG_270).
Returns: category, score (0-200), reasons (JSONB array of strings).';

-- ============================================================================
-- 2. TRIGGER FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION ops.trigger_auto_triage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_triage RECORD;
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

    -- Only auto-set status to triaged on INSERT, not UPDATE
    IF TG_OP = 'INSERT' AND NEW.status = 'new' THEN
        NEW.status := 'triaged';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ops.trigger_auto_triage IS
'Trigger function: auto-compute triage score on intake submission insert/update.
Skips if priority_override is set (manual override by staff).';

-- ============================================================================
-- 3. CREATE TRIGGER
-- ============================================================================

DROP TRIGGER IF EXISTS trg_auto_triage_intake ON ops.intake_submissions;
CREATE TRIGGER trg_auto_triage_intake
    BEFORE INSERT OR UPDATE ON ops.intake_submissions
    FOR EACH ROW
    EXECUTE FUNCTION ops.trigger_auto_triage();

\echo 'Created ops.compute_intake_triage() and trigger on ops.intake_submissions'

-- ============================================================================
-- 4. BACKFILL ALL EXISTING SUBMISSIONS
-- ============================================================================

\echo 'Backfilling triage scores for all existing submissions...'

-- Touch every row to fire the trigger
UPDATE ops.intake_submissions
SET triage_computed_at = NULL
WHERE triage_score IS NULL;

\echo 'MIG_2876: Triage computation restored and backfilled'

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_total INT;
    v_scored INT;
    v_pct NUMERIC;
BEGIN
    SELECT COUNT(*), COUNT(triage_score)
    INTO v_total, v_scored
    FROM ops.intake_submissions;

    v_pct := ROUND(v_scored::NUMERIC / GREATEST(v_total, 1) * 100, 1);
    RAISE NOTICE 'Triage backfill: % / % submissions scored', v_scored, v_total;

    IF v_scored < v_total * 0.95 THEN
        RAISE WARNING 'Less than 95%% of submissions scored — investigate';
    END IF;
END $$;

SELECT triage_category, COUNT(*) AS cnt
FROM ops.intake_submissions
GROUP BY triage_category
ORDER BY cnt DESC;
