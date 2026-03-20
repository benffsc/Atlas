-- MIG_2970: Ensure white-label geographic config keys exist in ops.app_config (FFS-685)
--
-- MIG_2964 already seeds these values. This migration is a safety net
-- to guarantee the keys exist if MIG_2964 was skipped or only partially applied.
-- ON CONFLICT DO NOTHING ensures idempotency.

INSERT INTO ops.app_config (key, value, category, description) VALUES
  ('map.default_bounds',    '{"south": 37.8, "north": 39.4, "west": -123.6, "east": -122.3}'::jsonb, 'map', 'Default map viewport bounds for API filtering'),
  ('geo.service_counties',  '["Sonoma", "Marin", "Napa", "Mendocino", "Lake"]'::jsonb,              'geo', 'Counties in the service area (used in county dropdowns)'),
  ('geo.default_county',    '"Sonoma"'::jsonb,                                                        'geo', 'Default county for new requests and forms'),
  ('geo.service_area_name', '"Sonoma County"'::jsonb,                                                 'geo', 'Human-readable service area name for UI text')
ON CONFLICT (key) DO NOTHING;
