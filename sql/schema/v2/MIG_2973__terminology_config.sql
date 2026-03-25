-- MIG_2973: Add terminology configuration to ops.app_config
-- FFS-687: White-label support for trapper types and program terminology
--
-- This allows orgs to customize public/staff terminology without code changes.
-- FFSC defaults are used as seed values.

INSERT INTO ops.app_config (key, value, description, category, updated_by)
VALUES
  ('terminology.trapper_types', '{"coordinator":"Coordinator","head_trapper":"Head Trapper","ffsc_trapper":"FFSC Trapper","community_trapper":"Community Trapper"}'::jsonb,
   'Display labels for trapper type values', 'terminology', NULL),
  ('terminology.program_public', '"Find Fix Return (FFR)"'::jsonb,
   'Public-facing program name', 'terminology', NULL),
  ('terminology.program_staff', '"TNR"'::jsonb,
   'Internal/staff program name', 'terminology', NULL),
  ('terminology.action_public', '"fix"'::jsonb,
   'Public-facing action verb (spay/neuter)', 'terminology', NULL),
  ('terminology.action_staff', '"alter"'::jsonb,
   'Internal/staff action verb', 'terminology', NULL)
ON CONFLICT (key) DO NOTHING;
