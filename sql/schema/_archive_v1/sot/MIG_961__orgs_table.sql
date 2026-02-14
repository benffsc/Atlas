-- ============================================================================
-- MIG_961: Unified Organizations Table
-- ============================================================================
-- Creates a unified `orgs` table for ALL external organizations (partners,
-- shelters, rescues, clinics, community groups).
--
-- This consolidates:
--   - partner_organizations (MIG_531)
--   - known_organizations (MIG_555)
--   - external orgs from organizations table (MIG_170)
--
-- FFSC internal departments remain in the `organizations` table (will be
-- renamed to ffsc_departments in MIG_963).
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_961: Unified Organizations Table'
\echo '=============================================='
\echo ''

-- ============================================================================
-- TABLE: orgs
-- Unified registry for ALL external organizations
-- ============================================================================

\echo 'Creating orgs table...'

CREATE TABLE IF NOT EXISTS trapper.orgs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Core Identity
    name TEXT NOT NULL,                          -- Canonical name
    short_name TEXT,                             -- Short name/abbreviation (e.g., "SCAS")
    org_type TEXT NOT NULL DEFAULT 'other',      -- shelter, rescue, clinic, vet, community_group, municipal, other

    -- Contact
    email TEXT,
    phone TEXT,
    website TEXT,

    -- Location
    place_id UUID REFERENCES trapper.places(place_id),
    address TEXT,                                -- Fallback address text if place not linked
    city TEXT,
    state TEXT DEFAULT 'CA',
    zip TEXT,
    lat NUMERIC(10, 7),
    lng NUMERIC(10, 7),

    -- Matching (for auto-linking appointments)
    name_patterns TEXT[] DEFAULT '{}',           -- ILIKE patterns like '%jehovah%witness%'
    aliases TEXT[] DEFAULT '{}',                 -- Alternative names this org goes by

    -- Status
    is_active BOOLEAN DEFAULT true,
    relationship_type TEXT DEFAULT 'partner',    -- partner, referral_source, transfer_destination

    -- Stats (denormalized for quick display)
    appointments_count INTEGER DEFAULT 0,
    cats_count INTEGER DEFAULT 0,
    first_appointment_date DATE,
    last_appointment_date DATE,

    -- Audit
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT,
    source_system TEXT                           -- Where this record originated (migration, manual, etc.)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

\echo 'Creating indexes...'

CREATE INDEX IF NOT EXISTS idx_orgs_name ON trapper.orgs(LOWER(name));
CREATE INDEX IF NOT EXISTS idx_orgs_short_name ON trapper.orgs(LOWER(short_name));
CREATE INDEX IF NOT EXISTS idx_orgs_type ON trapper.orgs(org_type);
CREATE INDEX IF NOT EXISTS idx_orgs_active ON trapper.orgs(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_orgs_place ON trapper.orgs(place_id) WHERE place_id IS NOT NULL;

-- GIN indexes for array searching
CREATE INDEX IF NOT EXISTS idx_orgs_patterns ON trapper.orgs USING GIN(name_patterns);
CREATE INDEX IF NOT EXISTS idx_orgs_aliases ON trapper.orgs USING GIN(aliases);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE trapper.orgs IS
'Unified registry of ALL external organizations (shelters, rescues, clinics, community groups, etc.).
These are partner orgs that interact with FFSC - NOT FFSC internal departments.
See ffsc_departments for FFSC internal structure.

Consolidates data from:
  - partner_organizations (MIG_531)
  - known_organizations (MIG_555)
  - external orgs from organizations table';

COMMENT ON COLUMN trapper.orgs.name IS 'Canonical name (e.g., "Sonoma County Animal Services")';
COMMENT ON COLUMN trapper.orgs.short_name IS 'Common abbreviation (e.g., "SCAS")';
COMMENT ON COLUMN trapper.orgs.org_type IS 'Organization type: shelter, rescue, clinic, vet, community_group, municipal, other';
COMMENT ON COLUMN trapper.orgs.name_patterns IS 'Array of ILIKE patterns for matching in ClinicHQ data (e.g., {"%SCAS%", "%Sonoma County Animal%"})';
COMMENT ON COLUMN trapper.orgs.aliases IS 'Alternative names this organization is known by';
COMMENT ON COLUMN trapper.orgs.place_id IS 'Link to places table for the organization''s physical location';

-- ============================================================================
-- ADD org_id TO sot_appointments
-- Links appointments directly to the organization
-- ============================================================================

\echo 'Adding org_id to sot_appointments...'

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'sot_appointments'
        AND column_name = 'org_id'
    ) THEN
        ALTER TABLE trapper.sot_appointments
        ADD COLUMN org_id UUID REFERENCES trapper.orgs(id);

        COMMENT ON COLUMN trapper.sot_appointments.org_id IS
        'The external organization that brought this cat to FFSC (if applicable).
        References the unified orgs table.';

        CREATE INDEX idx_appointments_org ON trapper.sot_appointments(org_id)
        WHERE org_id IS NOT NULL;
    END IF;
END $$;

-- ============================================================================
-- ORG_TYPE LOOKUP TABLE (for UI dropdowns)
-- ============================================================================

\echo 'Creating org_types lookup table...'

CREATE TABLE IF NOT EXISTS trapper.org_types (
    type_code TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT,
    display_order INTEGER DEFAULT 0
);

INSERT INTO trapper.org_types (type_code, display_name, description, display_order) VALUES
    ('shelter', 'Animal Shelter', 'Public or private animal shelter', 1),
    ('rescue', 'Rescue Organization', 'Non-profit animal rescue', 2),
    ('clinic', 'Veterinary Clinic', 'Veterinary practice', 3),
    ('vet', 'Veterinarian', 'Individual veterinary practice', 4),
    ('municipal', 'Municipal Services', 'City or county animal services', 5),
    ('community_group', 'Community Group', 'Community or neighborhood group', 6),
    ('other', 'Other', 'Other organization type', 99)
ON CONFLICT (type_code) DO NOTHING;

COMMENT ON TABLE trapper.org_types IS
'Lookup table for organization types. Used for UI dropdowns and data validation.';

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================

\echo 'Creating updated_at trigger...'

CREATE OR REPLACE FUNCTION trapper.orgs_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orgs_updated_at ON trapper.orgs;
CREATE TRIGGER trg_orgs_updated_at
    BEFORE UPDATE ON trapper.orgs
    FOR EACH ROW
    EXECUTE FUNCTION trapper.orgs_set_updated_at();

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_961 Complete!'
\echo '=============================================='
\echo ''

SELECT 'Tables created' AS status, 'trapper.orgs' AS name
UNION ALL SELECT 'Tables created', 'trapper.org_types'
UNION ALL SELECT 'Columns added', 'sot_appointments.org_id'
UNION ALL SELECT 'Triggers created', 'trg_orgs_updated_at';

\echo ''
\echo 'Next: Run MIG_962 to migrate data from existing tables'
\echo ''
