-- MIG_3042: SharePoint sync state tracking
-- Tracks which SharePoint folders have been synced and when,
-- so the cron only processes new/changed files.
--
-- Depends on: MIG_3040 (waiver_scans)
-- Part of: FFS-1110 (SharePoint Waiver Sync)

BEGIN;

-- Track sync state per SharePoint folder
CREATE TABLE IF NOT EXISTS ops.sharepoint_sync_state (
  sync_state_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_id        TEXT NOT NULL,
  folder_path     TEXT NOT NULL,           -- e.g., "Spay Neuter Clinics/Clinic HQ Waivers/2026 Waivers/April 2026/4.1.26"
  folder_item_id  TEXT,                    -- SharePoint driveItem ID for the folder
  last_synced_at  TIMESTAMPTZ,
  items_synced    INT DEFAULT 0,
  items_skipped   INT DEFAULT 0,           -- non-waiver files (Master List, Staff Roster)
  items_failed    INT DEFAULT 0,
  last_error      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (drive_id, folder_path)
);

-- Track individual files synced from SharePoint to prevent re-downloads
CREATE TABLE IF NOT EXISTS ops.sharepoint_synced_files (
  synced_file_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_id          TEXT NOT NULL,
  item_id           TEXT NOT NULL,          -- SharePoint driveItem ID
  file_name         TEXT NOT NULL,
  file_size         BIGINT,
  sharepoint_modified_at TIMESTAMPTZ,       -- lastModifiedDateTime from SharePoint
  file_upload_id    UUID REFERENCES ops.file_uploads(upload_id),
  waiver_scan_id    UUID REFERENCES ops.waiver_scans(waiver_id),
  sync_state_id     UUID REFERENCES ops.sharepoint_sync_state(sync_state_id),
  synced_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE (drive_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_sp_synced_files_upload ON ops.sharepoint_synced_files(file_upload_id);
CREATE INDEX IF NOT EXISTS idx_sp_synced_files_waiver ON ops.sharepoint_synced_files(waiver_scan_id);
CREATE INDEX IF NOT EXISTS idx_sp_sync_state_path ON ops.sharepoint_sync_state(folder_path);

COMMIT;
