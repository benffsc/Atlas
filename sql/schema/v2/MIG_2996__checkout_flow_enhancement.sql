-- MIG_2996: Add checkout flow enhancement columns to equipment_events
-- Supports structured checkout with purpose tracking, raw name preservation,
-- and person resolution status.
--
-- FFS-880: Structured Equipment Checkout Flow

BEGIN;

ALTER TABLE ops.equipment_events
  ADD COLUMN IF NOT EXISTS checkout_purpose TEXT,
  ADD COLUMN IF NOT EXISTS custodian_name_raw TEXT,
  ADD COLUMN IF NOT EXISTS resolution_status TEXT DEFAULT 'resolved';

-- Constrain resolution_status to known values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_resolution_status'
      AND table_schema = 'ops'
      AND table_name = 'equipment_events'
  ) THEN
    ALTER TABLE ops.equipment_events
      ADD CONSTRAINT chk_resolution_status
      CHECK (resolution_status IN ('resolved', 'unresolved', 'created'));
  END IF;
END $$;

COMMENT ON COLUMN ops.equipment_events.checkout_purpose IS 'Purpose of checkout: tnr_appointment, kitten_rescue, colony_check, feeding_station, personal_pet';
COMMENT ON COLUMN ops.equipment_events.custodian_name_raw IS 'Exact text staff typed, preserved even when resolved to person_id';
COMMENT ON COLUMN ops.equipment_events.resolution_status IS 'How person was identified: resolved (picked from search), created (new person inline), unresolved (freeform name only)';

COMMIT;
