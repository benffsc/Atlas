-- MIG_3045: Add merged_into_appointment_id column to ops.appointments
-- BLOCKER: 8 files reference this column in WHERE clauses but it was never created.
-- The existing quarantine mechanism (MIG_2455) uses hard DELETE into ops.quarantined_appointments.
-- This adds the soft-merge pattern matching sot.cats, sot.people, sot.places, ops.clinic_accounts.
--
-- All rows start NULL → existing queries with WHERE merged_into_appointment_id IS NULL
-- will include all rows. No data change, just schema.

BEGIN;

-- Add the merge tracking columns
ALTER TABLE ops.appointments
  ADD COLUMN IF NOT EXISTS merged_into_appointment_id UUID
    REFERENCES ops.appointments(appointment_id);

ALTER TABLE ops.appointments
  ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ;

-- Partial index for efficient merge-aware queries
CREATE INDEX IF NOT EXISTS idx_appointments_merged_into
  ON ops.appointments(merged_into_appointment_id)
  WHERE merged_into_appointment_id IS NOT NULL;

COMMIT;
