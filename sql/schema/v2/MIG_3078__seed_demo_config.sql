-- MIG_3078: Seed demo.* config keys for gala deck
--
-- Makes the /demo presentation deck fully admin-configurable.
-- All hardcoded strings (tagline, unit economics, vision copy, CTAs)
-- become editable via /admin/demo without code changes.
--
-- Pattern: follows MIG_3072 (story/presentation seed).
-- INSERT ON CONFLICT DO UPDATE preserves any values already customized
-- while updating descriptions and categories.
--
-- Related: FFS-1196 (Tier 3: Gala Mode), FFS-1193 (rebrand epic)

INSERT INTO ops.app_config (key, value, description, category, updated_at)
VALUES
  -- General
  (
    'demo.enabled',
    'true'::jsonb,
    'Kill switch for the /demo presentation deck. Set to false to redirect /demo to /.',
    'demo',
    NOW()
  ),
  (
    'demo.tagline',
    '"A guiding light for humane cat population management"'::jsonb,
    'Subtitle shown on the title slide beneath the Beacon logo.',
    'demo',
    NOW()
  ),

  -- Problem slide
  (
    'demo.clinic_distinction',
    '"FFSC is the only dedicated spay/neuter clinic for community cats in Sonoma County."'::jsonb,
    'Callout text on the problem slide explaining the org''s unique position.',
    'demo',
    NOW()
  ),

  -- Impact slide
  (
    'demo.impact_footnote',
    '"Every number is auditable — backed by individual cat records in the Beacon database"'::jsonb,
    'Footnote on the impact numbers slide reinforcing data credibility.',
    'demo',
    NOW()
  ),

  -- Zones slide
  (
    'demo.zones_title',
    '"Beacon shows exactly where intervention creates the greatest impact"'::jsonb,
    'Heading on the strategic insight / zones slide.',
    'demo',
    NOW()
  ),
  (
    'demo.zones_footnote',
    '"Predictive models forecast population trends so we can allocate resources before colonies grow"'::jsonb,
    'Footnote on the zones slide about predictive modeling.',
    'demo',
    NOW()
  ),

  -- Unit economics (The Ask)
  (
    'demo.ask_eyebrow',
    '"What your support does"'::jsonb,
    'Eyebrow label above the unit economics slide heading.',
    'demo',
    NOW()
  ),
  (
    'demo.ask_title',
    '"Every dollar is traceable to an outcome"'::jsonb,
    'Main heading on the unit economics / ask slide.',
    'demo',
    NOW()
  ),
  (
    'demo.unit_tier1_amount',
    '50'::jsonb,
    'Dollar amount for Tier 1 donation (single cat TNR).',
    'demo',
    NOW()
  ),
  (
    'demo.unit_tier1_outcome',
    '"1 cat trapped, neutered, vaccinated, ear-tipped, and returned"'::jsonb,
    'Outcome description for Tier 1 donation amount.',
    'demo',
    NOW()
  ),
  (
    'demo.unit_tier2_amount',
    '500'::jsonb,
    'Dollar amount for Tier 2 donation (colony stabilization).',
    'demo',
    NOW()
  ),
  (
    'demo.unit_tier2_outcome',
    '"One colony stabilized — ~10 cats fixed, kittens prevented for years"'::jsonb,
    'Outcome description for Tier 2 donation amount.',
    'demo',
    NOW()
  ),
  (
    'demo.unit_tier3_amount',
    '5000'::jsonb,
    'Dollar amount for Tier 3 donation (neighborhood-scale impact).',
    'demo',
    NOW()
  ),
  (
    'demo.unit_tier3_outcome',
    '"An entire neighborhood served — 100 cats, measurable population decline"'::jsonb,
    'Outcome description for Tier 3 donation amount.',
    'demo',
    NOW()
  ),
  (
    'demo.ask_body',
    '"Beacon tracks every cat from trap to return. Your donation isn''t a black box — it''s a pin on the map, a record in the database, a life changed."'::jsonb,
    'Body paragraph on the unit economics slide explaining donation traceability.',
    'demo',
    NOW()
  ),

  -- Vision slide
  (
    'demo.vision_body1',
    '"Beacon is the first data platform purpose-built for TNR. It integrates colony tracking, predictive modeling, volunteer coordination, and real-time impact reporting into a single system."'::jsonb,
    'First paragraph on the vision slide describing what Beacon is.',
    'demo',
    NOW()
  ),
  (
    'demo.vision_body2',
    '"What started at Forgotten Felines of Sonoma County is being built to serve any TNR organization that wants to prove their impact with data — scalable, replicable, and open."'::jsonb,
    'Second paragraph on the vision slide about scalability.',
    'demo',
    NOW()
  ),

  -- CTAs
  (
    'demo.cta1_label',
    '"See the full data"'::jsonb,
    'Label for the primary CTA button on the vision slide.',
    'demo',
    NOW()
  ),
  (
    'demo.cta1_href',
    '"/impact"'::jsonb,
    'URL for the primary CTA button. Can be internal path or external URL.',
    'demo',
    NOW()
  ),
  (
    'demo.cta2_label',
    '"Explore the dashboard"'::jsonb,
    'Label for the secondary CTA button on the vision slide.',
    'demo',
    NOW()
  ),
  (
    'demo.cta2_href',
    '"/"'::jsonb,
    'URL for the secondary CTA button.',
    'demo',
    NOW()
  )
ON CONFLICT (key) DO UPDATE
  SET
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    updated_at = NOW();

-- Verification
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count FROM ops.app_config
   WHERE category = 'demo';
  IF v_count < 20 THEN
    RAISE EXCEPTION 'MIG_3078 verification failed: expected at least 20 demo config keys, found %', v_count;
  END IF;
  RAISE NOTICE 'MIG_3078 verification: % demo config keys present', v_count;
END $$;
