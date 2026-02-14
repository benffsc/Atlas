-- MIG_288__vortex_population_parameters.sql
-- Vortex Population Model Parameters for Beacon Analytics
--
-- Purpose:
--   Add scientifically-accepted default values from Boone et al. 2019
--   for cat population modeling. These parameters are configurable via
--   the admin panel and power Beacon's predictive analytics.
--
-- Scientific Source:
--   Boone, J.D. et al. (2019) "A Long-Term Lens: Cumulative Impacts of
--   Free-Roaming Cat Management Strategy and Intensity on Preventable
--   Cat Mortalities" - Frontiers in Veterinary Science 6:238
--
-- Key Insight:
--   FFSC is the ONLY dedicated spay/neuter clinic for community cats in
--   Sonoma County. Our clinic data IS the ground truth for alterations.
--   Other organizations do small quantities; we do mass quantities.
--   Therefore: alteration rate = FFSC clinic alterations / population
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_288__vortex_population_parameters.sql

\echo ''
\echo 'MIG_288: Vortex Population Model Parameters'
\echo '============================================'
\echo ''
\echo 'Adding scientifically-accepted defaults from Boone et al. 2019'
\echo 'for Beacon population modeling.'
\echo ''

-- ============================================================
-- 1. Add Reproduction Parameters
-- ============================================================

\echo 'Adding reproduction parameters...'

INSERT INTO trapper.ecology_config (config_key, config_value, unit, description, min_value, max_value) VALUES

    -- Reproduction rates
    ('litters_per_year', 1.8, 'litters',
     'Average litters per breeding female per year. Boone 2019: 1.6-2.0. Modulated by population density.',
     1.0, 3.0),

    ('kittens_per_litter', 4, 'kittens',
     'Average kittens per litter. Literature range: 3-5.',
     2, 6),

    ('breeding_season_start_month', 2, 'month',
     'Breeding season start (February). California climate allows Feb-Nov breeding.',
     1, 12),

    ('breeding_season_end_month', 11, 'month',
     'Breeding season end (November). California climate allows Feb-Nov breeding.',
     1, 12),

    ('female_maturity_months', 6, 'months',
     'Age at sexual maturity for females. Can breed at 6 months.',
     4, 12),

    ('male_maturity_months', 8, 'months',
     'Age at sexual maturity for males. Typically 8-12 months.',
     6, 15),

    -- Survival rates (Boone 2019 model values)
    ('kitten_survival_rate_low_density', 0.50, 'proportion',
     'Kitten survival rate at LOW population density (0-50% of carrying capacity). Boone 2019: ~50%.',
     0.25, 0.90),

    ('kitten_survival_rate_high_density', 0.25, 'proportion',
     'Kitten survival rate at HIGH population density (near carrying capacity). Boone 2019: ~25%. Density-dependent mortality.',
     0.10, 0.50),

    ('adult_survival_rate', 0.70, 'proportion',
     'Annual adult survival rate. Boone 2019: 60-80%. Includes all causes of mortality.',
     0.50, 0.90),

    -- TNR effectiveness thresholds (from Vortex simulations)
    ('tnr_high_intensity_rate', 0.75, 'proportion',
     'High-intensity TNR: 75% of intact cats sterilized per 6-month cycle. Boone 2019: Reduces population 70% in 6 years.',
     0.50, 0.95),

    ('tnr_low_intensity_rate', 0.50, 'proportion',
     'Low-intensity TNR: 50% of intact cats sterilized per 6-month cycle. Boone 2019: Minimal population reduction.',
     0.30, 0.70),

    ('tnr_time_step_months', 6, 'months',
     'Time step for TNR intensity calculations. Vortex model uses 6-month cycles.',
     3, 12),

    -- Immigration (cats arriving from outside the colony)
    ('immigration_rate_low', 0.5, 'cats/6mo',
     'Low immigration: 0.5 cats per colony per 6-month period. Used for isolated colonies.',
     0, 2),

    ('immigration_rate_high', 2.0, 'cats/6mo',
     'High immigration: 2.0 cats per colony per 6-month period. Used for urban/connected areas.',
     0.5, 5),

    ('default_immigration_rate', 1.0, 'cats/6mo',
     'Default immigration rate when location context unknown. Boone 2019 midpoint.',
     0.5, 2.0),

    -- FFSC-specific ground truth settings
    ('ffsc_is_primary_clinic', 1, 'boolean',
     'FFSC is the ONLY dedicated spay/neuter clinic for community cats in Sonoma County. 1=Yes, 0=No. Determines if clinic data = ground truth.',
     0, 1),

    ('external_alteration_rate', 0.02, 'proportion',
     'Estimated proportion of community cats altered by other organizations. Very low since FFSC handles mass quantities.',
     0, 0.20),

    -- Population carrying capacity
    ('colony_carrying_capacity_default', 30, 'cats',
     'Default carrying capacity per colony site. Density-dependent mortality kicks in as population approaches this.',
     10, 100),

    ('density_mortality_threshold', 0.70, 'proportion',
     'Population density (as proportion of carrying capacity) at which density-dependent mortality begins.',
     0.50, 0.90)

