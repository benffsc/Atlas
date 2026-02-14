-- MIG_303: Link Staff to Organizations
--
-- Problem:
--   Staff table has department TEXT field but staff are not linked to organizations.
--   17 active staff members, 0 linked to FFSC organization.
--
-- Solution:
--   1. Link all active staff to FFSC parent organization via person_organization_link
--   2. Additionally link staff to their specific department org
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_303__link_staff_to_organizations.sql

\echo ''
\echo '=============================================='
\echo 'MIG_303: Link Staff to Organizations'
\echo '=============================================='
\echo ''

-- ============================================
-- LINK ALL STAFF TO FFSC PARENT ORG
-- ============================================

\echo 'Linking all active staff to FFSC organization...'

INSERT INTO trapper.person_organization_link (person_id, org_id, link_type, link_reason)
SELECT
    s.person_id,
    (SELECT org_id FROM trapper.organizations WHERE org_code = 'FFSC'),
    'staff',
    'Auto-linked via MIG_303'
FROM trapper.staff s
WHERE s.is_active = true
  AND s.person_id IS NOT NULL
ON CONFLICT (person_id, org_id) DO NOTHING;

\echo 'Staff linked to FFSC:'
SELECT COUNT(*) as staff_linked_to_ffsc
FROM trapper.person_organization_link pol
JOIN trapper.staff s ON s.person_id = pol.person_id
WHERE s.is_active = true
  AND pol.link_type = 'staff'
  AND pol.org_id = (SELECT org_id FROM trapper.organizations WHERE org_code = 'FFSC');

-- ============================================
-- LINK STAFF TO DEPARTMENT ORGS
-- ============================================

\echo ''
\echo 'Linking staff to their department organizations...'

-- Map staff departments to org_codes
INSERT INTO trapper.person_organization_link (person_id, org_id, link_type, link_reason)
SELECT
    s.person_id,
    o.org_id,
    'staff',
    'Auto-linked via MIG_303 - department: ' || s.department
FROM trapper.staff s
JOIN trapper.organizations o ON o.org_code = CASE
    WHEN s.department = 'Trapping' THEN 'TRAPPING'
    WHEN s.department = 'Clinic' THEN 'CLINIC'
    WHEN s.department IN ('Adoptions', 'Foster') THEN 'FOSTER_ADOPT'
    WHEN s.department IN ('Administration', 'Executive', 'Volunteers', 'Marketing') THEN 'EXECUTIVE'
    ELSE NULL
END
WHERE s.is_active = true
  AND s.person_id IS NOT NULL
  AND s.department IS NOT NULL
ON CONFLICT (person_id, org_id) DO NOTHING;

-- ============================================
-- ADD org_id COLUMN TO STAFF TABLE
-- ============================================

\echo ''
\echo 'Adding org_id column to staff table...'

ALTER TABLE trapper.staff
ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES trapper.organizations(org_id);

-- Update org_id based on department
UPDATE trapper.staff s
SET org_id = o.org_id
FROM trapper.organizations o
WHERE o.org_code = CASE
    WHEN s.department = 'Trapping' THEN 'TRAPPING'
    WHEN s.department = 'Clinic' THEN 'CLINIC'
    WHEN s.department IN ('Adoptions', 'Foster') THEN 'FOSTER_ADOPT'
    WHEN s.department IN ('Administration', 'Executive', 'Volunteers', 'Marketing') THEN 'EXECUTIVE'
    ELSE 'FFSC'
END;

-- ============================================
-- UPDATE v_active_staff VIEW
-- ============================================

\echo ''
\echo 'Updating v_active_staff view to include org info...'

DROP VIEW IF EXISTS trapper.v_active_staff CASCADE;

CREATE VIEW trapper.v_active_staff AS
SELECT
    s.staff_id,
    s.display_name,
    s.email,
    s.phone,
    s.work_extension,
    s.role,
    s.department,
    s.hired_date,
    s.person_id,
    s.source_record_id AS airtable_id,
    s.org_id,
    o.org_code,
    o.display_name AS organization_name
FROM trapper.staff s
LEFT JOIN trapper.organizations o ON o.org_id = s.org_id
WHERE s.is_active = true;

COMMENT ON VIEW trapper.v_active_staff IS
'Active staff members with organization info. Updated MIG_303.';

-- ============================================
-- VERIFICATION
-- ============================================

\echo ''
\echo 'Verification:'
\echo ''

SELECT 'Staff linked to FFSC' as check_type, COUNT(*) as count
FROM trapper.person_organization_link pol
JOIN trapper.organizations o ON o.org_id = pol.org_id
WHERE o.org_code = 'FFSC' AND pol.link_type = 'staff'
UNION ALL
SELECT 'Staff with org_id set' as check_type, COUNT(*) as count
FROM trapper.staff WHERE is_active = true AND org_id IS NOT NULL
UNION ALL
SELECT 'Total person-org links' as check_type, COUNT(*) as count
FROM trapper.person_organization_link;

\echo ''
\echo 'Staff by department org:'
SELECT o.display_name as organization, COUNT(*) as staff_count
FROM trapper.staff s
JOIN trapper.organizations o ON o.org_id = s.org_id
WHERE s.is_active = true
GROUP BY o.display_name
ORDER BY staff_count DESC;

\echo ''
\echo 'MIG_303 Complete!'
\echo ''
