-- MIG_3122: Fix equipment trigger to propagate due_date + holder_name on checkout
--
-- BUG: check_out events include due_date and custodian_name, but the trigger
-- never propagated them to ops.equipment.expected_return_date / current_holder_name.
-- This caused the overdue queue to use stale dates from previous checkouts,
-- showing equipment as overdue when it was just checked out yesterday.
--
-- FIX:
-- 1. check_out: set expected_return_date, current_holder_name, checkout_type
-- 2. check_in: clear expected_return_date
-- 3. found: clear expected_return_date
-- 4. Backfill: update equipment from most recent check_out event's due_date

-- =============================================================================
-- 1. Updated trigger function
-- =============================================================================

CREATE OR REPLACE FUNCTION ops.trg_equipment_event_update()
RETURNS TRIGGER AS $$
BEGIN
    CASE NEW.event_type
        WHEN 'check_out' THEN
            UPDATE ops.equipment SET
                custody_status = 'checked_out',
                current_custodian_id = NEW.custodian_person_id,
                current_holder_name = COALESCE(NEW.custodian_name, current_holder_name),
                current_place_id = NEW.place_id,
                current_request_id = NEW.request_id,
                checkout_type = NEW.checkout_type,
                expected_return_date = NEW.due_date,
                updated_at = NOW()
            WHERE equipment_id = NEW.equipment_id;

        WHEN 'assign' THEN
            UPDATE ops.equipment SET
                custody_status = 'assigned',
                current_custodian_id = NEW.custodian_person_id,
                current_holder_name = COALESCE(NEW.custodian_name, current_holder_name),
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
                current_holder_name = NULL,
                current_place_id = NULL,
                current_request_id = NULL,
                condition_status = COALESCE(NEW.condition_after, condition_status),
                checkout_type = NULL,
                expected_return_date = NULL,
                updated_at = NOW()
            WHERE equipment_id = NEW.equipment_id;

        WHEN 'transfer' THEN
            UPDATE ops.equipment SET
                current_custodian_id = NEW.custodian_person_id,
                current_place_id = COALESCE(NEW.place_id, current_place_id),
                current_holder_name = COALESCE(NEW.custodian_name, current_holder_name),
                expected_return_date = COALESCE(NEW.due_date, expected_return_date),
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
                current_holder_name = NULL,
                current_place_id = NULL,
                current_request_id = NULL,
                expected_return_date = NULL,
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
            NULL;
    END CASE;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 2. Backfill: sync expected_return_date from most recent check_out event
-- =============================================================================
-- For currently checked-out equipment, find the latest check_out event
-- and propagate its due_date to expected_return_date.

UPDATE ops.equipment e
SET expected_return_date = latest.due_date
FROM (
    SELECT DISTINCT ON (ev.equipment_id)
        ev.equipment_id,
        ev.due_date
    FROM ops.equipment_events ev
    WHERE ev.event_type IN ('check_out', 'transfer')
      AND ev.due_date IS NOT NULL
    ORDER BY ev.equipment_id, ev.created_at DESC
) latest
WHERE e.equipment_id = latest.equipment_id
  AND e.custody_status = 'checked_out'
  AND (e.expected_return_date IS NULL OR e.expected_return_date != latest.due_date);

-- =============================================================================
-- 3. Backfill: for checked-out equipment with NO due_date on event,
--    infer from custodian's most recent clinic appointment + 10 days
-- =============================================================================
-- Logic: find the custodian's most recent appointment (from ops.appointments),
-- set expected_return_date = appointment_date + 10 days.
-- If no appointment found, use checkout_date + 30 days as a safe fallback.

UPDATE ops.equipment e
SET expected_return_date = COALESCE(
    -- Try: custodian's most recent appointment + 10 days
    (
        SELECT (a.appointment_date + INTERVAL '10 days')::date
        FROM ops.appointments a
        WHERE a.person_id = e.current_custodian_id
          AND a.appointment_date IS NOT NULL
        ORDER BY a.appointment_date DESC
        LIMIT 1
    ),
    -- Fallback: checkout event date + 30 days
    (
        SELECT (ev.created_at + INTERVAL '30 days')::date
        FROM ops.equipment_events ev
        WHERE ev.equipment_id = e.equipment_id
          AND ev.event_type IN ('check_out', 'transfer')
        ORDER BY ev.created_at DESC
        LIMIT 1
    )
)
FROM (
    SELECT DISTINCT ON (ev.equipment_id)
        ev.equipment_id,
        ev.due_date
    FROM ops.equipment_events ev
    WHERE ev.event_type IN ('check_out', 'transfer')
    ORDER BY ev.equipment_id, ev.created_at DESC
) latest
WHERE e.equipment_id = latest.equipment_id
  AND e.custody_status = 'checked_out'
  AND latest.due_date IS NULL;
