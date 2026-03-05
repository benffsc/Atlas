-- MIG_2802__add_owner_fields_to_appointments.sql
-- Fixes FFS-114, FFS-119: Add owner_first_name, owner_last_name, owner_address
-- to ops.appointments. These columns were referenced by MIG_2490 and used by
-- link_appointments_to_places() (MIG_2431) but never created.
-- Only owner_email and owner_phone existed (from MIG_2070).

-- Step 1: Add the missing columns
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS owner_first_name TEXT;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS owner_last_name TEXT;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS owner_address TEXT;

COMMENT ON COLUMN ops.appointments.owner_first_name IS 'Original first name from ClinicHQ booking (preserved for DATA_GAP_053)';
COMMENT ON COLUMN ops.appointments.owner_last_name IS 'Original last name from ClinicHQ booking (preserved for DATA_GAP_053)';
COMMENT ON COLUMN ops.appointments.owner_address IS 'Original address from ClinicHQ booking (where cat came from). Used by link_appointments_to_places() Step 1.';

-- Step 2: Backfill from clinic_accounts (which DO have these fields)
UPDATE ops.appointments a
SET
  owner_first_name = COALESCE(a.owner_first_name, ca.owner_first_name),
  owner_last_name = COALESCE(a.owner_last_name, ca.owner_last_name),
  owner_address = COALESCE(a.owner_address, ca.owner_address)
FROM ops.clinic_accounts ca
WHERE ca.account_id = a.owner_account_id
  AND (a.owner_first_name IS NULL OR a.owner_last_name IS NULL OR a.owner_address IS NULL);

-- Step 3: Backfill from staged_records for appointments without clinic_account links
UPDATE ops.appointments a
SET
  owner_first_name = COALESCE(a.owner_first_name, sr.payload->>'Owner First Name'),
  owner_last_name = COALESCE(a.owner_last_name, sr.payload->>'Owner Last Name'),
  owner_address = COALESCE(a.owner_address, sr.payload->>'Owner Address')
FROM ops.staged_records sr
WHERE sr.source_system = 'clinichq'
  AND sr.record_type = 'owner_info'
  AND sr.payload->>'Number' = a.appointment_number
  AND (a.owner_first_name IS NULL OR a.owner_last_name IS NULL OR a.owner_address IS NULL);
