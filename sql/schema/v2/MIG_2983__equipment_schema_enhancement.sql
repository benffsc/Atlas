-- MIG_2983: Equipment Schema Enhancement — Phase 1
--
-- Adds checkout classification, tracking tiers, cage sub-types,
-- internal storage places, and rich backfills from cross-referencing.
--
-- New columns on ops.equipment:
--   checkout_type, inferred_due_date, tracking_tier, cage_type, cage_size
-- New columns on ops.equipment_events:
--   checkout_type, deposit_amount, deposit_returned_at, custodian_name,
--   custodian_phone, appointment_id
-- New equipment_types: wire_cage_single_door, wire_cage_double_door,
--   wire_cage_unknown, trail_camera
-- Internal storage places: FFSC Van, Cat Room, FFSC Clinic Storage
--
-- Depends on: MIG_2977 (schema), MIG_2978 (data migration), MIG_2982 (enrichment)

BEGIN;

-- =============================================================================
-- Step 1: New columns on ops.equipment
-- =============================================================================

ALTER TABLE ops.equipment
  ADD COLUMN IF NOT EXISTS checkout_type      TEXT,
  ADD COLUMN IF NOT EXISTS inferred_due_date  DATE,
  ADD COLUMN IF NOT EXISTS tracking_tier      TEXT,
  ADD COLUMN IF NOT EXISTS cage_type          TEXT,
  ADD COLUMN IF NOT EXISTS cage_size          TEXT;

COMMENT ON COLUMN ops.equipment.checkout_type IS 'Classification of current checkout: client, trapper, internal, foster';
COMMENT ON COLUMN ops.equipment.inferred_due_date IS 'Inferred return date based on upcoming appointment';
COMMENT ON COLUMN ops.equipment.tracking_tier IS 'Tracking intensity: active (traps), passive (cages), untracked (gadgets)';
COMMENT ON COLUMN ops.equipment.cage_type IS 'Wire cage sub-type: Single Door, Double Door';
COMMENT ON COLUMN ops.equipment.cage_size IS 'Wire cage size: 2 Foot through 6 Foot';

CREATE INDEX IF NOT EXISTS idx_equipment_tracking_tier
  ON ops.equipment (tracking_tier) WHERE retired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_equipment_checkout_type
  ON ops.equipment (checkout_type) WHERE custody_status = 'checked_out';


-- =============================================================================
-- Step 2: New columns on ops.equipment_events
-- =============================================================================

ALTER TABLE ops.equipment_events
  ADD COLUMN IF NOT EXISTS checkout_type      TEXT,
  ADD COLUMN IF NOT EXISTS deposit_amount     NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS deposit_returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS custodian_name     TEXT,
  ADD COLUMN IF NOT EXISTS custodian_phone    TEXT,
  ADD COLUMN IF NOT EXISTS appointment_id     UUID;

COMMENT ON COLUMN ops.equipment_events.checkout_type IS 'Classification at time of checkout';
COMMENT ON COLUMN ops.equipment_events.deposit_amount IS 'Trap deposit amount in USD';
COMMENT ON COLUMN ops.equipment_events.custodian_name IS 'Denormalized custodian name for display';
COMMENT ON COLUMN ops.equipment_events.appointment_id IS 'Linked clinic appointment (for inferred due dates)';


-- =============================================================================
-- Step 3: Update trigger to handle new fields
-- =============================================================================

CREATE OR REPLACE FUNCTION ops.equipment_event_trigger()
RETURNS TRIGGER AS $$
BEGIN
    CASE NEW.event_type
        WHEN 'check_out' THEN
            UPDATE ops.equipment SET
                custody_status = 'checked_out',
                checkout_type = NEW.checkout_type,
                current_custodian_id = NEW.custodian_person_id,
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
                current_place_id = NULL,
                current_request_id = NULL,
                current_kit_id = NULL,
                updated_at = NOW()
            WHERE equipment_id = NEW.equipment_id;

        WHEN 'transfer' THEN
            UPDATE ops.equipment SET
                current_custodian_id = NEW.custodian_person_id,
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


-- =============================================================================
-- Step 4: New equipment_types + reclassify 27 unknowns
-- =============================================================================

INSERT INTO ops.equipment_types (type_key, display_name, category, sort_order) VALUES
    ('wire_cage_single_door', 'Wire Cage (Single Door)', 'cage', 81),
    ('wire_cage_double_door', 'Wire Cage (Double Door)', 'cage', 82),
    ('wire_cage_unknown',     'Wire Cage (Unknown)',     'cage', 83),
    ('trail_camera',          'Trail Camera',            'camera', 91)
ON CONFLICT (type_key) DO NOTHING;

-- Reclassify unknowns based on item_type from Airtable payload
UPDATE ops.equipment
SET equipment_type_key = CASE
    WHEN item_type = 'Wire Cage' AND cage_type = 'Single Door' THEN 'wire_cage_single_door'
    WHEN item_type = 'Wire Cage' AND cage_type = 'Double Door' THEN 'wire_cage_double_door'
    WHEN item_type = 'Wire Cage' THEN 'wire_cage_unknown'
    WHEN item_type = 'Gadget' AND LOWER(equipment_name) LIKE '%camera%' THEN 'trail_camera'
    WHEN item_type = 'Gadget' THEN 'camera'
    ELSE equipment_type_key
