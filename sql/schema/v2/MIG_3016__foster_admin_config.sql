-- MIG_3016: Admin-Editable Foster & Role Configuration
--
-- Makes foster program settings configurable via ops.app_config (admin UI at /admin/config).
-- Critical for white-labeling — other orgs may not use ShelterLuv, VolunteerHub,
-- or have different role structures.
--
-- Pattern: follows MIG_2962 (beacon thresholds) and MIG_2948 (form configs).
-- New keys are read via getServerConfig() server-side and useAppConfig() client-side.
--
-- Created: 2026-03-30

\echo ''
\echo '=============================================='
\echo '  MIG_3016: Foster & Role Admin Config'
\echo '=============================================='
\echo ''

-- ============================================================================
-- SECTION A: Foster program config keys
-- ============================================================================

\echo '1. Seeding foster program config keys...'

INSERT INTO ops.app_config (key, value, description, category) VALUES

-- Foster authority model: which source systems are authoritative for active foster status
('foster.active_authority', '"volunteerhub"',
 'Source system that is authoritative for active foster status. VH = currently approved fosters. SL = historical evidence only. Set to "any" to treat all sources as active authority.',
 'foster'),

-- Foster role defaults: what role_status to assign when creating foster roles from different sources
('foster.sl_default_status', '"inactive"',
 'Default role_status for foster roles auto-created from ShelterLuv person_cat evidence. "inactive" = historical, "active" = treat as active foster.',
 'foster'),

('foster.vh_default_status', '"active"',
 'Default role_status for foster roles created from VolunteerHub foster group membership.',
 'foster'),

-- VH group matching pattern for foster detection
('foster.vh_group_pattern', '"%foster%"',
 'SQL LIKE pattern for matching VolunteerHub groups that indicate foster approval. Used by process_volunteerhub_group_roles() and /api/fosters route. Case-insensitive.',
 'foster'),

-- Foster analytics thresholds
('foster.high_volume_threshold', '20',
 'Number of cats fostered to be considered a "high volume" foster for analytics.',
 'foster'),

('foster.inactive_days_threshold', '180',
 'Days since last foster activity before a foster is considered stale/inactive for alerts.',
 'foster')

ON CONFLICT (key) DO NOTHING;

\echo '   Foster config keys seeded'


-- ============================================================================
-- SECTION B: Role display config keys (white-label ready)
-- ============================================================================

\echo ''
\echo '2. Seeding role display config keys...'

INSERT INTO ops.app_config (key, value, description, category) VALUES

-- Role display labels (for orgs that want different terminology)
('terminology.role_labels', '{
  "trapper": "Trapper",
  "foster": "Foster",
  "volunteer": "Volunteer",
  "staff": "Staff",
  "caretaker": "Colony Caretaker",
  "board_member": "Board Member",
  "donor": "Donor"
}',
 'Display labels for person role types. Orgs can customize (e.g., "Foster" → "Foster Parent", "Trapper" → "Field Volunteer").',
 'terminology'),

-- Role badge/status colors (currently hardcoded in role-audit page)
('theme.role_colors', '{
  "staff": "#4338ca",
  "trapper": "#065f46",
  "foster": "#9d174d",
  "volunteer": "#1e40af",
  "caretaker": "#92400e",
  "board_member": "#6b21a8",
  "donor": "#047857"
}',
 'Badge colors for role types in admin UI. Hex values.',
 'theme'),

-- Role status display labels
('terminology.role_statuses', '{
  "active": "Active",
  "inactive": "Inactive",
  "pending": "Pending",
  "on_leave": "On Leave"
}',
 'Display labels for role status values. Orgs can customize (e.g., "On Leave" → "Sabbatical").',
 'terminology'),

-- Source system authority mapping (which source is authoritative for which role)
('roles.source_authority', '{
  "trapper": "volunteerhub",
  "foster": "volunteerhub",
  "volunteer": "volunteerhub",
  "staff": "atlas_ui",
  "caretaker": "atlas_ui",
  "board_member": "atlas_ui",
  "donor": "atlas_ui"
}',
 'Which source system is authoritative for each role type. Controls whether SL/VH/manual is treated as active or historical evidence. Critical for white-labeling.',
 'rules'),

-- Foster relationship type in person_cat (for orgs with different relationship models)
('foster.relationship_type', '"foster"',
 'The relationship_type value in sot.person_cat that indicates a foster relationship. Default is "foster".',
 'foster')

ON CONFLICT (key) DO NOTHING;

\echo '   Role display config keys seeded'


-- ============================================================================
-- SECTION C: Sync health config keys
-- ============================================================================

\echo ''
\echo '3. Seeding sync health config keys...'

INSERT INTO ops.app_config (key, value, description, category) VALUES

-- Sync freshness thresholds (for admin dashboard alerts)
('sync.shelterluv_stale_hours', '24',
 'Hours after last ShelterLuv sync before marking as stale in admin dashboard.',
 'operational'),

('sync.volunteerhub_stale_hours', '48',
 'Hours after last VolunteerHub sync before marking as stale in admin dashboard.',
 'operational'),

('sync.clinichq_stale_hours', '48',
 'Hours after last ClinicHQ raw sync before marking as stale in admin dashboard.',
 'operational'),

('sync.staged_backlog_warning', '500',
 'Number of unprocessed staged records before triggering a warning in admin dashboard.',
 'operational')

ON CONFLICT (key) DO NOTHING;

\echo '   Sync health config keys seeded'


-- ============================================================================
-- SECTION D: Verification
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'New config keys by category:'
SELECT category, COUNT(*), STRING_AGG(key, ', ' ORDER BY key) AS keys
FROM ops.app_config
WHERE key LIKE 'foster.%' OR key LIKE 'roles.%' OR key IN (
  'terminology.role_labels', 'terminology.role_statuses',
  'theme.role_colors', 'sync.shelterluv_stale_hours',
  'sync.volunteerhub_stale_hours', 'sync.clinichq_stale_hours',
  'sync.staged_backlog_warning'
)
GROUP BY category ORDER BY category;

\echo ''
\echo 'Total config keys:'
SELECT COUNT(*) AS total_keys FROM ops.app_config;

\echo ''
\echo '=============================================='
\echo '  MIG_3016 Complete'
\echo '=============================================='
