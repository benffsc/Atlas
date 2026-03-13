-- MIG_2926: App Config Foundation (FFS-509)
--
-- Runtime configuration table for V2.5 admin-configurable settings.
-- Replaces hardcoded constants scattered across TypeScript files.
-- All V2.5 phases (FFS-506 epic) build on this table.

BEGIN;

-- Create the config table
CREATE TABLE IF NOT EXISTS ops.app_config (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  category    TEXT NOT NULL,
  updated_by  UUID REFERENCES ops.staff(staff_id),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_app_config_category ON ops.app_config(category);

-- Seed initial config values
INSERT INTO ops.app_config (key, value, description, category) VALUES
  ('request.stale_days', '30', 'Days of inactivity before new intakes are auto-archived', 'operational'),
  ('request.in_progress_stale_days', '14', 'Days without contact before in-progress intakes are auto-archived', 'operational'),
  ('pagination.default_limit', '50', 'Default page size for API list endpoints', 'operational'),
  ('pagination.max_limit', '200', 'Maximum allowed page size', 'operational'),
  ('map.default_zoom', '10', 'Default zoom level for map views', 'display'),
  ('map.default_center', '[38.45, -122.75]', 'Default map center [lat, lng] — Sonoma County', 'display')
ON CONFLICT (key) DO NOTHING;

COMMIT;
