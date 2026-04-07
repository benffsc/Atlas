-- MIG_3059: Expand community_resources for neighbor counties + statewide
--
-- Part of FFS-1181 (Out-of-Service-Area Email Pipeline epic),
-- Phase 2a / FFS-1184.
--
-- Adds county_served / region / priority columns to ops.community_resources
-- and seeds 9 neighbor-county and statewide resources from Ben's approved
-- Airtable "Out of County Email" body. Existing FFSC/Sonoma rows are tagged
-- county_served='Sonoma'. A helper function ops.get_neighbor_county_resources
-- powers the email template's dynamic resource cards.
--
-- The existing /api/cron/verify-resources cron (FFS-1113) will pick up the
-- new rows automatically because they all have scrape_url set.
--
-- Depends on: MIG_3039 (community_resources base table)
--
-- Created: 2026-04-07

\echo ''
\echo '=============================================='
\echo '  MIG_3059: Community resources for neighbor'
\echo '            counties + statewide directories'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. Add columns
-- ============================================================================

\echo '1. Adding county_served / region / priority columns...'

ALTER TABLE ops.community_resources
  ADD COLUMN IF NOT EXISTS county_served TEXT,
  ADD COLUMN IF NOT EXISTS region        TEXT,
  ADD COLUMN IF NOT EXISTS priority      INT NOT NULL DEFAULT 100;

CREATE INDEX IF NOT EXISTS idx_community_resources_county_served
  ON ops.community_resources (county_served, is_active)
  WHERE is_active;

COMMENT ON COLUMN ops.community_resources.county_served IS
'MIG_3059 (FFS-1184): County name (e.g., Sonoma, Marin, Napa) or ''statewide''.
Used to filter resources for the out-of-service-area email template.';

-- ============================================================================
-- 2. Tag existing rows
-- ============================================================================

\echo '2. Tagging existing FFSC/Sonoma rows...'

UPDATE ops.community_resources
   SET county_served = 'Sonoma'
 WHERE county_served IS NULL;

-- ============================================================================
-- 3. Seed neighbor-county + statewide resources
-- ============================================================================

\echo '3. Seeding neighbor-county and statewide resources...'

INSERT INTO ops.community_resources (
  slug, name, category, description, phone, address, hours,
  website_url, scrape_url, icon, urgency, display_order,
  county_served, region, priority, last_verified_at
) VALUES
  -- Marin County
  ('marin_humane', 'Marin Humane', 'pet_spay',
   'Low-cost spay/neuter and animal services for Marin County.',
   '(415) 883-4621',
   '171 Bel Marin Keys Blvd, Novato, CA 94949',
   NULL,
   'https://marinhumane.org',
   'https://marinhumane.org',
   'heart-handshake', 'info', 100,
   'Marin', 'bay_area_north', 10, NOW()),

  -- Napa County
  ('napa_humane', 'Napa Humane', 'pet_spay',
   'Low-cost spay/neuter clinic serving Napa County.',
   '(707) 255-8118',
   '3265 California Blvd, Napa, CA 94558',
   NULL,
   'https://napahumane.org',
   'https://napahumane.org',
   'heart-handshake', 'info', 100,
   'Napa', 'bay_area_north', 10, NOW()),

  ('napa_county_animal_shelter', 'Napa County Animal Shelter — Community Cat Program', 'pet_spay',
   'Community cat (TNR) program for Napa County residents.',
   '(707) 253-4517',
   '942 Hartle Court, Napa, CA 94559',
   NULL,
   'https://www.countyofnapa.org/199/Animal-Shelter',
   'https://www.countyofnapa.org/199/Animal-Shelter',
   'heart', 'info', 100,
   'Napa', 'bay_area_north', 20, NOW()),

  -- Mendocino County
  ('mendocino_county_acs', 'Mendocino County Animal Care Services', 'pet_spay',
   'Animal services and spay/neuter assistance for Mendocino County.',
   '(707) 463-4427',
   '298 Plant Rd, Ukiah, CA 95482',
   NULL,
   'https://www.mendocinocounty.gov/government/health-human-services-agency/animal-care-services',
   'https://www.mendocinocounty.gov/government/health-human-services-agency/animal-care-services',
   'heart-handshake', 'info', 100,
   'Mendocino', 'north_coast', 10, NOW()),

  ('coast_cat_project', 'Coast Cat Project', 'pet_spay',
   'TNR and community cat support along the Mendocino coast.',
   '(707) 962-0119',
   'Fort Bragg, CA 95437',
   NULL,
   'https://coastcatproject.org',
   'https://coastcatproject.org',
   'heart', 'info', 100,
   'Mendocino', 'north_coast', 20, NOW()),

  -- Lake County
  ('lake_county_acc', 'Lake County Animal Care & Control', 'pet_spay',
   'Animal services and spay/neuter resources for Lake County.',
   '(707) 263-0278',
   '4949 Helbush Dr, Lakeport, CA 95453',
   NULL,
   'https://www.lakecountyca.gov/Government/Directory/Animal_Care_Control.htm',
   'https://www.lakecountyca.gov/Government/Directory/Animal_Care_Control.htm',
   'heart-handshake', 'info', 100,
   'Lake', 'north_coast', 10, NOW()),

  -- Solano County
  ('solano_county_animal_care', 'Solano County Animal Care', 'pet_spay',
   'Spay/neuter and animal control services for Solano County.',
   '(707) 784-1356',
   '2510 Clay Bank Rd, Fairfield, CA 94533',
   NULL,
   'https://www.solanocounty.com/depts/sheriff/animal_care/default.asp',
   'https://www.solanocounty.com/depts/sheriff/animal_care/default.asp',
   'heart-handshake', 'info', 100,
   'Solano', 'bay_area_north', 10, NOW()),

  -- Statewide directories
  ('united_spay_alliance_ca', 'United Spay Alliance — California Program Locator', 'pet_spay',
   'Searchable national directory of low-cost spay/neuter programs by zip code.',
   NULL,
   NULL,
   NULL,
   'https://unitedspayalliance.org/california/',
   'https://unitedspayalliance.org/california/',
   'globe', 'info', 100,
   'statewide', 'california', 50, NOW()),

  ('alley_cat_allies_help', 'Alley Cat Allies — Community Cat Resources', 'pet_spay',
   'National community cat advocacy and resource hub. Includes how-to guides for TNR.',
   NULL,
   NULL,
   NULL,
   'https://www.alleycat.org/community-cat-care/',
   'https://www.alleycat.org/community-cat-care/',
   'globe', 'info', 100,
   'statewide', 'national', 60, NOW())

