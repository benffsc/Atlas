-- MIG_2985: Admin sidebar restructure
-- Matches new ADMIN_SIDEBAR_FALLBACK: 7 sections, ~21 items
-- Replaces old 8-section, 33-item layout
-- Run AFTER code deploy so fallback already works

BEGIN;

DELETE FROM ops.nav_items WHERE sidebar = 'admin';

INSERT INTO ops.nav_items (sidebar, section, label, path, icon, sort_order) VALUES
  -- Dashboard
  ('admin', 'Dashboard', 'Overview',          '/admin',                         'layout-dashboard', 10),
  ('admin', 'Dashboard', 'Clinic Days',       '/admin/clinic-days',             'hospital',         20),

  -- Data
  ('admin', 'Data',      'Data Hub',           '/admin/data',                   'bar-chart',        30),
  ('admin', 'Data',      'ClinicHQ Upload',    '/admin/ingest',                 'upload',           40),
  ('admin', 'Data',      'Data Health',        '/admin/data-health',            'activity',         50),

  -- Beacon
  ('admin', 'Beacon',    'Colony Estimates',   '/admin/beacon/colony-estimates', 'cat',              60),
  ('admin', 'Beacon',    'Mortality',          '/admin/beacon/mortality',        'clipboard-list',   70),
  ('admin', 'Beacon',    'Reproduction',       '/admin/beacon/reproduction',     'baby',             80),
  ('admin', 'Beacon',    'Seasonal Analysis',  '/admin/beacon/seasonal',         'calendar-days',    90),
  ('admin', 'Beacon',    'Forecasts',          '/admin/beacon/forecasts',        'trending-up',     100),

  -- Email
  ('admin', 'Email',     'Email Hub',          '/admin/email',                  'mail',            110),
  ('admin', 'Email',     'Templates',          '/admin/email-templates',        'file-text',       120),
  ('admin', 'Email',     'Batches',            '/admin/email-batches',          'send',            130),

  -- Tippy
  ('admin', 'Tippy',     'Corrections',        '/admin/tippy-corrections',      'pencil',          140),
  ('admin', 'Tippy',     'Knowledge Base',     '/admin/knowledge-base',         'book-open',       150),
  ('admin', 'Tippy',     'Conversations',      '/admin/tippy-conversations',    'message-square',  160),
  ('admin', 'Tippy',     'Feedback',           '/admin/tippy-feedback',         'help-circle',     170),

  -- Settings
  ('admin', 'Settings',  'All Settings',       '/admin/settings',               'settings',        180),

  -- Developer
  ('admin', 'Developer', 'Claude Code',        '/admin/claude-code',            'code-2',          190),
  ('admin', 'Developer', 'Linear',             '/admin/linear',                 'square-kanban',   200),
  ('admin', 'Developer', 'Test Mode',          '/admin/test-mode',              'flask-conical',   210);

COMMIT;
