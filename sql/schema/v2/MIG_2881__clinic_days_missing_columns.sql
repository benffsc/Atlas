-- MIG_2881: Add missing columns to ops.clinic_days
--
-- V1 MIG_456 added target_place_id, vet_name, max_capacity to trapper.clinic_days.
-- V2 MIG_2206 recreated the table in ops but only carried base columns.
-- MIG_2814 was supposed to add clinic_type but was never applied to the live DB.
-- target_place_id and vet_name were never in any V2 migration.
-- The admin/clinic-days routes (updated in 781c3e8) reference these columns → 500 errors.
--
-- max_capacity is NOT needed: table already has max_appointments, routes alias it.

BEGIN;

ALTER TABLE ops.clinic_days
  ADD COLUMN IF NOT EXISTS clinic_type TEXT NOT NULL DEFAULT 'regular';

ALTER TABLE ops.clinic_days
  ADD COLUMN IF NOT EXISTS target_place_id UUID REFERENCES sot.places(place_id);

ALTER TABLE ops.clinic_days
  ADD COLUMN IF NOT EXISTS vet_name TEXT;

CREATE INDEX IF NOT EXISTS idx_clinic_days_type ON ops.clinic_days(clinic_type);

COMMIT;
