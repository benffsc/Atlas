-- ============================================================================
-- MIG_701: Reference Data Tables for Tippy & Beacon
-- ============================================================================
-- Purpose: Provides reference data for Tippy's database intelligence and
-- Beacon's population modeling calculations.
--
-- Tables:
-- 1. ref_ecological_parameters - Scientific parameters (Boone et al. 2019)
-- 2. ref_organizations - Shelters, rescues, and partner organizations
-- 3. ref_sonoma_geography - Sonoma County geographic areas
--
-- These tables enable Tippy to:
-- - Answer questions about ecological calculations
-- - Cite peer-reviewed sources for population modeling
-- - Understand local geography and organizations
-- ============================================================================

\echo '=== MIG_701: Reference Data Tables ==='

-- ============================================================================
-- 1. Ecological Parameters Table
-- ============================================================================
\echo 'Creating ecological parameters reference table...'

CREATE TABLE IF NOT EXISTS trapper.ref_ecological_parameters (
  param_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  param_name TEXT NOT NULL UNIQUE,
  param_value NUMERIC,
  param_unit TEXT,
  description TEXT,
  source_citation TEXT,
  source_year INT,
  applicable_to TEXT DEFAULT 'all', -- 'urban', 'rural', 'all'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ref_eco_params_name
ON trapper.ref_ecological_parameters(param_name);

COMMENT ON TABLE trapper.ref_ecological_parameters IS
'Scientific parameters for cat population modeling. Primary source: Boone et al. 2019 "Community cats: a life history model".';

-- Insert Boone et al. 2019 parameters
INSERT INTO trapper.ref_ecological_parameters (param_name, param_value, param_unit, description, source_citation, source_year, applicable_to)
VALUES
  -- Survival rates
  ('kitten_survival_annual', 0.25, 'proportion',
   'Kitten survival rate to 1 year of age. Most kittens die before reaching adulthood.',
   'Boone et al. 2019 "Community cats: a life history model"', 2019, 'all'),

  ('adult_survival_annual', 0.80, 'proportion',
   'Adult cat (1+ year) annual survival rate in managed colonies.',
   'Boone et al. 2019', 2019, 'all'),

  ('adult_survival_unmanaged', 0.60, 'proportion',
   'Adult cat survival in unmanaged/feral conditions without caretaker.',
   'Estimated from multiple sources', 2019, 'rural'),

  -- Reproduction
  ('litters_per_year', 1.4, 'count',
   'Average number of litters per breeding female per year.',
   'Boone et al. 2019', 2019, 'all'),

  ('kittens_per_litter', 3.5, 'count',
   'Average kittens per litter (surviving to weaning).',
   'Boone et al. 2019', 2019, 'all'),

  ('breeding_age_months', 6.0, 'months',
   'Age at which female cats can begin reproducing.',
   'Standard veterinary reference', 2019, 'all'),

  ('breeding_season_months', 9.0, 'months',
   'Duration of breeding season in temperate climates (Feb-Oct in Sonoma).',
   'Regional observation', 2020, 'all'),

  -- TNR thresholds
  ('tnr_threshold_stabilization', 0.70, 'proportion',
   'Alteration rate needed to stabilize population (no growth).',
   'Miller et al. 2014', 2014, 'all'),

  ('tnr_threshold_decline', 0.75, 'proportion',
   'Alteration rate needed for population decline (the 75% rule).',
   'Boone et al. 2019', 2019, 'all'),

  ('tnr_threshold_rapid_decline', 0.85, 'proportion',
   'Alteration rate for rapid population reduction.',
   'Boone et al. 2019', 2019, 'all'),

  -- Immigration/emigration
  ('immigration_rate_urban', 0.15, 'proportion',
   'Annual immigration rate in urban/suburban areas (new cats entering population).',
   'Estimated based on regional movement patterns', 2020, 'urban'),

  ('immigration_rate_rural', 0.05, 'proportion',
   'Annual immigration rate in rural/isolated areas.',
   'Estimated based on regional movement patterns', 2020, 'rural'),

  ('emigration_rate', 0.10, 'proportion',
   'Annual emigration/dispersal rate (cats leaving the colony).',
   'Estimated', 2020, 'all'),

  -- Colony dynamics
  ('carrying_capacity_urban_acre', 25.0, 'cats/acre',
   'Maximum cat density in food-rich urban environments.',
   'Regional estimate', 2020, 'urban'),

  ('carrying_capacity_rural_acre', 5.0, 'cats/acre',
   'Maximum cat density in rural areas.',
   'Regional estimate', 2020, 'rural'),

  -- Chapman estimator parameters
  ('chapman_min_marked', 5.0, 'count',
   'Minimum number of marked (altered) cats for reliable Chapman estimate.',
   'Statistical recommendation', 2020, 'all'),

  ('chapman_min_recapture', 3.0, 'count',
   'Minimum number of recaptures (observed eartips) for reliable estimate.',
   'Statistical recommendation', 2020, 'all')

ON CONFLICT (param_name) DO UPDATE SET
  param_value = EXCLUDED.param_value,
  param_unit = EXCLUDED.param_unit,
  description = EXCLUDED.description,
  source_citation = EXCLUDED.source_citation,
  source_year = EXCLUDED.source_year,
  applicable_to = EXCLUDED.applicable_to,
  updated_at = NOW();

-- ============================================================================
-- 2. Organizations Reference Table
-- ============================================================================
\echo 'Creating organizations reference table...'

CREATE TABLE IF NOT EXISTS trapper.ref_organizations (
  org_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name TEXT NOT NULL,
  org_type TEXT NOT NULL, -- 'shelter', 'rescue', 'clinic', 'municipal', 'partner'
  short_name TEXT,
  service_area TEXT[],
  address TEXT,
  city TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  phone TEXT,
  website TEXT,
  email TEXT,
  intake_policy TEXT, -- 'open', 'limited', 'appointment', 'emergency_only'
  accepts_feral BOOLEAN DEFAULT false,
  tnr_partner BOOLEAN DEFAULT false,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ref_orgs_type
ON trapper.ref_organizations(org_type);

CREATE INDEX IF NOT EXISTS idx_ref_orgs_city
ON trapper.ref_organizations(city);

CREATE INDEX IF NOT EXISTS idx_ref_orgs_active
ON trapper.ref_organizations(is_active)
WHERE is_active = true;

COMMENT ON TABLE trapper.ref_organizations IS
'Reference table of shelters, rescues, clinics, and partner organizations in Sonoma County area.';

-- Insert known organizations
INSERT INTO trapper.ref_organizations (org_name, short_name, org_type, service_area, city, accepts_feral, tnr_partner, intake_policy, notes)
VALUES
  ('Forgotten Felines of Sonoma County', 'FFSC', 'clinic',
   ARRAY['Sonoma County'], 'Santa Rosa', true, true, 'appointment',
   'Primary TNR clinic for Sonoma County. Community cat spay/neuter specialists. Ground truth source for alteration data.'),

  ('Sonoma County Animal Services', 'SCAS', 'shelter',
   ARRAY['Sonoma County'], 'Santa Rosa', true, false, 'open',
   'County-run animal shelter. Open intake. Handles strays and owner surrenders.'),

  ('Humane Society of Sonoma County', 'HSSC', 'shelter',
   ARRAY['Sonoma County'], 'Santa Rosa', false, false, 'limited',
   'Private humane society. Limited intake. Focus on adoptable animals.'),

  ('Petaluma Animal Services', 'PAS', 'municipal',
   ARRAY['Petaluma', 'Penngrove'], 'Petaluma', true, false, 'open',
   'City of Petaluma animal services. Handles Petaluma city limits.'),

  ('Santa Rosa Animal Care', 'SRAC', 'municipal',
   ARRAY['Santa Rosa'], 'Santa Rosa', true, false, 'open',
   'City of Santa Rosa animal services.'),

  ('Healdsburg Animal Shelter', NULL, 'municipal',
   ARRAY['Healdsburg'], 'Healdsburg', true, false, 'open',
   'City of Healdsburg animal services.'),

  ('Sonoma Humane Society', NULL, 'shelter',
   ARRAY['Sonoma Valley'], 'Sonoma', false, false, 'limited',
   'Sonoma Valley humane society.'),

  ('Pets Lifeline', NULL, 'rescue',
   ARRAY['Sonoma Valley'], 'Sonoma', false, false, 'limited',
   'Sonoma Valley pet rescue organization.'),

  ('North Bay Animal Services', 'NBAS', 'partner',
   ARRAY['Marin County', 'Sonoma County'], 'Novato', true, false, 'limited',
   'Regional animal services covering parts of North Bay.'),

  ('Milo Foundation', NULL, 'rescue',
   ARRAY['Sonoma County', 'Bay Area'], 'Point Richmond', false, false, 'limited',
   'Bay Area rescue organization that occasionally takes Sonoma cats.')

ON CONFLICT DO NOTHING;

-- ============================================================================
-- 3. Sonoma Geography Reference Table
-- ============================================================================
\echo 'Creating Sonoma geography reference table...'

CREATE TABLE IF NOT EXISTS trapper.ref_sonoma_geography (
  area_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_type TEXT NOT NULL, -- 'city', 'zip', 'service_zone', 'neighborhood', 'county', 'region'
  area_name TEXT NOT NULL,
  area_code TEXT, -- ZIP code, city code, etc.
  parent_area_id UUID REFERENCES trapper.ref_sonoma_geography(area_id),
  population INT,
  households INT,
  area_sq_miles NUMERIC(10, 2),
  housing_density NUMERIC(10, 2), -- households per sq mile
  urban_rural TEXT, -- 'urban', 'suburban', 'rural'
  boundary_geom GEOMETRY(MultiPolygon, 4326),
  centroid_lat DOUBLE PRECISION,
  centroid_lng DOUBLE PRECISION,
  data_source TEXT,
  data_year INT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ref_geo_type
ON trapper.ref_sonoma_geography(area_type);

CREATE INDEX IF NOT EXISTS idx_ref_geo_name
ON trapper.ref_sonoma_geography(area_name);

CREATE INDEX IF NOT EXISTS idx_ref_geo_parent
ON trapper.ref_sonoma_geography(parent_area_id);

CREATE INDEX IF NOT EXISTS idx_ref_geo_spatial
ON trapper.ref_sonoma_geography USING GIST(boundary_geom)
WHERE boundary_geom IS NOT NULL;

COMMENT ON TABLE trapper.ref_sonoma_geography IS
'Geographic reference data for Sonoma County including cities, ZIP codes, and service zones.';

-- Insert service zones (matching Atlas service_zone values)
INSERT INTO trapper.ref_sonoma_geography (area_type, area_name, urban_rural, notes)
VALUES
  ('service_zone', 'Santa Rosa', 'urban', 'Largest city in Sonoma County. High cat population density.'),
  ('service_zone', 'Petaluma', 'suburban', 'Second largest city. Mix of urban core and rural edges.'),
  ('service_zone', 'West County', 'suburban', 'Sebastopol, Occidental, coastal areas. Mix of rural and small-town.'),
  ('service_zone', 'North County', 'rural', 'Healdsburg, Cloverdale, Geyserville. Wine country, rural.'),
  ('service_zone', 'South County', 'suburban', 'Rohnert Park, Cotati. College town atmosphere.'),
  ('service_zone', 'Sonoma Valley', 'suburban', 'City of Sonoma, Glen Ellen, Kenwood. Tourist/wine region.'),
  ('service_zone', 'Other', 'rural', 'Unincorporated areas not in other zones.')
ON CONFLICT DO NOTHING;

-- Insert Sonoma County summary
INSERT INTO trapper.ref_sonoma_geography (
  area_type, area_name, population, households, area_sq_miles,
  data_source, data_year, notes
)
VALUES (
  'county', 'Sonoma County', 488863, 194306, 1575.96,
  'US Census ACS 5-year estimate', 2022,
  'Sonoma County, California. Primary service area for FFSC.'
)
ON CONFLICT DO NOTHING;

-- Insert major cities with approximate data
INSERT INTO trapper.ref_sonoma_geography (
  area_type, area_name, population, households, area_sq_miles,
  urban_rural, data_source, data_year
)
VALUES
  ('city', 'Santa Rosa', 178127, 68000, 41.5, 'urban', 'US Census 2020', 2020),
  ('city', 'Petaluma', 59776, 23500, 14.9, 'suburban', 'US Census 2020', 2020),
  ('city', 'Rohnert Park', 44390, 17000, 6.7, 'suburban', 'US Census 2020', 2020),
  ('city', 'Windsor', 27613, 9700, 7.3, 'suburban', 'US Census 2020', 2020),
  ('city', 'Healdsburg', 12096, 5100, 4.4, 'suburban', 'US Census 2020', 2020),
  ('city', 'Sebastopol', 7694, 3400, 1.8, 'suburban', 'US Census 2020', 2020),
  ('city', 'Sonoma', 10648, 4800, 2.7, 'suburban', 'US Census 2020', 2020),
  ('city', 'Cotati', 7541, 3000, 1.8, 'suburban', 'US Census 2020', 2020),
  ('city', 'Cloverdale', 8930, 3400, 2.9, 'suburban', 'US Census 2020', 2020)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 4. Helper Functions
-- ============================================================================
\echo 'Creating helper functions...'

-- Get ecological parameter by name
CREATE OR REPLACE FUNCTION trapper.get_eco_param(p_name TEXT)
RETURNS NUMERIC AS $$
  SELECT param_value FROM trapper.ref_ecological_parameters WHERE param_name = p_name;
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION trapper.get_eco_param(TEXT) IS
'Get an ecological parameter value by name. Returns NULL if not found.';

-- Get all parameters for a context (urban/rural/all)
CREATE OR REPLACE FUNCTION trapper.get_eco_params_for_context(p_context TEXT DEFAULT 'all')
RETURNS TABLE (
  param_name TEXT,
  param_value NUMERIC,
  param_unit TEXT,
  description TEXT,
  source_citation TEXT
) AS $$
  SELECT param_name, param_value, param_unit, description, source_citation
  FROM trapper.ref_ecological_parameters
  WHERE applicable_to = p_context OR applicable_to = 'all'
  ORDER BY param_name;
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION trapper.get_eco_params_for_context(TEXT) IS
'Get all ecological parameters applicable to a context (urban, rural, or all).';

-- Find organizations by type
CREATE OR REPLACE FUNCTION trapper.find_organizations(
  p_type TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_tnr_partner BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
  org_id UUID,
  org_name TEXT,
  short_name TEXT,
  org_type TEXT,
  city TEXT,
  phone TEXT,
  accepts_feral BOOLEAN,
  tnr_partner BOOLEAN,
  notes TEXT
) AS $$
  SELECT org_id, org_name, short_name, org_type, city, phone, accepts_feral, tnr_partner, notes
  FROM trapper.ref_organizations
  WHERE is_active = true
    AND (p_type IS NULL OR org_type = p_type)
    AND (p_city IS NULL OR city ILIKE '%' || p_city || '%')
    AND (p_tnr_partner IS NULL OR tnr_partner = p_tnr_partner)
  ORDER BY org_name;
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION trapper.find_organizations(TEXT, TEXT, BOOLEAN) IS
'Find organizations by type, city, or TNR partner status.';

-- ============================================================================
-- 5. Add to Tippy View Catalog
-- ============================================================================
\echo 'Adding to Tippy view catalog...'

INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
VALUES
  ('ref_ecological_parameters', 'ecology',
   'Scientific parameters for cat population modeling from peer-reviewed research (Boone et al. 2019). Includes survival rates, reproduction parameters, and TNR thresholds.',
   ARRAY['param_name', 'param_value', 'source_citation'],
   ARRAY['applicable_to'],
   ARRAY[
     'What is the kitten survival rate?',
     'What alteration rate is needed for population decline?',
     'What are the TNR thresholds?',
     'How many kittens per litter on average?'
   ]),

  ('ref_organizations', 'entity',
   'Shelters, rescues, clinics, and partner organizations in Sonoma County area.',
   ARRAY['org_name', 'org_type', 'city'],
   ARRAY['org_type', 'city', 'is_active', 'tnr_partner'],
   ARRAY[
     'What shelters are in Sonoma County?',
     'Who handles animal services in Petaluma?',
     'Which organizations accept feral cats?',
     'What TNR partners work with FFSC?'
   ]),

  ('ref_sonoma_geography', 'stats',
   'Geographic reference data for Sonoma County including cities, service zones, and population data.',
   ARRAY['area_name', 'area_type', 'population'],
   ARRAY['area_type', 'urban_rural'],
   ARRAY[
     'What is the population of Santa Rosa?',
     'How many households are in Petaluma?',
     'What service zones does Atlas use?',
     'Which areas are rural vs urban?'
   ])

ON CONFLICT (view_name) DO UPDATE SET
  description = EXCLUDED.description,
  key_columns = EXCLUDED.key_columns,
  filter_columns = EXCLUDED.filter_columns,
  example_questions = EXCLUDED.example_questions;

-- ============================================================================
-- Summary
-- ============================================================================
\echo ''
\echo '=== MIG_701 Complete ==='
\echo 'Created:'
\echo '  - ref_ecological_parameters (17 parameters from Boone et al. 2019)'
\echo '  - ref_organizations (10 Sonoma County organizations)'
\echo '  - ref_sonoma_geography (service zones, county, cities)'
\echo '  - get_eco_param(name) function'
\echo '  - get_eco_params_for_context(context) function'
\echo '  - find_organizations(type, city, tnr) function'
\echo ''
\echo 'Usage:'
\echo '  -- Get TNR threshold for decline'
\echo '  SELECT trapper.get_eco_param(''tnr_threshold_decline'');'
\echo ''
\echo '  -- Get all parameters with sources'
\echo '  SELECT * FROM trapper.ref_ecological_parameters;'
\echo ''
\echo '  -- Find TNR partners'
\echo '  SELECT * FROM trapper.find_organizations(p_tnr_partner := true);'
