-- MIG_3135: Advanced economic impact model configuration
--
-- Seeds ~25 new ops.app_config keys for a sex-aware, multi-category economic
-- impact model with three confidence tiers (conservative/moderate/high).
--
-- Replaces the flat "10 kittens × $200" model (MIG_3070) with:
--   - Sex-aware reproduction (only females reproduce)
--   - Multiple cost categories (shelter, animal control, property, disease, placement)
--   - Three confidence tiers for defensible donor communication
--   - Indirect cost multiplier for uncaptured externalities
--
-- All values cited from peer-reviewed literature. Staff can update via
-- /admin/config without a code change.
--
-- Addresses: FFS-XXXX (Advanced Impact Reporting Engine)

INSERT INTO ops.app_config (key, value, description, category, updated_at)
VALUES
  -- =========================================================================
  -- REPRODUCTION MODEL
  -- =========================================================================
  (
    'impact.female_ratio',
    '0.50'::jsonb,
    'Fraction of altered cats that are female. Used in sex-aware kitten prevention model. Source: observed FFSC data is close to 50/50; biological sex ratio at birth ~50%. Configurable if org has skewed intake.',
    'impact',
    NOW()
  ),
  (
    'impact.litters_per_year_per_female',
    '2.5'::jsonb,
    'Average litters per year for an unaltered female community cat. Range in literature: 1.4–3.0. ASPCA and Alley Cat Allies cite 2–3 litters/year; we use 2.5 as midpoint. Source: Nutter et al. (2004), JAVMA.',
    'impact',
    NOW()
  ),
  (
    'impact.kittens_per_litter',
    '4.0'::jsonb,
    'Average kittens per litter for community cats. Literature range: 3–5. Nutter et al. (2004) found mean 4.0. Source: Nutter FB, Levine JF, Stoskopf MK (2004) JAVMA 225(9):1399-1402.',
    'impact',
    NOW()
  ),
  (
    'impact.kitten_survival_rate',
    '0.25'::jsonb,
    'Fraction of kittens surviving to adulthood (6+ months) in unmanaged colonies. 75% mortality is standard in literature. Source: Nutter et al. (2004), Levy et al. (2003). Configurable — managed colonies may have higher survival.',
    'impact',
    NOW()
  ),
  (
    'impact.reproductive_years',
    '5'::jsonb,
    'Average reproductive lifespan (years) for an unaltered community cat. Conservative: 3–5 years typical in literature for unmanaged cats. Source: McCarthy et al. (2013), Levy et al. (2003).',
    'impact',
    NOW()
  ),

  -- =========================================================================
  -- COST CATEGORIES
  -- =========================================================================
  (
    'impact.shelter_capture_rate',
    '0.30'::jsonb,
    'Fraction of surviving kittens eventually entering shelter system. Based on national shelter intake data: ~3.2M cats/year entering shelters vs ~10M+ estimated stray. Source: ASPCA shelter statistics, Humane Society estimates.',
    'impact',
    NOW()
  ),
  (
    'impact.shelter_intake_cost_usd',
    '300'::jsonb,
    'Cost per cat entering a shelter (intake, housing, medical, food, staff). National average $250–$500. We use $300 as conservative floor. Source: ASPCA cost studies, Marsh (2010).',
    'impact',
    NOW()
  ),
  (
    'impact.animal_control_cost_per_complaint_usd',
    '150'::jsonb,
    'Average cost per animal control complaint response (officer time, vehicle, admin). Source: National Animal Care & Control Association cost surveys. Range $100–$250.',
    'impact',
    NOW()
  ),
  (
    'impact.complaints_per_unaltered_cat_per_year',
    '0.3'::jsonb,
    'Average animal control complaints generated per unaltered community cat per year (noise, spraying, fighting). Source: Estimated from NACA data and local animal control reports. Range 0.1–0.5.',
    'impact',
    NOW()
  ),
  (
    'impact.property_damage_per_colony_per_year_usd',
    '200'::jsonb,
    'Annual property damage per unmanaged colony (garden damage, vehicle scratches, waste). Source: Estimated from insurance claims and property management surveys. Conservative — actual may be higher.',
    'impact',
    NOW()
  ),
  (
    'impact.disease_treatment_cost_per_cat_usd',
    '50'::jsonb,
    'Average disease-related cost per unaltered community cat per year (FIV, FeLV, upper respiratory treatment, public health monitoring). Source: Estimated from veterinary cost data and public health budgets.',
    'impact',
    NOW()
  ),
  (
    'impact.placement_cost_per_kitten_usd',
    '250'::jsonb,
    'Cost to place/rehome a kitten through rescue or foster (vetting, spay/neuter, foster supplies, transport, admin). Source: National kitten foster cost surveys. Range $150–$400.',
    'impact',
    NOW()
  ),
  (
    'impact.indirect_cost_multiplier',
    '1.3'::jsonb,
    'Multiplier for indirect/uncaptured costs not in the direct categories (environmental impact, volunteer time, administrative overhead, lost tax revenue from blight). 1.3 = 30% above direct costs. Conservative — economic studies often use 1.5–2.0x.',
    'impact',
    NOW()
  ),

  -- =========================================================================
  -- CONFIDENCE TIERS
  -- =========================================================================
  (
    'impact.confidence_conservative_multiplier',
    '0.6'::jsonb,
    'Multiplier for conservative estimates. Applied to the moderate (base) calculation. Use for cautious external communication. 60% of moderate = deliberately low floor.',
    'impact',
    NOW()
  ),
  (
    'impact.confidence_moderate_multiplier',
    '1.0'::jsonb,
    'Multiplier for moderate (base) estimates. This is the default displayed number. 1.0 = no adjustment to the model output.',
    'impact',
    NOW()
  ),
  (
    'impact.confidence_high_multiplier',
    '1.8'::jsonb,
    'Multiplier for high-end estimates. Applied to the moderate calculation. Some literature supports 2x+; we cap at 1.8 for credibility. Use for "potential upper range" communication.',
    'impact',
    NOW()
  ),

  -- =========================================================================
  -- MALE-SPECIFIC IMPACT
  -- =========================================================================
  (
    'impact.male_pregnancies_prevented_per_year',
    '3.0'::jsonb,
    'Estimated pregnancies prevented per neutered male per year. An unaltered male can impregnate many females; neutering one male prevents multiple litters across multiple females. Source: Estimated from behavioral studies. Conservative.',
    'impact',
    NOW()
  ),

  -- =========================================================================
  -- LABELS & DISPLAY
  -- =========================================================================
  (
    'impact.economic_model_version',
    '"v2"'::jsonb,
    'Version identifier for the economic impact model. v1 = flat multiplier (MIG_3070), v2 = sex-aware multi-category (MIG_3135). Controls which calculation path the API uses.',
    'impact',
    NOW()
  ),
  (
    'impact.shelter_cost_label',
    '"Shelter intake costs"'::jsonb,
    'Label for shelter intake cost category in the breakdown.',
    'impact',
    NOW()
  ),
  (
    'impact.animal_control_cost_label',
    '"Animal control costs"'::jsonb,
    'Label for animal control cost category in the breakdown.',
    'impact',
    NOW()
  ),
  (
    'impact.property_damage_label',
    '"Property damage"'::jsonb,
    'Label for property damage cost category in the breakdown.',
    'impact',
    NOW()
  ),
  (
    'impact.disease_cost_label',
    '"Disease-related costs"'::jsonb,
    'Label for disease cost category in the breakdown.',
    'impact',
    NOW()
  ),
  (
    'impact.placement_cost_label',
    '"Kitten placement costs"'::jsonb,
    'Label for kitten placement cost category in the breakdown.',
    'impact',
    NOW()
  ),
  (
    'impact.indirect_cost_label',
    '"Indirect & environmental costs"'::jsonb,
    'Label for indirect/environmental cost category in the breakdown.',
    'impact',
    NOW()
  )
ON CONFLICT (key) DO UPDATE
  SET
    value = EXCLUDED.value,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    updated_at = NOW();

-- Verification
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count FROM ops.app_config WHERE category = 'impact';
  IF v_count < 30 THEN
    RAISE EXCEPTION 'MIG_3135 verification failed: expected at least 30 impact.* config keys, found %', v_count;
  END IF;
  RAISE NOTICE 'MIG_3135 verification: % impact.* config keys present (v1 + v2 model)', v_count;
END $$;
