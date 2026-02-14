\echo '=== MIG_580: Audit Fix - Additional Organization Patterns ==='
\echo ''
\echo 'Adds detection patterns discovered from ClinicHQ audit (2022-2026).'
\echo ''

-- ============================================================================
-- PART 1: Add Missing Organization Patterns
-- ============================================================================

\echo 'Adding missing organization detection patterns...'

-- Pub Republic area (feeding site)
INSERT INTO trapper.data_fixing_patterns (pattern_name, pattern_type, pattern_ilike, is_organization, fix_notes)
VALUES
  ('org_pub_republic', 'name', '%Pub Republic%', TRUE, 'Pub Republic Luv Pilates Parking Area - feeding site'),
  ('org_parking_area', 'name', '%Parking Area%', TRUE, 'Generic parking area pattern'),
  ('org_parking_lot', 'name', '%Parking Lot%', TRUE, 'Generic parking lot pattern')
ON CONFLICT (pattern_name) DO NOTHING;

-- Marin Humane (partner org)
INSERT INTO trapper.data_fixing_patterns (pattern_name, pattern_type, pattern_ilike, is_organization, fix_notes)
VALUES
  ('org_marin_humane', 'name', '%Marin Humane%', TRUE, 'Marin Humane Society - partner org')
ON CONFLICT (pattern_name) DO NOTHING;

-- Add to known_organizations for better tracking
INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
  ('Pub Republic Parking Area', '%Pub Republic%', 'feeding_site', 'Pub Republic Luv Pilates Parking Area - feeding site for community cats'),
  ('Marin Humane', '%Marin Humane%', 'partner_org', 'Marin Humane Society - transfer partner')
ON CONFLICT (org_name) DO NOTHING;

\echo ''
\echo '=== Verification ==='

-- Verify new patterns work
SELECT
  name,
  trapper.is_organization_name(name) as is_org
FROM (VALUES
  ('Pub Republic Luv Pilates Parking Area'),
  ('Marin Humane'),
  ('Some Random Parking Area'),
  ('Bob''s Parking Lot')
) AS t(name);

\echo ''
\echo '=== MIG_580 Complete ==='
\echo ''
\echo '=============================================='
\echo 'DETECTED ORGANIZATIONS NEEDING REPRESENTATIVES'
\echo '=============================================='
\echo ''
\echo 'The following organizations are DETECTED but need representative setup:'
\echo 'Use /api/admin/known-organizations POST to set up routing.'
\echo ''
\echo '  1. Speedy Creek Winery (149 appointments)'
\echo '     - Address: (check ClinicHQ for actual address)'
\echo '     - Contact: (needs contact person)'
\echo ''
\echo '  2. Santa Rosa Garden Apartments (8 appointments)'
\echo '     - Has email: dtimmons722@gmail.com'
\echo ''
\echo '  3. Casini Ranch (5 appointments)'
\echo '     - Has email: bookeeping@casiniranch.com'
\echo '     - Has phone: 707-865-5500'
\echo ''
\echo '  4. Pub Republic Parking Area (56 appointments) - NOW DETECTED'
\echo ''
\echo '  5. Marin Humane (32 appointments) - NOW DETECTED'
\echo ''
\echo 'Other orgs detected: Glen Ellen Vocational Equine, Hanna Boys Center,'
\echo 'Windsor Christian Academy, So. Co. Fairgrounds RV Park, etc.'
\echo ''
\echo 'See AUDIT results for full list of organizations needing representatives.'
\echo ''
