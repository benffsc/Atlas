-- MIG_2401__add_missing_appointment_columns.sql
-- Add missing columns to ops.appointments that are referenced by ingest route
--
-- Issue: The ingest process route (/api/ingest/process/[id]/route.ts) references
-- columns that were never created:
-- - client_name (line 846): Combined owner first+last name for display
-- - owner_account_id (line 881): Links appointment to ops.clinic_accounts
--
-- These columns are also referenced by:
-- - MIG_2491: Creates indexes on these columns (fails if columns don't exist)
-- - MIG_2490: Backfill script that sets owner_account_id
-- - MIG_2489: Documentation references owner_account_id
-- - MIG_2551: Tippy place clinic notes uses owner_account_id
--
-- Root cause: V1 had these columns, V2 table creation missed them.

\echo ''
\echo '=============================================='
\echo '  MIG_2401: Add Missing Appointment Columns'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. ADD client_name COLUMN
-- ============================================================================

\echo '1. Adding client_name column to ops.appointments...'

ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS client_name TEXT;

COMMENT ON COLUMN ops.appointments.client_name IS
  'Combined owner first + last name from booking (display purposes)';

-- Index for name-based matching (used by clinic_accounts linkage)
CREATE INDEX IF NOT EXISTS idx_ops_appointments_client_name_lower
  ON ops.appointments (LOWER(client_name))
  WHERE client_name IS NOT NULL;

-- ============================================================================
-- 2. ADD owner_account_id COLUMN
-- ============================================================================

\echo '2. Adding owner_account_id column to ops.appointments...'

ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS owner_account_id UUID;

-- Add foreign key constraint to clinic_accounts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_appointments_owner_account'
      AND table_schema = 'ops'
      AND table_name = 'appointments'
  ) THEN
    ALTER TABLE ops.appointments
      ADD CONSTRAINT fk_appointments_owner_account
      FOREIGN KEY (owner_account_id)
      REFERENCES ops.clinic_accounts(account_id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN ops.appointments.owner_account_id IS
  'Links to clinic_account that booked this appointment (who booked, not necessarily who owns cat)';

-- Index for joining to clinic_accounts
CREATE INDEX IF NOT EXISTS idx_ops_appointments_owner_account
  ON ops.appointments (owner_account_id)
  WHERE owner_account_id IS NOT NULL;

-- ============================================================================
-- 3. BACKFILL client_name FROM EXISTING DATA
-- ============================================================================

\echo '3. Backfilling client_name from owner_first_name + owner_last_name...'

UPDATE ops.appointments
SET client_name = NULLIF(TRIM(
  COALESCE(owner_first_name, '') || ' ' || COALESCE(owner_last_name, '')
), '')
WHERE client_name IS NULL
  AND (owner_first_name IS NOT NULL OR owner_last_name IS NOT NULL);

\echo '   Backfilled client_name'

-- ============================================================================
-- 4. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'ops.appointments new columns:'
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'appointments'
  AND column_name IN ('client_name', 'owner_account_id')
ORDER BY column_name;

\echo ''
\echo 'Column coverage:'
SELECT
  COUNT(*) AS total_appointments,
  COUNT(client_name) AS with_client_name,
  COUNT(owner_account_id) AS with_owner_account,
  ROUND(100.0 * COUNT(client_name) / NULLIF(COUNT(*), 0), 1) AS client_name_pct,
  ROUND(100.0 * COUNT(owner_account_id) / NULLIF(COUNT(*), 0), 1) AS owner_account_pct
FROM ops.appointments;

\echo ''
\echo '=============================================='
\echo '  MIG_2401 Complete!'
\echo '=============================================='
\echo ''
\echo 'Next steps:'
\echo '  1. Run MIG_2490 to backfill owner_account_id from clinic_accounts'
\echo '  2. Verify ingest route works end-to-end'
\echo ''
