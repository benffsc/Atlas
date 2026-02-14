\echo ''
\echo '=============================================='
\echo 'MIG_532: Populate Partner Organizations'
\echo '=============================================='
\echo ''
\echo 'Creates partner organization records for known rescues and shelters.'
\echo 'Links existing appointments to these organizations.'
\echo ''

-- ============================================================================
-- STEP 1: Create places for partner organizations
-- ============================================================================

\echo 'Step 1: Creating places for partner org facilities...'

-- Humane Society for Inland Mendocino Co
SELECT trapper.find_or_create_place_deduped(
    '9700 UVA Dr, Redwood Valley, CA 95470',
    'Humane Society for Inland Mendocino Co',
    NULL, NULL, 'clinichq'
);

-- Northbay Animal Services
SELECT trapper.find_or_create_place_deduped(
    '840 Hopper St, Petaluma, CA 94952',
    'Northbay Animal Services',
    NULL, NULL, 'clinichq'
);

-- Bitten by a Kitten Rescue
SELECT trapper.find_or_create_place_deduped(
    '325 Jackson St, Crockett, CA 94525',
    'Bitten by a Kitten Rescue',
    NULL, NULL, 'clinichq'
);

-- Dogwood Animal Rescue Project
SELECT trapper.find_or_create_place_deduped(
    '1415 Fulton Road suite 205, Santa Rosa, CA 95403',
    'Dogwood Animal Rescue Project',
    NULL, NULL, 'clinichq'
);

-- Sonoma County Animal Services (SCAS)
SELECT trapper.find_or_create_place_deduped(
    '1247 Century Court, Santa Rosa, CA 95403',
    'Sonoma County Animal Services',
    NULL, NULL, 'clinichq'
);

\echo 'Places created.'

-- ============================================================================
-- STEP 2: Create partner organization records
-- ============================================================================

\echo 'Step 2: Creating partner organization records...'

-- Humane Society for Inland Mendocino Co
INSERT INTO trapper.partner_organizations (
    org_name, org_name_short, org_name_patterns, org_type,
    place_id, address, contact_email, contact_phone,
    relationship_type, created_by
)
SELECT
    'Humane Society for Inland Mendocino Co',
    'HSIMC',
    ARRAY['%Humane Society for Inland Mendocino%', '%HSIMC%', '%Inland Mendocino%Humane%'],
    'rescue',
    p.place_id,
    '9700 UVA Dr, Redwood Valley, CA 95470',
    'suzanne@hsimc.org',
    '707-354-4154',
    'partner',
    'MIG_532'
FROM trapper.places p
WHERE p.display_name ILIKE '%Humane Society for Inland Mendocino%'
   OR p.formatted_address ILIKE '%9700 UVA Dr%'
LIMIT 1
ON CONFLICT DO NOTHING;

-- Northbay Animal Services
INSERT INTO trapper.partner_organizations (
    org_name, org_name_short, org_name_patterns, org_type,
    place_id, address, contact_email, contact_phone,
    relationship_type, created_by
)
SELECT
    'Northbay Animal Services',
    'NBAS',
    ARRAY['%Northbay Animal%', '%North Bay Animal%', '%NBAS%'],
    'animal_services',
    p.place_id,
    '840 Hopper St, Petaluma, CA 94952',
    'info@northbayanimalservices.org',
    '707-762-6227',
    'partner',
    'MIG_532'
FROM trapper.places p
WHERE p.display_name ILIKE '%Northbay Animal%'
   OR p.formatted_address ILIKE '%840 Hopper%'
LIMIT 1
ON CONFLICT DO NOTHING;

-- Bitten by a Kitten Rescue
INSERT INTO trapper.partner_organizations (
    org_name, org_name_short, org_name_patterns, org_type,
    place_id, address, contact_email, contact_phone,
    relationship_type, created_by
)
SELECT
    'Bitten by a Kitten Rescue',
    'BBAK',
    ARRAY['%Bitten by a Kitten%', '%Bitten%Kitten%', '%BBAK%'],
    'rescue',
    p.place_id,
    '325 Jackson St, Crockett, CA 94525',
    'bitten-by-a-kitten@outlook.com',
    '510-241-5899',
    'partner',
    'MIG_532'
FROM trapper.places p
WHERE p.display_name ILIKE '%Bitten%Kitten%'
   OR p.formatted_address ILIKE '%325 Jackson%'
