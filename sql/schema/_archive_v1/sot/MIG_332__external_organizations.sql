\echo '=== MIG_332: External Organizations Table ==='
\echo 'Creates external_organizations table for shelters, rescues, clinics, etc.'
\echo ''

-- ============================================================================
-- PROBLEM
-- 210 organizations are stored in sot_people, corrupting person analytics.
-- Need a proper organizations table to:
-- 1. Store external orgs (Sonoma Humane, other rescues)
-- 2. Convert misclassified people to organizations
-- 3. Link organizations to places
-- ============================================================================

\echo 'Step 1: Creating external_organizations table...'

CREATE TABLE IF NOT EXISTS trapper.external_organizations (
    organization_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity
    name TEXT NOT NULL,
    org_type TEXT CHECK (org_type IN (
        'shelter',        -- Animal shelter
        'rescue',         -- Rescue organization
        'clinic',         -- Veterinary clinic
        'humane_society', -- Humane society
        'ffsc_location',  -- FFSC facility
        'vet_office',     -- Private vet office
        'pet_store',      -- Pet store
        'boarding',       -- Boarding facility
        'business',       -- Other business
        'government',     -- Government agency
        'other'
    )),

    -- Contact info
    website TEXT,
    phone TEXT,
    email TEXT,
    contact_person TEXT,

    -- Location
    place_id UUID REFERENCES trapper.places(place_id),
    address TEXT,

    -- Metadata
    notes TEXT,
    is_partner BOOLEAN DEFAULT FALSE,  -- Partner org we share data with
    data_source trapper.data_source,
    source_record_id TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Merge tracking
    merged_into_org_id UUID REFERENCES trapper.external_organizations(organization_id),
    merged_at TIMESTAMPTZ,
    merge_reason TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_external_orgs_type ON trapper.external_organizations(org_type);
CREATE INDEX IF NOT EXISTS idx_external_orgs_place ON trapper.external_organizations(place_id);
CREATE INDEX IF NOT EXISTS idx_external_orgs_partner ON trapper.external_organizations(is_partner) WHERE is_partner = TRUE;

COMMENT ON TABLE trapper.external_organizations IS
'External organizations (shelters, rescues, clinics, etc.) that FFSC interacts with.
Separate from sot_people to keep person analytics clean.';

\echo 'Created external_organizations table'

-- ============================================================================
-- Step 2: Function to convert person to organization
-- ============================================================================

\echo ''
\echo 'Step 2: Creating convert_person_to_organization function...'

CREATE OR REPLACE FUNCTION trapper.convert_person_to_organization(
    p_person_id UUID,
    p_org_type TEXT DEFAULT 'other'
)
RETURNS UUID AS $$
DECLARE
    v_person RECORD;
    v_org_id UUID;
BEGIN
    -- Get the person
    SELECT * INTO v_person
    FROM trapper.sot_people
    WHERE person_id = p_person_id
      AND merged_into_person_id IS NULL;

    IF v_person IS NULL THEN
        RAISE NOTICE 'Person not found or already merged: %', p_person_id;
        RETURN NULL;
    END IF;

    -- Check if already an organization
    IF NOT trapper.is_organization_name(v_person.display_name) THEN
        RAISE WARNING 'Person % does not appear to be an organization: %', p_person_id, v_person.display_name;
    END IF;

    -- Create organization
    INSERT INTO trapper.external_organizations (
        name,
        org_type,
        email,
        phone,
        data_source,
        notes
    ) VALUES (
        v_person.display_name,
        p_org_type,
        v_person.primary_email,
        v_person.primary_phone,
        v_person.data_source,
        'Converted from person ' || p_person_id
    )
    RETURNING organization_id INTO v_org_id;

    -- Mark person as non-canonical (don't delete - preserve links)
    UPDATE trapper.sot_people
    SET is_canonical = FALSE,
        data_quality = 'converted_to_org',
        notes = COALESCE(notes, '') || E'\nConverted to organization ' || v_org_id || ' on ' || NOW()
    WHERE person_id = p_person_id;

    -- Log the conversion
    INSERT INTO trapper.entity_edits (
        entity_type,
        entity_id,
        edit_type,
        old_values,
        new_values,
        edit_reason,
        edited_by
    ) VALUES (
        'person',
        p_person_id,
        'convert_to_org',
        jsonb_build_object('display_name', v_person.display_name, 'is_canonical', TRUE),
        jsonb_build_object('organization_id', v_org_id, 'is_canonical', FALSE),
        'Converted person to external organization',
        'system'
    );

    RAISE NOTICE 'Converted person % (%) to organization %', p_person_id, v_person.display_name, v_org_id;
    RETURN v_org_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.convert_person_to_organization IS
'Converts a person record that is actually an organization to the external_organizations table.
Marks the original person as non-canonical but preserves all links.';

\echo 'Created convert_person_to_organization function'

-- ============================================================================
-- Step 3: View for people that should be organizations
-- ============================================================================

\echo ''
\echo 'Step 3: Creating view for people needing conversion...'

CREATE OR REPLACE VIEW trapper.v_people_needing_org_conversion AS
SELECT
    p.person_id,
    p.display_name,
    p.primary_email,
    p.primary_phone,
    p.data_source,
    p.created_at,
    -- Suggest org type based on name
    CASE
        WHEN p.display_name ~* '(humane|spca|aspca)' THEN 'humane_society'
        WHEN p.display_name ~* '(shelter|pound)' THEN 'shelter'
        WHEN p.display_name ~* '(rescue|haven|sanctuary)' THEN 'rescue'
        WHEN p.display_name ~* '(clinic|hospital|vet|veterinary|animal care)' THEN 'clinic'
        WHEN p.display_name ~* '(pet|petsmart|petco)' THEN 'pet_store'
        ELSE 'other'
    END as suggested_org_type,
    -- Count related entities
    (SELECT COUNT(*) FROM trapper.sot_cats c WHERE c.owner_person_id = p.person_id) as linked_cats,
    (SELECT COUNT(*) FROM trapper.sot_requests r WHERE r.requester_person_id = p.person_id) as linked_requests
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND p.is_canonical = TRUE
  AND trapper.is_organization_name(p.display_name)
ORDER BY linked_cats DESC, p.display_name;

COMMENT ON VIEW trapper.v_people_needing_org_conversion IS
'Lists people records that appear to be organizations based on name patterns.
Use convert_person_to_organization() to convert them.';

\echo 'Created v_people_needing_org_conversion view'

-- ============================================================================
-- Step 4: Summary
-- ============================================================================

\echo ''
\echo '=== Summary ==='

\echo 'Organizations currently as people:'
SELECT COUNT(*) as count FROM trapper.v_people_needing_org_conversion;

\echo ''
\echo 'Sample organizations needing conversion:'
SELECT display_name, suggested_org_type, linked_cats
FROM trapper.v_people_needing_org_conversion
LIMIT 10;

\echo ''
\echo '=== MIG_332 Complete ==='
\echo 'Created external_organizations table and conversion tools.'
\echo ''
\echo 'To convert organizations:'
\echo '  SELECT trapper.convert_person_to_organization(person_id, org_type)'
\echo '  FROM trapper.v_people_needing_org_conversion;'
\echo ''
