-- ============================================================================
-- MIG_962: Migrate Data to Unified Orgs Table
-- ============================================================================
-- Migrates organization data from three sources into the unified orgs table:
--   1. partner_organizations (MIG_531) - Has place links and stats
--   2. known_organizations (MIG_555) - Has contact info and aliases
--   3. organizations where org_type='program' - External orgs that were
--      incorrectly stored in the FFSC internal structure
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_962: Migrate Data to Unified Orgs Table'
\echo '=============================================='
\echo ''

-- ============================================================================
-- STEP 1: Migrate from partner_organizations
-- ============================================================================

\echo 'Migrating from partner_organizations...'

INSERT INTO trapper.orgs (
    name,
    short_name,
    org_type,
    email,
    phone,
    website,
    place_id,
    address,
    name_patterns,
    is_active,
    relationship_type,
    appointments_count,
    cats_count,
    first_appointment_date,
    last_appointment_date,
    notes,
    created_at,
    updated_at,
    source_system
)
SELECT
    po.org_name,
    po.org_name_short,
    CASE po.org_type
        WHEN 'animal_services' THEN 'municipal'
        WHEN 'vet_clinic' THEN 'vet'
        ELSE COALESCE(po.org_type, 'other')
    END,
    po.contact_email,
    po.contact_phone,
    po.website,
    po.place_id,
    po.address,
    po.org_name_patterns,
    po.is_active,
    po.relationship_type,
    po.appointments_count,
    po.cats_processed,
    po.first_appointment_date,
    po.last_appointment_date,
    po.notes,
    po.created_at,
    po.updated_at,
    'mig_962_from_partner_organizations'
FROM trapper.partner_organizations po
WHERE NOT EXISTS (
    -- Skip if already exists with same name
    SELECT 1 FROM trapper.orgs o
    WHERE LOWER(o.name) = LOWER(po.org_name)
);

\echo 'Done: partner_organizations'

-- ============================================================================
-- STEP 2: Migrate from known_organizations
-- ============================================================================

\echo 'Migrating from known_organizations...'

INSERT INTO trapper.orgs (
    name,
    short_name,
    org_type,
    email,
    phone,
    website,
    place_id,
    address,
    city,
    state,
    zip,
    lat,
    lng,
    aliases,
    is_active,
    notes,
    created_at,
    updated_at,
    source_system
)
SELECT
    ko.canonical_name,
    ko.short_name,
    CASE ko.org_type
        WHEN 'partner' THEN 'other'
        ELSE COALESCE(ko.org_type, 'other')
    END,
    ko.email,
    ko.phone,
    ko.website,
    ko.canonical_place_id,
    ko.street_address,
    ko.city,
    ko.state,
    ko.zip,
    ko.lat,
    ko.lng,
    ko.aliases,
    ko.is_active,
    ko.notes || COALESCE(' | Service area: ' || ko.service_area, ''),
    ko.created_at,
    ko.updated_at,
    'mig_962_from_known_organizations'
FROM trapper.known_organizations ko
WHERE NOT EXISTS (
    -- Skip if already exists with same name (may have been inserted from partner_orgs)
    SELECT 1 FROM trapper.orgs o
    WHERE LOWER(o.name) = LOWER(ko.canonical_name)
)
-- Skip FFSC itself - that's us, not an external org
AND LOWER(ko.canonical_name) NOT LIKE '%forgotten felines%';

\echo 'Done: known_organizations'

-- ============================================================================
-- STEP 3: Merge data from known_organizations into existing orgs
-- Some orgs exist in both tables - merge contact info
-- ============================================================================

\echo 'Merging additional data from known_organizations...'

UPDATE trapper.orgs o
SET
    -- Fill in missing contact info from known_organizations
    email = COALESCE(o.email, ko.email),
    phone = COALESCE(o.phone, ko.phone),
    website = COALESCE(o.website, ko.website),
    city = COALESCE(o.city, ko.city),
    state = COALESCE(o.state, ko.state),
    zip = COALESCE(o.zip, ko.zip),
    lat = COALESCE(o.lat, ko.lat),
    lng = COALESCE(o.lng, ko.lng),
    -- Merge aliases (combine arrays)
    aliases = ARRAY(SELECT DISTINCT unnest FROM unnest(COALESCE(o.aliases, '{}') || COALESCE(ko.aliases, '{}'))),
    -- Update place_id if we don't have one
    place_id = COALESCE(o.place_id, ko.canonical_place_id)
FROM trapper.known_organizations ko
WHERE LOWER(o.name) = LOWER(ko.canonical_name)
  AND LOWER(ko.canonical_name) NOT LIKE '%forgotten felines%';

\echo 'Done: merge known_organizations data'

-- ============================================================================
-- STEP 4: Identify and migrate external orgs from organizations table
-- These are orgs like "JW Petaluma" and "SCAS" that were incorrectly stored
-- in the FFSC internal structure
-- ============================================================================

\echo 'Identifying external orgs in organizations table...'

-- First, let's see what we have
SELECT org_code, display_name, org_type, is_internal
FROM trapper.organizations
WHERE org_type = 'program' OR is_internal = FALSE
ORDER BY display_name;