END
WHERE equipment_type_key = 'unknown'
  AND item_type IS NOT NULL;

-- Second pass: reclassify remaining unknowns by checking staged_records payload
UPDATE ops.equipment e
SET equipment_type_key = CASE
    WHEN sr.payload->>'Item Type' ILIKE '%wire cage%' THEN 'wire_cage_unknown'
    WHEN sr.payload->>'Item_Type' ILIKE '%wire cage%' THEN 'wire_cage_unknown'
    WHEN sr.payload->>'Item Type' ILIKE '%gadget%' THEN 'camera'
    WHEN sr.payload->>'Item_Type' ILIKE '%gadget%' THEN 'camera'
    ELSE e.equipment_type_key
END
FROM ops.staged_records sr
WHERE sr.source_system = 'airtable'
  AND sr.source_table = 'equipment'
  AND sr.source_row_id = e.source_record_id
  AND e.equipment_type_key = 'unknown';


-- =============================================================================
-- Step 5: Internal location places
-- =============================================================================

-- Create internal storage places (idempotent via ON CONFLICT)
INSERT INTO sot.places (place_id, display_name, place_kind, formatted_address, source_system, source_record_id)
VALUES
    (gen_random_uuid(), 'FFSC Van', 'internal_storage', 'FFSC Van (Mobile)', 'atlas_ui', 'internal_ffsc_van'),
    (gen_random_uuid(), 'Cat Room', 'internal_storage', 'FFSC Clinic - Cat Room', 'atlas_ui', 'internal_cat_room'),
    (gen_random_uuid(), 'FFSC Clinic Storage', 'internal_storage', 'FFSC Clinic - Storage', 'atlas_ui', 'internal_clinic_storage')
ON CONFLICT (source_system, source_record_id) WHERE source_record_id IS NOT NULL DO NOTHING;

-- Store place IDs in app_config for programmatic reference
INSERT INTO ops.app_config (key, value, description, category)
VALUES
    ('equipment.place_ffsc_van',
     (SELECT to_jsonb(place_id::text) FROM sot.places WHERE source_record_id = 'internal_ffsc_van' LIMIT 1),
     'Place ID for FFSC Van (internal storage)', 'equipment'),
    ('equipment.place_cat_room',
     (SELECT to_jsonb(place_id::text) FROM sot.places WHERE source_record_id = 'internal_cat_room' LIMIT 1),
     'Place ID for Cat Room (internal storage)', 'equipment'),
    ('equipment.place_clinic_storage',
     (SELECT to_jsonb(place_id::text) FROM sot.places WHERE source_record_id = 'internal_clinic_storage' LIMIT 1),
     'Place ID for FFSC Clinic Storage', 'equipment')
ON CONFLICT (key) DO NOTHING;


-- =============================================================================
-- Step 6: Backfill tracking_tier
-- =============================================================================

UPDATE ops.equipment
SET tracking_tier = CASE
    WHEN item_type = 'Trap' THEN 'active'
    WHEN item_type = 'Wire Cage' THEN 'passive'
    WHEN item_type = 'Gadget' THEN 'untracked'
    WHEN equipment_type_key LIKE '%trap%' OR equipment_type_key = 'drop_trap' OR equipment_type_key = 'string_trap' THEN 'active'
    WHEN equipment_type_key LIKE '%cage%' OR equipment_type_key = 'transfer_cage' THEN 'passive'
    WHEN equipment_type_key IN ('camera', 'trail_camera') THEN 'passive'
    WHEN equipment_type_key IN ('trap_cover', 'divider') THEN 'untracked'
    ELSE 'active'
END
WHERE tracking_tier IS NULL;


-- =============================================================================
-- Step 7: Backfill cage_type/cage_size from staged_records
-- =============================================================================

UPDATE ops.equipment e
SET
    cage_type = COALESCE(
        e.cage_type,
        NULLIF(TRIM(sr.payload->>'Cage Type'), ''),
        NULLIF(TRIM(sr.payload->>'Cage_Type'), '')
    ),
    cage_size = COALESCE(
        e.cage_size,
        NULLIF(TRIM(sr.payload->>'Cage Size'), ''),
        NULLIF(TRIM(sr.payload->>'Cage_Size'), '')
    )
FROM ops.staged_records sr
WHERE sr.source_system = 'airtable'
  AND sr.source_table = 'equipment'
  AND sr.source_row_id = e.source_record_id
  AND (e.cage_type IS NULL OR e.cage_size IS NULL)
  AND e.item_type = 'Wire Cage';


-- =============================================================================
-- Step 8: Resolve holder names → person IDs (fuzzy match)
-- =============================================================================

-- Only match where custodian is unresolved but holder name exists
-- Uses pg_trgm similarity for fuzzy matching (>= 0.7)
DO $$
DECLARE
    resolved_count INT := 0;
    unresolved_count INT := 0;
