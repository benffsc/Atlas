-- MIG_2960: Soft deletes and audit trail for system resilience (FFS-637, FFS-638)
--
-- Section A: Add deleted_at/deleted_by columns to existing tables
-- Section B: Update v_colony_stats view to filter soft-deleted colonies
--
-- Core Invariant #1: "No Data Disappears"
-- Replaces hard DELETE routes with soft deletes.
--
-- Note: sot.cat_birth_events, sot.colony_requests, sot.colony_people do not
-- exist yet. Their soft-delete columns will be added when those tables are created.
-- The route-level soft-delete code is already in place and will work once
-- those tables exist.

BEGIN;

-- ============================================================
-- Section A: Add deleted_at/deleted_by to existing tables
-- ============================================================

-- sot.colonies — exists, needs new columns
ALTER TABLE sot.colonies ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE sot.colonies ADD COLUMN IF NOT EXISTS deleted_by TEXT;

-- sot.cat_mortality_events — exists, needs new columns
ALTER TABLE sot.cat_mortality_events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE sot.cat_mortality_events ADD COLUMN IF NOT EXISTS deleted_by TEXT;

-- Partial indexes for efficient filtering of non-deleted rows
CREATE INDEX IF NOT EXISTS idx_colonies_not_deleted
  ON sot.colonies(colony_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cat_mortality_events_not_deleted
  ON sot.cat_mortality_events(cat_id) WHERE deleted_at IS NULL;

-- ============================================================
-- Section A2: Tables that don't exist yet — safe DO blocks
-- These will no-op if table doesn't exist, succeed if it does.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sot' AND table_name = 'cat_birth_events') THEN
    ALTER TABLE sot.cat_birth_events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    ALTER TABLE sot.cat_birth_events ADD COLUMN IF NOT EXISTS deleted_by TEXT;
    CREATE INDEX IF NOT EXISTS idx_cat_birth_events_not_deleted
      ON sot.cat_birth_events(cat_id) WHERE deleted_at IS NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sot' AND table_name = 'colony_requests') THEN
    ALTER TABLE sot.colony_requests ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    ALTER TABLE sot.colony_requests ADD COLUMN IF NOT EXISTS deleted_by TEXT;
    CREATE INDEX IF NOT EXISTS idx_colony_requests_not_deleted
      ON sot.colony_requests(colony_id, request_id) WHERE deleted_at IS NULL;
  END IF;
END $$;

-- ============================================================
-- Section B: Update v_colony_stats to filter soft-deleted colonies
-- ============================================================

CREATE OR REPLACE VIEW ops.v_colony_stats AS
SELECT
  col.colony_id,
  col.name,
  col.description,
  col.colony_status,
  col.colony_type,
  col.estimated_population,
  col.estimated_altered,
  col.last_count_date,
  col.count_method,
  col.is_verified,
  col.needs_attention,
  col.attention_reason,
  col.watch_list,
  col.watch_list_reason,
  col.service_zone,
  col.source_system,
  col.created_at,
  col.updated_at,
  -- Primary caretaker
  col.primary_caretaker_id,
  COALESCE(pc.display_name, pc.first_name || ' ' || pc.last_name) AS primary_caretaker_name,
  -- Stats
  (SELECT COUNT(*) FROM sot.colony_cats cc WHERE cc.colony_id = col.colony_id AND cc.membership_status = 'active')::int AS active_cat_count,
  (SELECT COUNT(*) FROM sot.colony_cats cc WHERE cc.colony_id = col.colony_id)::int AS total_cat_count,
  (SELECT COUNT(*) FROM sot.colony_places cp WHERE cp.colony_id = col.colony_id AND cp.is_active = TRUE)::int AS active_place_count,
  -- Primary place
  (SELECT pp.place_id FROM sot.colony_places pp WHERE pp.colony_id = col.colony_id AND pp.is_primary = TRUE LIMIT 1) AS primary_place_id,
  (SELECT ppl.display_name FROM sot.colony_places pp JOIN sot.places ppl ON ppl.place_id = pp.place_id WHERE pp.colony_id = col.colony_id AND pp.is_primary = TRUE LIMIT 1) AS primary_place_name,
  (SELECT ppl.formatted_address FROM sot.colony_places pp JOIN sot.places ppl ON ppl.place_id = pp.place_id WHERE pp.colony_id = col.colony_id AND pp.is_primary = TRUE LIMIT 1) AS primary_place_address,
  -- Alteration rate
  CASE WHEN col.estimated_population > 0 THEN
    ROUND(100.0 * COALESCE(col.estimated_altered, 0) / col.estimated_population, 1)
  ELSE NULL END AS alteration_rate_pct
FROM sot.colonies col
LEFT JOIN sot.people pc ON pc.person_id = col.primary_caretaker_id AND pc.merged_into_person_id IS NULL
WHERE col.merged_into_colony_id IS NULL
  AND col.deleted_at IS NULL;

COMMIT;
