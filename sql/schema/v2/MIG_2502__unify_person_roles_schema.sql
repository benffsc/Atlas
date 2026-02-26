-- MIG_2502__unify_person_roles_schema.sql
-- Date: 2026-02-25
--
-- PROBLEM: Schema inconsistency causing map view failures
--
-- The codebase has TWO person_roles references:
--   - ops.person_roles (used by map views MIG_2300, 2303, 2306)
--   - sot.person_roles (used by search functions, entity linking)
--
-- INDUSTRY BEST PRACTICE (PostgreSQL Wiki):
--   "Cross schema object access is possible from a single database connection"
--   Put tables in ONE schema, create VIEWS in other schemas if needed.
--
-- ATLAS ARCHITECTURE:
--   - sot = Source of Truth (entities: people, places, cats)
--   - ops = Operations (workflow: appointments, requests)
--
-- person_roles is about PEOPLE → belongs in sot
--
-- SOLUTION:
--   1. Ensure sot.person_roles TABLE exists with all data
--   2. Drop ops.person_roles TABLE if it exists
--   3. Create ops.person_roles as VIEW pointing to sot.person_roles
--   4. Map views continue to work, search continues to work, ONE source of truth
--
-- Run: psql "$DATABASE_URL" -f sql/schema/v2/MIG_2502__unify_person_roles_schema.sql

\echo ''
\echo '=============================================='
\echo '  MIG_2502: Unify person_roles Schema'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. DIAGNOSTIC: Current State
-- ============================================================================

\echo '1. Checking current state...'
\echo ''

\echo '1.1 What exists in ops schema:'
SELECT
    CASE
        WHEN table_type = 'BASE TABLE' THEN 'TABLE'
        WHEN table_type = 'VIEW' THEN 'VIEW'
        ELSE table_type
    END as object_type,
    table_name
FROM information_schema.tables
WHERE table_schema = 'ops' AND table_name = 'person_roles';

\echo ''
\echo '1.2 What exists in sot schema:'
SELECT
    CASE
        WHEN table_type = 'BASE TABLE' THEN 'TABLE'
        WHEN table_type = 'VIEW' THEN 'VIEW'
        ELSE table_type
    END as object_type,
    table_name
FROM information_schema.tables
WHERE table_schema = 'sot' AND table_name = 'person_roles';

-- ============================================================================
-- 2. ENSURE sot.person_roles TABLE EXISTS
-- ============================================================================

\echo ''
\echo '2. Ensuring sot.person_roles table exists...'

CREATE TABLE IF NOT EXISTS sot.person_roles (
    role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES sot.people(person_id),
    role TEXT NOT NULL,
    role_status TEXT DEFAULT 'active',
    trapper_type TEXT,
    source_system TEXT DEFAULT 'atlas_ui',
    source_record_id TEXT,
    started_at DATE,
    ended_at DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add constraints if they don't exist (using DO block for idempotency)
DO $$
BEGIN
    -- Role check constraint
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'person_roles_role_check'
    ) THEN
        ALTER TABLE sot.person_roles ADD CONSTRAINT person_roles_role_check
            CHECK (role IN (
                'volunteer', 'trapper', 'coordinator', 'head_trapper',
                'ffsc_trapper', 'community_trapper', 'foster',
                'staff', 'clinic_volunteer', 'board_member', 'requester', 'caretaker'
            ));
    END IF;

    -- Role status check constraint
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'person_roles_role_status_check'
    ) THEN
        ALTER TABLE sot.person_roles ADD CONSTRAINT person_roles_role_status_check
            CHECK (role_status IN ('active', 'inactive', 'pending'));
    END IF;

    -- Trapper type check constraint
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'person_roles_trapper_type_check'
    ) THEN
        ALTER TABLE sot.person_roles ADD CONSTRAINT person_roles_trapper_type_check
            CHECK (trapper_type IS NULL OR trapper_type IN (
                'coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper'
            ));
    END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_sot_person_roles_person ON sot.person_roles(person_id);
