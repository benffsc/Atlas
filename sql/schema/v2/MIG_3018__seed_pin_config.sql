-- MIG_3018: Seed map pin configuration for white-label
-- Date: 2026-03-30
--
-- Part of FFS-1017 (Map Pin Redesign). Seeds admin-configurable pin colors,
-- status dots, sizes, and labels into ops.app_config so any org can customize
-- their map appearance via Admin > Config.

\echo ''
\echo '=============================================='
\echo '  MIG_3018: Seed map pin configuration'
\echo '=============================================='
\echo ''

-- Pin style colors (4-color urgency palette)
INSERT INTO ops.app_config (key, value, description, category)
VALUES (
  'map.colors.pinStyle',
  '{"disease": "#dc2626", "watch_list": "#d97706", "active": "#3b82f6", "active_requests": "#3b82f6", "reference": "#94a3b8", "default": "#3b82f6"}'::jsonb,
  'Pin fill colors by style. Red=urgent, Amber=monitor, Blue=active, Gray=reference.',
  'map'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description;

-- Status dot colors
INSERT INTO ops.app_config (key, value, description, category)
VALUES (
  'map.pin.statusDots',
  '{"disease": "#dc2626", "needs_trapper": "#f97316", "has_volunteer": "#7c3aed"}'::jsonb,
  'Status indicator dot colors on active pins.',
  'map'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description;

-- Pin size tiers (in pixels)
INSERT INTO ops.app_config (key, value, description, category)
VALUES (
  'map.pin.sizes',
  '{"hotspot": 32, "active": 22, "reference": 12}'::jsonb,
  'Pin size tiers in pixels. Hotspot=10+ cats, Active=default, Reference=minimal data.',
  'map'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description;

-- Pin display labels
INSERT INTO ops.app_config (key, value, description, category)
VALUES (
  'map.pin.labels',
  '{"disease": "Disease Risk", "watch_list": "Watch List", "active": "Verified Cats", "active_requests": "Active Requests", "reference": "Reference"}'::jsonb,
  'Display labels for each pin style (shown in layer toggles).',
  'map'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description;

-- Google MyMaps ID for KML sync
INSERT INTO ops.app_config (key, value, description, category)
VALUES (
  'map.mymaps.mid',
  '"11ASW62IbxeTgnXmBTKIr5pyrDAc"'::jsonb,
  'Google MyMaps map ID for automated KML sync.',
  'map'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description;

\echo ''
\echo '✓ MIG_3018 complete — pin config seeded in ops.app_config'
\echo '  Keys: map.colors.pinStyle, map.pin.statusDots, map.pin.sizes, map.pin.labels, map.mymaps.mid'
\echo ''
