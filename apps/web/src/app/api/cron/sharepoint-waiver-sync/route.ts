import { NextRequest } from "next/server";
import { queryOne, queryRows, execute, query } from "@/lib/db";
import { apiSuccess, apiServerError, apiError } from "@/lib/api-response";
import {
  validateSharePointConfig,
  listFolderChildren,
  listFolderChildrenById,
  downloadFile,
} from "@/lib/sharepoint";
import { parseWaiverFilename } from "@/lib/waiver-filename-parser";
import { createHash } from "crypto";

// SharePoint Waiver Sync Cron Job
//
// Runs on schedule to sync waiver PDFs from SharePoint → Atlas.
// Discovers clinic day folders in current + previous month,
// downloads new PDFs, parses filenames, and matches to appointments.
//
// Proactive: waivers are parsed before ClinicHQ data arrives,
// so matching happens automatically when the batch comes in.
//
// Vercel Cron: Add to vercel.json:
//   "crons": [{ "path": "/api/cron/sharepoint-waiver-sync", "schedule": "0 */4 * * *" }]
//
// Environment Variables Required:
//   - MICROSOFT_CLIENT_ID, MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_SECRET
//   - SHAREPOINT_DRIVE_ID: The drive ID for "Spay Neuter Clinic" library
//   - SHAREPOINT_WAIVER_PATH: Base path to waiver folders (default: "Spay Neuter Clinics/Clinic HQ Waivers")
//   - CRON_SECRET: Optional secret for manual trigger security

export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;
const SHAREPOINT_DRIVE_ID = process.env.SHAREPOINT_DRIVE_ID;
const SHAREPOINT_WAIVER_PATH =
  process.env.SHAREPOINT_WAIVER_PATH || "Spay Neuter Clinics/Clinic HQ Waivers";

// Files to skip — these are administrative, not waivers
const SKIP_PATTERNS = [
  /^(clinic\s+)?staff\s+roster/i,
  /^master\s+list/i,
  /^\d+\.\d+\.\d+\s+(clinic\s+)?staff\s+roster/i,
  /^\d+\.\d+\.\d+\s+master\s+list/i,
];

function shouldSkipFile(filename: string): boolean {
  return SKIP_PATTERNS.some((pattern) => pattern.test(filename));
}