ON CONFLICT (slug) DO UPDATE SET
  name           = EXCLUDED.name,
  description    = EXCLUDED.description,
  phone          = EXCLUDED.phone,
  address        = EXCLUDED.address,
  website_url    = EXCLUDED.website_url,
  scrape_url     = EXCLUDED.scrape_url,
  county_served  = EXCLUDED.county_served,
  region         = EXCLUDED.region,
  priority       = EXCLUDED.priority,
  updated_at     = NOW();

UPDATE ops.community_resources
   SET verify_by = NOW() + INTERVAL '90 days'
 WHERE verify_by IS NULL;

-- ============================================================================
-- 4. Helper function for the email template
-- ============================================================================

\echo '4. Creating ops.get_neighbor_county_resources()...'

CREATE OR REPLACE FUNCTION ops.get_neighbor_county_resources(p_county TEXT)
RETURNS TABLE (
  slug          TEXT,
  name          TEXT,
  description   TEXT,
  phone         TEXT,
  address       TEXT,
  website_url   TEXT,
  county_served TEXT,
  region        TEXT,
  priority      INT
) AS $$
  SELECT slug, name, description, phone, address, website_url,
         county_served, region, priority
    FROM ops.community_resources
   WHERE is_active = TRUE
     AND (county_served = p_county OR county_served = 'statewide')
   ORDER BY
     -- statewide cards last
     (county_served = 'statewide') ASC,
     priority ASC,
     name ASC;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION ops.get_neighbor_county_resources IS
'MIG_3059 (FFS-1184): Returns active community resources for a given county
plus all statewide rows. Used by the out_of_service_area email template
to render dynamic resource cards.';

-- ============================================================================
-- 5. Verification
-- ============================================================================

\echo '5. Verification...'

DO $$
DECLARE
  v_marin INT;
  v_statewide INT;
  v_sonoma_tagged INT;
BEGIN
  SELECT COUNT(*) INTO v_marin
    FROM ops.community_resources WHERE county_served = 'Marin';
  SELECT COUNT(*) INTO v_statewide
    FROM ops.community_resources WHERE county_served = 'statewide';
  SELECT COUNT(*) INTO v_sonoma_tagged
    FROM ops.community_resources WHERE county_served = 'Sonoma';

  RAISE NOTICE '   Sonoma rows tagged   : %', v_sonoma_tagged;
  RAISE NOTICE '   Marin resources       : %', v_marin;
  RAISE NOTICE '   Statewide directories : %', v_statewide;
END $$;

COMMIT;

\echo ''
\echo '✓ MIG_3059 complete'
\echo ''
