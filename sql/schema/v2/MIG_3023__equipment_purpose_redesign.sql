-- MIG_3023: Equipment checkout purpose redesign
--
-- Two purpose fields:
-- 1. client_stated_purpose (TEXT) — what the client wrote on the paper slip
-- 2. checkout_purpose (TEXT) — staff-selected standardized tags (comma-separated, multi-select)
--
-- New purpose values: ffr, well_check, rescue_recovery, trap_training, transport
-- Old values (tnr_appointment, kitten_rescue, etc.) migrated to new equivalents.

BEGIN;

-- Add client_stated_purpose column
ALTER TABLE ops.equipment_events
  ADD COLUMN IF NOT EXISTS client_stated_purpose TEXT;

COMMENT ON COLUMN ops.equipment_events.client_stated_purpose
  IS 'Free-text purpose as written by the client on the checkout slip';

-- Migrate old purpose values to new
UPDATE ops.equipment_events SET checkout_purpose = 'ffr' WHERE checkout_purpose = 'tnr_appointment';
UPDATE ops.equipment_events SET checkout_purpose = 'rescue_recovery' WHERE checkout_purpose = 'kitten_rescue';
UPDATE ops.equipment_events SET checkout_purpose = 'ffr' WHERE checkout_purpose = 'colony_check';
UPDATE ops.equipment_events SET checkout_purpose = 'ffr' WHERE checkout_purpose = 'feeding_station';
UPDATE ops.equipment_events SET checkout_purpose = 'well_check' WHERE checkout_purpose = 'personal_pet';

COMMIT;
