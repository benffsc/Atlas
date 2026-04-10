import { NextRequest } from "next/server";
import { randomUUID, createHash } from "crypto";
import { queryOne, execute } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/api-response";
import {
  validateSharePointConfig,
  listFolderChildren,
  listFolderChildrenById,
  downloadFile,
} from "@/lib/sharepoint";
import { uploadFile, getPublicUrl, isStorageAvailable } from "@/lib/supabase";

/**
 * SharePoint Photo Sync Cron
 *
 * Runs on schedule to sync clinic day photos from SharePoint → Atlas.
 * Discovers clinic day folders, downloads new images, stores in Supabase,
 * and creates request_media + evidence_stream_segments rows.
 *
 * Follows the same budget/dedup/sync-state pattern as sharepoint-waiver-sync.
 * CDS-AI classify cron (at :45) picks up the pending segments automatically.
 *
 * SharePoint folder structure:
 *   Clinic Day Photos/{Year} Photos/{Month} {Year}/{M.DD.YY}/
 *     IMG_0001.jpg, IMG_0002.jpg, ...
 *
 * Schedule: every 4 hours at :30 (after waiver sync at :00, before CDS-AI at :45)
 *
 * Env:
 *   - SHAREPOINT_DRIVE_ID, SHAREPOINT_CLIENT_ID, etc. (shared with waiver sync)
 *   - SHAREPOINT_PHOTO_PATH (default: "Spay Neuter Clinics/Clinic Day Photos")
 *
 * Linear: FFS-1198
 */

export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;
const SHAREPOINT_DRIVE_ID = process.env.SHAREPOINT_DRIVE_ID;
const SHAREPOINT_PHOTO_PATH =
  process.env.SHAREPOINT_PHOTO_PATH || "Spay Neuter Clinics/Clinic Day Photos";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "heic", "heif", "webp"]);

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
};

/**
 * Parse folder name like "4.15.26" → "2026-04-15".
 * Returns null if unparseable.
 */
function parseFolderDate(name: string): string | null {
  const match = name.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!match) return null;

  const month = parseInt(match[1]);
  const day = parseInt(match[2]);
  let year = parseInt(match[3]);

  // Two-digit year: assume 2000s
  if (year < 100) year += 2000;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isImageFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? IMAGE_EXTENSIONS.has(ext) : false;
}

function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() || "jpg";
}

/**
 * Build month folder paths to scan (current + previous month).
 * Format: "{Year} Photos/{Month Name} {Year}"
 */
