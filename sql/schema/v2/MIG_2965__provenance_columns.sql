-- MIG_2965: Provenance columns for addresses + updated_at for relationship tables
-- FFS-645: Ensures all core entities have full provenance (source_system, source_record_id, source_created_at)
--          and relationship tables track when links were last modified.
--
-- sot.addresses already has source_system (MIG_2006). This adds source_record_id + source_created_at.
-- sot.person_place already has updated_at (MIG_2021). This adds it to cat_place and person_cat.

BEGIN;

-- ==========================================================================
-- Section A: Provenance columns on sot.addresses
-- ==========================================================================

ALTER TABLE sot.addresses ADD COLUMN IF NOT EXISTS source_record_id TEXT;
ALTER TABLE sot.addresses ADD COLUMN IF NOT EXISTS source_created_at TIMESTAMPTZ;

COMMENT ON COLUMN sot.addresses.source_record_id IS 'ID in the originating system (e.g., ClinicHQ address ID)';
COMMENT ON COLUMN sot.addresses.source_created_at IS 'When this record was created in the originating system';

-- ==========================================================================
-- Section B: updated_at on relationship tables
-- ==========================================================================

-- cat_place: add updated_at
ALTER TABLE sot.cat_place ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- person_cat: add updated_at
ALTER TABLE sot.person_cat ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- person_place already has updated_at from MIG_2021, but ensure it exists
ALTER TABLE sot.person_place ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ==========================================================================
-- Section C: Backfill updated_at with best available timestamp
-- ==========================================================================

UPDATE sot.cat_place SET updated_at = COALESCE(migrated_at, created_at) WHERE updated_at IS NULL;
UPDATE sot.person_cat SET updated_at = COALESCE(migrated_at, created_at) WHERE updated_at IS NULL;
UPDATE sot.person_place SET updated_at = COALESCE(migrated_at, created_at) WHERE updated_at IS NULL;

-- ==========================================================================
-- Section D: Triggers to auto-set updated_at on UPDATE
-- ==========================================================================

-- Reuse the existing sot.trigger_set_updated_at() function from MIG_1002

CREATE TRIGGER set_cat_place_updated_at
    BEFORE UPDATE ON sot.cat_place
    FOR EACH ROW EXECUTE FUNCTION sot.trigger_set_updated_at();

CREATE TRIGGER set_person_cat_updated_at
    BEFORE UPDATE ON sot.person_cat
    FOR EACH ROW EXECUTE FUNCTION sot.trigger_set_updated_at();

-- person_place may already have a trigger — use DROP IF EXISTS first
DROP TRIGGER IF EXISTS set_person_place_updated_at ON sot.person_place;
CREATE TRIGGER set_person_place_updated_at
    BEFORE UPDATE ON sot.person_place
    FOR EACH ROW EXECUTE FUNCTION sot.trigger_set_updated_at();

COMMIT;
