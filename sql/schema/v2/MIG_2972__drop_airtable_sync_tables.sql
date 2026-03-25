-- MIG_2972: Drop Airtable sync infrastructure tables
-- FFS-557: Airtable Decommission
--
-- These tables supported the pull-based Airtable sync engine.
-- Now replaced by:
--   - JotForm direct webhook for trapper agreements
--   - All other Airtable syncs were one-time historical imports
--
-- IMPORTANT: This does NOT delete historical data in sot.* tables
-- where source_system = 'airtable'. That data is permanently retained.

-- Drop sync tracking tables (cascade drops dependent views/constraints)
DROP TABLE IF EXISTS ops.airtable_sync_records CASCADE;
DROP TABLE IF EXISTS ops.airtable_sync_runs CASCADE;
DROP TABLE IF EXISTS ops.airtable_sync_configs CASCADE;

-- Drop Airtable-specific columns from intake custom fields
ALTER TABLE ops.intake_custom_fields
  DROP COLUMN IF EXISTS airtable_field_id,
  DROP COLUMN IF EXISTS airtable_synced_at;

-- Remove "Airtable Syncs" from admin nav config
DELETE FROM ops.app_config WHERE key = 'admin.nav.airtable_syncs';
