\echo ''
\echo '=============================================='
\echo 'MIG_529: Create Places from Organization Names'
\echo '=============================================='
\echo ''
\echo 'Creates places for trapping locations identified in ClinicHQ org names.'
\echo 'Links appointments to these places via inferred_place_id.'
\echo ''

-- ============================================================================
-- STEP 1: Create places for ADDRESS-based org names
-- These are records where someone put an address in the owner field
-- ============================================================================

\echo 'Step 1: Creating places from address-based org names...'

-- Create places from addresses (records that look like "123 Street Name")
WITH address_orgs AS (
    SELECT DISTINCT
        p.display_name,
        -- Clean up the address
        TRIM(REGEXP_REPLACE(
            REGEXP_REPLACE(p.display_name, '\s*(Ffsc|FFSC|Forgotten Felines.*)$', '', 'i'),
            '\s+', ' ', 'g'
        )) AS clean_address
    FROM trapper.sot_people p
    WHERE p.merged_into_person_id IS NULL
      AND p.is_canonical = FALSE
      -- Matches address patterns: starts with number, has street suffix
      AND p.display_name ~ '^\d+\s+\w+'
      -- Has at least one common street suffix or looks like address
      AND p.display_name ~* '(rd\.?|road|st\.?|street|ave\.?|avenue|ln\.?|lane|dr\.?|drive|way|ct\.?|court|blvd|highway|hwy)'
),
created_places AS (
    SELECT
        ao.display_name AS org_name,
        ao.clean_address,
        trapper.find_or_create_place_deduped(
            ao.clean_address || ', CA',  -- Add state for geocoding
            NULL,  -- name
            NULL,  -- lat
            NULL,  -- lng
            'clinichq'
        ) AS place_id
    FROM address_orgs ao
)
INSERT INTO trapper.organization_place_mappings (
    org_pattern, org_pattern_type, place_id, org_display_name, notes, created_by
)
SELECT
    '%' || cp.clean_address || '%',
    'ilike',
    cp.place_id,
    cp.clean_address,
    'Auto-created from address in ClinicHQ owner field',
    'MIG_529'
FROM created_places cp
WHERE cp.place_id IS NOT NULL
ON CONFLICT (org_pattern, org_pattern_type) DO NOTHING;

-- Note: Step 1 may fail if 'clinichq' is not a valid data_source.
-- The named locations in Step 2 below use explicit data_source values.

\echo 'Address-based places created.'

-- ============================================================================
-- STEP 2: Create places for NAMED locations with known addresses
-- ============================================================================

\echo 'Step 2: Creating places for known named locations...'

-- Gold Ridge RCD
SELECT trapper.find_or_create_place_deduped(
    '2776 Sullivan Rd, Sebastopol, CA 95472',
    'Gold Ridge Resource Conservation District',
    NULL, NULL, 'clinichq'
);

INSERT INTO trapper.organization_place_mappings (
    org_pattern, org_pattern_type, place_id, org_display_name, notes, created_by
)
SELECT
    '%Gold Ridge%',
    'ilike',
    place_id,
    'Gold Ridge RCD',
    'Resource Conservation District - community cat trapping location',
    'MIG_529'
FROM trapper.places
WHERE formatted_address ILIKE '%2776 Sullivan%' OR display_name ILIKE '%Gold Ridge%'
LIMIT 1
ON CONFLICT (org_pattern, org_pattern_type) DO NOTHING;

-- Lawson's Landing (campground in Dillon Beach)
SELECT trapper.find_or_create_place_deduped(
    '137 Marine View Dr, Dillon Beach, CA 94929',
    'Lawson''s Landing',
    NULL, NULL, 'clinichq'
);

INSERT INTO trapper.organization_place_mappings (
    org_pattern, org_pattern_type, place_id, org_display_name, notes, created_by
)
SELECT
    '%Lawson%Landing%',
    'ilike',
    place_id,
    'Lawson''s Landing',
    'Campground/marina - community cat trapping location',
    'MIG_529'
FROM trapper.places
WHERE formatted_address ILIKE '%Dillon Beach%' OR display_name ILIKE '%Lawson%'
LIMIT 1
ON CONFLICT (org_pattern, org_pattern_type) DO NOTHING;

-- Howarth Park
SELECT trapper.find_or_create_place_deduped(
    '630 Summerfield Rd, Santa Rosa, CA 95405',
    'Howarth Park',
    NULL, NULL, 'clinichq'
);

INSERT INTO trapper.organization_place_mappings (
    org_pattern, org_pattern_type, place_id, org_display_name, notes, created_by
)
SELECT
    '%Howarth Park%',
    'ilike',
    place_id,
    'Howarth Park',
    'Public park - community cat colony location',
    'MIG_529'
FROM trapper.places
WHERE display_name ILIKE '%Howarth%' OR formatted_address ILIKE '%Summerfield%'
LIMIT 1
ON CONFLICT (org_pattern, org_pattern_type) DO NOTHING;

-- Avenue Car Wash (Santa Rosa)
SELECT trapper.find_or_create_place_deduped(
    '1500 Santa Rosa Ave, Santa Rosa, CA 95404',
    'Avenue Car Wash',
    NULL, NULL, 'clinichq'
);

INSERT INTO trapper.organization_place_mappings (
    org_pattern, org_pattern_type, place_id, org_display_name, notes, created_by
)
SELECT
    '%Avenue Car Wash%',
    'ilike',
    place_id,
    'Avenue Car Wash',
    'Business - community cat colony location',
    'MIG_529'
