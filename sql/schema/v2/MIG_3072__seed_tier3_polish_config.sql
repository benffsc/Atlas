-- MIG_3072: Seed Tier 3 Beacon polish config keys
--
-- Adds admin-configurable keys for Tier 3 gala-mode features:
--   - Live counter ticker (dashboard)
--   - Presentation mode toggle (user menu)
--   - Scrollytelling intro (/story route)
--
-- All keys are white-label friendly — any org deploying Beacon can
-- customize the gala demo layer via /admin/config without a code change.
-- Per CLAUDE.md rules: "New configuration value → ops.app_config
-- (admin-editable, NOT hardcoded constant)".
--
-- Related: FFS-1196 (Tier 3: Gala Mode), FFS-1193 (rebrand epic)

INSERT INTO ops.app_config (key, value, description, category, updated_at)
VALUES
  -- Live counter ticker
  (
    'live_counter.enabled',
    'true'::jsonb,
    'Whether to show the live counter ticker on the dashboard ("Cats altered in YEAR: NNN and counting"). Set to false to hide.',
    'live_counter',
    NOW()
  ),
  (
    'live_counter.label',
    '"Cats altered in {year}"'::jsonb,
    'Label text for the live counter. The {year} token is replaced with the current calendar year. Override for white-label deployments.',
    'live_counter',
    NOW()
  ),
  (
    'live_counter.suffix',
    '"and counting"'::jsonb,
    'Text shown after the counter number. Default "and counting" creates forward momentum. Override per org voice.',
    'live_counter',
    NOW()
  ),

  -- Presentation mode
  (
    'presentation.enabled',
    'true'::jsonb,
    'Whether the presentation mode toggle is available in the user menu. Set to false to hide the toggle entirely (e.g. for staff-only deployments without public demos).',
    'presentation',
    NOW()
  ),
  (
    'presentation.font_scale',
    '1.2'::jsonb,
    'Font size multiplier applied when presentation mode is active. Default 1.2 (20% larger). Range: 1.0–1.5.',
    'presentation',
    NOW()
  ),
  (
    'presentation.indicator_text',
    '"Presentation Mode — press ESC to exit"'::jsonb,
    'Text shown in the floating indicator when presentation mode is active.',
    'presentation',
    NOW()
  ),

  -- Scrollytelling intro (3 slides at /story)
  (
    'story.enabled',
    'true'::jsonb,
    'Whether the /story scrollytelling intro page is accessible. Set to false to 404 the route.',
    'story',
    NOW()
  ),
  (
    'story.slide1_title',
    '"Sonoma County has thousands of community cats"'::jsonb,
    'Slide 1 (WHO) title. Sets up the scale of the problem.',
    'story',
    NOW()
  ),
  (
    'story.slide1_body',
    '"Most live outdoors. Most are unaltered. Every unaltered female can produce 2 to 3 litters a year. Without intervention, populations grow exponentially — and shelters fill with cats who never should have existed."'::jsonb,
    'Slide 1 (WHO) body text. Tell the human story.',
    'story',
    NOW()
  ),
  (
    'story.slide2_title',
    '"Beacon illuminates where help is needed most"'::jsonb,
    'Slide 2 (HOW) title. Introduces the product.',
    'story',
    NOW()
  ),
  (
    'story.slide2_body',
    '"Data-driven TNR tracking. Predictive population modeling. Real-time impact measurement. Beacon turns operational data into actionable insights so every trap, every volunteer hour, and every dollar goes where it will do the most good."'::jsonb,
    'Slide 2 (HOW) body text. Explain the product value.',
    'story',
    NOW()
  ),
  (
    'story.slide3_title',
    '"Since {year}: a quiet, measurable revolution"'::jsonb,
    'Slide 3 (WHAT) title. The {year} token is replaced with the earliest TNR year from the impact summary data.',
    'story',
    NOW()
  ),
  (
    'story.slide3_body',
    '"Every number you see here represents a life changed — and a cascade of lives prevented from ever suffering outdoors. This is what humane cat population management looks like when you have the data to back it up."'::jsonb,
    'Slide 3 (WHAT) body text. Context for the impact numbers.',
    'story',
    NOW()
  ),
  (
    'story.cta_label',
    '"Explore the map"'::jsonb,
    'Call-to-action button label at the end of the story. Points to /map by default.',
    'story',
    NOW()
  ),
  (
    'story.cta_href',
    '"/map"'::jsonb,
    'Call-to-action button URL. Can point anywhere — default /map, could be /beacon or an external fundraising page.',
    'story',
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
  SELECT COUNT(*) INTO v_count FROM ops.app_config
   WHERE category IN ('live_counter', 'presentation', 'story');
  IF v_count < 15 THEN
    RAISE EXCEPTION 'MIG_3072 verification failed: expected at least 15 Tier 3 config keys, found %', v_count;
  END IF;
  RAISE NOTICE 'MIG_3072 verification: % Tier 3 config keys present', v_count;
END $$;
