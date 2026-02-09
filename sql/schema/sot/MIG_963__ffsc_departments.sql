-- ============================================================================
-- MIG_963: FFSC Departments Cleanup
-- ============================================================================
-- Cleans up the organizations table to only contain FFSC internal structure
-- (departments and teams). External organizations have been migrated to the
-- unified orgs table in MIG_962.
--
-- The table remains as `organizations` for backward compatibility, but we:
--   1. Remove any external orgs that were incorrectly stored here
--   2. Update the org_type constraint
--   3. Create a view `v_ffsc_departments` for the new admin UI
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_963: FFSC Departments Cleanup'
\echo '=============================================='
\echo ''

-- ============================================================================
-- STEP 1: Identify external orgs in the organizations table
-- ============================================================================

\echo 'Current organizations table contents:'

SELECT org_code, display_name, org_type, is_internal
FROM trapper.organizations
ORDER BY org_type, display_name;

-- ============================================================================
-- STEP 2: Mark external orgs as inactive (don't delete - keep for reference)
-- ============================================================================

\echo 'Marking external orgs as non-internal in organizations table...'

-- Any org that's not clearly part of FFSC internal structure should be marked
UPDATE trapper.organizations
SET is_internal = FALSE
WHERE org_type = 'program'
  AND org_code NOT IN ('FFSC', 'RELOCATION', 'FOSTER_ADOPT', 'TRAPPING', 'CLINIC', 'EXECUTIVE')
  AND LOWER(display_name) NOT LIKE '%forgotten felines%';

-- Show what we marked
SELECT org_code, display_name, org_type, is_internal
FROM trapper.organizations
WHERE is_internal = FALSE;

-- ============================================================================
-- STEP 3: Add 'team' to the org_type constraint for better granularity
-- ============================================================================

\echo 'Updating org_type constraint...'

-- Drop old constraint if exists
ALTER TABLE trapper.organizations
DROP CONSTRAINT IF EXISTS organizations_org_type_check;

-- Add updated constraint
ALTER TABLE trapper.organizations
ADD CONSTRAINT organizations_org_type_check
CHECK (org_type IN ('parent', 'department', 'team', 'program'));

COMMENT ON COLUMN trapper.organizations.org_type IS
'Organization type within FFSC:
  - parent: The main FFSC organization
  - department: Major operational divisions (Clinic, Trapping, etc.)
  - team: Sub-groups within departments
  - program: Legacy type, being phased out';

-- ============================================================================
-- STEP 4: Create view for FFSC departments (internal structure only)
-- ============================================================================

\echo 'Creating v_ffsc_departments view...'

CREATE OR REPLACE VIEW trapper.v_ffsc_departments AS
SELECT
    org_id,
    parent_org_id,
    org_code,
    display_name,
    org_type,
    description,
    created_at,
    updated_at,
    -- Include parent info
    (SELECT display_name FROM trapper.organizations p WHERE p.org_id = o.parent_org_id) AS parent_name
FROM trapper.organizations o
WHERE o.is_internal = TRUE
ORDER BY
    CASE o.org_type
        WHEN 'parent' THEN 1
        WHEN 'department' THEN 2
        WHEN 'team' THEN 3
        ELSE 4
    END,
    o.display_name;

COMMENT ON VIEW trapper.v_ffsc_departments IS
'FFSC internal organizational structure.
Shows only internal departments and teams - NOT external partner organizations.
For external orgs, use the trapper.orgs table.';

-- ============================================================================
-- STEP 5: Create a function to get all departments
-- ============================================================================

\echo 'Creating get_ffsc_departments function...'

CREATE OR REPLACE FUNCTION trapper.get_ffsc_departments()
RETURNS TABLE (
    org_id UUID,
    org_code TEXT,
    display_name TEXT,
    org_type TEXT,
    description TEXT,
    parent_name TEXT
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        org_id,
        org_code,
        display_name,
        org_type,
        description,
        parent_name
    FROM trapper.v_ffsc_departments
    WHERE org_type IN ('department', 'team')
    ORDER BY
        CASE org_type
            WHEN 'department' THEN 1
            WHEN 'team' THEN 2
            ELSE 3
        END,
        display_name;
$$;

COMMENT ON FUNCTION trapper.get_ffsc_departments IS
'Returns FFSC internal departments and teams for admin UI dropdown.';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'Verification'
\echo '=============================================='
\echo ''

\echo 'FFSC internal structure:'
SELECT org_code, display_name, org_type FROM trapper.v_ffsc_departments;

\echo ''
\echo 'External orgs (should now be in trapper.orgs):'
SELECT org_code, display_name, org_type
FROM trapper.organizations
WHERE is_internal = FALSE;

\echo ''
\echo 'Comparison:'
SELECT
    (SELECT COUNT(*) FROM trapper.organizations WHERE is_internal = TRUE) AS ffsc_internal_count,
    (SELECT COUNT(*) FROM trapper.organizations WHERE is_internal = FALSE) AS marked_external_count,
    (SELECT COUNT(*) FROM trapper.orgs) AS unified_orgs_count;

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_963 Complete!'
\echo '=============================================='
\echo ''

SELECT 'Updated' AS status, 'Marked external orgs in organizations table' AS detail
UNION ALL SELECT 'Updated', 'org_type constraint to include team'
UNION ALL SELECT 'Created', 'v_ffsc_departments view'
UNION ALL SELECT 'Created', 'get_ffsc_departments() function';

\echo ''
\echo 'The organizations table is now cleaned up for FFSC internal use only.'
\echo 'External organizations are in the unified orgs table.'
\echo ''
\echo 'Next: Run MIG_964 to create the org matching function'
\echo ''