/**
 * Build the month folder names to scan.
 * Returns current month + previous month folder names.
 * Format: "{Year} Waivers/{Month Name} {Year}" e.g. "2026 Waivers/April 2026"
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
  folders.push(`${currentYear} Waivers/${months[currentMonth]} ${currentYear}`);

  // Previous month (handles year boundary)
  const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
  const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
  folders.push(`${prevYear} Waivers/${months[prevMonth]} ${prevYear}`);

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

  // Per-invocation budget to avoid hitting Vercel's 300s function timeout.
  // SharePoint downloads + DB inserts are ~0.5-1s each; 200 files ≈ 150-200s,
  // leaving headroom for folder listing + retries. Remaining files get picked
  // up on the next cron tick (every 4h) — eventually catching up.
  const MAX_FILES_PER_RUN = 200;
  let filesProcessedThisRun = 0;

  const log: string[] = [];
  const stats = {
    foldersScanned: 0,
    clinicDaysFound: 0,
    filesDiscovered: 0,
    filesSkipped: 0,
    filesAlreadySynced: 0,
    filesDownloaded: 0,
    filesParsed: 0,
    filesMatched: 0,
    errors: 0,
    budgetReached: false,
  };

  try {
    const monthFolders = getMonthFoldersToScan();
    log.push(`Scanning ${monthFolders.length} month folders (budget: ${MAX_FILES_PER_RUN} files)`);

    for (const monthFolder of monthFolders) {
      const monthPath = `${SHAREPOINT_WAIVER_PATH}/${monthFolder}`;
      log.push(`Scanning: ${monthPath}`);

      let clinicDayFolders;
      try {
        clinicDayFolders = await listFolderChildren(SHAREPOINT_DRIVE_ID, monthPath);
      } catch (err) {
        log.push(`  SKIP: Could not list ${monthPath}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      stats.foldersScanned++;

      // Filter to only folders (clinic day subfolders like "4.1.26")
      const dayFolders = clinicDayFolders.filter((item) => item.isFolder && (item.childCount || 0) > 0);
      stats.clinicDaysFound += dayFolders.length;

      for (const dayFolder of dayFolders) {
        const folderPath = `${monthPath}/${dayFolder.name}`;
        log.push(`  Clinic day: ${dayFolder.name} (${dayFolder.childCount} items)`);

        // Check sync state — skip if already fully synced and folder hasn't changed
        const syncState = await queryOne<{
          sync_state_id: string;
          last_synced_at: string;
          items_synced: number;
        }>(
          `SELECT sync_state_id, last_synced_at::text, items_synced
           FROM ops.sharepoint_sync_state
           WHERE drive_id = $1 AND folder_path = $2`,
          [SHAREPOINT_DRIVE_ID, folderPath]
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

        const pdfFiles = files.filter(
          (f) => !f.isFolder && f.name.toLowerCase().endsWith(".pdf")
        );
        stats.filesDiscovered += pdfFiles.length;

        let folderSynced = 0;
        let folderSkipped = 0;
        let folderFailed = 0;
        let folderFullyProcessed = true;

        for (const pdfFile of pdfFiles) {
          // Per-run budget check — stop gracefully. Mark the folder as
          // not fully processed so the sync state does NOT get written
          // with last_synced_at = now() — otherwise the next cron tick
          // would skip this folder entirely and leave half the files
          // unsynced forever.
          if (filesProcessedThisRun >= MAX_FILES_PER_RUN) {
            stats.budgetReached = true;
            folderFullyProcessed = false;
            log.push(`    Budget reached (${MAX_FILES_PER_RUN} files this run). Folder left partial; will resume next tick.`);
            break;
          }

          // Skip non-waiver files
          if (shouldSkipFile(pdfFile.name)) {
            stats.filesSkipped++;
            folderSkipped++;
            continue;
          }

          // Check if already synced
          const alreadySynced = await queryOne<{ synced_file_id: string }>(
            `SELECT synced_file_id FROM ops.sharepoint_synced_files
             WHERE drive_id = $1 AND item_id = $2`,
            [SHAREPOINT_DRIVE_ID, pdfFile.id]
          );

          if (alreadySynced) {
            stats.filesAlreadySynced++;
            continue;
          }

          // Download and process
          try {
            filesProcessedThisRun++;
            const content = await downloadFile(SHAREPOINT_DRIVE_ID, pdfFile.id);
            stats.filesDownloaded++;

            // Create file_upload record
            const fileHash = createHash("sha256").update(content).digest("hex");

            // Check for duplicate by hash
            const existingUpload = await queryOne<{ upload_id: string }>(
              `SELECT upload_id FROM ops.file_uploads WHERE file_hash = $1`,
              [fileHash]
            );

            let uploadId: string;
            if (existingUpload) {
              uploadId = existingUpload.upload_id;
            } else {
              // Build stored_filename following the convention used by other
              // ingest paths: {source_system}_{source_table}_{iso_ts}_{hash8}.ext
              // ops.file_uploads.stored_filename is NOT NULL.
              const nameExt = pdfFile.name.includes(".")
                ? pdfFile.name.split(".").pop()!
                : "pdf";
              const ts = new Date().toISOString().replace(/[:.]/g, "-");
              const storedFilename = `clinic_waiver_waiver_scan_${ts}_${fileHash.slice(0, 8)}.${nameExt}`;

              const upload = await queryOne<{ upload_id: string }>(
                `INSERT INTO ops.file_uploads (
                   source_system, source_table, original_filename, stored_filename,
                   file_content, file_size_bytes, file_hash, status, rows_total
                 ) VALUES ('clinic_waiver', 'waiver_scan', $1, $2, $3, $4, $5, 'pending', 1)
                 RETURNING upload_id`,
                [pdfFile.name, storedFilename, content, content.length, fileHash]
              );
              uploadId = upload!.upload_id;
            }

            // Parse filename and match
            const parseResult = parseWaiverFilename(pdfFile.name);
            let waiverId: string | null = null;

            if (parseResult.success) {
              stats.filesParsed++;
              const { lastName, description, last4Chip, date } = parseResult.data;

              // Match to appointment
              const matchResult = await queryOne<{
                appointment_id: string;
                cat_id: string | null;
                client_name: string | null;
              }>(
                `SELECT a.appointment_id, a.cat_id, a.client_name
                 FROM ops.appointments a
                 LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
                 WHERE c.microchip IS NOT NULL
                   AND RIGHT(c.microchip, 4) = $1
                   AND a.appointment_date = $2
                 ORDER BY a.created_at DESC
                 LIMIT 1`,
                [last4Chip, date]
              );

              let matchConfidence: number | null = null;
              let matchMethod: string | null = null;

              if (matchResult) {
                stats.filesMatched++;
                matchMethod = "chip_date";
                matchConfidence = 0.95;

                if (matchResult.client_name?.toLowerCase().includes(lastName.toLowerCase())) {
                  matchConfidence = 1.0;
                }
              }

              const waiver = await queryOne<{ waiver_id: string }>(
                `INSERT INTO ops.waiver_scans (
                   file_upload_id,
                   parsed_last_name, parsed_description, parsed_last4_chip, parsed_date,
                   matched_appointment_id, matched_cat_id, match_method, match_confidence,
                   ocr_status, review_status, enrichment_status
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', 'pending', 'pending')
                 ON CONFLICT (file_upload_id) DO NOTHING
                 RETURNING waiver_id`,
                [
                  uploadId,
                  lastName,
                  description,
                  last4Chip,
                  date,
                  matchResult?.appointment_id || null,
                  matchResult?.cat_id || null,
                  matchMethod,
                  matchConfidence,
                ]
              );
              waiverId = waiver?.waiver_id || null;
            } else {
              // File didn't parse — still create a waiver_scan record
              const waiver = await queryOne<{ waiver_id: string }>(
                `INSERT INTO ops.waiver_scans (file_upload_id, ocr_status, review_status, enrichment_status)
                 VALUES ($1, 'pending', 'pending', 'pending')
                 ON CONFLICT (file_upload_id) DO NOTHING
                 RETURNING waiver_id`,
                [uploadId]
              );
              waiverId = waiver?.waiver_id || null;
            }

            // Mark upload as completed
            await execute(
              `UPDATE ops.file_uploads SET status = 'completed' WHERE upload_id = $1`,
              [uploadId]
            );

            // Record synced file
            await execute(
              `INSERT INTO ops.sharepoint_synced_files (
                 drive_id, item_id, file_name, file_size,
                 sharepoint_modified_at, file_upload_id, waiver_scan_id
               ) VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (drive_id, item_id) DO NOTHING`,
              [
                SHAREPOINT_DRIVE_ID,
                pdfFile.id,
                pdfFile.name,
                pdfFile.size,
                pdfFile.lastModifiedDateTime,
                uploadId,
                waiverId,
              ]
            );

            folderSynced++;
          } catch (err) {
            log.push(`    ERROR processing ${pdfFile.name}: ${err instanceof Error ? err.message : String(err)}`);
            stats.errors++;
            folderFailed++;
          }
        }

        // Only update sync state if the folder was fully processed. If the
        // per-run budget interrupted mid-folder, leave the sync state alone
        // so the next cron tick re-lists the folder and picks up unsynced
        // files via the sharepoint_synced_files dedup check.
        if (folderFullyProcessed) {
          await execute(
            `INSERT INTO ops.sharepoint_sync_state (
               drive_id, folder_path, folder_item_id,
               last_synced_at, items_synced, items_skipped, items_failed
             ) VALUES ($1, $2, $3, now(), $4, $5, $6)
             ON CONFLICT (drive_id, folder_path) DO UPDATE SET
               last_synced_at = now(),
               items_synced = ops.sharepoint_sync_state.items_synced + $4,
               items_skipped = $5,
               items_failed = $6,
               updated_at = now()`,
            [
              SHAREPOINT_DRIVE_ID,
              folderPath,
              dayFolder.id,
              folderSynced,
              folderSkipped,
              folderFailed,
            ]
          );
          log.push(`    Done: ${folderSynced} synced, ${folderSkipped} skipped, ${folderFailed} failed`);
        } else {
          log.push(`    Partial: ${folderSynced} synced, ${folderSkipped} skipped, ${folderFailed} failed — sync state NOT updated`);
        }

        // If budget reached, stop scanning further folders
        if (stats.budgetReached) break;
      }
      if (stats.budgetReached) break;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log.push(`Completed in ${duration}s`);

    return apiSuccess({
      status: "ok",
      duration_s: parseFloat(duration),
      stats,
      log,
    });
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error("[SHAREPOINT-WAIVER-SYNC] Fatal error:", error);
    return apiServerError(
      `Sync failed after ${duration}s: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
