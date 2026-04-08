-- MIG_3071: Seed ops.app_config with map caption keys
--
-- Adds config for the floating caption overlay on the main map
-- (components/map/MapCaption.tsx, shown on /map page). Per CLAUDE.md rules,
-- any user-visible text that orgs might want to customize MUST live in
-- ops.app_config, not hardcoded strings.
--
-- The caption is a subtle semi-transparent overlay in the bottom-left of
-- the map showing the product name and a short tagline. White-label friendly.
--
-- Related: FFS-1195 (Tier 2: Mission Visibility), FFS-1193 (rebrand epic)

INSERT INTO ops.app_config (key, value, description, category, updated_at)
VALUES
  (
    'map.caption_enabled',
    'true'::jsonb,
    'Whether to show the floating caption overlay on the main map page. Set to false to hide the caption entirely.',
    'map',
    NOW()
  ),
  (
    'map.caption_title',
    '"Beacon Map"'::jsonb,
    'Title text shown in the map caption overlay. Default "Beacon Map". Override for white-label deployments (e.g. "Community Cat Map", "TNR Intelligence").',
    'map',
    NOW()
  ),
  (
    'map.caption_subtitle',
    '"Real-time TNR tracking across Sonoma County"'::jsonb,
    'Subtitle text shown under the caption title. Should describe what the map shows at a glance. Keep it short (under ~60 chars).',
    'map',
    NOW()
  )
ON CONFLICT (key) DO UPDATE
  SET
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    updated_at = NOW();

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count FROM ops.app_config WHERE key IN ('map.caption_enabled', 'map.caption_title', 'map.caption_subtitle');
  IF v_count < 3 THEN
    RAISE EXCEPTION 'MIG_3071 verification failed: expected 3 map.caption_* keys, found %', v_count;
  END IF;
  RAISE NOTICE 'MIG_3071 verification: % map.caption_* config keys present', v_count;
END $$;
