-- MIG_3030: Equipment Activity View
-- Cross-equipment chronological event feed for admin visibility.
-- FFS-1055

-- View joining events → equipment → equipment_types → people (actor + custodian) → places
CREATE OR REPLACE VIEW ops.v_equipment_activity AS
SELECT
  ev.event_id,
  ev.equipment_id,
  ev.event_type,
  ev.actor_person_id,
  ap.display_name AS actor_name,
  ev.custodian_person_id,
  COALESCE(cp.display_name, ev.custodian_name) AS custodian_name,
  ev.place_id,
  pl.formatted_address AS place_address,
  ev.request_id,
  ev.kit_id,
  ev.condition_before,
  ev.condition_after,
  ev.due_date::text,
  ev.notes,
  ev.source_system,
  ev.created_at::text,
  ev.checkout_type,
  ev.deposit_amount::numeric,
  ev.deposit_returned_at::text,
  ev.custodian_phone,
  ev.appointment_id,
  ev.checkout_purpose,
  ev.custodian_name_raw,
  ev.resolution_status,
  ev.photo_url,
  -- Equipment context
  e.equipment_name AS equipment_name,
  e.barcode AS equipment_barcode,
  COALESCE(et.category, 'unknown') AS equipment_category,
  COALESCE(et.display_name, e.equipment_type) AS equipment_type_name
FROM ops.equipment_events ev
JOIN ops.equipment e ON e.equipment_id = ev.equipment_id
LEFT JOIN ops.equipment_types et ON et.type_key = e.equipment_type_key
LEFT JOIN sot.people ap ON ap.person_id = ev.actor_person_id
LEFT JOIN sot.people cp ON cp.person_id = ev.custodian_person_id
LEFT JOIN sot.places pl ON pl.place_id = ev.place_id;

-- Index for time-range queries on the activity feed
CREATE INDEX IF NOT EXISTS idx_equipment_events_created_at_desc
  ON ops.equipment_events (created_at DESC);
