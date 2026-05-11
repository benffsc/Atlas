-- MIG_3132: Department-based briefing configuration (white-label friendly)
--
-- Maps departments to which briefing sections they see. Admin-configurable
-- via ops.app_config pattern. No hardcoded names in code.

-- Briefing section config stored in app_config (admin-editable)
-- Key pattern: briefing.sections.<department_slug>
-- Value: JSON array of section names to include

INSERT INTO ops.app_config (key, value, category, description) VALUES
  ('briefing.sections.clinic', '["clinic_detail", "field_intel", "reminders", "tickets"]',
   'tippy', 'Briefing sections for Clinic department staff'),
  ('briefing.sections.adoptions', '["foster_pipeline", "field_intel", "reminders", "tickets"]',
   'tippy', 'Briefing sections for Foster/Adopt/Relo department staff'),
  ('briefing.sections.trapping', '["request_pipeline", "clinic_activity", "field_intel", "reminders", "tickets", "intakes"]',
   'tippy', 'Briefing sections for Trapping coordinator'),
  ('briefing.sections.administration', '["clinic_activity", "field_intel", "reminders", "tickets", "intakes", "request_pipeline"]',
   'tippy', 'Briefing sections for Administration (includes everything)'),
  ('briefing.sections.volunteers', '["clinic_activity", "field_intel", "reminders", "tickets"]',
   'tippy', 'Briefing sections for Volunteer coordination staff'),
  ('briefing.sections.marketing', '["clinic_activity", "field_intel", "program_stats"]',
   'tippy', 'Briefing sections for Marketing staff'),
  ('briefing.sections.default', '["clinic_activity", "field_intel", "reminders", "tickets"]',
   'tippy', 'Default briefing sections for staff with no department set')
ON CONFLICT (key) DO NOTHING;

-- Update staff departments that are missing
UPDATE ops.staff SET department = 'Administration' WHERE display_name = 'Ben Mis' AND department IS DISTINCT FROM 'Administration';
UPDATE ops.staff SET role = 'Trapping Coordinator' WHERE display_name = 'Ben Mis' AND role IS DISTINCT FROM 'Trapping Coordinator';
