-- MIG_2985: Add Equipment + Kiosk nav items to main sidebar
--
-- Equipment was added to the codebase (FFS-779) but never seeded
-- into ops.nav_items for the main sidebar. The hardcoded fallback
-- showed it briefly, then the DB fetch replaced it — causing a flicker.
--
-- Also adds Beacon Dashboard to main sidebar (was in hardcoded fallback
-- but missing from DB).

BEGIN;

-- Equipment in main sidebar (between Trappers sort_order=60 and Records sort_order=70)
INSERT INTO ops.nav_items (sidebar, section, label, path, icon, sort_order, required_role)
VALUES ('main', 'Operations', 'Equipment', '/equipment', 'wrench', 65, NULL)
ON CONFLICT DO NOTHING;

-- Beacon Dashboard in main sidebar (was in hardcoded fallback, missing from DB)
-- Insert before Colony Estimates (sort_order=110)
INSERT INTO ops.nav_items (sidebar, section, label, path, icon, sort_order, required_role)
VALUES ('main', 'Beacon', 'Beacon Dashboard', '/beacon', 'radio', 105, NULL)
ON CONFLICT DO NOTHING;

COMMIT;
