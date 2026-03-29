-- MIG_2978: Equipment Data Cleanup & Legacy Migration
--
-- 1. Map existing equipment_type free-text to equipment_type_key FK
-- 2. Extract barcodes from equipment_name
-- 3. Backfill custody_status from is_available + active checkouts
-- 4. Convert 878 legacy checkouts to immutable events
-- 5. Set source_system markers
--
-- Depends on: MIG_2977 (schema)

BEGIN;

-- =============================================================================
-- 1. Map equipment_type_key from existing free-text equipment_type
-- =============================================================================

UPDATE ops.equipment SET equipment_type_key = CASE
    WHEN equipment_type ILIKE '%Large Trap%Backdoor%' AND equipment_type NOT ILIKE '%No Backdoor%' AND equipment_type NOT ILIKE '%Swing%' THEN 'large_trap_backdoor'
    WHEN equipment_type ILIKE '%Large Trap%No Backdoor%'    THEN 'large_trap_no_backdoor'
    WHEN equipment_type ILIKE '%Large Trap%Swing%'          THEN 'large_trap_swing_backdoor'
    WHEN equipment_type ILIKE '%Small Trap%Backdoor%' AND equipment_type NOT ILIKE '%No Backdoor%' THEN 'small_trap_backdoor'
    WHEN equipment_type ILIKE '%Small Trap%No Backdoor%'    THEN 'small_trap_no_backdoor'
    WHEN equipment_type ILIKE '%Drop Trap%'                 THEN 'drop_trap'
    WHEN equipment_type ILIKE '%String%'                    THEN 'string_trap'
    WHEN equipment_type ILIKE '%Camera%'                    THEN 'camera'
    ELSE 'unknown'
END
WHERE equipment_type_key IS NULL;


-- =============================================================================
-- 2. Barcode extraction SKIPPED
-- =============================================================================
-- Original regex extraction was incorrect (produced duplicates like "1" from "#1").
-- MIG_2982 fixes this using real "Barcode Number" field from Airtable staged data.


-- =============================================================================
-- 3. Backfill custody_status from existing data
-- =============================================================================

-- Items with active (unreturned) checkouts
UPDATE ops.equipment e
SET custody_status = 'checked_out',
    current_custodian_id = sub.person_id
FROM (
    SELECT DISTINCT ON (equipment_id) equipment_id, person_id
    FROM ops.equipment_checkouts
    WHERE returned_at IS NULL
    ORDER BY equipment_id, COALESCE(checked_out_at, created_at) DESC
) sub
WHERE e.equipment_id = sub.equipment_id
  AND e.is_available = FALSE;

-- Items marked unavailable but no active checkout = maintenance
UPDATE ops.equipment
SET custody_status = 'maintenance'
WHERE is_available = FALSE
  AND custody_status != 'checked_out';

-- Map condition text to condition_status
UPDATE ops.equipment SET condition_status = CASE
    WHEN condition ILIKE '%new%'      THEN 'new'
    WHEN condition ILIKE '%good%'     THEN 'good'
    WHEN condition ILIKE '%fair%'     THEN 'fair'
    WHEN condition ILIKE '%poor%'     THEN 'poor'
    WHEN condition ILIKE '%damaged%'  THEN 'damaged'
    WHEN condition ILIKE '%missing%'  THEN 'poor'
    ELSE 'good'
END
WHERE condition IS NOT NULL;


-- =============================================================================
-- 4. Convert legacy checkouts to equipment_events
--    Disable trigger during bulk insert, then re-enable
-- =============================================================================

-- Temporarily disable the auto-sync trigger
ALTER TABLE ops.equipment_events DISABLE TRIGGER trg_equipment_event_sync;

-- Insert check_out events for every checkout record
INSERT INTO ops.equipment_events (
    equipment_id, event_type, custodian_person_id, notes,
    source_system, source_record_id, created_at
)
SELECT
    ec.equipment_id,
    'check_out',
    ec.person_id,
    ec.notes,
    'airtable',
    'legacy_checkout_' || ec.checkout_id::text,
    COALESCE(ec.checked_out_at, ec.created_at, NOW())
FROM ops.equipment_checkouts ec
WHERE ec.checked_out_at IS NOT NULL
   OR ec.created_at IS NOT NULL;

-- Insert check_in events for returned checkouts
INSERT INTO ops.equipment_events (
    equipment_id, event_type, custodian_person_id, notes,
    source_system, source_record_id, created_at
)
SELECT
    ec.equipment_id,
    'check_in',
    ec.person_id,
    'Returned — ' || COALESCE(ec.notes, ''),
    'airtable',
    'legacy_return_' || ec.checkout_id::text,
    ec.returned_at
FROM ops.equipment_checkouts ec
WHERE ec.returned_at IS NOT NULL;

-- Re-enable trigger
ALTER TABLE ops.equipment_events ENABLE TRIGGER trg_equipment_event_sync;


-- =============================================================================
-- 5. Mark all migrated data
-- =============================================================================

-- Ensure all existing equipment has source_system set
UPDATE ops.equipment
SET source_system = 'airtable'
WHERE source_system IS NULL OR source_system = '';


-- =============================================================================
-- 6. Verification queries (run manually to spot-check)
-- =============================================================================

-- SELECT 'equipment_types' AS table_name, COUNT(*) AS row_count FROM ops.equipment_types
-- UNION ALL SELECT 'equipment', COUNT(*) FROM ops.equipment
-- UNION ALL SELECT 'equipment_events', COUNT(*) FROM ops.equipment_events
-- UNION ALL SELECT 'equipment_kits', COUNT(*) FROM ops.equipment_kits
-- UNION ALL SELECT 'barcodes_set', COUNT(*) FROM ops.equipment WHERE barcode IS NOT NULL
-- UNION ALL SELECT 'type_key_set', COUNT(*) FROM ops.equipment WHERE equipment_type_key IS NOT NULL;

-- SELECT custody_status, COUNT(*) FROM ops.equipment GROUP BY custody_status ORDER BY count DESC;
-- SELECT event_type, COUNT(*) FROM ops.equipment_events GROUP BY event_type ORDER BY count DESC;

COMMIT;
