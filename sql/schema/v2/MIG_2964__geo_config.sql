-- MIG_2964: Seed geographic config for white-label map defaults (FFS-685)
--
-- Adds map bounds, autocomplete bias, and service county config to ops.app_config.
-- Recategorizes existing map.default_center and map.default_zoom from 'map' (already correct).
-- Client reads via useGeoConfig(), server reads via geo-config.ts helpers.

INSERT INTO ops.app_config (key, value, category, description) VALUES
  ('map.default_bounds',     '{"south": 37.8, "north": 39.4, "west": -123.6, "east": -122.3}'::jsonb, 'map', 'Default map viewport bounds for API filtering'),
  ('map.autocomplete_bias',  '{"lat": 38.5, "lng": -122.8, "radius": 50000}'::jsonb,                  'map', 'Google Places autocomplete location bias (lat, lng, radius in meters)'),
  ('geo.service_counties',   '["Sonoma", "Marin", "Napa", "Mendocino", "Lake"]'::jsonb,               'geo', 'Counties in the service area (used in county dropdowns)'),
  ('geo.default_county',     '"Sonoma"'::jsonb,                                                         'geo', 'Default county for new requests and forms'),
  ('geo.service_area_name',  '"Sonoma County"'::jsonb,                                                  'geo', 'Human-readable service area name for UI text')
ON CONFLICT (key) DO NOTHING;
