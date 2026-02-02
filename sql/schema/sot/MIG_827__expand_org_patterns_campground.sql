-- ============================================================================
-- MIG_827: Expand Organization Name Patterns — Campground/RV/Lodging
-- ============================================================================
-- WORKING_LEDGER ref: DQ-001
--
-- Problem: "Wildhaven Campgrounds" appears as a person name on map pins
-- at 2411 Alexander Valley Rd. The is_organization_name() function doesn't
-- recognize "Campground" as an org pattern.
--
-- Fix: Add campground/RV/lodging patterns to known_organizations.
-- Also audit for any existing people records matching new patterns.
-- ============================================================================

\echo '=== MIG_827: Expand Org Patterns — Campground/RV/Lodging ==='

-- ============================================================================
-- Step 1: Pre-change audit
-- ============================================================================

\echo ''
\echo 'Step 1: People matching new org patterns (pre-fix):'

SELECT person_id, display_name, data_source, source_system
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
  AND (
    display_name ILIKE '%Campground%'
    OR display_name ILIKE '%Campsite%'
    OR display_name ILIKE '%RV Park%'
    OR display_name ILIKE '%RV Resort%'
    OR display_name ILIKE '%KOA%'
    OR display_name ILIKE '%Trailer Park%'
    OR display_name ILIKE '%Mobile Home Park%'
    OR display_name ILIKE '%Guest Ranch%'
    OR display_name ILIKE '%Retreat Center%'
  )
ORDER BY display_name;

-- ============================================================================
-- Step 2: Add patterns to known_organizations
-- ============================================================================

\echo ''
\echo 'Step 2: Adding campground/RV/lodging patterns to known_organizations...'

INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
  ('Campground (generic)', '%Campground%', 'business', 'Campgrounds, RV campgrounds'),
  ('Campsite (generic)', '%Campsite%', 'business', 'Campsites'),
  ('RV Park (generic)', '%RV Park%', 'business', 'RV parks'),
  ('RV Resort (generic)', '%RV Resort%', 'business', 'RV resorts'),
  ('KOA (generic)', '%KOA%', 'business', 'KOA campground franchise'),
  ('Trailer Park (generic)', '%Trailer Park%', 'business', 'Trailer parks'),
  ('Mobile Home Park (generic)', '%Mobile Home Park%', 'business', 'Mobile home parks/communities'),
  ('Guest Ranch (generic)', '%Guest Ranch%', 'business', 'Guest ranches/dude ranches'),
  ('Retreat Center (generic)', '%Retreat Center%', 'business', 'Retreat centers')
ON CONFLICT DO NOTHING;

\echo 'Patterns added.'

-- ============================================================================
-- Step 3: Verify is_organization_name() now catches the patterns
-- ============================================================================

\echo ''
\echo 'Step 3: Verification — new patterns detected:'

SELECT
  name,
  trapper.is_organization_name(name) AS is_org
FROM (VALUES
  ('Wildhaven Campgrounds'),
  ('Sonoma County Campground'),
  ('KOA Petaluma'),
  ('Holiday Duncan'),
  ('Bethany Garrick'),
  ('Bodega Bay RV Park'),
  ('Calistoga Ranch Guest Ranch')
) AS t(name);

-- ============================================================================
-- Step 4: Flag affected people records
-- ============================================================================

\echo ''
\echo 'Step 4: People records that should be reclassified:'

SELECT person_id, display_name, data_source
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
  AND trapper.is_organization_name(display_name) = TRUE
  AND is_system_account IS NOT TRUE
ORDER BY display_name
LIMIT 20;

-- Mark newly detected org names as system accounts
UPDATE trapper.sot_people
SET is_system_account = TRUE,
    updated_at = NOW()
WHERE merged_into_person_id IS NULL
  AND trapper.is_organization_name(display_name) = TRUE
  AND is_system_account IS NOT TRUE;

\echo 'System account flag updated for org-name people.'

-- ============================================================================
-- Step 5: Summary
-- ============================================================================

\echo ''
\echo '====== MIG_827 SUMMARY ======'
\echo 'Added campground/RV/lodging patterns to is_organization_name().'
\echo 'Flagged affected people records as is_system_account = TRUE.'
\echo ''
\echo 'Affected places (people should disappear from map pin popups):'
\echo '  - 2411 Alexander Valley Rd (Wildhaven Campgrounds)'
\echo '  - Any other campground/RV park named person records'
\echo ''
\echo '=== MIG_827 Complete ==='