function getMonthFoldersToScan(): string[] {
  const now = new Date();
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const folders: string[] = [];

  // Current month
  folders.push(`${currentYear} Photos/${months[currentMonth]} ${currentYear}`);

  // Previous month
  const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
  const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
  folders.push(`${prevYear} Photos/${months[prevMonth]} ${prevYear}`);

  return folders;
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  // Auth check
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  // Validate config
  const config = validateSharePointConfig();
  if (!config.valid) {
    return apiError(`Missing env vars: ${config.missing.join(", ")}`, 500);
  }
  if (!SHAREPOINT_DRIVE_ID) {
    return apiError("Missing SHAREPOINT_DRIVE_ID env var", 500);
  }
  if (!isStorageAvailable()) {
    return apiError("Supabase storage not configured", 500);
  }

  const MAX_FILES_PER_RUN = 50; // ~150s at ~3s/file (download + upload + DB)
  let filesProcessedThisRun = 0;

  const log: string[] = [];
  const stats = {
    foldersScanned: 0,
    clinicDaysFound: 0,
    filesDiscovered: 0,
    filesSkipped: 0,
    filesAlreadySynced: 0,
    filesDownloaded: 0,
    filesUploaded: 0,
    segmentsCreated: 0,
    errors: 0,
    budgetReached: false,
  };

  try {
    const monthFolders = getMonthFoldersToScan();
    log.push(`Scanning ${monthFolders.length} month folders (budget: ${MAX_FILES_PER_RUN} files)`);

    for (const monthFolder of monthFolders) {
      const monthPath = `${SHAREPOINT_PHOTO_PATH}/${monthFolder}`;
      log.push(`Scanning: ${monthPath}`);

      let clinicDayFolders;
      try {
        clinicDayFolders = await listFolderChildren(SHAREPOINT_DRIVE_ID, monthPath);
      } catch (err) {
        log.push(`  SKIP: Could not list ${monthPath}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      stats.foldersScanned++;

      const dayFolders = clinicDayFolders.filter(
        (item) => item.isFolder && (item.childCount || 0) > 0
      );
      stats.clinicDaysFound += dayFolders.length;

      for (const dayFolder of dayFolders) {
        const clinicDate = parseFolderDate(dayFolder.name);
        if (!clinicDate) {
          log.push(`  SKIP: Unparseable folder name: ${dayFolder.name}`);
          continue;
        }

        const folderPath = `${monthPath}/${dayFolder.name}`;
        log.push(`  Clinic day: ${dayFolder.name} → ${clinicDate} (${dayFolder.childCount} items)`);

        // Check sync state — use "photo:" prefix to separate from waiver sync state
        const syncKey = `photo:${folderPath}`;
        const syncState = await queryOne<{
          sync_state_id: string;
          last_synced_at: string;
          items_synced: number;
        }>(
          `SELECT sync_state_id, last_synced_at::text, items_synced
           FROM ops.sharepoint_sync_state
           WHERE drive_id = $1 AND folder_path = $2`,
          [SHAREPOINT_DRIVE_ID, syncKey]
        );

        const folderModified = new Date(dayFolder.lastModifiedDateTime);
        if (syncState?.last_synced_at) {
          const lastSynced = new Date(syncState.last_synced_at);
          if (folderModified <= lastSynced) {
            log.push(`    Skipped (no changes since last sync)`);
            continue;
          }
        }

        // List files in this clinic day folder
        let files;
        try {
          files = await listFolderChildrenById(SHAREPOINT_DRIVE_ID, dayFolder.id);
        } catch (err) {
          log.push(`    ERROR listing files: ${err instanceof Error ? err.message : String(err)}`);
          stats.errors++;
          continue;
        }

        // Filter to images only
        const imageFiles = files
          .filter((f) => !f.isFolder && isImageFile(f.name))
          .sort((a, b) =>
            // Sort by createdDateTime to preserve phone upload order
            new Date(a.createdDateTime).getTime() - new Date(b.createdDateTime).getTime()
          );

        stats.filesDiscovered += imageFiles.length;

        const batchId = randomUUID();
        let folderSynced = 0;
        let folderSkipped = 0;
        let folderFailed = 0;
        let folderFullyProcessed = true;
        let seqNum = 0;

        for (const imgFile of imageFiles) {
          if (filesProcessedThisRun >= MAX_FILES_PER_RUN) {
            stats.budgetReached = true;
            folderFullyProcessed = false;
            log.push(`    Budget reached (${MAX_FILES_PER_RUN} files this run). Folder left partial.`);
            break;
          }

          // Check if already synced by SharePoint item ID
          const alreadySynced = await queryOne<{ synced_file_id: string }>(
            `SELECT synced_file_id FROM ops.sharepoint_synced_files
             WHERE drive_id = $1 AND item_id = $2`,
            [SHAREPOINT_DRIVE_ID, imgFile.id]
          );

          if (alreadySynced) {
            stats.filesAlreadySynced++;
            continue;
          }

          try {
            filesProcessedThisRun++;
            seqNum++;

            // Download from SharePoint
            const content = await downloadFile(SHAREPOINT_DRIVE_ID, imgFile.id);
            stats.filesDownloaded++;

            // SHA-256 dedup
            const hash = createHash("sha256").update(content).digest("hex");
            const shortHash = hash.substring(0, 8);

            // Check for duplicate by hash
            const existing = await queryOne<{ media_id: string }>(
              `SELECT media_id FROM ops.request_media
               WHERE stored_filename LIKE '%' || $1 || '%'
                 AND NOT is_archived
               LIMIT 1`,
              [shortHash]
            );

            if (existing) {
              stats.filesSkipped++;
              folderSkipped++;
              // Still track as synced so we don't re-download
              await execute(
                `INSERT INTO ops.sharepoint_synced_files (
                   drive_id, item_id, file_name, file_size,
                   sharepoint_modified_at
                 ) VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT DO NOTHING`,
                [SHAREPOINT_DRIVE_ID, imgFile.id, imgFile.name, imgFile.size, imgFile.lastModifiedDateTime]
              );
              continue;
            }

            // Upload to Supabase
            const ext = getExtension(imgFile.name);
            const mimeType = MIME_MAP[ext] || "image/jpeg";
            const storedFilename = `${clinicDate}_seq${String(seqNum).padStart(4, "0")}_${shortHash}.${ext}`;
            const storagePath = `clinic-days/${clinicDate}/evidence/${storedFilename}`;

            const uploadResult = await uploadFile(storagePath, content, mimeType);
            if (!uploadResult.success) {
              log.push(`    ERROR upload ${imgFile.name}: ${uploadResult.error}`);
              stats.errors++;
              folderFailed++;
              continue;
            }

            stats.filesUploaded++;

            const publicUrl = uploadResult.url || getPublicUrl(storagePath);

            // Build notes JSON
            const notesJson = JSON.stringify({
              clinic_date: clinicDate,
              ingest_batch_id: batchId,
              sequence_number: seqNum,
              exif_taken_at: null, // SharePoint doesn't preserve EXIF; rely on createdDateTime order
              original_folder: folderPath,
              file_hash: hash,
              sharepoint_item_id: imgFile.id,
            });

            // INSERT request_media
            const mediaRow = await queryOne<{ media_id: string }>(
              `INSERT INTO ops.request_media (
                 media_type, original_filename, stored_filename,
                 file_size_bytes, mime_type, storage_provider, storage_path,
                 cat_identification_confidence, uploaded_by, notes
               ) VALUES (
                 'cat_photo', $1, $2, $3, $4, 'supabase', $5,
                 'unidentified', 'sharepoint_photo_sync', $6
               )
               RETURNING media_id`,
              [imgFile.name, storedFilename, content.length, mimeType, publicUrl, notesJson]
            );

            if (!mediaRow) {
              stats.errors++;
              folderFailed++;
              continue;
            }

            // INSERT evidence_stream_segments
            await queryOne(
              `INSERT INTO ops.evidence_stream_segments (
                 ingest_batch_id, clinic_date, source_kind, source_ref_id,
                 sequence_number, assignment_status
               ) VALUES ($1, $2::DATE, 'request_media', $3, $4, 'pending')`,
              [batchId, clinicDate, mediaRow.media_id, seqNum]
            );

            stats.segmentsCreated++;
            folderSynced++;

            // Track in sharepoint_synced_files
            await execute(
              `INSERT INTO ops.sharepoint_synced_files (
                 drive_id, item_id, file_name, file_size,
                 sharepoint_modified_at, file_upload_id
               ) VALUES ($1, $2, $3, $4, $5, NULL)
               ON CONFLICT DO NOTHING`,
              [SHAREPOINT_DRIVE_ID, imgFile.id, imgFile.name, imgFile.size, imgFile.lastModifiedDateTime]
            );

            log.push(`    ✓ ${imgFile.name} → seq ${seqNum}`);
          } catch (err) {
            stats.errors++;
            folderFailed++;
            log.push(`    ERROR ${imgFile.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // Update sync state only if folder was fully processed
        if (folderFullyProcessed) {
          await execute(
            `INSERT INTO ops.sharepoint_sync_state (
               drive_id, folder_path, folder_item_id,
               last_synced_at, items_synced, items_skipped, items_failed
             ) VALUES ($1, $2, $3, now(), $4, $5, $6)
             ON CONFLICT (drive_id, folder_path) DO UPDATE SET
               last_synced_at = now(),
               items_synced = EXCLUDED.items_synced,
               items_skipped = EXCLUDED.items_skipped,
               items_failed = EXCLUDED.items_failed`,
            [SHAREPOINT_DRIVE_ID, syncKey, dayFolder.id, folderSynced, folderSkipped, folderFailed]
          );
        } else {
          log.push(`    Partial processing — sync state NOT updated`);
        }

        // Break outer loop if budget reached
        if (stats.budgetReached) break;
      }

      if (stats.budgetReached) break;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log.push(`Done in ${duration}s`);

    return apiSuccess({
      status: "ok",
      duration_s: parseFloat(duration),
      stats,
      log,
    });
  } catch (err) {
    console.error("[sharepoint-photo-sync] error:", err);
    return apiError(
      err instanceof Error ? err.message : "SharePoint photo sync failed",
      500,
      { stats, log }
    );
  }
}
