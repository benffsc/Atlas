-- MIG_3016: Kiosk Hub Configuration
-- Seeds kiosk.* config keys for multi-purpose public kiosk hub
-- and adds admin sidebar nav item for /admin/kiosk

BEGIN;

-- ── Kiosk config keys ──────────────────────────────────────────────────────────

INSERT INTO ops.app_config (key, value, description, category) VALUES
  ('kiosk.modules_enabled',       '["equipment","help"]'::jsonb,
   'Which modules appear on the kiosk splash screen (equipment, help, cats, trapper)', 'kiosk'),

  ('kiosk.session_timeout_public', '120'::jsonb,
   'Seconds of inactivity before public kiosk modules reset to splash', 'kiosk'),

  ('kiosk.session_timeout_equipment', '300'::jsonb,
   'Seconds of inactivity before equipment kiosk resets to splash', 'kiosk'),

  ('kiosk.splash_title',          '"How can we help?"'::jsonb,
   'Heading text on the kiosk splash screen', 'kiosk'),

  ('kiosk.splash_subtitle',       '"Tap an option to get started"'::jsonb,
   'Subheading text on the kiosk splash screen', 'kiosk'),

  ('kiosk.cats_slideshow_interval', '8'::jsonb,
   'Seconds between auto-advance in adoptable cats slideshow', 'kiosk'),

  ('kiosk.success_message',       '"Thank you! We''ll be in touch."'::jsonb,
   'Message shown after successful kiosk help form submission', 'kiosk'),

  ('kiosk.help_questions',        'null'::jsonb,
   'Custom indirect questions for the help form (null = use defaults from code)', 'kiosk')
ON CONFLICT (key) DO NOTHING;

-- ── Admin sidebar nav item ─────────────────────────────────────────────────────

INSERT INTO ops.nav_items (sidebar, section, label, path, icon, sort_order, visible, required_role)
VALUES ('admin', 'Settings', 'Kiosk Config', '/admin/kiosk', 'tablet', 85, TRUE, 'admin')
ON CONFLICT DO NOTHING;

COMMIT;
