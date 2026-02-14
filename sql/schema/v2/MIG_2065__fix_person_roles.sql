-- MIG_2065: Add missing fields to ops.person_roles
-- Date: 2026-02-13
--
-- V2 person_roles lost these fields from V1:
--   - started_at DATE
--   - ended_at DATE
--   - notes TEXT
--   - on_leave role_status
--
-- This migration adds them back for trapper management.

\echo ''
\echo '=============================================='
\echo '  MIG_2065: Fix ops.person_roles'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. ADD MISSING COLUMNS
-- ============================================================================

\echo '1. Adding missing columns to ops.person_roles...'

-- Add started_at
ALTER TABLE ops.person_roles ADD COLUMN IF NOT EXISTS started_at DATE;

-- Add ended_at
ALTER TABLE ops.person_roles ADD COLUMN IF NOT EXISTS ended_at DATE;

-- Add notes
ALTER TABLE ops.person_roles ADD COLUMN IF NOT EXISTS notes TEXT;

\echo '   Added started_at, ended_at, notes columns'

-- ============================================================================
-- 2. ADD on_leave TO ROLE STATUS ENUM
-- ============================================================================

\echo ''
\echo '2. Adding on_leave to role_status enum...'

-- Check if enum value exists before adding
DO $$
BEGIN
    -- Try to add the value
    ALTER TYPE ops.person_role_status ADD VALUE IF NOT EXISTS 'on_leave';
    RAISE NOTICE 'Added on_leave to ops.person_role_status';
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'on_leave already exists in ops.person_role_status';
END $$;

-- ============================================================================
-- 3. BACKFILL FROM V1 (if exists)
-- ============================================================================

\echo ''
\echo '3. Backfilling dates from V1 trapper.person_roles...'

DO $$
DECLARE
    v_count INT := 0;
BEGIN
    -- Check if V1 table exists and has the columns
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
          AND table_name = 'person_roles'
          AND column_name = 'started_at'
    ) THEN
        -- Update existing records with V1 data
        UPDATE ops.person_roles o
        SET
            started_at = v1.started_at,
            ended_at = v1.ended_at,
            notes = v1.notes
        FROM trapper.person_roles v1
        WHERE v1.person_id = o.person_id
          AND v1.role = o.role::text
          AND (o.started_at IS NULL OR o.ended_at IS NULL OR o.notes IS NULL);

        GET DIAGNOSTICS v_count = ROW_COUNT;
        RAISE NOTICE 'Updated % records with V1 dates/notes', v_count;
    ELSE
        RAISE NOTICE 'V1 trapper.person_roles does not have started_at - skipping backfill';
    END IF;
END $$;

-- ============================================================================
-- 4. CREATE HELPER VIEW
-- ============================================================================

\echo ''
\echo '4. Creating v_person_roles_extended view...'

CREATE OR REPLACE VIEW ops.v_person_roles_extended AS
SELECT
    pr.role_id,
    pr.person_id,
    p.display_name AS person_name,
    pr.role,
    pr.role_status,
    pr.started_at,
    pr.ended_at,
    pr.notes,
    pr.assigned_at,
    pr.assigned_by,
    -- Computed fields
    CASE
        WHEN pr.ended_at IS NOT NULL THEN pr.ended_at - pr.started_at
        WHEN pr.started_at IS NOT NULL THEN CURRENT_DATE - pr.started_at
        ELSE NULL
    END AS days_in_role,
    CASE
        WHEN pr.role_status = 'active' AND pr.started_at IS NOT NULL THEN
            EXTRACT(YEAR FROM age(CURRENT_DATE, pr.started_at))
        ELSE NULL
    END AS years_active
FROM ops.person_roles pr
JOIN sot.people p ON p.person_id = pr.person_id AND p.merged_into_person_id IS NULL;

COMMENT ON VIEW ops.v_person_roles_extended IS 'Person roles with tenure tracking and computed fields';

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'ops.person_roles columns:'
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'person_roles'
ORDER BY ordinal_position;

\echo ''
\echo 'Role status values available:'
SELECT enumlabel
FROM pg_enum
WHERE enumtypid = 'ops.person_role_status'::regtype;

\echo ''
\echo 'Records with dates:'
SELECT
    COUNT(*) as total_roles,
    COUNT(started_at) as with_started_at,
    COUNT(ended_at) as with_ended_at,
    COUNT(notes) as with_notes
FROM ops.person_roles;

\echo ''
\echo '=============================================='
\echo '  MIG_2065 Complete!'
\echo '=============================================='
\echo ''
