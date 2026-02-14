\echo '=== MIG_322: External Organizations Table ==='
\echo 'Creates proper entity type for external organizations (shelters, rescues, clinics)'
\echo ''

-- ============================================================================
-- PROBLEM
-- ============================================================================
-- 210 organizations are stored as people in sot_people, which:
-- - Corrupts person analytics (counts, linking, deduplication)
-- - Makes identity matching harder (can't match email to "Humane Society")
-- - Confuses the Data Engine household modeling
--
-- NOTE: The existing trapper.organizations table (MIG_170) is for internal
-- FFSC organizational structure (parent, department, program). This migration
-- creates a separate table for external organizations like shelters, rescues,
-- and clinics that need to be tracked as distinct entities from people.
--
-- SOLUTION
-- - Create external_organizations table for external entity types
-- - Provide conversion function to move people → external organizations
-- - Link external organizations to places (locations they serve)
-- ============================================================================

-- Step 1: Create external organizations table
\echo 'Step 1: Creating external_organizations table...'

CREATE TABLE IF NOT EXISTS trapper.external_organizations (
    external_org_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity
    name TEXT NOT NULL,
    org_type TEXT CHECK (org_type IN ('shelter', 'rescue', 'clinic', 'ffsc_location', 'business', 'government', 'other')),
    description TEXT,

    -- Contact info
    phone TEXT,
    email TEXT,
    website TEXT,

    -- Location
    place_id UUID REFERENCES trapper.places(place_id),
    service_area TEXT,  -- e.g., "Sonoma County", "Petaluma area"

    -- Source tracking
    source_system TEXT,
    source_record_id TEXT,
    converted_from_person_id UUID,  -- If converted from a person record

    -- Metadata
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Merge support
    merged_into_org_id UUID REFERENCES trapper.external_organizations(external_org_id)
);

CREATE INDEX IF NOT EXISTS idx_external_orgs_name ON trapper.external_organizations(name);
CREATE INDEX IF NOT EXISTS idx_external_orgs_type ON trapper.external_organizations(org_type);
CREATE INDEX IF NOT EXISTS idx_external_orgs_place ON trapper.external_organizations(place_id);

COMMENT ON TABLE trapper.external_organizations IS
'External organizations (shelters, rescues, clinics) as distinct entity type.
Separated from sot_people to prevent corruption of person analytics.
Note: Internal FFSC orgs use trapper.organizations (MIG_170).';

-- Step 2: Create cat-external-organization relationships (for foster orgs, etc.)
\echo ''
\echo 'Step 2: Creating cat_external_org_relationships table...'

CREATE TABLE IF NOT EXISTS trapper.cat_external_org_relationships (
    relationship_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),
    external_org_id UUID NOT NULL REFERENCES trapper.external_organizations(external_org_id),
    relationship_type TEXT NOT NULL CHECK (relationship_type IN ('foster', 'rescue', 'adopted_from', 'surrendered_to', 'clinic', 'other')),
    start_date DATE,
    end_date DATE,
    notes TEXT,
    source_system TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(cat_id, external_org_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_cat_ext_org_rel_cat ON trapper.cat_external_org_relationships(cat_id);
CREATE INDEX IF NOT EXISTS idx_cat_ext_org_rel_org ON trapper.cat_external_org_relationships(external_org_id);

COMMENT ON TABLE trapper.cat_external_org_relationships IS
'Links cats to external organizations (foster orgs, rescue groups, clinics).';

-- Step 3: Create conversion function
\echo ''
\echo 'Step 3: Creating convert_person_to_external_org function...'

CREATE OR REPLACE FUNCTION trapper.convert_person_to_external_org(
    p_person_id UUID,
    p_org_type TEXT DEFAULT 'other'
)
RETURNS UUID AS $$
DECLARE
    v_person RECORD;
    v_org_id UUID;
    v_place_id UUID;
BEGIN
    -- Get person record
    SELECT * INTO v_person
    FROM trapper.sot_people
    WHERE person_id = p_person_id
      AND merged_into_person_id IS NULL;

    IF v_person IS NULL THEN
        RAISE EXCEPTION 'Person not found or already merged: %', p_person_id;
    END IF;

    -- Get associated place if any
    SELECT place_id INTO v_place_id
    FROM trapper.person_place_relationships
    WHERE person_id = p_person_id
    ORDER BY created_at DESC
    LIMIT 1;

    -- Create external organization
    INSERT INTO trapper.external_organizations (
        name, org_type, phone, email, place_id,
        source_system, converted_from_person_id, notes
    ) VALUES (
        v_person.display_name,
        p_org_type,
        v_person.primary_phone,
        v_person.primary_email,
        v_place_id,
        'conversion',
        p_person_id,
        'Converted from person record'
    ) RETURNING external_org_id INTO v_org_id;

    -- Mark person as non-canonical (don't delete, keep for audit)
    UPDATE trapper.sot_people
    SET is_canonical = FALSE,
        data_quality = 'converted_to_org',
        quality_notes = 'Converted to external organization: ' || v_org_id::TEXT
    WHERE person_id = p_person_id;

    -- Log the conversion
    INSERT INTO trapper.entity_edits (
        entity_type, entity_id, edit_type, field_name,
        old_value, new_value, edited_by, edit_reason
    ) VALUES (
        'person', p_person_id, 'conversion', 'entity_type',
        jsonb_build_object('type', 'person', 'name', v_person.display_name),
        jsonb_build_object('type', 'external_organization', 'org_id', v_org_id),
        'data_engine', 'External organization detected - converted to proper entity type'
    );

    RETURN v_org_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.convert_person_to_external_org IS
'Converts a person record to an external organization. Does not delete the person,
just marks it non-canonical and creates a new external_organizations record.';

-- Step 4: Seed with known organizations from known_organizations table
\echo ''
\echo 'Step 4: Seeding external_organizations from known_organizations registry...'

INSERT INTO trapper.external_organizations (name, org_type, source_system, notes)
SELECT
    org_name,
    org_type,
    'known_organizations',
    notes
FROM trapper.known_organizations
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.external_organizations o WHERE o.name = known_organizations.org_name
);

-- Step 5: Create view for organizations-as-people that need conversion
\echo ''
\echo 'Step 5: Creating view for people needing conversion...'

CREATE OR REPLACE VIEW trapper.v_people_needing_org_conversion AS
SELECT
    p.person_id,
    p.display_name,
    p.primary_email,
    p.primary_phone,
    p.created_at,

    -- Suggested org type based on name patterns
    CASE
        WHEN p.display_name ILIKE '%humane society%' OR p.display_name ILIKE '%spca%' THEN 'shelter'
        WHEN p.display_name ILIKE '%rescue%' THEN 'rescue'
        WHEN p.display_name ILIKE '%animal medical%' OR p.display_name ILIKE '%veterinary%' OR p.display_name ILIKE '%clinic%' THEN 'clinic'
        WHEN p.display_name ILIKE '%ffsc%' OR p.display_name ILIKE '%forgotten felines%' THEN 'ffsc_location'
        WHEN p.display_name ILIKE '%animal services%' THEN 'government'
        ELSE 'other'
    END as suggested_org_type,

    -- Count of cats linked (to prioritize conversion)
    (SELECT COUNT(*) FROM trapper.sot_cats c WHERE c.owner_person_id = p.person_id) as cat_count,

    -- Count of appointments linked
    (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.person_id = p.person_id) as appointment_count

FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND p.is_canonical = TRUE
  AND trapper.is_organization_name(p.display_name)
ORDER BY cat_count DESC, appointment_count DESC;

COMMENT ON VIEW trapper.v_people_needing_org_conversion IS
'People records that are actually external organizations and need to be converted.
Use convert_person_to_external_org() to convert them.';

-- Step 6: Summary
\echo ''
\echo '=== Summary ==='
SELECT
    (SELECT COUNT(*) FROM trapper.external_organizations) as external_orgs_created,
    (SELECT COUNT(*) FROM trapper.v_people_needing_org_conversion) as people_needing_conversion;

\echo ''
\echo '=== MIG_322 Complete ==='
\echo 'Created:'
\echo '  - external_organizations table (for shelters, rescues, clinics)'
\echo '  - cat_external_org_relationships table'
\echo '  - convert_person_to_external_org() function'
\echo '  - v_people_needing_org_conversion view'
\echo ''
\echo 'To convert organizations:'
\echo '  SELECT * FROM trapper.v_people_needing_org_conversion;'
\echo '  SELECT trapper.convert_person_to_external_org(person_id, suggested_org_type) FROM ...;'
\echo ''
