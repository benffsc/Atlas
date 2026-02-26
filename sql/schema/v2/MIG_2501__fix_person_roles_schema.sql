-- MIG_2501__fix_person_roles_schema.sql
-- Date: 2026-02-25
--
-- PROBLEM: Schema inconsistency between ops.person_roles and sot.person_roles
--
-- The codebase has TWO different person_roles tables:
--   - ops.person_roles (created in V1 archive, used by map views)
--   - sot.person_roles (used by search functions, entity linking)
--
-- This migration:
-- 1. Checks which tables exist
-- 2. Creates missing table(s) if needed
-- 3. Creates a compatibility view if needed
-- 4. Ensures map view dependencies are satisfied
--
-- Run: psql "$DATABASE_URL" -f sql/schema/v2/MIG_2501__fix_person_roles_schema.sql

\echo ''
\echo '=============================================='
\echo '  MIG_2501: Fix person_roles Schema'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. DIAGNOSTIC: Check what exists
-- ============================================================================

\echo '1. Checking existing person_roles objects...'
\echo ''

\echo '1.1 Tables:'
SELECT
    table_schema,
    table_name,
    'TABLE' as object_type
FROM information_schema.tables
WHERE table_name = 'person_roles'
ORDER BY table_schema;

\echo ''
\echo '1.2 Views:'
SELECT
    table_schema,
    table_name,
    'VIEW' as object_type
FROM information_schema.views
WHERE table_name = 'person_roles'
ORDER BY table_schema;

-- ============================================================================
-- 2. ENSURE ops.person_roles EXISTS
-- ============================================================================

\echo ''
\echo '2. Ensuring ops.person_roles table exists...'

