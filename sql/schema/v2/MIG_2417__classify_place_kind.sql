-- MIG_2417: Classify place_kind
--
-- Problem: 100% of places (7,939) have place_kind = 'unknown'
-- This prevents UI from showing property type indicators
--
-- Valid place_kind values:
-- single_family, apartment_unit, apartment_building, mobile_home,
-- business, farm, outdoor_site, clinic, shelter, unknown

BEGIN;

-- 1. Classify based on display_name patterns
UPDATE sot.places
SET
  place_kind = CASE
    -- Clinics/vets (high priority - check first)
    WHEN display_name ~* '(clinic|hospital|vet|veterinary|animal\s*care|spay|neuter)' THEN 'clinic'
    -- Shelters/rescues
    WHEN display_name ~* '(shelter|rescue|spca|humane|animal\s*services|ffsc|forgotten\s*felines)' THEN 'shelter'
    -- Apartment units (has unit/apt/suite number)
    WHEN display_name ~* '(apt\.?|unit|suite|#)\s*[0-9a-z]+' THEN 'apartment_unit'
    -- Apartment buildings/complexes
    WHEN display_name ~* '(apartment|apts|complex|manor|terrace|village|towers?)' THEN 'apartment_building'
    -- Mobile homes
    WHEN display_name ~* '(mobile|mhp|trailer|rv\s*park|space\s*[0-9])' THEN 'mobile_home'
    -- Farms/ranches/agricultural
    WHEN display_name ~* '(ranch|farm|vineyard|winery|acres|orchard|dairy|poultry|livestock)' THEN 'farm'
    -- Outdoor/public spaces
    WHEN display_name ~* '(park|trail|creek|river|highway|hwy|road\s*[0-9]|freeway)' THEN 'outdoor_site'
    -- Businesses (check common business indicators)
    WHEN display_name ~* '(corp|inc|llc|ltd|store|shop|office|plaza|center|mall|restaurant|cafe|hotel|motel)' THEN 'business'
    WHEN display_name ~* '(auto|repair|service|salon|spa|gym|fitness|market|grocery)' THEN 'business'
    -- Default to single_family (residential)
    ELSE 'single_family'
  END,
  updated_at = NOW()
WHERE (place_kind = 'unknown' OR place_kind IS NULL)
AND merged_into_place_id IS NULL;

-- Log results
DO $$
DECLARE
  v_count INT;
BEGIN
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'MIG_2417: Classified % places', v_count;
END $$;

COMMIT;

-- Verification: Show distribution
SELECT
  place_kind,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) as pct
FROM sot.places
WHERE merged_into_place_id IS NULL
GROUP BY place_kind
ORDER BY count DESC;

-- Show sample of each category
SELECT place_kind, display_name
FROM (
  SELECT
    place_kind,
    display_name,
    ROW_NUMBER() OVER (PARTITION BY place_kind ORDER BY created_at DESC) as rn
  FROM sot.places
  WHERE merged_into_place_id IS NULL
  AND place_kind IS NOT NULL
) t
WHERE rn <= 3
ORDER BY place_kind, rn;
