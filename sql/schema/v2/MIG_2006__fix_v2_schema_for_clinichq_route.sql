-- MIG_2006: Fix V2 Schema for ClinicHQ Ingest Route
--
-- Purpose: Fix column name mismatches and add missing constraints
-- for the V2 ClinicHQ ingest API route (/api/v2/ingest/clinichq)
--
-- Issues fixed:
-- 1. source.clinichq_raw: Add 'appointment_service' to record_type CHECK
-- 2. ops.clinic_accounts: Add missing unique constraint
-- 3. sot.addresses: Add raw_input, display_address columns + source_system
-- 4. sot.places: Rename sot_address_id to address_id
--
-- Created: 2026-02-12

\echo ''
\echo '=============================================='
\echo '  MIG_2006: Fix V2 Schema for ClinicHQ Route'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. FIX source.clinichq_raw record_type CHECK
-- ============================================================================

\echo '1. Updating source.clinichq_raw record_type constraint...'

-- Drop the old constraint
ALTER TABLE source.clinichq_raw
    DROP CONSTRAINT IF EXISTS clinichq_raw_record_type_check;

-- Add expanded constraint with appointment_service
ALTER TABLE source.clinichq_raw
    ADD CONSTRAINT clinichq_raw_record_type_check
    CHECK (record_type IN (
        'appointment', 'owner', 'cat', 'procedure', 'vaccination',
        'appointment_service', 'unknown'
    ));

\echo '   Added appointment_service to record_type constraint'

-- ============================================================================
-- 2. FIX ops.clinic_accounts: Add unique constraint
-- ============================================================================

\echo ''
\echo '2. Adding unique constraint to ops.clinic_accounts...'

-- Add unique constraint on (owner_first_name, owner_last_name, owner_email)
-- This is used by the route for ON CONFLICT handling
CREATE UNIQUE INDEX IF NOT EXISTS clinic_accounts_name_email_key
    ON ops.clinic_accounts(owner_first_name, owner_last_name, COALESCE(owner_email, ''));

-- Also create it as an actual constraint for ON CONFLICT ON CONSTRAINT
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'clinic_accounts_name_email_key'
    ) THEN
        ALTER TABLE ops.clinic_accounts
            ADD CONSTRAINT clinic_accounts_name_email_key
            UNIQUE USING INDEX clinic_accounts_name_email_key;
    END IF;
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'Constraint clinic_accounts_name_email_key already exists';
END$$;

\echo '   Added clinic_accounts_name_email_key constraint'

-- ============================================================================
-- 3. FIX sot.addresses: Add missing columns
-- ============================================================================

\echo ''
\echo '3. Adding missing columns to sot.addresses...'

-- Add columns the route expects
ALTER TABLE sot.addresses ADD COLUMN IF NOT EXISTS raw_input TEXT;
ALTER TABLE sot.addresses ADD COLUMN IF NOT EXISTS display_address TEXT;
ALTER TABLE sot.addresses ADD COLUMN IF NOT EXISTS source_system TEXT;

-- Copy existing data to new columns if old columns have data
UPDATE sot.addresses
SET raw_input = COALESCE(raw_input, raw_address),
    display_address = COALESCE(display_address, COALESCE(formatted_address, display_line))
WHERE raw_input IS NULL OR display_address IS NULL;

-- Create unique constraint for dedup
CREATE UNIQUE INDEX IF NOT EXISTS idx_sot_addresses_raw_input_unique
    ON sot.addresses(raw_input)
    WHERE raw_input IS NOT NULL;

\echo '   Added raw_input, display_address, source_system columns'

-- ============================================================================
-- 4. FIX sot.places: Add address_id column (alias for sot_address_id)
-- ============================================================================

\echo ''
\echo '4. Adding address_id column to sot.places...'

-- Add address_id column (the route expects this name)
ALTER TABLE sot.places ADD COLUMN IF NOT EXISTS address_id UUID;

-- Create FK to sot.addresses
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'places_address_id_fkey'
    ) THEN
        ALTER TABLE sot.places
            ADD CONSTRAINT places_address_id_fkey
            FOREIGN KEY (address_id) REFERENCES sot.addresses(address_id);
    END IF;
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'FK places_address_id_fkey already exists';
END$$;

-- Copy existing data from sot_address_id to address_id
UPDATE sot.places
SET address_id = COALESCE(address_id, sot_address_id)
WHERE address_id IS NULL AND sot_address_id IS NOT NULL;

\echo '   Added address_id column with FK'

-- ============================================================================
-- 5. Add source_system to places if missing
-- ============================================================================

\echo ''
\echo '5. Adding source_system to sot.places...'

ALTER TABLE sot.places ADD COLUMN IF NOT EXISTS source_system TEXT;

\echo '   Added source_system column'

-- ============================================================================
-- 6. FIX sot.cats: Add color column alias
-- ============================================================================

\echo ''
\echo '6. Adding color column to sot.cats...'

-- The route uses 'color' but table has 'primary_color'
ALTER TABLE sot.cats ADD COLUMN IF NOT EXISTS color TEXT;

-- Copy existing primary_color data to color
UPDATE sot.cats
SET color = COALESCE(color, primary_color)
WHERE color IS NULL AND primary_color IS NOT NULL;

\echo '   Added color column'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Checking source.clinichq_raw record_type values:'
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'clinichq_raw_record_type_check';

\echo ''
\echo 'Checking ops.clinic_accounts constraints:'
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'ops.clinic_accounts'::regclass
ORDER BY conname;

\echo ''
\echo 'Checking sot.addresses columns:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'sot' AND table_name = 'addresses'
  AND column_name IN ('raw_input', 'display_address', 'source_system', 'raw_address')
ORDER BY column_name;

\echo ''
\echo 'Checking sot.places columns:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'sot' AND table_name = 'places'
  AND column_name IN ('address_id', 'sot_address_id', 'source_system')
ORDER BY column_name;

\echo ''
\echo '=============================================='
\echo '  MIG_2006 Complete'
\echo '=============================================='
\echo ''
\echo 'Fixed schema issues for ClinicHQ ingest route:'
\echo '  1. source.clinichq_raw: Added appointment_service to record_type'
\echo '  2. ops.clinic_accounts: Added clinic_accounts_name_email_key constraint'
\echo '  3. sot.addresses: Added raw_input, display_address, source_system columns'
\echo '  4. sot.places: Added address_id column (alias for sot_address_id)'
\echo ''
