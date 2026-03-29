-- MIG_2982: Equipment Data Correction & Enrichment
--
-- Corrects issues from MIG_2978 and adds missing Airtable fields:
-- 1. Fix barcodes: Use real "Barcode Number" from staged_records (not regex from name)
-- 2. Add missing columns: item_type, size, functional_status, current_holder_name,
--    expected_return_date, photo_url, barcode_image_url
-- 3. Backfill new columns from staged_records payloads
-- 4. Backfill due_date on legacy checkout events
-- 5. Create equipment_collection_tasks table (3rd Airtable table — 23 records)
-- 6. Update v_equipment_inventory view to include new columns
--
-- Depends on: MIG_2977 (schema), MIG_2978 (initial data migration)

BEGIN;

-- =============================================================================
-- 1. Add missing columns to ops.equipment
-- =============================================================================

ALTER TABLE ops.equipment
  ADD COLUMN IF NOT EXISTS item_type TEXT,
  ADD COLUMN IF NOT EXISTS size TEXT,
  ADD COLUMN IF NOT EXISTS functional_status TEXT DEFAULT 'functional',
  ADD COLUMN IF NOT EXISTS current_holder_name TEXT,
  ADD COLUMN IF NOT EXISTS expected_return_date DATE,
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS barcode_image_url TEXT;


-- =============================================================================
-- 2. Fix barcodes from real "Barcode Number" field in staged_records
--    MIG_2978 used regex extraction from equipment_name, which was wrong.
--    The actual Airtable field "Barcode Number" has values like "0160", "0145".
-- =============================================================================

-- Clear regex-derived barcodes that start with AUTO- (generated fallbacks)
UPDATE ops.equipment
SET barcode = NULL
WHERE barcode LIKE 'AUTO-%';

-- Clear regex-derived barcodes that start with CAM- (camera pattern guess)
UPDATE ops.equipment
SET barcode = NULL
WHERE barcode LIKE 'CAM-%'
  AND source_system = 'airtable';

-- Now set barcode from the real Airtable "Barcode Number" field
-- Use a CTE with ROW_NUMBER to handle Airtable duplicates (e.g., two records with barcode "1008")
-- Only the first record per barcode value wins; the rest are left NULL.
WITH ranked AS (
  SELECT
    e.equipment_id,
    TRIM(sr.payload->>'Barcode Number') AS real_barcode,
    ROW_NUMBER() OVER (PARTITION BY TRIM(sr.payload->>'Barcode Number') ORDER BY e.created_at) AS rn
  FROM ops.equipment e
  JOIN ops.staged_records sr
    ON sr.source_system = 'airtable'
   AND sr.source_table = 'equipment'
   AND sr.source_row_id = e.source_record_id
  WHERE sr.payload->>'Barcode Number' IS NOT NULL
    AND TRIM(sr.payload->>'Barcode Number') != ''
)
UPDATE ops.equipment e
SET barcode = r.real_barcode
FROM ranked r
WHERE e.equipment_id = r.equipment_id
  AND r.rn = 1;  -- only first per barcode to avoid unique constraint violation


-- =============================================================================
-- 3. Backfill item_type, size, functional_status, current_holder,
--    expected_return_date, photos from staged_records payloads
-- =============================================================================

