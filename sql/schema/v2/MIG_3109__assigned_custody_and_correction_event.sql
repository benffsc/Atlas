-- MIG_3109: Add 'assigned' custody status and 'assign'/'correction' event types
--
-- 'assigned' — equipment loaned indefinitely to a trapper (not in the overdue queue)
-- 'assign' — event that transitions available → assigned
-- 'correction' — metadata-only audit event (no custody/condition change)
--
-- FFS-1344

-- =============================================================================
-- 1. Update the equipment event trigger to handle 'assign' and 'correction'
-- =============================================================================

CREATE OR REPLACE FUNCTION ops.trg_equipment_event_update()
RETURNS TRIGGER AS $$
BEGIN
    CASE NEW.event_type
        WHEN 'check_out' THEN
            UPDATE ops.equipment SET
                custody_status = 'checked_out',
                current_custodian_id = NEW.custodian_person_id,
                current_place_id = NEW.place_id,
                current_request_id = NEW.request_id,

                updated_at = NOW()
            WHERE equipment_id = NEW.equipment_id;

        WHEN 'assign' THEN
            UPDATE ops.equipment SET
                custody_status = 'assigned',
                current_custodian_id = NEW.custodian_person_id,
                current_place_id = NEW.place_id,
                current_request_id = NEW.request_id,

                updated_at = NOW()
            WHERE equipment_id = NEW.equipment_id;

        WHEN 'check_in' THEN
            UPDATE ops.equipment SET
                custody_status = CASE
                    WHEN NEW.condition_after IN ('damaged', 'poor') THEN 'maintenance'
                    ELSE 'available'
                END,
                current_custodian_id = NULL,
                current_place_id = NULL,
                current_request_id = NULL,
                condition_status = COALESCE(NEW.condition_after, condition_status),
                updated_at = NOW()
            WHERE equipment_id = NEW.equipment_id;

        WHEN 'transfer' THEN
            UPDATE ops.equipment SET
                current_custodian_id = NEW.custodian_person_id,
                current_place_id = COALESCE(NEW.place_id, current_place_id),
                current_holder_name = COALESCE(NEW.custodian_name, current_holder_name),
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
                current_custodian_id = NULL,
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

        WHEN 'condition_change' THEN
            UPDATE ops.equipment SET
                condition_status = NEW.condition_after,
                updated_at = NOW()
            WHERE equipment_id = NEW.equipment_id;

        WHEN 'correction' THEN
            -- Metadata-only audit event: no state change on equipment row.
            -- The event itself (with notes) serves as the audit trail.
            NULL;

        WHEN 'note' THEN
            -- Update due_date if provided with a note event (used for date extensions)
            IF NEW.due_date IS NOT NULL THEN
                UPDATE ops.equipment SET
                    expected_return_date = NEW.due_date,
                    updated_at = NOW()
                WHERE equipment_id = NEW.equipment_id;
            END IF;

        ELSE
            -- Unknown event type — no state change
            NULL;
    END CASE;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Verify the trigger is attached (idempotent)
DROP TRIGGER IF EXISTS trg_equipment_event_after_insert ON ops.equipment_events;
CREATE TRIGGER trg_equipment_event_after_insert
    AFTER INSERT ON ops.equipment_events
    FOR EACH ROW
    EXECUTE FUNCTION ops.trg_equipment_event_update();
