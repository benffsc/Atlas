-- MIG_3128: Config-driven survey templates
--
-- Surveys are defined as templates with questions stored as JSONB.
-- Each question has a type, options, and a field mapping that tells
-- the survey submission handler which profile column to write to.
--
-- This replaces the hardcoded survey page and supports:
-- - Multiple survey types (trapper, foster, caretaker, custom)
-- - Admin-editable questions without code deploys
-- - White-label: each Beacon deployment customizes their own surveys
-- - Conditional questions (show_if logic)
-- - Helix-extractable (kernel layer, org-agnostic)

BEGIN;

CREATE TABLE IF NOT EXISTS ops.survey_templates (
  template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT,
  thank_you_title TEXT DEFAULT 'Thank you!',
  thank_you_message TEXT DEFAULT 'Your response has been recorded.',
  target_entity TEXT NOT NULL DEFAULT 'trapper_profile',
  questions JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT survey_templates_target_check
    CHECK (target_entity IN ('trapper_profile', 'foster_profile', 'volunteer_profile', 'custom'))
);

COMMENT ON TABLE ops.survey_templates IS 'Config-driven survey definitions. Questions are JSONB arrays rendered by the generic survey page.';
COMMENT ON COLUMN ops.survey_templates.slug IS 'URL-safe identifier used in survey links and API lookups';
COMMENT ON COLUMN ops.survey_templates.target_entity IS 'Which entity type the survey writes to — determines field mapping targets';
COMMENT ON COLUMN ops.survey_templates.questions IS 'Ordered array of question objects: { id, type, label, description?, required?, options?, maps_to?, show_if? }';

-- Seed: Trapper Capabilities Survey (current hardcoded questions → config)
INSERT INTO ops.survey_templates (slug, title, subtitle, target_entity, thank_you_title, thank_you_message, questions)
VALUES (
  'trapper_capabilities',
  'Trapper Capabilities Survey',
  'Help us understand how you can help!',
  'trapper_profile',
  'Thank you, {{first_name}}!',
  'Your trapper profile has been updated. We''ll use this info to match you with trapping opportunities in your area.',
  '[
    {
      "id": "capabilities",
      "type": "checkbox",
      "label": "What can you help with?",
      "required": true,
      "maps_to": "capabilities",
      "options": [
        { "value": "trapping", "label": "Trapping", "description": "Set traps, handle cats, transport to clinic" },
        { "value": "transport", "label": "Transport", "description": "Pick up/drop off trapped cats" },
        { "value": "recon", "label": "Recon / Scouting", "description": "Scout locations, count cats, report back" },
        { "value": "colony_care", "label": "Colony Care", "description": "Ongoing feeding, monitoring, newcomer detection" },
        { "value": "mentoring", "label": "Mentoring", "description": "Shadow new trappers, teach field skills" }
      ]
    },
    {
      "id": "availability_days",
      "type": "day_picker",
      "label": "Days you are typically available",
      "maps_to": "_availability_days"
    },
    {
      "id": "availability_notes",
      "type": "text",
      "label": "Time preference or other scheduling notes",
      "placeholder": "e.g., Mornings only, available for Monday clinics",
      "maps_to": "availability_notes"
    },
    {
      "id": "geographic_range",
      "type": "text",
      "label": "Area you can cover",
      "placeholder": "e.g., Windsor, West Sonoma County, Petaluma area",
      "maps_to": "geographic_range"
    },
    {
      "id": "has_own_traps",
      "type": "toggle",
      "label": "I have my own traps",
      "maps_to": "has_own_traps"
    },
    {
      "id": "has_vehicle",
      "type": "toggle",
      "label": "I have a vehicle that can transport traps",
      "maps_to": "has_vehicle"
    },
    {
      "id": "trapping_experience",
      "type": "radio",
      "label": "Trapping experience",
      "maps_to": "trapping_experience",
      "options": [
        { "value": "none", "label": "No prior experience" },
        { "value": "some", "label": "Some experience (helped with a few trappings)" },
        { "value": "experienced", "label": "Experienced (regular trapping)" }
      ]
    },
    {
      "id": "languages",
      "type": "text",
      "label": "Languages spoken",
      "placeholder": "e.g., English, Spanish",
      "maps_to": "languages_spoken"
    },
    {
      "id": "additional_notes",
      "type": "textarea",
      "label": "Anything else?",
      "placeholder": "Anything else we should know about your availability, preferences, or experience...",
      "maps_to": "_additional_notes"
    }
  ]'::JSONB
)
ON CONFLICT (slug) DO UPDATE SET
  questions = EXCLUDED.questions,
  title = EXCLUDED.title,
  subtitle = EXCLUDED.subtitle,
  thank_you_title = EXCLUDED.thank_you_title,
  thank_you_message = EXCLUDED.thank_you_message,
  updated_at = NOW();

-- Link survey template to trapper profiles
ALTER TABLE sot.trapper_profiles
  ADD COLUMN IF NOT EXISTS survey_template_slug TEXT DEFAULT 'trapper_capabilities';

COMMIT;
