-- MIG_2006: Fix V2 Schema for ClinicHQ Ingest Route
-- Run this in Supabase SQL Editor
-- Purpose: Fix column name mismatches and add missing constraints
-- Created: 2026-02-12

-- ============================================================================
-- 1. FIX source.clinichq_raw record_type CHECK
-- ============================================================================

ALTER TABLE source.clinichq_raw
    DROP CONSTRAINT IF EXISTS clinichq_raw_record_type_check;

ALTER TABLE source.clinichq_raw
    ADD CONSTRAINT clinichq_raw_record_type_check
    CHECK (record_type IN (
        'appointment', 'owner', 'cat', 'procedure', 'vaccination',
        'appointment_service', 'unknown'
    ));

-- ============================================================================
-- 2. FIX ops.appointments: Add clinichq_appointment_id column
-- ============================================================================

ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS clinichq_appointment_id TEXT;

-- Create unique constraint for ON CONFLICT
CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_appointments_clinichq_id
    ON ops.appointments(clinichq_appointment_id)
    WHERE clinichq_appointment_id IS NOT NULL;

-- ============================================================================
-- 3. FIX ops.clinic_accounts: Add unique constraint
-- ============================================================================

-- First drop the index if it exists (to allow re-creation)
DROP INDEX IF EXISTS ops.clinic_accounts_name_email_key;

-- Create unique index for COALESCE handling
CREATE UNIQUE INDEX clinic_accounts_name_email_key
    ON ops.clinic_accounts(owner_first_name, owner_last_name, COALESCE(owner_email, ''));

-- ============================================================================
-- 4. FIX sot.addresses: Add missing columns
-- ============================================================================

ALTER TABLE sot.addresses ADD COLUMN IF NOT EXISTS raw_input TEXT;
ALTER TABLE sot.addresses ADD COLUMN IF NOT EXISTS display_address TEXT;
ALTER TABLE sot.addresses ADD COLUMN IF NOT EXISTS source_system TEXT;

-- Copy existing data to new columns (if table has data)
UPDATE sot.addresses
SET raw_input = COALESCE(raw_input, raw_address),
    display_address = COALESCE(display_address, COALESCE(formatted_address, display_line))
WHERE raw_input IS NULL OR display_address IS NULL;

-- ============================================================================
-- 5. FIX sot.places: Add address_id column
-- ============================================================================

ALTER TABLE sot.places ADD COLUMN IF NOT EXISTS address_id UUID REFERENCES sot.addresses(address_id);
ALTER TABLE sot.places ADD COLUMN IF NOT EXISTS source_system TEXT;

-- Copy existing data from sot_address_id (if table has data)
UPDATE sot.places
SET address_id = sot_address_id
WHERE address_id IS NULL AND sot_address_id IS NOT NULL;

-- ============================================================================
-- 6. FIX sot.cats: Add color column
-- ============================================================================

ALTER TABLE sot.cats ADD COLUMN IF NOT EXISTS color TEXT;

-- Copy existing data from primary_color (if table has data)
UPDATE sot.cats
SET color = primary_color
WHERE color IS NULL AND primary_color IS NOT NULL;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT 'MIG_2006 Applied Successfully' as status;

-- Check columns exist
SELECT 'source.clinichq_raw' as table_name,
    (SELECT string_agg(conname, ', ') FROM pg_constraint
     WHERE conrelid = 'source.clinichq_raw'::regclass AND contype = 'c') as constraints;

SELECT 'ops.appointments' as table_name,
    column_name FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'appointments' AND column_name = 'clinichq_appointment_id';

SELECT 'sot.addresses' as table_name, column_name FROM information_schema.columns
WHERE table_schema = 'sot' AND table_name = 'addresses'
AND column_name IN ('raw_input', 'display_address', 'source_system');

SELECT 'sot.places' as table_name, column_name FROM information_schema.columns
WHERE table_schema = 'sot' AND table_name = 'places'
AND column_name IN ('address_id', 'source_system');

SELECT 'sot.cats' as table_name, column_name FROM information_schema.columns
WHERE table_schema = 'sot' AND table_name = 'cats' AND column_name = 'color';