LIMIT 1
ON CONFLICT DO NOTHING;

-- Dogwood Animal Rescue Project
INSERT INTO trapper.partner_organizations (
    org_name, org_name_short, org_name_patterns, org_type,
    place_id, address, contact_phone,
    relationship_type, created_by
)
SELECT
    'Dogwood Animal Rescue Project',
    'DARP',
    ARRAY['%Dogwood Animal%', '%Dogwood%Rescue%', '%DARP%'],
    'rescue',
    p.place_id,
    '1415 Fulton Road suite 205, Santa Rosa, CA 95403',
    '661-549-9269',
    'partner',
    'MIG_532'
FROM trapper.places p
WHERE p.display_name ILIKE '%Dogwood%'
   OR p.formatted_address ILIKE '%1415 Fulton%'
LIMIT 1
ON CONFLICT DO NOTHING;

-- Sonoma County Animal Services (SCAS)
INSERT INTO trapper.partner_organizations (
    org_name, org_name_short, org_name_patterns, org_type,
    place_id, address, contact_email, contact_phone,
    relationship_type, notes, created_by
)
SELECT
    'Sonoma County Animal Services',
    'SCAS',
    ARRAY[
        '%SCAS%',
        '%Sonoma County Animal%',
        '%Sc Animal Services%',
        '%Scas %'  -- Matches "Scas Mark Belew", etc.
    ],
    'animal_services',
    p.place_id,
    '1247 Century Court, Santa Rosa, CA 95403',
    'theanimalshelter@sonomacounty.gov',
    '707-565-7100',
    'partner',
    'Main county shelter. Appointments with "SCAS + address" indicate cat origin location.',
    'MIG_532'
FROM trapper.places p
WHERE p.display_name ILIKE '%Sonoma County Animal%'
   OR p.formatted_address ILIKE '%1247 Century%'
LIMIT 1
ON CONFLICT DO NOTHING;

-- Countryside Rescue (no address found yet)
INSERT INTO trapper.partner_organizations (
    org_name, org_name_short, org_name_patterns, org_type,
    contact_email, contact_phone,
    relationship_type, notes, created_by
)
VALUES (
    'Countryside Rescue',
    NULL,
    ARRAY['%Countryside Rescue%', '%Countryside%'],
    'rescue',
    'amanda@countrysiderescue.com',
    '707-974-8451',
    'partner',
    'Address lookup needed',
    'MIG_532'
)
ON CONFLICT DO NOTHING;

\echo 'Partner organizations created.'

-- ============================================================================
-- STEP 3: Add additional known partner orgs
-- ============================================================================

\echo 'Step 3: Adding additional partner organizations...'

-- These are smaller orgs that appeared in the data
INSERT INTO trapper.partner_organizations (
    org_name, org_name_patterns, org_type, relationship_type, created_by
) VALUES
    ('Petaluma Animal Services', ARRAY['%Petaluma Animal%'], 'animal_services', 'partner', 'MIG_532'),
    ('Rohnert Park Animal Shelter', ARRAY['%Rohnert Park Animal%', '%RPAS%'], 'shelter', 'partner', 'MIG_532'),
    ('Milo Foundation', ARRAY['%Milo Foundation%', '%Milo%'], 'rescue', 'partner', 'MIG_532')
ON CONFLICT DO NOTHING;

\echo 'Additional orgs added.'

-- ============================================================================
-- STEP 4: Link existing appointments to partner orgs
-- ============================================================================

\echo 'Step 4: Linking appointments to partner organizations...'

SELECT * FROM trapper.link_all_appointments_to_partner_orgs();

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_532 Complete!'
\echo '=============================================='
\echo ''

SELECT 'Partner Organizations' AS metric, COUNT(*)::text AS value
FROM trapper.partner_organizations
UNION ALL
SELECT 'Appointments with partner_org_id', COUNT(*)::text
FROM trapper.sot_appointments WHERE partner_org_id IS NOT NULL
UNION ALL
SELECT 'Appointments with inferred_place_id', COUNT(*)::text
FROM trapper.sot_appointments WHERE inferred_place_id IS NOT NULL;

\echo ''
\echo 'Partner orgs by appointment count:'
SELECT org_name, appointments_count, org_type
FROM trapper.v_partner_org_stats
WHERE appointments_count > 0
ORDER BY appointments_count DESC
LIMIT 10;

\echo ''
