-- MIG_2968: Fix form option drift (FFS-692)
--
-- Remaps values stored by drifted inline options to canonical form-options.ts values.
-- TS changes must deploy BEFORE this migration — new code accepts both old and new values.
--
-- Affected columns in ops.requests (and intake_submissions where applicable):
--   mom_present, mom_fixed, kitten_age_estimate, kitten_assessment_status,
--   triage_category (final_category), county, kitten_behavior, death_cause,
--   awareness_duration, property_type (JSONB custom_fields)
--
-- Each UPDATE is idempotent: WHERE clause checks for old value only.

BEGIN;

-- ─── mom_present: yes→yes_present, no→not_seen, unsure→unknown ────────────
UPDATE ops.requests SET mom_present = 'yes_present' WHERE mom_present = 'yes';
UPDATE ops.requests SET mom_present = 'not_seen'    WHERE mom_present = 'no';
UPDATE ops.requests SET mom_present = 'unknown'     WHERE mom_present = 'unsure';

-- ─── mom_fixed: unsure→unknown ────────────────────────────────────────────
UPDATE ops.requests SET mom_fixed = 'unknown' WHERE mom_fixed = 'unsure';

-- ─── kitten_age_estimate: normalize to canonical coarse values ─────────────
-- Old intake-schema.ts values → canonical form-options.ts values
UPDATE ops.requests SET kitten_age_estimate = '4_8_weeks'   WHERE kitten_age_estimate = '4_to_8_weeks';
UPDATE ops.requests SET kitten_age_estimate = '8_12_weeks'  WHERE kitten_age_estimate = '8_to_12_weeks';
UPDATE ops.requests SET kitten_age_estimate = '12_16_weeks' WHERE kitten_age_estimate = '12_to_16_weeks';
UPDATE ops.requests SET kitten_age_estimate = 'mixed_ages'  WHERE kitten_age_estimate = 'mixed';

-- ─── kitten_assessment_status: not_needed→not_assessing ───────────────────
UPDATE ops.requests SET kitten_assessment_status = 'not_assessing' WHERE kitten_assessment_status = 'not_needed';

-- ─── kitten_behavior: shy_young→shy_hissy_young (inline queue/new drift) ──
UPDATE ops.requests SET kitten_behavior = 'shy_hissy_young' WHERE kitten_behavior = 'shy_young';

-- ─── triage_category (final_category): call-sheet drift → canonical ────────
UPDATE ops.requests SET triage_category = 'ffr'      WHERE triage_category = 'high_priority_tnr';
UPDATE ops.requests SET triage_category = 'ffr'      WHERE triage_category = 'standard_tnr';
UPDATE ops.requests SET triage_category = 'wellness'  WHERE triage_category = 'wellness_only';
UPDATE ops.requests SET triage_category = 'owned'     WHERE triage_category = 'owned_cat_low';
UPDATE ops.requests SET triage_category = 'out_of_area' WHERE triage_category = 'out_of_county';
UPDATE ops.requests SET triage_category = 'review'    WHERE triage_category = 'needs_review';

-- ─── county: normalize case ─────────────────────────────────────────────────
UPDATE ops.requests SET county = 'Sonoma'    WHERE county = 'sonoma';
UPDATE ops.requests SET county = 'Marin'     WHERE county = 'marin';
UPDATE ops.requests SET county = 'Napa'      WHERE county = 'napa';
UPDATE ops.requests SET county = 'Mendocino' WHERE county = 'mendocino';
UPDATE ops.requests SET county = 'Lake'      WHERE county = 'lake';
UPDATE ops.requests SET county = 'Other'     WHERE county = 'other' AND county != 'Other';

-- ─── death_cause: illness→disease, hit_by_car→vehicle (cat mortality) ──────
-- These may be in sot.cats or ops-level mortality records
UPDATE sot.cats SET death_cause = 'disease' WHERE death_cause = 'illness';
UPDATE sot.cats SET death_cause = 'vehicle' WHERE death_cause = 'hit_by_car';

-- ─── awareness_duration: legacy values → canonical ─────────────────────────
-- Only remap if old values like "under_1_week" etc. were ever stored
UPDATE ops.requests SET awareness_duration = 'days'   WHERE awareness_duration = 'under_1_week';
UPDATE ops.requests SET awareness_duration = 'weeks'  WHERE awareness_duration = '1_to_4_weeks';
UPDATE ops.requests SET awareness_duration = 'months' WHERE awareness_duration = '1_to_6_months';
UPDATE ops.requests SET awareness_duration = 'years'  WHERE awareness_duration = 'over_1_year';

-- ─── property_type in JSONB custom_fields: house→private_home, etc. ────────
-- Call-sheet stores property_type as a simple string in the property_type column
UPDATE ops.requests SET property_type = 'private_home' WHERE property_type = 'house';
UPDATE ops.requests SET property_type = 'apartment_complex' WHERE property_type = 'apartment';
UPDATE ops.requests SET property_type = 'business' WHERE property_type = 'Business';
UPDATE ops.requests SET property_type = 'rural_unincorporated' WHERE property_type = 'rural';

-- ─── Also remap in intake_submissions if they exist ────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ops' AND table_name = 'intake_submissions'
  ) THEN
    -- mom_present
    UPDATE ops.intake_submissions SET mom_present = 'yes_present' WHERE mom_present = 'yes';
    UPDATE ops.intake_submissions SET mom_present = 'not_seen'    WHERE mom_present = 'no';
    UPDATE ops.intake_submissions SET mom_present = 'unknown'     WHERE mom_present = 'unsure';
    -- mom_fixed
    UPDATE ops.intake_submissions SET mom_fixed = 'unknown' WHERE mom_fixed = 'unsure';
    -- kitten_age_estimate
    UPDATE ops.intake_submissions SET kitten_age_estimate = '4_8_weeks'   WHERE kitten_age_estimate = '4_to_8_weeks';
    UPDATE ops.intake_submissions SET kitten_age_estimate = '8_12_weeks'  WHERE kitten_age_estimate = '8_to_12_weeks';
    UPDATE ops.intake_submissions SET kitten_age_estimate = '12_16_weeks' WHERE kitten_age_estimate = '12_to_16_weeks';
    UPDATE ops.intake_submissions SET kitten_age_estimate = 'mixed_ages'  WHERE kitten_age_estimate = 'mixed';
    -- kitten_behavior
    UPDATE ops.intake_submissions SET kitten_behavior = 'shy_hissy_young' WHERE kitten_behavior = 'shy_young';
    -- county
    UPDATE ops.intake_submissions SET county = 'Sonoma' WHERE county = 'sonoma';
    UPDATE ops.intake_submissions SET county = 'Marin' WHERE county = 'marin';
    UPDATE ops.intake_submissions SET county = 'Napa' WHERE county = 'napa';
    UPDATE ops.intake_submissions SET county = 'Mendocino' WHERE county = 'mendocino';
    UPDATE ops.intake_submissions SET county = 'Lake' WHERE county = 'lake';
  END IF;
END $$;

COMMIT;
