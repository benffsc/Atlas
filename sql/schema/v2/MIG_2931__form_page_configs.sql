-- MIG_2931: Print form page configs — JSON-driven print page layouts (FFS-519)
-- Stores per-template page layout overrides. The TemplateRenderer can read from
-- this table to determine section order, field visibility, and field widths.
-- The existing /intake/print/[id] page is NOT touched — this enables a future
-- config-driven print renderer alongside the current hardcoded one.

CREATE TABLE IF NOT EXISTS ops.form_page_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT UNIQUE NOT NULL REFERENCES ops.form_templates(template_key),
  label TEXT NOT NULL,
  page_config JSONB NOT NULL DEFAULT '{}',
  print_settings JSONB NOT NULL DEFAULT '{"orientation":"portrait","paperSize":"letter","margins":{"top":"0.5in","right":"0.5in","bottom":"0.5in","left":"0.5in"}}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES ops.staff(staff_id)
);

-- Seed with current call sheet layout (matches /intake/print/[id]/page.tsx sections)
INSERT INTO ops.form_page_configs (template_key, label, page_config, print_settings)
VALUES (
  'tnr_call_sheet',
  'TNR Call Sheet',
  '{
    "pages": [
      {
        "number": 1,
        "label": "Main",
        "sections": [
          {
            "key": "header",
            "label": "Header",
            "type": "header",
            "visible": true,
            "fields": ["submission_id", "submitted_at", "first_name", "last_name"]
          },
          {
            "key": "status_strip",
            "label": "Status Strip",
            "type": "status",
            "visible": true,
            "fields": ["submission_status", "appointment_date", "triage_category"]
          },
          {
            "key": "contact_location",
            "label": "Contact & Location",
            "type": "card",
            "visible": true,
            "layout": "3-col",
            "fields": [
              {"key": "first_name", "width": "md"},
              {"key": "last_name", "width": "md"},
              {"key": "phone", "width": "md"},
              {"key": "email", "width": "lg"},
              {"key": "cats_address", "width": "xl"},
              {"key": "cats_city", "width": "md"},
              {"key": "county", "width": "sm"}
            ]
          },
          {
            "key": "about_cats",
            "label": "About the Cats",
            "type": "grid",
            "visible": true,
            "fields": [
              {"key": "cat_count_estimate", "width": "sm", "label": "How many cats?"},
              {"key": "fixed_status", "width": "md", "label": "Fixed status"},
              {"key": "awareness_duration", "width": "md", "label": "How long aware?"},
              {"key": "has_kittens", "width": "sm", "label": "Kittens?"},
              {"key": "cats_being_fed", "width": "sm", "label": "Being fed?"},
              {"key": "has_medical_concerns", "width": "sm", "label": "Medical?"}
            ]
          },
          {
            "key": "situation",
            "label": "Situation Details",
            "type": "checklist_and_text",
            "visible": true,
            "fields": [
              {"key": "has_medical_concerns", "type": "check", "label": "Medical concerns"},
              {"key": "cats_being_fed", "type": "check", "label": "Cats are being fed"},
              {"key": "has_property_access", "type": "check", "label": "Has property access"},
              {"key": "is_property_owner", "type": "check", "label": "Is property owner"},
              {"key": "is_emergency", "type": "check", "label": "Emergency"},
              {"key": "situation_description", "type": "textarea", "label": "Description"}
            ]
          },
          {
            "key": "additional_info",
            "label": "Additional Information",
            "type": "tags",
            "visible": true,
            "fields": ["feeding_frequency", "referral_source"]
          },
          {
            "key": "staff_notes",
            "label": "Staff Notes",
            "type": "notes",
            "visible": true,
            "fields": ["priority_override", "triage_score", "review_notes"]
          }
        ]
      },
      {
        "number": 2,
        "label": "Kittens",
        "condition": "has_kittens",
        "sections": [
          {
            "key": "kitten_info",
            "label": "Kitten Details",
            "type": "grid",
            "visible": true,
            "fields": [
              {"key": "kitten_count", "width": "sm"},
              {"key": "kitten_age_estimate", "width": "md"},
              {"key": "kitten_behavior", "width": "md"},
              {"key": "kitten_contained", "width": "sm"}
            ]
          },
          {
            "key": "mom_status",
            "label": "Mom Cat Status",
            "type": "grid",
            "visible": true,
            "fields": [
              {"key": "mom_present", "width": "sm"},
              {"key": "mom_fixed", "width": "sm"},
              {"key": "can_bring_in", "width": "sm"}
            ]
          },
          {
            "key": "kitten_notes",
            "label": "Kitten Notes",
            "type": "notes",
            "visible": true,
            "fields": ["kitten_mixed_ages_description", "kitten_notes"]
          },
          {
            "key": "kitten_assessment",
            "label": "Kitten Assessment (Staff)",
            "type": "assessment",
            "visible": true,
            "fields": ["kitten_outcome", "foster_readiness", "kitten_urgency_factors"]
          }
        ]
      }
    ]
  }',
  '{"orientation": "portrait", "paperSize": "letter", "margins": {"top": "0.5in", "right": "0.5in", "bottom": "0.5in", "left": "0.5in"}}'
)
ON CONFLICT (template_key) DO UPDATE
SET page_config = EXCLUDED.page_config, print_settings = EXCLUDED.print_settings, label = EXCLUDED.label;

-- Seed trapper sheet config
INSERT INTO ops.form_page_configs (template_key, label, page_config, print_settings)
VALUES (
  'trapper_sheet',
  'Trapper Assignment Sheet',
  '{
    "pages": [
      {
        "number": 1,
        "label": "Assignment",
        "sections": [
          {
            "key": "header",
            "label": "Header",
            "type": "header",
            "visible": true,
            "fields": ["request_id", "assigned_date"]
          },
          {
            "key": "location",
            "label": "Location",
            "type": "card",
            "visible": true,
            "fields": [
              {"key": "address", "width": "xl"},
              {"key": "cats_city", "width": "md"},
              {"key": "county", "width": "sm"},
              {"key": "location_description", "width": "lg"}
            ]
          },
          {
            "key": "contact",
            "label": "Contact",
            "type": "card",
            "visible": true,
            "fields": [
              {"key": "first_name", "width": "md"},
              {"key": "last_name", "width": "md"},
              {"key": "phone", "width": "md"},
              {"key": "email", "width": "lg"}
            ]
          },
          {
            "key": "cat_info",
            "label": "Cat Information",
            "type": "grid",
            "visible": true,
            "fields": [
              {"key": "cat_count_estimate", "width": "sm"},
              {"key": "fixed_status", "width": "md"},
              {"key": "has_kittens", "width": "sm"},
              {"key": "cats_being_fed", "width": "sm"}
            ]
          },
          {
            "key": "access",
            "label": "Property Access",
            "type": "grid",
            "visible": true,
            "fields": [
              {"key": "has_property_access", "width": "sm"},
              {"key": "is_property_owner", "width": "sm"},
              {"key": "ownership_status", "width": "md"}
            ]
          },
          {
            "key": "notes",
            "label": "Notes",
            "type": "notes",
            "visible": true,
            "fields": ["situation_description", "review_notes"]
          }
        ]
      }
    ]
  }',
  '{"orientation": "portrait", "paperSize": "letter", "margins": {"top": "0.5in", "right": "0.5in", "bottom": "0.5in", "left": "0.5in"}}'
)
ON CONFLICT (template_key) DO UPDATE
SET page_config = EXCLUDED.page_config, print_settings = EXCLUDED.print_settings, label = EXCLUDED.label;