-- NOTE: Airtable field names in payload depend on what the API returned when originally staged.
-- The stageRecord() function stores raw Airtable fields object.
-- Field names below are from the Airtable API exploration (2026-03).
-- If the backfill leaves columns NULL, run the audit query to check actual field names:
--   SELECT key, COUNT(*) FROM ops.staged_records, jsonb_each_text(payload)
--   WHERE source_system='airtable' AND source_table='equipment' GROUP BY key;
UPDATE ops.equipment e
SET
  item_type = COALESCE(
    NULLIF(TRIM(sr.payload->>'Item Type'), ''),
    NULLIF(TRIM(sr.payload->>'Item_Type'), '')
  ),
  size = NULLIF(TRIM(sr.payload->>'Size'), ''),
  functional_status = CASE
    WHEN COALESCE(sr.payload->>'Functional Status', sr.payload->>'Functional_Status', '') ILIKE '%functional%' THEN 'functional'
    WHEN COALESCE(sr.payload->>'Functional Status', sr.payload->>'Functional_Status', '') ILIKE '%needs%repair%' THEN 'needs_repair'
    WHEN COALESCE(sr.payload->>'Functional Status', sr.payload->>'Functional_Status') IS NOT NULL
         AND TRIM(COALESCE(sr.payload->>'Functional Status', sr.payload->>'Functional_Status', '')) != '' THEN 'unknown'
    ELSE 'functional'
  END,
  current_holder_name = COALESCE(
    NULLIF(TRIM(sr.payload->>'Current Holder'), ''),
    NULLIF(TRIM(sr.payload->>'Current_Holder'), '')
  ),
  expected_return_date = CASE
    WHEN COALESCE(sr.payload->>'Expected Return Date', sr.payload->>'Expected_Return_Date', '') ~ '^\d{4}-\d{2}-\d{2}'
    THEN COALESCE(sr.payload->>'Expected Return Date', sr.payload->>'Expected_Return_Date')::date
    ELSE NULL
  END,
  photo_url = CASE
    WHEN sr.payload->'Photos' IS NOT NULL AND jsonb_typeof(sr.payload->'Photos') = 'array'
         AND jsonb_array_length(sr.payload->'Photos') > 0
    THEN sr.payload->'Photos'->0->>'url'
    ELSE NULL
  END,
  barcode_image_url = CASE
    WHEN sr.payload->'Barcode' IS NOT NULL AND jsonb_typeof(sr.payload->'Barcode') = 'array'
         AND jsonb_array_length(sr.payload->'Barcode') > 0
    THEN sr.payload->'Barcode'->0->>'url'
    ELSE NULL
  END
FROM ops.staged_records sr
WHERE sr.source_system = 'airtable'
  AND sr.source_table = 'equipment'
  AND sr.source_row_id = e.source_record_id;


-- =============================================================================
-- 4. Backfill due_date on legacy checkout events from checkout log payloads
-- =============================================================================

UPDATE ops.equipment_events ev
SET due_date = (sr.payload->>'Expected Return Date')::date
FROM ops.staged_records sr
WHERE sr.source_system = 'airtable'
  AND sr.source_table = 'checkout_log'
  AND ev.source_record_id = 'legacy_checkout_' || sr.source_row_id
  AND sr.payload->>'Expected Return Date' IS NOT NULL
  AND sr.payload->>'Expected Return Date' ~ '^\d{4}-\d{2}-\d{2}'
  AND ev.due_date IS NULL;


-- =============================================================================
-- 5. Create equipment_collection_tasks table
--    Airtable "Equipment Collections" table — 23 follow-up records
--    Tracks people who have FFSC equipment and need to return it
-- =============================================================================

