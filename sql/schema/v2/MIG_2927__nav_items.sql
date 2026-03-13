-- MIG_2927: Nav Items table (FFS-511)
--
-- Admin-configurable sidebar navigation. Stores items for both
-- the main app sidebar and admin sidebar, with role-based visibility,
-- ordering, and show/hide toggles.

BEGIN;

CREATE TABLE IF NOT EXISTS ops.nav_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sidebar     TEXT NOT NULL,            -- 'main' or 'admin'
  section     TEXT NOT NULL,            -- section title: 'Operations', 'Settings', etc.
  label       TEXT NOT NULL,
  path        TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT '',  -- emoji icon
  sort_order  INT NOT NULL DEFAULT 0,
  visible     BOOLEAN NOT NULL DEFAULT TRUE,
  required_role TEXT,                    -- NULL = all roles, 'admin', 'staff'
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_nav_items_sidebar ON ops.nav_items(sidebar, sort_order);

-- Seed: Admin sidebar (matches current AdminSidebar in SidebarLayout.tsx)
INSERT INTO ops.nav_items (sidebar, section, label, path, icon, sort_order, required_role) VALUES
  -- Dashboard
  ('admin', 'Dashboard', 'Overview',           '/admin',                          '📊', 10, NULL),
  ('admin', 'Dashboard', 'Clinic Days',        '/admin/clinic-days',              '🏥', 20, NULL),
  -- Data
  ('admin', 'Data', 'Data Hub',                '/admin/data',                     '📊', 30, NULL),
  ('admin', 'Data', 'Upload Data',             '/admin/data?tab=processing',      '📤', 40, NULL),
  ('admin', 'Data', 'Review Queue',            '/admin/data?tab=review',          '📋', 50, NULL),
  -- Beacon
  ('admin', 'Beacon', 'Atlas Map',             '/map',                            '🗺️', 60, NULL),
  ('admin', 'Beacon', 'Colony Estimates',      '/admin/beacon/colony-estimates',  '🐱', 70, NULL),
  ('admin', 'Beacon', 'Seasonal Analysis',     '/admin/beacon/seasonal',          '📆', 80, NULL),
  ('admin', 'Beacon', 'Forecasts',             '/admin/beacon/forecasts',         '🔮', 90, NULL),
  -- Email
  ('admin', 'Email', 'Email Hub',              '/admin/email',                    '📧', 100, NULL),
  ('admin', 'Email', 'Templates',              '/admin/email-templates',          '📝', 110, NULL),
  ('admin', 'Email', 'Batches',                '/admin/email-batches',            '📨', 120, NULL),
  -- Settings
  ('admin', 'Settings', 'Staff',               '/admin/staff',                    '👥', 130, NULL),
  ('admin', 'Settings', 'Organizations',       '/admin/organizations',            '🏢', 140, NULL),
  ('admin', 'Settings', 'Equipment',           '/admin/equipment',                '🪤', 150, NULL),
  ('admin', 'Settings', 'Intake Fields',       '/admin/intake-fields',            '📝', 160, NULL),
  ('admin', 'Settings', 'Ecology Config',      '/admin/ecology',                  '🌿', 170, NULL),
  ('admin', 'Settings', 'AI Access',           '/admin/ai-access',                '🔐', 180, NULL),
  ('admin', 'Settings', 'App Config',          '/admin/config',                   '⚙️', 190, NULL),
  ('admin', 'Settings', 'Navigation',          '/admin/nav',                      '🧭', 200, 'admin'),
  ('admin', 'Settings', 'Roles',               '/admin/roles',                    '🛡️', 210, 'admin'),
  -- Linear
  ('admin', 'Linear', 'Dashboard',             '/admin/linear',                   '📐', 220, NULL),
  ('admin', 'Linear', 'Issues',                '/admin/linear/issues',            '📋', 230, NULL),
  ('admin', 'Linear', 'Sessions',              '/admin/linear/sessions',          '🤖', 240, NULL),
  -- Developer
  ('admin', 'Developer', 'Claude Code',        '/admin/claude-code',              '🤖', 250, 'admin'),
  ('admin', 'Developer', 'Knowledge Base',     '/admin/knowledge-base',           '📚', 260, NULL),
  ('admin', 'Developer', 'Tippy Corrections',  '/admin/tippy-corrections',        '✏️', 270, NULL)
ON CONFLICT DO NOTHING;

-- Seed: Main app sidebar (matches current mainSidebarSections)
INSERT INTO ops.nav_items (sidebar, section, label, path, icon, sort_order, required_role) VALUES
  -- Operations
  ('main', 'Operations', 'Dashboard',          '/',                               '🏠', 10, NULL),
  ('main', 'Operations', 'Atlas Map',          '/map',                            '🗺️', 20, NULL),
  ('main', 'Operations', 'Intake Queue',       '/intake/queue',                   '📥', 30, NULL),
  ('main', 'Operations', 'Requests',           '/requests',                       '📋', 40, NULL),
  ('main', 'Operations', 'Clinic Days',        '/admin/clinic-days',              '🏥', 50, NULL),
  ('main', 'Operations', 'Trappers',           '/trappers',                       '🪤', 60, NULL),
  -- Records
  ('main', 'Records', 'Cats',                  '/cats',                           '🐱', 70, NULL),
  ('main', 'Records', 'People',                '/people',                         '👥', 80, NULL),
  ('main', 'Records', 'Places',                '/places',                         '📍', 90, NULL),
  ('main', 'Records', 'Search',                '/search',                         '🔍', 100, NULL),
  -- Beacon
  ('main', 'Beacon', 'Colony Estimates',       '/admin/beacon/colony-estimates',  '📊', 110, NULL),
  ('main', 'Beacon', 'Seasonal Analysis',      '/admin/beacon/seasonal',          '📆', 120, NULL),
  ('main', 'Beacon', 'Forecasts',              '/admin/beacon/forecasts',         '🔮', 130, NULL),
  -- Admin
  ('main', 'Admin', 'Admin Panel',             '/admin',                          '⚙️', 140, NULL)
ON CONFLICT DO NOTHING;

COMMIT;
