-- MIG_2006: Fix V2 Schema for ClinicHQ Ingest Route
-- Run this in Supabase SQL Editor
-- Purpose: Fix column name mismatches and add missing constraints
-- Created: 2026-02-12
-- Updated: Added constraint fixes for ON CONFLICT clauses

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
-- 2. FIX ops.appointments: Add clinichq_appointment_id with CONSTRAINT
-- ============================================================================

ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS clinichq_appointment_id TEXT;

-- Drop partial index if exists (doesn't work with ON CONFLICT)
DROP INDEX IF EXISTS ops.idx_ops_appointments_clinichq_id;

-- Create actual CONSTRAINT (not partial index) for ON CONFLICT to work
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'appointments_clinichq_id_unique'
    ) THEN
        ALTER TABLE ops.appointments
            ADD CONSTRAINT appointments_clinichq_id_unique
            UNIQUE (clinichq_appointment_id);
    END IF;
END$$;

-- ============================================================================
-- 3. FIX ops.clinic_accounts: Add CONSTRAINT (not just index)
-- ============================================================================

DROP INDEX IF EXISTS ops.clinic_accounts_name_email_key;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'clinic_accounts_name_email_key'
    ) THEN
        ALTER TABLE ops.clinic_accounts
            ADD CONSTRAINT clinic_accounts_name_email_key
            UNIQUE (owner_first_name, owner_last_name, owner_email);
    END IF;
END$$;

-- ============================================================================
-- 4. FIX sot.addresses: Add missing columns
-- ============================================================================

ALTER TABLE sot.addresses ADD COLUMN IF NOT EXISTS raw_input TEXT;
ALTER TABLE sot.addresses ADD COLUMN IF NOT EXISTS display_address TEXT;
ALTER TABLE sot.addresses ADD COLUMN IF NOT EXISTS source_system TEXT;

-- ============================================================================
-- 5. FIX sot.places: Add address_id column
-- ============================================================================

ALTER TABLE sot.places ADD COLUMN IF NOT EXISTS address_id UUID REFERENCES sot.addresses(address_id);
ALTER TABLE sot.places ADD COLUMN IF NOT EXISTS source_system TEXT;

-- ============================================================================
-- 6. FIX sot.cats: Add color column and unique constraint
-- ============================================================================

ALTER TABLE sot.cats ADD COLUMN IF NOT EXISTS color TEXT;

-- Drop non-unique index
DROP INDEX IF EXISTS sot.idx_sot_cats_microchip;
DROP INDEX IF EXISTS sot.idx_sot_cats_microchip_unique;

-- Create unique index with exact WHERE clause the route expects
CREATE UNIQUE INDEX IF NOT EXISTS idx_sot_cats_microchip_active
    ON sot.cats(microchip)
    WHERE merged_into_cat_id IS NULL;

-- ============================================================================
-- 7. FIX sot.person_identifiers: Add constraint for route's conflict target
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_person_identifiers_person_type_norm
    ON sot.person_identifiers(person_id, id_type, id_value_norm);

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT 'MIG_2006 Applied Successfully - All constraints fixed' as status;