ON CONFLICT (config_key) DO NOTHING;

-- ============================================================
-- 2. Add Configuration Categories (for UI grouping)
-- ============================================================

\echo ''
\echo 'Adding config_category column if not exists...'

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'ecology_config'
        AND column_name = 'config_category'
    ) THEN
        ALTER TABLE trapper.ecology_config
        ADD COLUMN config_category TEXT DEFAULT 'general';

        COMMENT ON COLUMN trapper.ecology_config.config_category IS
        'Category for grouping configs in admin UI: reproduction, survival, tnr, immigration, ffsc, thresholds';
    END IF;
END $$;

-- Update categories for new Vortex parameters
UPDATE trapper.ecology_config SET config_category = 'reproduction'
WHERE config_key IN ('litters_per_year', 'kittens_per_litter', 'breeding_season_start_month',
                     'breeding_season_end_month', 'female_maturity_months', 'male_maturity_months');

UPDATE trapper.ecology_config SET config_category = 'survival'
WHERE config_key IN ('kitten_survival_rate_low_density', 'kitten_survival_rate_high_density',
                     'adult_survival_rate', 'cat_lifespan_years');

UPDATE trapper.ecology_config SET config_category = 'tnr'
WHERE config_key IN ('tnr_high_intensity_rate', 'tnr_low_intensity_rate', 'tnr_time_step_months',
                     'high_alteration_threshold', 'medium_alteration_threshold', 'complete_colony_threshold');

UPDATE trapper.ecology_config SET config_category = 'immigration'
WHERE config_key IN ('immigration_rate_low', 'immigration_rate_high', 'default_immigration_rate');

UPDATE trapper.ecology_config SET config_category = 'ffsc'
WHERE config_key IN ('ffsc_is_primary_clinic', 'external_alteration_rate');

UPDATE trapper.ecology_config SET config_category = 'colony'
WHERE config_key IN ('colony_carrying_capacity_default', 'density_mortality_threshold',
                     'max_reasonable_colony_size', 'min_reports_for_confidence');

UPDATE trapper.ecology_config SET config_category = 'observation'
WHERE config_key IN ('recent_report_window_days', 'eartip_observation_window_days',
                     'clinic_revisit_extension_years');

-- ============================================================
-- 3. Add Scientific Reference Column
-- ============================================================

\echo ''
\echo 'Adding scientific_reference column if not exists...'

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'ecology_config'
        AND column_name = 'scientific_reference'
    ) THEN
        ALTER TABLE trapper.ecology_config
        ADD COLUMN scientific_reference TEXT;

        COMMENT ON COLUMN trapper.ecology_config.scientific_reference IS
        'Citation for the default value. Helps staff understand why a value was chosen.';
    END IF;
END $$;

-- Update references for Vortex parameters
UPDATE trapper.ecology_config SET scientific_reference = 'Boone et al. 2019, Frontiers in Veterinary Science 6:238'
WHERE config_key IN (
    'litters_per_year', 'kittens_per_litter', 'kitten_survival_rate_low_density',
    'kitten_survival_rate_high_density', 'adult_survival_rate', 'tnr_high_intensity_rate',
    'tnr_low_intensity_rate', 'tnr_time_step_months', 'immigration_rate_low',
    'immigration_rate_high', 'default_immigration_rate', 'density_mortality_threshold'
);

UPDATE trapper.ecology_config SET scientific_reference = 'California climate (Feb-Nov breeding typical)'
WHERE config_key IN ('breeding_season_start_month', 'breeding_season_end_month');

UPDATE trapper.ecology_config SET scientific_reference = 'Veterinary literature consensus'
WHERE config_key IN ('female_maturity_months', 'male_maturity_months');

UPDATE trapper.ecology_config SET scientific_reference = 'FFSC operational knowledge - only dedicated community cat clinic'
WHERE config_key IN ('ffsc_is_primary_clinic', 'external_alteration_rate');

-- ============================================================
-- 4. Population Model Equations (For Reference)
-- ============================================================