-- Create ops.person_roles if it doesn't exist
-- This is required by ops.v_map_atlas_pins
CREATE TABLE IF NOT EXISTS ops.person_roles (
    role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES sot.people(person_id),
    role TEXT NOT NULL CHECK (role IN (
        'volunteer', 'trapper', 'coordinator', 'head_trapper',
        'ffsc_trapper', 'community_trapper', 'foster',
        'staff', 'clinic_volunteer', 'board_member'
    )),
    role_status TEXT DEFAULT 'active' CHECK (role_status IN ('active', 'inactive', 'pending')),
    trapper_type TEXT CHECK (trapper_type IS NULL OR trapper_type IN (
        'coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper'
    )),
    source_system TEXT DEFAULT 'atlas_ui',
    source_record_id TEXT,
    started_at DATE,
    ended_at DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_ops_person_roles_person ON ops.person_roles(person_id);
CREATE INDEX IF NOT EXISTS idx_ops_person_roles_role ON ops.person_roles(role);
CREATE INDEX IF NOT EXISTS idx_ops_person_roles_status ON ops.person_roles(role_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_person_roles_unique ON ops.person_roles(person_id, role);

\echo '   ops.person_roles table ensured'

-- ============================================================================
-- 3. ENSURE sot.person_roles EXISTS
-- ============================================================================

\echo ''
\echo '3. Ensuring sot.person_roles table exists...'

-- Create sot.person_roles if it doesn't exist
-- This is used by search functions and entity linking
CREATE TABLE IF NOT EXISTS sot.person_roles (
    role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES sot.people(person_id),
    role TEXT NOT NULL CHECK (role IN (
        'volunteer', 'trapper', 'coordinator', 'head_trapper',
        'ffsc_trapper', 'community_trapper', 'foster',
        'staff', 'clinic_volunteer', 'board_member'
    )),
    role_status TEXT DEFAULT 'active' CHECK (role_status IN ('active', 'inactive', 'pending')),
    trapper_type TEXT CHECK (trapper_type IS NULL OR trapper_type IN (
        'coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper'
    )),
    source_system TEXT DEFAULT 'atlas_ui',
    source_record_id TEXT,
    started_at DATE,
    ended_at DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_sot_person_roles_person ON sot.person_roles(person_id);
CREATE INDEX IF NOT EXISTS idx_sot_person_roles_role ON sot.person_roles(role);
CREATE INDEX IF NOT EXISTS idx_sot_person_roles_status ON sot.person_roles(role_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sot_person_roles_unique ON sot.person_roles(person_id, role);

\echo '   sot.person_roles table ensured'

-- ============================================================================
-- 4. SYNC DATA BETWEEN SCHEMAS (if one has data and other doesn't)
-- ============================================================================

\echo ''
\echo '4. Checking data synchronization...'

DO $$
DECLARE
    v_ops_count INT;
    v_sot_count INT;
BEGIN
    SELECT COUNT(*) INTO v_ops_count FROM ops.person_roles;
    SELECT COUNT(*) INTO v_sot_count FROM sot.person_roles;

    RAISE NOTICE 'ops.person_roles: % rows', v_ops_count;
    RAISE NOTICE 'sot.person_roles: % rows', v_sot_count;

    -- If ops has data but sot is empty, copy to sot
    IF v_ops_count > 0 AND v_sot_count = 0 THEN
        RAISE NOTICE 'Copying ops.person_roles -> sot.person_roles...';
        INSERT INTO sot.person_roles (
            role_id, person_id, role, role_status, trapper_type,
            source_system, source_record_id, started_at, ended_at, notes,
            created_at, updated_at
        )
        SELECT
            role_id, person_id, role, role_status, trapper_type,
            source_system, source_record_id, started_at, ended_at, notes,
            created_at, updated_at
        FROM ops.person_roles
        ON CONFLICT (role_id) DO NOTHING;
        RAISE NOTICE 'Done copying to sot.person_roles';
    END IF;

    -- If sot has data but ops is empty, copy to ops
    IF v_sot_count > 0 AND v_ops_count = 0 THEN
        RAISE NOTICE 'Copying sot.person_roles -> ops.person_roles...';
        INSERT INTO ops.person_roles (
            role_id, person_id, role, role_status, trapper_type,
            source_system, source_record_id, started_at, ended_at, notes,
            created_at, updated_at
        )
        SELECT
            role_id, person_id, role, role_status, trapper_type,
            source_system, source_record_id, started_at, ended_at, notes,
            created_at, updated_at
        FROM sot.person_roles
        ON CONFLICT (role_id) DO NOTHING;
        RAISE NOTICE 'Done copying to ops.person_roles';
    END IF;

    IF v_ops_count > 0 AND v_sot_count > 0 THEN
        RAISE NOTICE 'Both tables have data - no sync needed';
    END IF;

    IF v_ops_count = 0 AND v_sot_count = 0 THEN
        RAISE NOTICE 'Both tables are empty - no data to sync';
    END IF;
END $$;

-- ============================================================================
-- 5. CHECK OTHER MAP VIEW DEPENDENCIES
-- ============================================================================

\echo ''
\echo '5. Checking other map view dependencies...'

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

\echo ''
\echo '5.4 sot.addresses table:'
SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'sot' AND table_name = 'addresses'
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
    -- Try to query the view
    BEGIN
        SELECT COUNT(*) INTO v_count FROM ops.v_map_atlas_pins LIMIT 1;
        SELECT COUNT(*) INTO v_active_count FROM ops.v_map_atlas_pins WHERE pin_tier = 'active';
        SELECT COUNT(*) INTO v_reference_count FROM ops.v_map_atlas_pins WHERE pin_tier = 'reference';

        RAISE NOTICE 'VIEW WORKS!';
        RAISE NOTICE '  Total pins: %', v_count;
        RAISE NOTICE '  Active pins: %', v_active_count;
        RAISE NOTICE '  Reference pins: %', v_reference_count;

        IF v_active_count = 0 AND v_count > 0 THEN
            RAISE NOTICE 'WARNING: All pins are reference! Check pin_tier logic.';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'VIEW FAILED: %', SQLERRM;
        RAISE NOTICE 'Run MIG_2500 for detailed diagnostics.';
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

\echo 'person_roles table row counts:'
SELECT
    'ops.person_roles' as table_name,
    COUNT(*) as row_count
FROM ops.person_roles
UNION ALL
SELECT
    'sot.person_roles' as table_name,
    COUNT(*) as row_count
FROM sot.person_roles;

\echo ''
\echo 'Role distribution (ops.person_roles):'
SELECT role, role_status, COUNT(*)
FROM ops.person_roles
GROUP BY 1, 2
ORDER BY 3 DESC;

\echo ''
\echo '=============================================='
\echo '  MIG_2501 Complete'
\echo '=============================================='
\echo ''
\echo 'Actions taken:'
\echo '  - Ensured ops.person_roles table exists'
\echo '  - Ensured sot.person_roles table exists'
\echo '  - Synced data between schemas if needed'
\echo '  - Tested map view functionality'
\echo ''
\echo 'If map view still fails, run MIG_2500 for detailed diagnostics.'
\echo ''
