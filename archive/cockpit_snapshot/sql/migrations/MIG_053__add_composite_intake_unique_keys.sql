-- MIG_053__add_composite_intake_unique_keys.sql
-- Adds composite UNIQUE constraints on (source_system, source_row_hash) for intake tables.
-- Safe to re-run: uses IF NOT EXISTS checks via pg_constraint.
-- Does NOT drop existing constraints (non-destructive).

BEGIN;

-- Add composite unique constraint to appointment_requests
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'appointment_requests__uq_source_system_row_hash'
          AND conrelid = 'trapper.appointment_requests'::regclass
    ) THEN
        ALTER TABLE trapper.appointment_requests
        ADD CONSTRAINT appointment_requests__uq_source_system_row_hash
        UNIQUE (source_system, source_row_hash);
        RAISE NOTICE 'Added constraint appointment_requests__uq_source_system_row_hash';
    ELSE
        RAISE NOTICE 'Constraint appointment_requests__uq_source_system_row_hash already exists';
    END IF;
END $$;

-- Add composite unique constraint to clinichq_upcoming_appointments
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'clinichq_upcoming_appointments__uq_source_system_row_hash'
          AND conrelid = 'trapper.clinichq_upcoming_appointments'::regclass
    ) THEN
        ALTER TABLE trapper.clinichq_upcoming_appointments
        ADD CONSTRAINT clinichq_upcoming_appointments__uq_source_system_row_hash
        UNIQUE (source_system, source_row_hash);
        RAISE NOTICE 'Added constraint clinichq_upcoming_appointments__uq_source_system_row_hash';
    ELSE
        RAISE NOTICE 'Constraint clinichq_upcoming_appointments__uq_source_system_row_hash already exists';
    END IF;
END $$;

COMMIT;