-- Migrate any orgs marked as external or that look like external orgs
-- (We'll be conservative - only migrate if clearly external)
INSERT INTO trapper.orgs (
    name,
    short_name,
    org_type,
    is_active,
    notes,
    created_at,
    source_system
)
SELECT
    orgs.display_name,
    orgs.org_code,
    CASE
        WHEN LOWER(orgs.display_name) LIKE '%animal services%' THEN 'municipal'
        WHEN LOWER(orgs.display_name) LIKE '%shelter%' THEN 'shelter'
        WHEN LOWER(orgs.display_name) LIKE '%rescue%' THEN 'rescue'
        WHEN LOWER(orgs.display_name) LIKE '%jehovah%' THEN 'community_group'
        WHEN LOWER(orgs.display_name) LIKE '%witness%' THEN 'community_group'
        ELSE 'other'
    END,
    TRUE,
    'Migrated from organizations table - was incorrectly stored as FFSC program',
    orgs.created_at,
    'mig_962_from_organizations'
FROM trapper.organizations orgs
WHERE orgs.is_internal = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM trapper.orgs o
    WHERE LOWER(o.name) = LOWER(orgs.display_name)
);

\echo 'Done: external orgs from organizations table'

-- ============================================================================
-- STEP 5: Build name_patterns from aliases
-- Convert alias arrays into ILIKE patterns for matching
-- ============================================================================

\echo 'Building name_patterns from aliases...'

UPDATE trapper.orgs
SET name_patterns = ARRAY(
    SELECT DISTINCT pattern FROM (
        -- Include existing patterns
        SELECT unnest(name_patterns) AS pattern
        UNION
        -- Add pattern for canonical name
        SELECT '%' || LOWER(name) || '%'
        UNION
        -- Add pattern for short name
        SELECT '%' || LOWER(short_name) || '%' WHERE short_name IS NOT NULL
        UNION
        -- Add patterns for each alias
        SELECT '%' || LOWER(unnest(aliases)) || '%' WHERE aliases IS NOT NULL AND array_length(aliases, 1) > 0
    ) patterns
    WHERE pattern IS NOT NULL AND pattern != '%%'
)
WHERE (name_patterns IS NULL OR array_length(name_patterns, 1) = 0)
   OR (aliases IS NOT NULL AND array_length(aliases, 1) > 0);

\echo 'Done: build name_patterns'

-- ============================================================================
-- STEP 6: Create mapping table for migration reference
-- ============================================================================

\echo 'Creating migration mapping table...'

CREATE TABLE IF NOT EXISTS trapper.orgs_migration_map (
    old_table TEXT NOT NULL,
    old_id UUID NOT NULL,
    new_org_id UUID NOT NULL REFERENCES trapper.orgs(id),
    migrated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (old_table, old_id)
);

-- Map partner_organizations
INSERT INTO trapper.orgs_migration_map (old_table, old_id, new_org_id)
SELECT 'partner_organizations', po.org_id, o.id
FROM trapper.partner_organizations po
JOIN trapper.orgs o ON LOWER(o.name) = LOWER(po.org_name)
ON CONFLICT DO NOTHING;

-- Map known_organizations
INSERT INTO trapper.orgs_migration_map (old_table, old_id, new_org_id)
SELECT 'known_organizations', ko.org_id, o.id
FROM trapper.known_organizations ko
JOIN trapper.orgs o ON LOWER(o.name) = LOWER(ko.canonical_name)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE trapper.orgs_migration_map IS
'Maps old organization IDs from partner_organizations and known_organizations
to new unified orgs table. Used for migration reference and debugging.';

\echo 'Done: migration mapping table'

-- ============================================================================
-- STEP 7: Update partner_org_id references in appointments to new org_id
-- ============================================================================

\echo 'Migrating appointment org references...'

UPDATE trapper.sot_appointments a
SET org_id = mm.new_org_id
FROM trapper.orgs_migration_map mm
WHERE mm.old_table = 'partner_organizations'
  AND mm.old_id = a.partner_org_id
  AND a.org_id IS NULL;

\echo 'Done: migrate appointment references'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'Migration Verification'
\echo '=============================================='
\echo ''

\echo 'Source counts:'
SELECT 'partner_organizations' AS source, COUNT(*) AS count FROM trapper.partner_organizations
UNION ALL
SELECT 'known_organizations', COUNT(*) FROM trapper.known_organizations
UNION ALL
SELECT 'organizations (external)', COUNT(*) FROM trapper.organizations WHERE is_internal = FALSE
ORDER BY source;

\echo ''
\echo 'Target counts by source:'
SELECT source_system, COUNT(*) AS count
FROM trapper.orgs
GROUP BY source_system
ORDER BY count DESC;

\echo ''
\echo 'Target counts by org_type:'
SELECT org_type, COUNT(*) AS count
FROM trapper.orgs
GROUP BY org_type
ORDER BY count DESC;

\echo ''
\echo 'Orgs with place links:'
SELECT COUNT(*) AS orgs_with_places FROM trapper.orgs WHERE place_id IS NOT NULL;

\echo ''
\echo 'Orgs with name patterns:'
SELECT COUNT(*) AS orgs_with_patterns FROM trapper.orgs WHERE name_patterns IS NOT NULL AND array_length(name_patterns, 1) > 0;

\echo ''
\echo 'Appointments migrated to new org_id:'
SELECT COUNT(*) AS appointments_linked FROM trapper.sot_appointments WHERE org_id IS NOT NULL;

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_962 Complete!'
\echo '=============================================='
\echo ''

SELECT 'Data migrated' AS status, 'partner_organizations → orgs' AS detail
UNION ALL SELECT 'Data migrated', 'known_organizations → orgs'
UNION ALL SELECT 'Data merged', 'Contact info from known_organizations'
UNION ALL SELECT 'Patterns built', 'name_patterns from aliases'
UNION ALL SELECT 'Mappings created', 'orgs_migration_map for reference'
UNION ALL SELECT 'Appointments', 'partner_org_id → org_id migration';

\echo ''
\echo 'Next: Run MIG_963 to rename organizations → ffsc_departments'
\echo ''
