-- MIG_2977: Equipment Tracking System Overhaul
--
-- Replaces basic is_available/checkout model with:
-- 1. equipment_types lookup table (configurable, not hardcoded enums)
-- 2. equipment_events immutable event log (custody chain)
-- 3. equipment_kits bundle tracking
-- 4. New columns on ops.equipment for richer metadata
-- 5. v_equipment_inventory view for list/detail pages
--
-- Preserves all 157 existing equipment rows and 878 checkout records.

BEGIN;

-- =============================================================================
-- 1. Equipment Types (configurable lookup)
-- =============================================================================

CREATE TABLE IF NOT EXISTS ops.equipment_types (
    type_key       TEXT PRIMARY KEY,
    display_name   TEXT NOT NULL,
    category       TEXT NOT NULL DEFAULT 'trap',  -- trap, cage, camera, accessory
    manufacturer   TEXT,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order     INT NOT NULL DEFAULT 100,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ops.equipment_types IS 'Configurable equipment type registry. Add new types here, not as enums.';

-- Seed from existing data + new types
INSERT INTO ops.equipment_types (type_key, display_name, category, manufacturer, sort_order) VALUES
    ('large_trap_backdoor',       'Large Trap (Backdoor)',       'trap',      'Tomahawk', 10),
    ('large_trap_no_backdoor',    'Large Trap (No Backdoor)',    'trap',      'Tomahawk', 20),
    ('large_trap_swing_backdoor', 'Large Trap (Swing Backdoor)', 'trap',      'Tomahawk', 30),
    ('small_trap_backdoor',       'Small Trap (Backdoor)',       'trap',      'Tomahawk', 40),
    ('small_trap_no_backdoor',    'Small Trap (No Backdoor)',    'trap',      'Tomahawk', 50),
    ('drop_trap',                 'Drop Trap',                   'trap',      'Tomahawk', 60),
    ('string_trap',               'String Trap',                 'trap',      NULL,        70),
    ('transfer_cage',             'Transfer Cage',               'cage',      'Tomahawk', 80),
    ('camera',                    'Camera',                      'camera',    NULL,        90),
    ('trap_cover',                'Trap Cover',                  'accessory', NULL,        100),
    ('divider',                   'Divider',                     'accessory', NULL,        110),
    ('unknown',                   'Unknown / Other',             'accessory', NULL,        999)
ON CONFLICT (type_key) DO NOTHING;


-- =============================================================================
-- 2. Alter ops.equipment — add new columns (preserve existing data)
-- =============================================================================

ALTER TABLE ops.equipment
    ADD COLUMN IF NOT EXISTS barcode               TEXT,
    ADD COLUMN IF NOT EXISTS equipment_type_key     TEXT REFERENCES ops.equipment_types(type_key),
    ADD COLUMN IF NOT EXISTS manufacturer           TEXT,
    ADD COLUMN IF NOT EXISTS model                  TEXT,
    ADD COLUMN IF NOT EXISTS custody_status         TEXT NOT NULL DEFAULT 'available',
    ADD COLUMN IF NOT EXISTS condition_status        TEXT NOT NULL DEFAULT 'good',
    ADD COLUMN IF NOT EXISTS current_custodian_id   UUID REFERENCES sot.people(person_id),
    ADD COLUMN IF NOT EXISTS current_place_id       UUID REFERENCES sot.places(place_id),
    ADD COLUMN IF NOT EXISTS current_request_id     UUID,
    ADD COLUMN IF NOT EXISTS current_kit_id         UUID,  -- FK added after kits table
    ADD COLUMN IF NOT EXISTS acquired_at            DATE,
    ADD COLUMN IF NOT EXISTS retired_at             TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Add barcode unique index (partial — only non-null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_barcode_unique
    ON ops.equipment (barcode) WHERE barcode IS NOT NULL;

-- Index for custody status queries
CREATE INDEX IF NOT EXISTS idx_equipment_custody_status
    ON ops.equipment (custody_status) WHERE retired_at IS NULL;


-- =============================================================================
-- 3. Equipment Events (immutable custody chain)
-- =============================================================================

CREATE TABLE IF NOT EXISTS ops.equipment_events (
    event_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id           UUID NOT NULL REFERENCES ops.equipment(equipment_id),
    event_type             TEXT NOT NULL,
        -- check_out, check_in, transfer, condition_change,
        -- maintenance_start, maintenance_end, reported_missing,
        -- found, retired, note
    actor_person_id        UUID,            -- staff who performed action
    custodian_person_id    UUID,            -- who receives custody (for check_out/transfer)
    place_id               UUID,            -- where equipment is going
    request_id             UUID,            -- linked trapping request
    kit_id                 UUID,            -- if part of a kit checkout
    condition_before       TEXT,
    condition_after        TEXT,
    due_date               DATE,            -- expected return date
    notes                  TEXT,
    source_system          TEXT NOT NULL DEFAULT 'atlas_ui',
    source_record_id       TEXT,            -- for migrated data
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ops.equipment_events IS 'Immutable event log. Every custody change or status update is appended here. Never updated or deleted.';

CREATE INDEX IF NOT EXISTS idx_equipment_events_equipment
    ON ops.equipment_events (equipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_equipment_events_custodian
    ON ops.equipment_events (custodian_person_id, created_at DESC)
    WHERE custodian_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_events_type
    ON ops.equipment_events (event_type);
CREATE INDEX IF NOT EXISTS idx_equipment_events_kit
    ON ops.equipment_events (kit_id) WHERE kit_id IS NOT NULL;


-- =============================================================================
-- 4. Equipment Kits (bundle checkout)
-- =============================================================================

CREATE TABLE IF NOT EXISTS ops.equipment_kits (
    kit_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id      UUID REFERENCES sot.people(person_id),
    request_id     UUID,
    place_id       UUID REFERENCES sot.places(place_id),
    checked_out_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    returned_at    TIMESTAMPTZ,
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ops.equipment_kits IS 'Groups multiple equipment items into a single checkout bundle.';

CREATE INDEX IF NOT EXISTS idx_equipment_kits_person
    ON ops.equipment_kits (person_id) WHERE returned_at IS NULL;

-- Now add FK for current_kit_id
ALTER TABLE ops.equipment
    ADD CONSTRAINT fk_equipment_current_kit
    FOREIGN KEY (current_kit_id) REFERENCES ops.equipment_kits(kit_id)
    NOT VALID;  -- don't validate existing rows


-- =============================================================================
-- 5. Trigger: auto-update equipment on event INSERT
-- =============================================================================

CREATE OR REPLACE FUNCTION ops.equipment_event_trigger()
RETURNS TRIGGER AS $$
BEGIN
    -- Update equipment table based on event type
    CASE NEW.event_type
        WHEN 'check_out' THEN
            UPDATE ops.equipment SET
                custody_status = 'checked_out',
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
            -- 'note' or unknown: just update timestamp
            UPDATE ops.equipment SET updated_at = NOW()
            WHERE equipment_id = NEW.equipment_id;
    END CASE;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_equipment_event_sync ON ops.equipment_events;
CREATE TRIGGER trg_equipment_event_sync
    AFTER INSERT ON ops.equipment_events
    FOR EACH ROW
    EXECUTE FUNCTION ops.equipment_event_trigger();


-- =============================================================================
-- 6. View: v_equipment_inventory
-- =============================================================================

CREATE OR REPLACE VIEW ops.v_equipment_inventory AS
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

COMMENT ON VIEW ops.v_equipment_inventory IS 'Equipment inventory with type info, custodian, and computed metrics. Excludes retired items.';


-- =============================================================================
-- 7. App Config entries
-- =============================================================================

INSERT INTO ops.app_config (key, value, description, category)
VALUES
    ('equipment.overdue_days_warning',  '"14"'::jsonb,   'Days before equipment is flagged as overdue (warning)',   'equipment'),
    ('equipment.overdue_days_critical', '"30"'::jsonb,   'Days before equipment is flagged as critically overdue',  'equipment'),
    ('equipment.default_kit_traps',     '"2"'::jsonb,    'Default number of traps in a standard kit',              'equipment'),
    ('equipment.default_kit_cages',     '"4"'::jsonb,    'Default number of transfer cages in a standard kit',     'equipment'),
    ('equipment.barcode_prefix',        '"FFSC"'::jsonb, 'Prefix for generated barcode labels',                    'equipment')
ON CONFLICT (key) DO NOTHING;


COMMIT;
