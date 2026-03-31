-- MIG_3019: Add sync columns to source.google_map_entries
-- Date: 2026-03-30
--
-- Part of FFS-1023 (KML Import). Adds content_hash, synced_at, sync_source,
-- and sync_status for change detection during automated MyMaps sync.

\echo ''
\echo '=============================================='
\echo '  MIG_3019: Add sync columns to google_map_entries'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. ADD COLUMNS
-- ============================================================================

\echo '1. Adding sync columns...'

ALTER TABLE source.google_map_entries
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sync_source TEXT,
  ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'active';

COMMENT ON COLUMN source.google_map_entries.content_hash IS
  'MD5 hash of (kml_name || original_content) for change detection during sync.';
COMMENT ON COLUMN source.google_map_entries.synced_at IS
  'When this entry was last seen during a MyMaps sync.';
COMMENT ON COLUMN source.google_map_entries.sync_source IS
  'How this entry was imported: web_ui, mymaps_kml, manual.';
COMMENT ON COLUMN source.google_map_entries.sync_status IS
  'Sync lifecycle: active (seen in latest sync), removed (no longer in KML).';

-- ============================================================================
-- 2. CREATE UNIQUE INDEX FOR UPSERT
-- ============================================================================

\echo '2. Creating unique index for upsert...'

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_gme_kml_upsert
  ON source.google_map_entries (lat, lng, kml_name)
  WHERE kml_name IS NOT NULL;

-- ============================================================================
-- 3. INDEX ON synced_at for filtering
-- ============================================================================

\echo '3. Creating synced_at index...'

CREATE INDEX IF NOT EXISTS idx_source_gme_synced_at
  ON source.google_map_entries (synced_at)
  WHERE synced_at IS NOT NULL;

\echo ''
\echo '✓ MIG_3019 complete — sync columns added to source.google_map_entries'
\echo '  New columns: content_hash, synced_at, sync_source, sync_status'
\echo '  New index: idx_source_gme_kml_upsert (lat, lng, kml_name)'
\echo ''
