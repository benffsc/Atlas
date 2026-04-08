-- MIG_3070: Seed ops.app_config with Beacon impact summary multipliers
--
-- The dashboard Impact Summary card (components/dashboard/ImpactSummary.tsx)
-- translates operational data (cats altered) into mission outcomes (kittens
-- prevented, shelter cost avoided) using multipliers. These were previously
-- hardcoded constants in apps/web/src/app/api/dashboard/impact/route.ts,
-- which violates CLAUDE.md invariant: "New configuration value → ops.app_config
-- (admin-editable, NOT hardcoded constant)".
--
-- Per white-label requirements (FFS-1193 epic), any org deploying Beacon
-- needs to be able to set their own multipliers without a code change —
-- different orgs cite different numbers based on their local data and
-- donor communication preferences.
--
-- These keys appear in /admin/config automatically (the admin UI reads all
-- categories from ops.app_config generically).
--
-- Related: FFS-1194 (Tier 1 Beacon Polish)

INSERT INTO ops.app_config (key, value, description, category, updated_at)
VALUES
  (
    'impact.kittens_prevented_per_altered_cat',
    '10'::jsonb,
    'How many kittens we estimate are prevented per altered cat. Conservative floor. Used to compute the "kittens prevented" number on the dashboard impact summary. Industry sources cite 10 to 200+; default 10 is a defensible minimum. Orgs can raise this if they have stronger local data.',
    'impact',
    NOW()
  ),
  (
    'impact.shelter_cost_per_kitten_usd',
    '200'::jsonb,
    'Estimated shelter intake and processing cost avoided per prevented kitten (USD). Includes vaccinations, medical, food, housing, staff time. Many shelters cite $500+; default $200 is a conservative floor. Used to compute "shelter costs avoided" on the dashboard impact summary.',
    'impact',
    NOW()
  ),
  (
    'impact.enabled',
    'true'::jsonb,
    'Whether to show the Impact Summary card on the dashboard at all. Set to false for orgs that do not want to display mission-connected impact numbers (e.g. orgs with insufficient data or different communication preferences).',
    'impact',
    NOW()
  ),
  (
    'impact.card_title',
    '"Our impact"'::jsonb,
    'Heading on the Impact Summary card. Default "Our impact" (then appended with " since YEAR" from earliest record). Set to a custom heading to override.',
    'impact',
    NOW()
  ),
  (
    'impact.card_subtitle',
    '"Click any number to see the math"'::jsonb,
    'Subtitle text on the Impact Summary card. Default reminds users that stats are auditable. Override to customize the call-to-action.',
    'impact',
    NOW()
  ),
  (
    'impact.label_cats_altered',
    '"cats altered"'::jsonb,
    'Label for the first impact stat. Default "cats altered". Override for orgs that use different terminology (e.g. "sterilizations performed", "TNR interventions").',
    'impact',
    NOW()
  ),
  (
    'impact.label_kittens_prevented',
    '"kittens prevented"'::jsonb,
    'Label for the second impact stat. Default "kittens prevented".',
    'impact',
    NOW()
  ),
  (
    'impact.label_shelter_cost_avoided',
    '"shelter costs avoided"'::jsonb,
    'Label for the third impact stat. Default "shelter costs avoided".',
    'impact',
    NOW()
  ),
  (
    'impact.kittens_rationale',
    '"Conservative floor. Approximately 50% of altered cats are female. An unaltered female can have 2–3 litters per year of 4–5 kittens, with varying survival rates. Over a reproductive lifespan of 3–5 years for an unaltered community cat, prevented-kitten estimates range widely in the literature (10 to 200+). We use this multiplier as a deliberately defensible minimum to avoid overclaiming impact."'::jsonb,
    'Rationale text shown in the methodology drawer explaining why the kittens-prevented multiplier is set to its current value. Org-specific — update when the multiplier changes to keep the explanation consistent.',
    'impact',
    NOW()
  ),
  (
    'impact.shelter_cost_rationale',
    '"Widely cited intake and processing cost at municipal and community shelters. Includes vaccinations, medical care, food, housing, and staff time. Many shelters cite $500 or more per animal; we use this value as a conservative floor to avoid overclaiming financial impact."'::jsonb,
    'Rationale text shown in the methodology drawer explaining why the shelter cost per kitten is set to its current value.',
    'impact',
    NOW()
  ),
  (
    'impact.kittens_source_label',
    '"Alley Cat Allies — Trap-Neuter-Return guidance"'::jsonb,
    'External source link label shown in the kittens-prevented methodology drawer. Set to the primary citation your org uses for the multiplier.',
    'impact',
    NOW()
  ),
  (
    'impact.kittens_source_url',
    '"https://www.alleycat.org/our-work/trap-neuter-return/"'::jsonb,
    'External source URL shown in the kittens-prevented methodology drawer. Must be a full https:// URL or empty string.',
    'impact',
    NOW()
  )
ON CONFLICT (key) DO UPDATE
  SET
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    updated_at = NOW();

-- Verification: confirm all 12 keys exist in the impact category
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count FROM ops.app_config WHERE category = 'impact';
  IF v_count < 12 THEN
    RAISE EXCEPTION 'MIG_3070 verification failed: expected at least 12 impact.* config keys, found %', v_count;
  END IF;
  RAISE NOTICE 'MIG_3070 verification: % impact.* config keys present', v_count;
END $$;
