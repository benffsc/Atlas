-- MIG_2928: Permissions & Role-Permission matrix (FFS-512)
--
-- Replaces inline auth_role checks with a configurable permission system.
-- Seed data preserves current behavior exactly:
--   admin  → all permissions
--   staff  → read everything + write operational resources
--   volunteer → read-only

BEGIN;

CREATE TABLE IF NOT EXISTS ops.permissions (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT,
  category    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ops.role_permissions (
  role           TEXT NOT NULL,    -- matches ops.staff.auth_role CHECK values
  permission_key TEXT NOT NULL REFERENCES ops.permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role, permission_key)
);

CREATE INDEX idx_role_permissions_role ON ops.role_permissions(role);
CREATE INDEX idx_permissions_category ON ops.permissions(category);

-- Seed permissions
INSERT INTO ops.permissions (key, label, description, category) VALUES
  -- Admin
  ('admin.access',     'Admin Panel Access',     'Access the admin panel and dashboard',  'admin'),
  ('admin.config',     'Manage App Config',      'Edit runtime app configuration',        'admin'),
  ('admin.auth',       'Manage Staff Auth',      'Reset passwords, set roles',            'admin'),
  ('admin.ai',         'Manage AI Access',       'Configure AI access controls',          'admin'),
  ('admin.nav',        'Manage Navigation',      'Edit sidebar navigation layout',        'admin'),
  ('admin.roles',      'Manage Roles',           'Edit role-permission matrix',           'admin'),
  ('admin.tippy',      'Manage Tippy AI',        'Review Tippy drafts, corrections',      'admin'),
  ('admin.data',       'Data Improvements',      'Manage data quality improvements',      'admin'),
  ('admin.email',      'Manage Email',           'Templates, batches, email settings',    'admin'),
  ('admin.reports',    'Trapper Reports',        'Create and manage trapper reports',     'admin'),
  ('admin.clinic',     'Manage Clinic Days',     'Delete clinic day records',             'admin'),
  -- Requests
  ('requests.read',    'View Requests',          'View request list and details',         'requests'),
  ('requests.write',   'Edit Requests',          'Create and update requests',            'requests'),
  -- Cats
  ('cats.read',        'View Cats',              'View cat list and details',             'cats'),
  ('cats.write',       'Edit Cats',              'Create and update cat records',         'cats'),
  -- People
  ('people.read',      'View People',            'View people list and details',          'people'),
  ('people.write',     'Edit People',            'Create and update people records',      'people'),
  -- Places
  ('places.read',      'View Places',            'View places list and details',          'places'),
  ('places.write',     'Edit Places',            'Create and update place records',       'places'),
  -- Knowledge
  ('knowledge.read',   'View Knowledge Base',    'Read knowledge base articles',          'knowledge'),
  ('knowledge.write',  'Edit Knowledge Base',    'Create and edit KB articles',           'knowledge'),
  ('knowledge.delete', 'Delete Knowledge',       'Remove KB articles',                    'knowledge'),
  -- Intake
  ('intake.read',      'View Intake Queue',      'View intake submissions',               'intake'),
  ('intake.write',     'Edit Intake',            'Create, triage, convert intakes',       'intake')
ON CONFLICT (key) DO NOTHING;

-- Admin gets everything
INSERT INTO ops.role_permissions (role, permission_key)
SELECT 'admin', key FROM ops.permissions
ON CONFLICT DO NOTHING;

-- Staff gets read + operational write (matches current staff_can_access logic)
INSERT INTO ops.role_permissions (role, permission_key) VALUES
  ('staff', 'admin.access'),
  ('staff', 'requests.read'),
  ('staff', 'requests.write'),
  ('staff', 'cats.read'),
  ('staff', 'cats.write'),
  ('staff', 'people.read'),
  ('staff', 'people.write'),
  ('staff', 'places.read'),
  ('staff', 'places.write'),
  ('staff', 'knowledge.read'),
  ('staff', 'knowledge.write'),
  ('staff', 'intake.read'),
  ('staff', 'intake.write')
ON CONFLICT DO NOTHING;

-- Volunteer gets read-only
INSERT INTO ops.role_permissions (role, permission_key) VALUES
  ('volunteer', 'requests.read'),
  ('volunteer', 'cats.read'),
  ('volunteer', 'people.read'),
  ('volunteer', 'places.read'),
  ('volunteer', 'knowledge.read'),
  ('volunteer', 'intake.read')
ON CONFLICT DO NOTHING;

COMMIT;
