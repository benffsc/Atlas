-- MIG_2031: Fix missing ops.* view aliases for map-data route
-- Date: 2026-02-13
-- Issue: Map 500 error due to missing view aliases
--
-- The map-data route at /api/beacon/map-data/route.ts queries:
-- - ops.v_map_atlas_pins (existed)
-- - ops.v_google_map_entries_classified (MISSING - only in trapper.*)
-- - ops.observation_zones (MISSING - only in sot.*)
-- - ops.v_observation_zone_summary (MISSING - only in trapper.*)
--
-- This creates the missing aliases.

-- 1. Google Map Entries Classified view
CREATE OR REPLACE VIEW ops.v_google_map_entries_classified AS
SELECT * FROM trapper.v_google_map_entries_classified;

-- 2. Observation Zones view (pointing to sot table)
CREATE OR REPLACE VIEW ops.observation_zones AS
SELECT * FROM sot.observation_zones;

-- 3. Observation Zone Summary view
CREATE OR REPLACE VIEW ops.v_observation_zone_summary AS
SELECT * FROM trapper.v_observation_zone_summary;

-- Verification
SELECT 'ops.v_map_atlas_pins' as view_name, COUNT(*) as row_count FROM ops.v_map_atlas_pins
UNION ALL
SELECT 'ops.v_google_map_entries_classified', COUNT(*) FROM ops.v_google_map_entries_classified
UNION ALL
SELECT 'ops.observation_zones', COUNT(*) FROM ops.observation_zones
UNION ALL
SELECT 'ops.v_observation_zone_summary', COUNT(*) FROM ops.v_observation_zone_summary
ORDER BY 1;