FROM trapper.places
WHERE display_name ILIKE '%Avenue Car Wash%' OR formatted_address ILIKE '%1500 Santa Rosa Ave%'
LIMIT 1
ON CONFLICT (org_pattern, org_pattern_type) DO NOTHING;

-- Chevron Sebastopol
SELECT trapper.find_or_create_place_deduped(
    '6990 Sebastopol Ave, Sebastopol, CA 95472',
    'Chevron Sebastopol',
    NULL, NULL, 'clinichq'
);

INSERT INTO trapper.organization_place_mappings (
    org_pattern, org_pattern_type, place_id, org_display_name, notes, created_by
)
SELECT
    '%Chevron Sebastopol%',
    'ilike',
    place_id,
    'Chevron Sebastopol',
    'Gas station - community cat colony location',
    'MIG_529'
FROM trapper.places
WHERE display_name ILIKE '%Chevron Sebastopol%'
LIMIT 1
ON CONFLICT (org_pattern, org_pattern_type) DO NOTHING;

-- Graton Rancheria
SELECT trapper.find_or_create_place_deduped(
    '6400 Redwood Dr, Rohnert Park, CA 94928',
    'Graton Rancheria',
    NULL, NULL, 'clinichq'
);

INSERT INTO trapper.organization_place_mappings (
    org_pattern, org_pattern_type, place_id, org_display_name, notes, created_by
)
SELECT
    '%Graton Rancheria%',
    'ilike',
    place_id,
    'Graton Rancheria',
    'Federated Indians of Graton Rancheria - community cat location',
    'MIG_529'
FROM trapper.places
WHERE display_name ILIKE '%Graton Rancheria%'
LIMIT 1
ON CONFLICT (org_pattern, org_pattern_type) DO NOTHING;

-- Lombardi Lane (street in Santa Rosa)
SELECT trapper.find_or_create_place_deduped(
    'Lombardi Ln, Santa Rosa, CA',
    'Lombardi Lane Colony',
    NULL, NULL, 'clinichq'
);

INSERT INTO trapper.organization_place_mappings (
    org_pattern, org_pattern_type, place_id, org_display_name, notes, created_by
)
SELECT
    '%Lombardi Lane%',
    'ilike',
    place_id,
    'Lombardi Lane',
    'Street colony location',
    'MIG_529'
FROM trapper.places
WHERE display_name ILIKE '%Lombardi%'
LIMIT 1
ON CONFLICT (org_pattern, org_pattern_type) DO NOTHING;

\echo 'Named location places created.'

-- ============================================================================
-- STEP 3: Link appointments to places via mappings
-- ============================================================================

\echo 'Step 3: Linking appointments to places...'

WITH org_appointments AS (
    SELECT
        a.appointment_id,
        p.display_name AS owner_name,
        m.place_id AS mapped_place_id,
        m.org_display_name
    FROM trapper.sot_appointments a
    JOIN trapper.sot_people p ON a.person_id = p.person_id
    JOIN trapper.organization_place_mappings m ON (
        (m.org_pattern_type = 'ilike' AND p.display_name ILIKE m.org_pattern) OR
        (m.org_pattern_type = 'exact' AND LOWER(p.display_name) = LOWER(m.org_pattern))
    )
    WHERE p.is_canonical = FALSE
      AND a.inferred_place_id IS NULL
      AND m.auto_link_enabled = TRUE
)
UPDATE trapper.sot_appointments a
SET
    inferred_place_id = oa.mapped_place_id,
    inferred_place_source = 'org_mapping'
FROM org_appointments oa
WHERE a.appointment_id = oa.appointment_id;

\echo 'Appointments linked to places.'

-- ============================================================================
-- STEP 4: Mark places as colony sites
-- ============================================================================

\echo 'Step 4: Marking places as colony sites...'

-- Add colony_site context to all places linked via org mappings
INSERT INTO trapper.place_contexts (
    place_id, context_type, evidence_type, evidence_notes, assigned_by, source_system
)
SELECT DISTINCT
    m.place_id,
    'colony_site',
    'org_mapping',
    'Identified as trapping location from ClinicHQ org name: ' || m.org_display_name,
    'MIG_529',
    'clinichq'
FROM trapper.organization_place_mappings m
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.place_contexts pc
    WHERE pc.place_id = m.place_id AND pc.context_type = 'colony_site'
)
ON CONFLICT DO NOTHING;

\echo 'Place contexts updated.'

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_529 Complete!'
\echo '=============================================='
\echo ''

SELECT 'Total Org-Place Mappings' AS metric, COUNT(*)::text AS value
FROM trapper.organization_place_mappings
UNION ALL
SELECT 'Appointments with inferred_place_id', COUNT(*)::text
FROM trapper.sot_appointments
WHERE inferred_place_id IS NOT NULL
UNION ALL
SELECT 'Appointments linked via org_mapping', COUNT(*)::text
FROM trapper.sot_appointments
WHERE inferred_place_source = 'org_mapping'
UNION ALL
SELECT 'Places marked as colony_site', COUNT(DISTINCT place_id)::text
FROM trapper.place_contexts
WHERE context_type = 'colony_site';

\echo ''
\echo 'Top org-place mappings by appointments:'
SELECT
    org_display_name,
    place_address,
    appointments_linked_count
FROM trapper.v_organization_place_mappings
ORDER BY appointments_linked_count DESC
LIMIT 10;

\echo ''
\echo 'Remaining org appointments without place link:'
SELECT COUNT(*) FROM trapper.v_org_appointments_without_place;

\echo ''