\echo ''
\echo 'Key equations for Beacon population modeling:'
\echo ''
\echo '┌─────────────────────────────────────────────────────────────────────────┐'
\echo '│ CHAPMAN MARK-RECAPTURE ESTIMATOR (Current Population)                   │'
\echo '│                                                                          │'
\echo '│   N̂ = ((M + 1)(C + 1) / (R + 1)) - 1                                    │'
\echo '│                                                                          │'
\echo '│   Where:                                                                 │'
\echo '│     N̂ = Estimated population                                            │'
\echo '│     M = Marked cats (verified altered from FFSC clinic)                  │'
\echo '│     C = Total cats observed in sample                                    │'
\echo '│     R = Recaptured marked cats (ear-tipped cats observed)                │'
\echo '│                                                                          │'
\echo '│   Note: M comes ONLY from FFSC clinic data (ground truth)                │'
\echo '└─────────────────────────────────────────────────────────────────────────┘'
\echo ''
\echo '┌─────────────────────────────────────────────────────────────────────────┐'
\echo '│ ALTERATION RATE                                                          │'
\echo '│                                                                          │'
\echo '│   p = A / N                                                              │'
\echo '│                                                                          │'
\echo '│   Where:                                                                 │'
\echo '│     p = Alteration rate (proportion fixed)                               │'
\echo '│     A = Cats altered by FFSC (verified clinic records)                   │'
\echo '│     N = Estimated population (from Chapman or survey)                    │'
\echo '│                                                                          │'
\echo '│   FFSC Assumption: External alteration rate ≈ 2% (negligible)            │'
\echo '│   Therefore: Total altered ≈ FFSC altered                                │'
\echo '└─────────────────────────────────────────────────────────────────────────┘'
\echo ''
\echo '┌─────────────────────────────────────────────────────────────────────────┐'
\echo '│ POPULATION GROWTH (Vortex Model - Boone 2019)                           │'
\echo '│                                                                          │'
\echo '│   N(t+1) = N(t) + Births - Deaths + Immigration - Emigration             │'
\echo '│                                                                          │'
\echo '│   Births = F_intact × litters_per_year × kittens_per_litter × survival   │'
\echo '│                                                                          │'
\echo '│   Where:                                                                 │'
\echo '│     F_intact = Females × (1 - alteration_rate) × 0.5                     │'
\echo '│     survival = density-dependent (25% at high density, 50% at low)       │'
\echo '│                                                                          │'
\echo '│   Key Finding: 75% TNR intensity → 70% population reduction in 6 years   │'
\echo '│                50% TNR intensity → minimal reduction                     │'
\echo '└─────────────────────────────────────────────────────────────────────────┘'
\echo ''
\echo '┌─────────────────────────────────────────────────────────────────────────┐'
\echo '│ DENSITY-DEPENDENT KITTEN SURVIVAL                                        │'
\echo '│                                                                          │'
\echo '│   S_kitten = S_max - (S_max - S_min) × (N / K)                           │'
\echo '│                                                                          │'
\echo '│   Where:                                                                 │'
\echo '│     S_kitten = Kitten survival rate                                      │'
\echo '│     S_max = Survival at low density (50%, config: kitten_survival_low)   │'
\echo '│     S_min = Survival at high density (25%, config: kitten_survival_high) │'
\echo '│     N = Current population                                               │'
\echo '│     K = Carrying capacity                                                │'
\echo '└─────────────────────────────────────────────────────────────────────────┘'
\echo ''
\echo '┌─────────────────────────────────────────────────────────────────────────┐'
\echo '│ TIME TO COLONY COMPLETION ESTIMATE                                       │'
\echo '│                                                                          │'
\echo '│   T = (N × (1 - p)) / (TNR_rate × capacity_per_cycle)                    │'
\echo '│                                                                          │'
\echo '│   Where:                                                                 │'
\echo '│     T = Estimated cycles to completion                                   │'
\echo '│     N = Current population                                               │'
\echo '│     p = Current alteration rate                                          │'
\echo '│     TNR_rate = Target TNR intensity (0.75 for high)                      │'
\echo '│     capacity_per_cycle = Cats FFSC can process per 6-month cycle         │'
\echo '└─────────────────────────────────────────────────────────────────────────┘'

COMMENT ON TABLE trapper.ecology_config IS
'Configurable parameters for ecology and population modeling.

GROUND TRUTH PRINCIPLE:
FFSC is the ONLY dedicated spay/neuter clinic for community cats in Sonoma County.
Other organizations do small quantities; FFSC does mass quantities (4,000+/year).
Therefore, FFSC clinic data = ground truth for alteration counts.

KEY EQUATIONS:

1. Chapman Mark-Recapture: N̂ = ((M+1)(C+1)/(R+1)) - 1
   - M from FFSC clinic (verified), C and R from observations

2. Alteration Rate: p = FFSC_altered / N
   - External alterations negligible (~2%)

3. Population Growth: N(t+1) = N(t) + Births - Deaths + Immigration
   - Births depend on intact females and density-dependent survival

4. Density-Dependent Survival: S = S_max - (S_max - S_min) × (N/K)
   - Kitten survival drops as population approaches carrying capacity

All default values from Boone et al. 2019 (Frontiers in Veterinary Science 6:238).
Changes are audited via ecology_config_audit table.';

-- ============================================================
-- 5. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Ecology configuration by category:';
SELECT
    config_category,
    config_key,
    config_value,
    unit,
    SUBSTRING(description, 1, 60) AS description_preview
FROM trapper.ecology_config
ORDER BY config_category, config_key;

\echo ''
\echo 'Parameter counts by category:';
SELECT config_category, COUNT(*) as param_count
FROM trapper.ecology_config
GROUP BY config_category
ORDER BY config_category;

\echo ''
\echo 'Parameters with scientific references:';
SELECT COUNT(*) as with_reference
FROM trapper.ecology_config
WHERE scientific_reference IS NOT NULL;

SELECT 'MIG_288 Complete' AS status;