CREATE INDEX IF NOT EXISTS idx_sot_person_roles_role ON sot.person_roles(role);
CREATE INDEX IF NOT EXISTS idx_sot_person_roles_status ON sot.person_roles(role_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sot_person_roles_unique ON sot.person_roles(person_id, role);

\echo '   sot.person_roles table ensured'

-- ============================================================================
-- 3. MIGRATE DATA FROM ops.person_roles TO sot.person_roles (if ops has data)
-- ============================================================================

\echo ''
\echo '3. Migrating data from ops to sot (if needed)...'

DO $$
DECLARE
    v_ops_is_table BOOLEAN;
    v_ops_count INT := 0;
    v_sot_count INT := 0;
    v_migrated INT := 0;
BEGIN
    -- Check if ops.person_roles is a TABLE (not a view)
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'ops'
          AND table_name = 'person_roles'
          AND table_type = 'BASE TABLE'
    ) INTO v_ops_is_table;

    IF v_ops_is_table THEN
        -- Get counts
        EXECUTE 'SELECT COUNT(*) FROM ops.person_roles' INTO v_ops_count;
        SELECT COUNT(*) INTO v_sot_count FROM sot.person_roles;

        RAISE NOTICE 'ops.person_roles (TABLE): % rows', v_ops_count;
        RAISE NOTICE 'sot.person_roles: % rows', v_sot_count;

        IF v_ops_count > 0 THEN
            -- Migrate data from ops to sot
            INSERT INTO sot.person_roles (
                role_id, person_id, role, role_status, trapper_type,
                source_system, source_record_id, started_at, ended_at, notes,
                created_at, updated_at
            )
            SELECT
                role_id, person_id, role, role_status, trapper_type,
                source_system, source_record_id, started_at, ended_at, notes,
                created_at, updated_at
            FROM ops.person_roles opr
            WHERE NOT EXISTS (
                SELECT 1 FROM sot.person_roles spr
                WHERE spr.role_id = opr.role_id
            )
            ON CONFLICT (role_id) DO NOTHING;

            GET DIAGNOSTICS v_migrated = ROW_COUNT;
            RAISE NOTICE 'Migrated % rows from ops to sot', v_migrated;
        END IF;
    ELSE
        RAISE NOTICE 'ops.person_roles is not a table (may be view or missing) - no migration needed';
    END IF;
END $$;

-- ============================================================================
-- 4. DROP ops.person_roles TABLE AND CREATE AS VIEW
-- ============================================================================

\echo ''
\echo '4. Converting ops.person_roles to VIEW...'

DO $$
DECLARE
    v_ops_is_table BOOLEAN;
    v_ops_is_view BOOLEAN;
BEGIN
    -- Check what ops.person_roles is
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'ops'
          AND table_name = 'person_roles'
          AND table_type = 'BASE TABLE'
    ) INTO v_ops_is_table;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'ops'
          AND table_name = 'person_roles'
          AND table_type = 'VIEW'
    ) INTO v_ops_is_view;

    IF v_ops_is_table THEN
        RAISE NOTICE 'Dropping ops.person_roles TABLE...';
        DROP TABLE ops.person_roles CASCADE;
        RAISE NOTICE 'Creating ops.person_roles VIEW...';
    ELSIF v_ops_is_view THEN
        RAISE NOTICE 'ops.person_roles is already a VIEW - recreating...';
        DROP VIEW ops.person_roles CASCADE;
    ELSE
        RAISE NOTICE 'ops.person_roles does not exist - creating VIEW...';
    END IF;
END $$;

-- Create the view pointing to sot
CREATE OR REPLACE VIEW ops.person_roles AS
SELECT
    role_id,
    person_id,
    role,
    role_status,
    trapper_type,
    source_system,
    source_record_id,
    started_at,
    ended_at,
    notes,
    created_at,
    updated_at
FROM sot.person_roles;

COMMENT ON VIEW ops.person_roles IS
'View pointing to sot.person_roles (MIG_2502).
Industry best practice: single source of truth table in sot schema,
view in ops schema for map view compatibility.
All writes should go to sot.person_roles.';

\echo '   ops.person_roles is now a VIEW pointing to sot.person_roles'

-- ============================================================================
-- 5. VERIFY MAP VIEW DEPENDENCIES
-- ============================================================================

