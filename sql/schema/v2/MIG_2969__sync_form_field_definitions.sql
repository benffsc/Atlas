-- MIG_2969: Sync ops.form_field_definitions options with canonical form-options.ts (FFS-692)
--
-- Updates the JSONB options stored in ops.form_field_definitions to use
-- snake_case values matching the centralized form-options.ts registry.
-- This ensures the DB-level option definitions match the TS source of truth.

BEGIN;

-- Only proceed if the table exists (created by FFS-402/FFS-445)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ops' AND table_name = 'form_field_definitions'
  ) THEN
    RAISE NOTICE 'ops.form_field_definitions does not exist, skipping sync';
    RETURN;
  END IF;

  -- mom_present: update options to canonical values
  UPDATE ops.form_field_definitions
  SET options = '[
    {"value": "yes_present", "label": "Yes, mom is present"},
    {"value": "comes_goes", "label": "Comes and goes"},
    {"value": "not_seen", "label": "Haven''t seen mom"},
    {"value": "unknown", "label": "Unknown"}
  ]'::jsonb
  WHERE field_key = 'mom_present';

  -- mom_fixed: update options (unsure→unknown)
  UPDATE ops.form_field_definitions
  SET options = '[
    {"value": "yes", "label": "Yes (ear-tipped)"},
    {"value": "no", "label": "No / Don''t think so"},
    {"value": "unknown", "label": "Unknown"}
  ]'::jsonb
  WHERE field_key = 'mom_fixed';

  -- kitten_age_estimate: update to coarse canonical values
  UPDATE ops.form_field_definitions
  SET options = '[
    {"value": "under_4_weeks", "label": "Under 4 weeks (bottle babies)"},
    {"value": "4_8_weeks", "label": "4-8 weeks (weaning)"},
    {"value": "8_12_weeks", "label": "8-12 weeks (ideal foster)"},
    {"value": "12_16_weeks", "label": "12-16 weeks (socialization critical)"},
    {"value": "over_16_weeks", "label": "Over 16 weeks / 4+ months"},
    {"value": "mixed_ages", "label": "Mixed ages"},
    {"value": "unknown", "label": "Unknown / Not sure"}
  ]'::jsonb
  WHERE field_key = 'kitten_age_estimate';

  -- kitten_assessment_status: update to canonical values
  UPDATE ops.form_field_definitions
  SET options = '[
    {"value": "pending", "label": "Pending Assessment"},
    {"value": "assessed", "label": "Assessed"},
    {"value": "follow_up", "label": "Needs Follow-up"},
    {"value": "not_assessing", "label": "Not Assessing"},
    {"value": "placed", "label": "Placed in foster"}
  ]'::jsonb
  WHERE field_key = 'kitten_assessment_status';

  -- triage_category: update to canonical values
  UPDATE ops.form_field_definitions
  SET options = '[
    {"value": "ffr", "label": "FFR"},
    {"value": "wellness", "label": "Wellness"},
    {"value": "owned", "label": "Owned"},
    {"value": "out_of_area", "label": "Out of Area"},
    {"value": "review", "label": "Review"}
  ]'::jsonb
  WHERE field_key IN ('triage_category', 'final_category');

  -- priority: add urgent to options
  UPDATE ops.form_field_definitions
  SET options = '[
    {"value": "urgent", "label": "Urgent"},
    {"value": "high", "label": "High"},
    {"value": "normal", "label": "Normal"},
    {"value": "low", "label": "Low"}
  ]'::jsonb
  WHERE field_key = 'priority';

END $$;

COMMIT;
