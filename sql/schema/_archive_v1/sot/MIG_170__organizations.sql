-- MIG_170__organizations.sql
-- Creates FFSC organization structure and internal account detection
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_170__organizations.sql

\echo ''
\echo 'MIG_170: Organizations Schema'
\echo '=============================='
\echo ''

-- ============================================================
-- 1. Create organizations table
-- ============================================================

\echo 'Creating organizations table...'

CREATE TABLE IF NOT EXISTS trapper.organizations (
    org_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_org_id UUID REFERENCES trapper.organizations(org_id),
    org_code TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    org_type TEXT NOT NULL CHECK (org_type IN ('parent', 'department', 'program')),
    description TEXT,
    is_internal BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_parent ON trapper.organizations(parent_org_id);
CREATE INDEX IF NOT EXISTS idx_organizations_code ON trapper.organizations(org_code);

-- ============================================================
-- 2. Seed FFSC and departments
-- ============================================================

\echo 'Seeding FFSC organization...'

INSERT INTO trapper.organizations (org_code, display_name, org_type, description)
VALUES ('FFSC', 'Forgotten Felines of Sonoma County', 'parent', 'Parent organization')
ON CONFLICT (org_code) DO NOTHING;

\echo 'Seeding departments...'

INSERT INTO trapper.organizations (parent_org_id, org_code, display_name, org_type, description)
SELECT o.org_id, dept.code, dept.name, 'department', dept.descr
FROM trapper.organizations o
CROSS JOIN (VALUES
    ('RELOCATION', 'Relocation', 'Barn cat and relocation program'),
    ('FOSTER_ADOPT', 'Foster/Adopt', 'Foster and adoption program'),
    ('TRAPPING', 'Trapping', 'TNR trapping operations'),
    ('CLINIC', 'Clinic', 'ClinicHQ clinic operations'),
    ('EXECUTIVE', 'Executive', 'Administrative and executive')
) AS dept(code, name, descr)
WHERE o.org_code = 'FFSC'
ON CONFLICT (org_code) DO NOTHING;

-- ============================================================
-- 3. Create internal account types table
-- ============================================================

\echo 'Creating internal account types table...'

CREATE TABLE IF NOT EXISTS trapper.internal_account_types (
    type_id SERIAL PRIMARY KEY,
    account_pattern TEXT NOT NULL,
    pattern_type TEXT NOT NULL CHECK (pattern_type IN ('contains', 'equals', 'starts_with', 'regex')),
    maps_to_org_code TEXT REFERENCES trapper.organizations(org_code),
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_internal_account_types_active
ON trapper.internal_account_types(is_active) WHERE is_active = TRUE;

-- ============================================================
-- 4. Seed known internal account patterns
-- ============================================================

\echo 'Seeding internal account patterns...'

INSERT INTO trapper.internal_account_types (account_pattern, pattern_type, maps_to_org_code, description) VALUES
-- Foster/Adopt patterns
('ff foster', 'contains', 'FOSTER_ADOPT', 'FF Foster program placeholder'),
('ffsc foster', 'contains', 'FOSTER_ADOPT', 'FFSC Foster program placeholder'),
('forgotten felines foster', 'contains', 'FOSTER_ADOPT', 'Foster program full name'),
('foster program', 'contains', 'FOSTER_ADOPT', 'Generic foster program'),

-- Relocation patterns
('barn cat', 'contains', 'RELOCATION', 'Barn cat relocation program'),
('fire cat', 'starts_with', 'RELOCATION', 'Fire cat relocation program'),
('relocation', 'contains', 'RELOCATION', 'General relocation'),

-- Clinic placeholder patterns
('rebooking', 'contains', 'CLINIC', 'Clinic rebooking placeholder'),
('lost owner', 'contains', 'CLINIC', 'Lost/unknown owner placeholder'),
('unknown owner', 'contains', 'CLINIC', 'Unknown owner placeholder'),
('clinic placeholder', 'contains', 'CLINIC', 'Generic clinic placeholder'),
('no owner', 'contains', 'CLINIC', 'No owner specified'),
('owner unknown', 'contains', 'CLINIC', 'Owner unknown variation'),

-- Executive/Staff patterns
('@forgottenfelines.org', 'contains', 'EXECUTIVE', 'FFSC staff email domain')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 5. Create person-organization link table
-- ============================================================

\echo 'Creating person-organization link table...'

CREATE TABLE IF NOT EXISTS trapper.person_organization_link (
    link_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES trapper.organizations(org_id) ON DELETE CASCADE,
    link_type TEXT NOT NULL CHECK (link_type IN ('internal_account', 'staff', 'volunteer', 'donor')),
    link_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(person_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_person_org_link_person ON trapper.person_organization_link(person_id);
CREATE INDEX IF NOT EXISTS idx_person_org_link_org ON trapper.person_organization_link(org_id);

-- ============================================================
-- 6. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'
\echo ''

\echo 'Organizations:'
SELECT org_code, display_name, org_type FROM trapper.organizations ORDER BY org_type, display_name;

\echo ''
\echo 'Internal account patterns:'
SELECT account_pattern, pattern_type, maps_to_org_code FROM trapper.internal_account_types ORDER BY maps_to_org_code;

SELECT 'MIG_170 Complete' AS status;