\echo ''
\echo '5. Checking map view dependencies...'

\echo ''
\echo '5.1 sot.is_organization_name function:'
SELECT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'sot' AND routine_name = 'is_organization_name'
) as exists;

\echo ''
\echo '5.2 ops.v_place_disease_summary view:'
SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'ops' AND table_name = 'v_place_disease_summary'
) as exists;

\echo ''
\echo '5.3 sot.v_place_alteration_history view:'
SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'sot' AND table_name = 'v_place_alteration_history'
) as exists;

-- ============================================================================
-- 6. TEST THE MAP VIEW
-- ============================================================================

\echo ''
\echo '6. Testing ops.v_map_atlas_pins...'

DO $$
DECLARE
    v_count INT;
    v_active_count INT;
    v_reference_count INT;
BEGIN
    BEGIN
        SELECT COUNT(*) INTO v_count FROM ops.v_map_atlas_pins;
        SELECT COUNT(*) INTO v_active_count FROM ops.v_map_atlas_pins WHERE pin_tier = 'active';
        SELECT COUNT(*) INTO v_reference_count FROM ops.v_map_atlas_pins WHERE pin_tier = 'reference';

        RAISE NOTICE '';
        RAISE NOTICE '=== MAP VIEW TEST RESULTS ===';
        RAISE NOTICE 'Total pins: %', v_count;
        RAISE NOTICE 'Active pins: % (should be > 0)', v_active_count;
        RAISE NOTICE 'Reference pins: %', v_reference_count;

        IF v_active_count = 0 AND v_count > 0 THEN
            RAISE NOTICE '';
            RAISE NOTICE 'WARNING: All pins are reference tier!';
            RAISE NOTICE 'This means the pin classification logic is not finding:';
            RAISE NOTICE '  - Places with cats (cat_count > 0)';
            RAISE NOTICE '  - Places with requests';
            RAISE NOTICE '  - Places with active person roles';
            RAISE NOTICE '  - Places with disease risk or watch_list flags';
        ELSIF v_active_count > 0 THEN
            RAISE NOTICE '';
            RAISE NOTICE 'SUCCESS: Map view is working correctly!';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '';
        RAISE NOTICE '=== MAP VIEW FAILED ===';
        RAISE NOTICE 'Error: %', SQLERRM;
        RAISE NOTICE '';
        RAISE NOTICE 'This is likely due to a missing dependency.';
        RAISE NOTICE 'Run MIG_2500__diagnose_map_pins.sql for detailed diagnosis.';
    END;
END $$;

-- ============================================================================
-- 7. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Schema objects after migration:'
SELECT
    table_schema,
    table_name,
    CASE
        WHEN table_type = 'BASE TABLE' THEN 'TABLE'
        WHEN table_type = 'VIEW' THEN 'VIEW'
        ELSE table_type
    END as object_type
FROM information_schema.tables
WHERE table_name = 'person_roles'
  AND table_schema IN ('sot', 'ops')
ORDER BY table_schema;

\echo ''
\echo 'Row count in sot.person_roles:'
SELECT COUNT(*) as total_roles FROM sot.person_roles;

\echo ''
\echo 'Role distribution:'
SELECT role, role_status, COUNT(*)
FROM sot.person_roles
GROUP BY 1, 2
ORDER BY 3 DESC
LIMIT 10;

\echo ''
\echo '=============================================='
\echo '  MIG_2502 Complete'
\echo '=============================================='
\echo ''
\echo 'CHANGES MADE:'
\echo '  1. sot.person_roles TABLE is now the single source of truth'
\echo '  2. ops.person_roles is now a VIEW pointing to sot.person_roles'
\echo '  3. All existing data preserved'
\echo ''
\echo 'ARCHITECTURE (Industry Best Practice):'
\echo '  - sot schema = Source of Truth (tables)'
\echo '  - ops schema = Operations (can use views to reference sot)'
\echo ''
\echo 'NEXT STEPS:'
\echo '  1. Verify map shows active pins (not all grey)'
\echo '  2. If still grey, run MIG_2500__diagnose_map_pins.sql'
\echo '  3. Then apply MIG_2499__intelligent_search.sql'
\echo ''