CREATE TABLE IF NOT EXISTS ops.equipment_collection_tasks (
  task_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_name          TEXT NOT NULL,
  phone                TEXT,
  person_id            UUID REFERENCES sot.people(person_id),
  equipment_description TEXT,
  trap_count           INT,
  collection_status    TEXT NOT NULL DEFAULT 'pending',
  outreach_method      TEXT,
  notes                TEXT,
  traps_returned       INT DEFAULT 0,
  last_contacted_at    TIMESTAMPTZ,
  resolved_at          TIMESTAMPTZ,
  source_system        TEXT NOT NULL DEFAULT 'airtable',
  source_record_id     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ops.equipment_collection_tasks IS 'Follow-up tasks for collecting FFSC equipment from community members. Imported from Airtable "Equipment Collections" table.';

CREATE INDEX IF NOT EXISTS idx_collection_tasks_status
  ON ops.equipment_collection_tasks (collection_status)
  WHERE resolved_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_tasks_source
  ON ops.equipment_collection_tasks (source_system, source_record_id)
  WHERE source_record_id IS NOT NULL;

-- Import from staged_records if they exist
INSERT INTO ops.equipment_collection_tasks (
  person_name, phone, equipment_description, trap_count,
  collection_status, notes, traps_returned,
  source_system, source_record_id, created_at, updated_at
)
SELECT
  COALESCE(NULLIF(TRIM(sr.payload->>'Name'), ''), 'Unknown'),
  NULLIF(TRIM(sr.payload->>'Phone'), ''),
  NULLIF(TRIM(sr.payload->>'Equipment Info'), ''),
  CASE WHEN sr.payload->>'# of traps' ~ '^\d+$' THEN (sr.payload->>'# of traps')::int ELSE NULL END,
  CASE
    WHEN sr.payload->>'Status' ILIKE '%do not collect%' THEN 'do_not_collect'
    WHEN sr.payload->>'Status' ILIKE '%called%' THEN 'contacted'
    WHEN sr.payload->>'Status' ILIKE '%emailed%' THEN 'contacted'
    WHEN sr.payload->>'Status' ILIKE '%will bring%' THEN 'will_return'
    WHEN sr.payload->>'Status' ILIKE '%has no traps%' THEN 'no_traps'
    WHEN sr.payload->>'Status' ILIKE '%collected%' THEN 'collected'
    ELSE 'pending'
  END,
  NULLIF(TRIM(sr.payload->>'Notes'), ''),
  CASE WHEN sr.payload->>'Returned or added' ~ '^\d+$' THEN (sr.payload->>'Returned or added')::int ELSE 0 END,
  'airtable',
  sr.source_row_id,
  COALESCE(
    CASE WHEN sr.payload->>'Last Modified' ~ '^\d{4}-\d{2}-\d{2}' THEN (sr.payload->>'Last Modified')::timestamptz ELSE NULL END,
    sr.created_at,
    NOW()
  ),
  NOW()
FROM ops.staged_records sr
WHERE sr.source_system = 'airtable'
  AND sr.source_table = 'equipment_collections'
ON CONFLICT (source_system, source_record_id) WHERE source_record_id IS NOT NULL
DO NOTHING;


-- =============================================================================
-- 6. Update v_equipment_inventory view to include new columns
--    Must DROP first because adding columns changes the view signature.
-- =============================================================================

DROP VIEW IF EXISTS ops.v_equipment_inventory;
CREATE VIEW ops.v_equipment_inventory AS
SELECT
    e.equipment_id,
    e.barcode,
    COALESCE(e.equipment_name, e.barcode, e.equipment_type) AS display_name,
    e.equipment_type_key,
    et.display_name AS type_display_name,
    et.category AS type_category,
    e.equipment_type AS legacy_type,
    e.serial_number,
    e.manufacturer,
    e.model,
    e.custody_status,
    e.condition_status,
    e.current_custodian_id,
    cust.display_name AS custodian_name,
    e.current_place_id,
    pl.formatted_address AS current_place_address,
    e.current_request_id,
    e.current_kit_id,
    e.acquired_at,
    e.retired_at,
    e.notes,
    e.source_system,
    e.created_at,
    e.updated_at,
    -- New enrichment columns (MIG_2982)
    e.item_type,
    e.size,
    e.functional_status,
    e.current_holder_name,
    e.expected_return_date,
    e.photo_url,
    e.barcode_image_url,
    -- Computed fields
    CASE
        WHEN e.custody_status = 'checked_out' THEN
            (SELECT EXTRACT(DAY FROM NOW() - MAX(ev.created_at))::int
             FROM ops.equipment_events ev
             WHERE ev.equipment_id = e.equipment_id AND ev.event_type = 'check_out')
        ELSE NULL
    END AS days_checked_out,
    (SELECT COUNT(*)::int FROM ops.equipment_events ev
     WHERE ev.equipment_id = e.equipment_id AND ev.event_type = 'check_out') AS total_checkouts,
    (SELECT MAX(ev.due_date)
     FROM ops.equipment_events ev
     WHERE ev.equipment_id = e.equipment_id
       AND ev.event_type = 'check_out'
       AND NOT EXISTS (
           SELECT 1 FROM ops.equipment_events ev2
           WHERE ev2.equipment_id = e.equipment_id
             AND ev2.event_type = 'check_in'
             AND ev2.created_at > ev.created_at
       )
    ) AS current_due_date,
    -- is_available for backward compatibility
    e.custody_status = 'available' AS is_available
FROM ops.equipment e
LEFT JOIN ops.equipment_types et ON et.type_key = e.equipment_type_key
LEFT JOIN sot.people cust ON cust.person_id = e.current_custodian_id
LEFT JOIN sot.places pl ON pl.place_id = e.current_place_id
WHERE e.retired_at IS NULL;

COMMENT ON VIEW ops.v_equipment_inventory IS 'Equipment inventory with type info, custodian, enrichment fields, and computed metrics. Excludes retired items.';


COMMIT;
