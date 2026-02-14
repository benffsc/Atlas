-- ============================================================================
-- MIG_555: Known Organizations Reference Table
-- ============================================================================
-- Creates a reference table for known animal welfare organizations in the region.
-- This enables:
-- 1. Stable identity matching during ClinicHQ imports
-- 2. Enrichment of organization records with official contact info
-- 3. Prevention of duplicate organization records
-- ============================================================================

\echo '=== MIG_555: Known Organizations Reference Table ==='

-- Known organizations lookup table
CREATE TABLE IF NOT EXISTS trapper.known_organizations (
  org_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  canonical_name TEXT NOT NULL,           -- Official name
  short_name TEXT,                        -- Common abbreviation (e.g., "SCAS")
  aliases TEXT[] DEFAULT '{}',            -- Other names this org is known by
  org_type TEXT NOT NULL DEFAULT 'other', -- shelter, rescue, clinic, municipal, partner

  -- Contact info
  street_address TEXT,
  city TEXT,
  state TEXT DEFAULT 'CA',
  zip TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,

  -- Geographic
  lat NUMERIC(10, 7),
  lng NUMERIC(10, 7),
  service_area TEXT,                      -- Description of area served

  -- Linking
  canonical_person_id UUID REFERENCES trapper.sot_people(person_id),
  canonical_place_id UUID REFERENCES trapper.places(place_id),

  -- Metadata
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_known_organizations_canonical_name
  ON trapper.known_organizations(LOWER(canonical_name));
CREATE INDEX IF NOT EXISTS idx_known_organizations_short_name
  ON trapper.known_organizations(LOWER(short_name));
CREATE INDEX IF NOT EXISTS idx_known_organizations_type
  ON trapper.known_organizations(org_type);

COMMENT ON TABLE trapper.known_organizations IS
  'Reference table for known animal welfare organizations. Used to match and deduplicate organization records during imports.';

-- ============================================================================
-- Populate with known Sonoma County organizations
-- ============================================================================

\echo 'Populating known organizations...'

INSERT INTO trapper.known_organizations (
  canonical_name, short_name, aliases, org_type,
  street_address, city, state, zip, phone, email, website,
  lat, lng, service_area, notes
) VALUES
-- County shelter
(
  'Sonoma County Animal Services',
  'SCAS',
  ARRAY['Sonoma County Animal Shelter', 'The Animal Shelter', 'SCAS Santa Rosa', 'Sonoma County Animal Care and Control'],
  'shelter',
  '1247 Century Ct',
  'Santa Rosa',
  'CA',
  '95403',
  '707-565-7100',
  'theanimalshelter@sonomacounty.gov',
  'https://sonomacounty.gov/health-and-human-services/health-services/divisions/public-health/animal-services',
  38.5080, -122.7340,
  'Unincorporated Sonoma County, Santa Rosa, Windsor',
  'County-operated shelter. Hours: Tue-Sat 10am-5pm, Kennel visits 12pm-4:30pm.'
),
-- Humane Society
(
  'Humane Society of Sonoma County',
  'HSSC',
  ARRAY['Humane Society Sonoma', 'HSSC Santa Rosa', 'HSSC Healdsburg'],
  'rescue',
  '5345 Hwy 12 West',
  'Santa Rosa',
  'CA',
  '95407',
  '707-542-0882',
  NULL,
  'https://humanesocietysoco.org/',
  38.4350, -122.7650,
  'Sonoma County',
  'Donor-supported safe haven since 1931. Has Santa Rosa and Healdsburg locations.'
),
-- Pets Lifeline
(
  'Pets Lifeline',
  'PL',
  ARRAY['Pets Lifeline Sonoma'],
  'rescue',
  '19686 8th St E',
  'Sonoma',
  'CA',
  '95476',
  '707-996-4577',
  NULL,
  'https://www.petslifeline.org/',
  38.2820, -122.4580,
  'Sonoma Valley',
  'Protects and improves lives of Sonoma Valley dogs and cats.'
),
-- North Bay Animal Services
(
  'North Bay Animal Services',
  'NBAS',
  ARRAY['NBAS Petaluma'],
  'shelter',
  '840 Hopper St',
  'Petaluma',
  'CA',
  '94952',
  '707-778-4396',
  NULL,
  'https://northbayanimalservices.org/',
  38.2450, -122.6360,
  'Petaluma to Windsor, Sebastopol to Cloverdale',
  'Non-profit serving multiple communities.'
),
-- Rohnert Park Animal Services
(
  'Rohnert Park Animal Shelter',
  'RPAS',
  ARRAY['Rohnert Park Animal Services', 'RP Animal Shelter'],
  'municipal',
  '301 J Rogers Ln',
  'Rohnert Park',
  'CA',
  '94928',
  '707-584-1582',
  NULL,
  'https://rpanimalshelter.org/',
  38.3480, -122.7010,
  'Rohnert Park, Cotati',
  'City-operated shelter.'
),
-- Dogwood Animal Rescue
(
  'Dogwood Animal Rescue Project',
  'Dogwood',
  ARRAY['Dogwood Rescue', 'DARP'],
  'rescue',
  'PO Box 7233',
  'Santa Rosa',
  'CA',
  '95407',
  NULL,
  NULL,
  'https://dogwoodanimalrescue.org/',
  NULL, NULL,
  'Sonoma County',
  'Foster-based rescue, no physical shelter.'
),
-- Forgotten Felines (us!)
(
  'Forgotten Felines of Sonoma County',
  'FFSC',
  ARRAY['Forgotten Felines', 'FFSC Santa Rosa', 'FF Sonoma'],
  'clinic',
  '101 Binz Rd',
  'Santa Rosa',
  'CA',
  '95407',
  '707-576-7999',
  'info@forgottenfelines.com',
  'https://forgottenfelines.com/',
  38.4120, -122.7450,
  'Sonoma County',
  'TNR clinic and community cat resource. This is us!'
),
-- Petaluma Animal Services Foundation
(
  'Petaluma Animal Services Foundation',
  'PASF',
  ARRAY['Petaluma Animal Shelter', 'PAS Foundation'],
  'rescue',
  '840 Hopper St',
  'Petaluma',
  'CA',
  '94952',
  NULL,
  NULL,
  'https://petalumaanimalshelter.org/',
  38.2450, -122.6360,
  'Petaluma area',
  'Foundation supporting Petaluma animal welfare.'
),
-- Milo Foundation
(
  'Milo Foundation',
  'Milo',
  ARRAY['Milo Sanctuary', 'Milo Point Richmond'],
  'rescue',
  NULL,
  'Point Richmond',
  'CA',
  NULL,
  '510-900-2275',
  NULL,
  'https://milofoundation.org/',
  NULL, NULL,
  'Bay Area including Sonoma County',
  'No-kill sanctuary, often transfers from Sonoma County shelters.'
)
ON CONFLICT DO NOTHING;

\echo 'Inserted known organizations'

-- ============================================================================
-- Function to match organization names
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.match_known_organization(
  p_name TEXT
)
RETURNS TABLE (
  org_id UUID,
  canonical_name TEXT,
  match_type TEXT,
  confidence NUMERIC
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_normalized TEXT;
BEGIN
  -- Normalize input
  v_normalized := LOWER(TRIM(REGEXP_REPLACE(p_name, '\s+', ' ', 'g')));

  -- Try exact canonical name match
  RETURN QUERY
  SELECT
    ko.org_id,
    ko.canonical_name,
    'exact'::TEXT,
    1.0::NUMERIC
  FROM trapper.known_organizations ko
  WHERE LOWER(ko.canonical_name) = v_normalized
  LIMIT 1;

  IF FOUND THEN RETURN; END IF;

  -- Try short name match
  RETURN QUERY
  SELECT
    ko.org_id,
    ko.canonical_name,
    'short_name'::TEXT,
    0.95::NUMERIC
  FROM trapper.known_organizations ko
  WHERE LOWER(ko.short_name) = v_normalized
  LIMIT 1;

  IF FOUND THEN RETURN; END IF;

  -- Try alias match
  RETURN QUERY
  SELECT
    ko.org_id,
    ko.canonical_name,
    'alias'::TEXT,
    0.90::NUMERIC
  FROM trapper.known_organizations ko
  WHERE v_normalized = ANY(SELECT LOWER(a) FROM UNNEST(ko.aliases) a)
  LIMIT 1;

  IF FOUND THEN RETURN; END IF;

  -- Try fuzzy match (contains canonical name)
  RETURN QUERY
  SELECT
    ko.org_id,
    ko.canonical_name,
    'fuzzy_contains'::TEXT,
    0.75::NUMERIC
  FROM trapper.known_organizations ko
  WHERE v_normalized ILIKE '%' || ko.canonical_name || '%'
     OR v_normalized ILIKE '%' || ko.short_name || '%'
  ORDER BY LENGTH(ko.canonical_name) DESC
  LIMIT 1;

  IF FOUND THEN RETURN; END IF;

  -- Try reverse fuzzy (canonical name contains input)
  RETURN QUERY
  SELECT
    ko.org_id,
    ko.canonical_name,
    'fuzzy_partial'::TEXT,
    0.60::NUMERIC
  FROM trapper.known_organizations ko
  WHERE LOWER(ko.canonical_name) ILIKE '%' || v_normalized || '%'
  ORDER BY LENGTH(ko.canonical_name)
  LIMIT 1;

  RETURN;
END;
$$;

COMMENT ON FUNCTION trapper.match_known_organization IS
  'Matches an organization name against known organizations. Returns org_id, canonical name, match type, and confidence.';

-- ============================================================================
-- Function to merge duplicate organization person records
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.merge_organization_duplicates(
  p_org_canonical_name TEXT,
  p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  action TEXT,
  details JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_org RECORD;
  v_canonical_person_id UUID;
  v_duplicate_ids UUID[];
  v_dup_id UUID;
  v_merged_count INT := 0;
BEGIN
  -- Find the known org
  SELECT * INTO v_org
  FROM trapper.known_organizations
  WHERE LOWER(canonical_name) = LOWER(p_org_canonical_name)
  LIMIT 1;

  IF v_org IS NULL THEN
    RETURN QUERY SELECT 'error'::TEXT, jsonb_build_object('message', 'Organization not found: ' || p_org_canonical_name);
    RETURN;
  END IF;

  -- Find all person records that match this org
  SELECT ARRAY_AGG(p.person_id ORDER BY p.created_at)
  INTO v_duplicate_ids
  FROM trapper.sot_people p
  WHERE p.merged_into_person_id IS NULL
    AND (
      -- Match by canonical name
      LOWER(p.display_name) ILIKE '%' || LOWER(v_org.canonical_name) || '%'
      OR LOWER(p.display_name) ILIKE '%' || LOWER(v_org.short_name) || '%'
      OR LOWER(p.display_name) = ANY(SELECT LOWER(a) FROM UNNEST(v_org.aliases) a)
    );

  IF v_duplicate_ids IS NULL OR array_length(v_duplicate_ids, 1) = 0 THEN
    RETURN QUERY SELECT 'info'::TEXT, jsonb_build_object('message', 'No duplicate person records found for: ' || p_org_canonical_name);
    RETURN;
  END IF;

  RETURN QUERY SELECT 'found'::TEXT, jsonb_build_object(
    'org_name', v_org.canonical_name,
    'duplicate_count', array_length(v_duplicate_ids, 1),
    'person_ids', v_duplicate_ids
  );

  -- Use the first (oldest) as canonical, or create new if org has a canonical_person_id
  IF v_org.canonical_person_id IS NOT NULL THEN
    v_canonical_person_id := v_org.canonical_person_id;
  ELSE
    v_canonical_person_id := v_duplicate_ids[1];
  END IF;

  IF p_dry_run THEN
    RETURN QUERY SELECT 'dry_run'::TEXT, jsonb_build_object(
      'would_keep', v_canonical_person_id,
      'would_merge', (SELECT array_agg(x) FROM UNNEST(v_duplicate_ids) x WHERE x != v_canonical_person_id),
      'org_data', jsonb_build_object(
        'canonical_name', v_org.canonical_name,
        'address', v_org.street_address || ', ' || v_org.city || ' ' || v_org.zip,
        'phone', v_org.phone,
        'email', v_org.email
      )
    );
    RETURN;
  END IF;

  -- Update the canonical person with org info
  UPDATE trapper.sot_people
  SET
    display_name = v_org.canonical_name,
    person_type = 'organization',
    updated_at = NOW()
  WHERE person_id = v_canonical_person_id;

  -- Add phone if available
  IF v_org.phone IS NOT NULL THEN
    INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system, is_primary)
    VALUES (v_canonical_person_id, 'phone', v_org.phone, trapper.norm_phone_us(v_org.phone), 'atlas_enrichment', TRUE)
    ON CONFLICT (id_type, id_value_norm) DO NOTHING;
  END IF;

  -- Add email if available
  IF v_org.email IS NOT NULL THEN
    INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system, is_primary)
    VALUES (v_canonical_person_id, 'email', v_org.email, LOWER(v_org.email), 'atlas_enrichment', TRUE)
    ON CONFLICT (id_type, id_value_norm) DO NOTHING;
  END IF;

  -- Link org to canonical person
  UPDATE trapper.known_organizations
  SET canonical_person_id = v_canonical_person_id, updated_at = NOW()
  WHERE org_id = v_org.org_id;

  -- Merge duplicates into canonical
  FOREACH v_dup_id IN ARRAY v_duplicate_ids
  LOOP
    IF v_dup_id != v_canonical_person_id THEN
      -- Mark as merged
      UPDATE trapper.sot_people
      SET merged_into_person_id = v_canonical_person_id, updated_at = NOW()
      WHERE person_id = v_dup_id;

      -- Move any relationships
      UPDATE trapper.person_place_relationships
      SET person_id = v_canonical_person_id
      WHERE person_id = v_dup_id;

      UPDATE trapper.person_cat_relationships
      SET person_id = v_canonical_person_id
      WHERE person_id = v_dup_id;

      v_merged_count := v_merged_count + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT 'merged'::TEXT, jsonb_build_object(
    'canonical_person_id', v_canonical_person_id,
    'merged_count', v_merged_count,
    'org_name', v_org.canonical_name
  );
END;
$$;

COMMENT ON FUNCTION trapper.merge_organization_duplicates IS
  'Merges duplicate person records for a known organization into a single canonical record with enriched data.';

-- ============================================================================
-- View for organization health
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_known_org_status AS
SELECT
  ko.org_id,
  ko.canonical_name,
  ko.short_name,
  ko.org_type,
  ko.city,
  ko.phone IS NOT NULL AS has_phone,
  ko.email IS NOT NULL AS has_email,
  ko.canonical_person_id,
  p.display_name AS person_display_name,
  -- Count duplicates
  (
    SELECT COUNT(*)
    FROM trapper.sot_people sp
    WHERE sp.merged_into_person_id IS NULL
      AND (
        LOWER(sp.display_name) ILIKE '%' || LOWER(ko.canonical_name) || '%'
        OR LOWER(sp.display_name) ILIKE '%' || LOWER(ko.short_name) || '%'
      )
  ) AS matching_person_count,
  ko.is_active
FROM trapper.known_organizations ko
LEFT JOIN trapper.sot_people p ON p.person_id = ko.canonical_person_id;

COMMENT ON VIEW trapper.v_known_org_status IS
  'Shows known organizations and how many matching person records exist (for dedup monitoring).';

\echo '=== MIG_555 Complete ==='
\echo 'Created: known_organizations table'
\echo 'Created: match_known_organization() function'
\echo 'Created: merge_organization_duplicates() function'
\echo 'Created: v_known_org_status view'
\echo 'Populated: 9 known Sonoma County animal organizations'
