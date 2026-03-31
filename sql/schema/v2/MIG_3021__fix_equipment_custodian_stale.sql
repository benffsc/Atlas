-- MIG_3017: Equipment data integrity fixes
--
-- Issues fixed:
-- 1. Stale custodian: trigger never synced current_holder_name on checkout/checkin
-- 2. Found: didn't clear current_place_id (already fixed in trigger below)
-- 3. Transfer: trigger preserves old holder_name when no new name provided
-- 4. Deposit: check_in events don't persist deposit_returned_at (frontend fix)
-- 5. View: custodian JOIN doesn't respect person merges (invariant 7)
--
-- Frontend fixes (separate from this migration):
-- - CheckinForm: pass deposit_returned_at timestamp
-- - SimpleActionConfirm: collect custodian for transfer action

BEGIN;

-- ── Step 1: Update trigger to sync current_holder_name ─────────────────────────

CREATE OR REPLACE FUNCTION ops.equipment_event_trigger()
RETURNS TRIGGER AS $$
BEGIN
    CASE NEW.event_type
        WHEN 'check_out' THEN
            UPDATE ops.equipment SET
                custody_status = 'checked_out',
                checkout_type = NEW.checkout_type,
                current_custodian_id = NEW.custodian_person_id,
                current_holder_name = NEW.custodian_name,
                current_place_id = NEW.place_id,
                current_request_id = NEW.request_id,
                current_kit_id = NEW.kit_id,
                updated_at = NOW()
            WHERE equipment_id = NEW.equipment_id;

        WHEN 'check_in' THEN
            UPDATE ops.equipment SET
                custody_status = CASE
                    WHEN NEW.condition_after IN ('damaged', 'poor') THEN 'maintenance'
                    ELSE 'available'
                END,
                condition_status = COALESCE(NEW.condition_after, condition_status),
                checkout_type = NULL,
                inferred_due_date = NULL,
                current_custodian_id = NULL,
                current_holder_name = NULL,
                current_place_id = NULL,
                current_request_id = NULL,
                current_kit_id = NULL,
                updated_at = NOW()
            WHERE equipment_id = NEW.equipment_id;

        WHEN 'transfer' THEN
            UPDATE ops.equipment SET
                current_custodian_id = NEW.custodian_person_id,
                current_holder_name = COALESCE(NEW.custodian_name, current_holder_name),
                current_place_id = COALESCE(NEW.place_id, current_place_id),
                current_request_id = COALESCE(NEW.request_id, current_request_id),
                updated_at = NOW()
            WHERE equipment_id = NEW.equipment_id;

        WHEN 'condition_change' THEN
            UPDATE ops.equipment SET
                condition_status = COALESCE(NEW.condition_after, condition_status),
                updated_at = NOW()
            WHERE equipment_id = NEW.equipment_id;

        WHEN 'maintenance_start' THEN
            UPDATE ops.equipment SET
                custody_status = 'maintenance',
                updated_at = NOW()
            WHERE equipment_id = NEW.equipment_id;

        WHEN 'maintenance_end' THEN
            UPDATE ops.equipment SET
                custody_status = 'available',
                condition_status = COALESCE(NEW.condition_after, 'good'),
                updated_at = NOW()
            WHERE equipment_id = NEW.equipment_id;

        WHEN 'reported_missing' THEN
            UPDATE ops.equipment SET
                custody_status = 'missing',
                updated_at = NOW()
            WHERE equipment_id = NEW.equipment_id;

        WHEN 'found' THEN
            UPDATE ops.equipment SET
                custody_status = 'available',
                checkout_type = NULL,
                inferred_due_date = NULL,
                current_custodian_id = NULL,
                current_holder_name = NULL,
                current_place_id = NULL,
                current_request_id = NULL,
                updated_at = NOW()
            WHERE equipment_id = NEW.equipment_id;

        WHEN 'retired' THEN
            UPDATE ops.equipment SET
                custody_status = 'retired',
                retired_at = NOW(),
                updated_at = NOW()
            WHERE equipment_id = NEW.equipment_id;

        ELSE
            UPDATE ops.equipment SET updated_at = NOW()
            WHERE equipment_id = NEW.equipment_id;
    END CASE;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Step 2: Clean up stale current_holder_name on items that are available ──────

UPDATE ops.equipment
SET current_holder_name = NULL
WHERE custody_status IN ('available', 'maintenance', 'missing')
  AND current_custodian_id IS NULL
  AND current_holder_name IS NOT NULL;

-- ── Step 3: Fix merge-aware custodian in checked-out equipment ──────────────────
-- If a person was merged, update equipment to point to the winner person_id.
-- This prevents stale/missing custodian names after person dedup.

UPDATE ops.equipment e
SET current_custodian_id = p.merged_into_person_id
FROM sot.people p
WHERE e.current_custodian_id = p.person_id
  AND p.merged_into_person_id IS NOT NULL;

COMMIT;
