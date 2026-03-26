-- =============================================================================
-- Equipment Airtable -> Atlas Sync Audit
-- Run after each sync cycle to verify data integrity.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Count Parity
--    Compare total Airtable-sourced equipment in Atlas vs staged records.
-- ---------------------------------------------------------------------------
\echo '=== 1. COUNT PARITY ==='

SELECT
    (SELECT COUNT(*) FROM ops.equipment WHERE source_system = 'airtable') AS atlas_airtable_count,
    (SELECT COUNT(*) FROM ops.staged_records WHERE source_system = 'airtable' AND source_table = 'equipment') AS staged_count,
    (SELECT COUNT(*) FROM ops.equipment WHERE source_system = 'airtable')
      - (SELECT COUNT(*) FROM ops.staged_records WHERE source_system = 'airtable' AND source_table = 'equipment') AS delta;


-- ---------------------------------------------------------------------------
-- 2. Status Drift
--    Equipment where Airtable's staged "Status" differs from Atlas custody_status.
-- ---------------------------------------------------------------------------
\echo '=== 2. STATUS DRIFT ==='

SELECT
    e.equipment_id,
    e.display_name,
    e.custody_status AS atlas_status,
    sr.payload->>'Status' AS airtable_status_raw,
    CASE sr.payload->>'Status'
      WHEN 'Available' THEN 'available'
      WHEN 'Checked Out' THEN 'checked_out'
      WHEN 'Missing' THEN 'missing'
      ELSE lower(sr.payload->>'Status')
    END AS airtable_status_normalized
FROM ops.equipment e
JOIN ops.staged_records sr
    ON sr.source_row_id = e.source_record_id
   AND sr.source_system = 'airtable'
   AND sr.source_table = 'equipment'
WHERE e.source_system = 'airtable'
  AND e.custody_status IS DISTINCT FROM
    CASE sr.payload->>'Status'
      WHEN 'Available' THEN 'available'
      WHEN 'Checked Out' THEN 'checked_out'
      WHEN 'Missing' THEN 'missing'
      ELSE lower(sr.payload->>'Status')
    END
ORDER BY e.display_name;


-- ---------------------------------------------------------------------------
-- 3. Atlas-Only Items
--    Equipment created directly in Atlas (not from Airtable).
-- ---------------------------------------------------------------------------
\echo '=== 3. ATLAS-ONLY ITEMS ==='

SELECT
    e.equipment_id,
    e.display_name,
    e.equipment_type_key,
    e.custody_status,
    e.created_at
FROM ops.equipment e
WHERE e.source_system = 'atlas_ui'
ORDER BY e.created_at DESC;


-- ---------------------------------------------------------------------------
-- 4. Orphaned Staged Records
--    Staged equipment records with no matching row in ops.equipment.
-- ---------------------------------------------------------------------------
\echo '=== 4. ORPHANED STAGED RECORDS ==='

SELECT
    sr.source_row_id,
    sr.payload->>'Name' AS airtable_name,
    sr.payload->>'Status' AS airtable_status,
    sr.payload->>'Item Type' AS airtable_item_type
FROM ops.staged_records sr
LEFT JOIN ops.equipment e
    ON e.source_record_id = sr.source_row_id
   AND e.source_system = 'airtable'
WHERE sr.source_system = 'airtable'
  AND sr.source_table = 'equipment'
  AND e.equipment_id IS NULL
ORDER BY sr.source_row_id;


-- ---------------------------------------------------------------------------
-- 5. Kiosk Events Since Last Sync
--    Atlas-originated equipment events created after the last Airtable sync.
-- ---------------------------------------------------------------------------
\echo '=== 5. KIOSK EVENTS SINCE LAST SYNC ==='

SELECT
    eq.display_name,
    ev.event_type,
    ev.notes,
    ev.created_at
FROM ops.equipment_events ev
JOIN ops.equipment eq USING (equipment_id)
WHERE ev.source_system = 'atlas_ui'
  AND ev.created_at > COALESCE(
      (SELECT value::timestamptz FROM ops.app_config WHERE key = 'equipment.last_sync_at'),
      '2020-01-01'
  )
ORDER BY ev.created_at DESC;