BEGIN
    -- Resolve holder names to person_ids via fuzzy name match
    WITH matches AS (
        SELECT
            e.equipment_id,
            p.person_id,
            similarity(LOWER(e.current_holder_name), LOWER(p.display_name)) AS sim
        FROM ops.equipment e
        JOIN sot.people p ON similarity(LOWER(e.current_holder_name), LOWER(p.display_name)) > 0.7
        WHERE e.current_custodian_id IS NULL
          AND e.current_holder_name IS NOT NULL
          AND e.custody_status = 'checked_out'
          AND p.merged_into_person_id IS NULL
    ),
    best_matches AS (
        SELECT DISTINCT ON (equipment_id) equipment_id, person_id, sim
        FROM matches
        ORDER BY equipment_id, sim DESC
    )
    UPDATE ops.equipment e
    SET current_custodian_id = bm.person_id,
        updated_at = NOW()
    FROM best_matches bm
    WHERE e.equipment_id = bm.equipment_id;

    GET DIAGNOSTICS resolved_count = ROW_COUNT;

    SELECT COUNT(*) INTO unresolved_count
    FROM ops.equipment
    WHERE current_custodian_id IS NULL
      AND current_holder_name IS NOT NULL
      AND custody_status = 'checked_out';

    RAISE NOTICE 'Holder resolution: % resolved, % still unresolved', resolved_count, unresolved_count;
END $$;


-- =============================================================================
-- Step 9: Classify historical checkout types
-- =============================================================================

UPDATE ops.equipment e
SET checkout_type = CASE
    -- Internal: staff names and location keywords
    WHEN LOWER(COALESCE(e.current_holder_name, '')) ~ '^(ben|crystal|jami|donna|pat|lori)\b' THEN 'internal'
    WHEN LOWER(COALESCE(e.current_holder_name, '')) LIKE '%crystal -%' THEN 'internal'
    WHEN LOWER(COALESCE(e.current_holder_name, '')) LIKE '%ben -%' THEN 'internal'
    WHEN LOWER(COALESCE(e.current_holder_name, '')) ~ '(van|cat room|clinic|storage|office)' THEN 'internal'
    -- Trapper: matches trapper_profiles
    WHEN EXISTS (
        SELECT 1 FROM sot.trapper_profiles tp
        WHERE tp.person_id = e.current_custodian_id
    ) THEN 'trapper'
    -- Foster patterns
    WHEN LOWER(COALESCE(e.current_holder_name, '')) LIKE '%foster%' THEN 'foster'
    -- Default: client
    ELSE 'client'
END
WHERE e.custody_status = 'checked_out'
  AND e.checkout_type IS NULL;


-- =============================================================================
-- Step 10: Infer due dates retroactively
-- =============================================================================

-- For checked-out items with resolved custodian, find the first appointment
-- within 60 days of the checkout event and set inferred_due_date = appt + 2 days
UPDATE ops.equipment e
SET inferred_due_date = sub.inferred_date
FROM (
    SELECT
        e2.equipment_id,
        (MIN(a.appointment_date) + INTERVAL '2 days')::date AS inferred_date
    FROM ops.equipment e2
    JOIN ops.equipment_events ev
        ON ev.equipment_id = e2.equipment_id
       AND ev.event_type = 'check_out'
       AND NOT EXISTS (
           SELECT 1 FROM ops.equipment_events ev2
           WHERE ev2.equipment_id = e2.equipment_id
             AND ev2.event_type = 'check_in'
             AND ev2.created_at > ev.created_at
       )
    JOIN sot.person_place pp ON pp.person_id = e2.current_custodian_id
    JOIN ops.appointments a ON a.inferred_place_id = pp.place_id
       AND a.appointment_date >= ev.created_at::date
       AND a.appointment_date <= ev.created_at::date + INTERVAL '60 days'
    WHERE e2.custody_status = 'checked_out'
      AND e2.current_custodian_id IS NOT NULL
      AND e2.inferred_due_date IS NULL
    GROUP BY e2.equipment_id
) sub
WHERE e.equipment_id = sub.equipment_id;


-- =============================================================================
-- Step 11: Rebuild v_equipment_inventory view
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
    -- Enrichment columns (MIG_2982)
    e.item_type,
    e.size,
    e.functional_status,
    e.current_holder_name,
    e.expected_return_date,
    e.photo_url,
    e.barcode_image_url,
    -- Phase 2 columns (MIG_2983)
    e.checkout_type,
    e.inferred_due_date,
    e.tracking_tier,
    e.cage_type,
    e.cage_size,
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
    e.custody_status = 'available' AS is_available
FROM ops.equipment e
LEFT JOIN ops.equipment_types et ON et.type_key = e.equipment_type_key
LEFT JOIN sot.people cust ON cust.person_id = e.current_custodian_id
LEFT JOIN sot.places pl ON pl.place_id = e.current_place_id
WHERE e.retired_at IS NULL;

COMMENT ON VIEW ops.v_equipment_inventory IS 'Equipment inventory with type info, custodian, enrichment, tracking tier, checkout classification, and computed metrics. Excludes retired items.';


COMMIT;
