import { NextRequest } from "next/server";
import { queryOne, execute } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/api-response";
import {
  validateSharePointConfig,
  listFolderChildren,
  downloadFile,
} from "@/lib/sharepoint";
import { parseMasterListFilename } from "@/lib/master-list-parser";
import { ingestMasterListWorkbook } from "@/lib/master-list-ingest";
import * as xlsx from "xlsx";
import { createHash } from "crypto";

/**
 * SharePoint Master List Auto-Sync Cron — FFS-1088
 *
 * Discovers Master List Excel files in SharePoint and ingests them via the
 * shared lib/master-list-ingest.ts pipeline. After import, CDS Phase 2
 * (waiver bridge) becomes useful for these dates because the synced waivers
 * (FFS-1110) finally have something to match against.
 *
 * Folder layout:
 *   Spay Neuter Clinics/
 *     Master Numbered Forms/
 *       2026 Completed Master List/
 *         Master List January 5, 2026.xlsx
 *         Master List February 11, 2026.xlsx
 *         Master List April 1, 2026.xlsx
 *         Master List Template April 8, 2026.xlsx   ← skipped
 *
 * Vercel Cron: "15 [slash]/6 * * *" — every 6 hours, offset from waiver sync.
 * (The literal cron string is `15` followed by space-slash-6 — see vercel.json)
 *
 * Per-run budget: 30 files. Each file takes ~5-15s (parse + insert + CDS run),
 * so 30 files ≈ 150-450s. Stays well under Vercel's 300s maxDuration.
 *
 * Idempotency:
 *   - File-level: ops.sharepoint_synced_files dedup by item_id
 *   - Date-level: ingestMasterListWorkbook returns 'skipped_existing' if
 *     ops.clinic_day_entries already populated for that date
 *
 * Created: 2026-04-07
 */

export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;
const SHAREPOINT_DRIVE_ID = (process.env.SHAREPOINT_DRIVE_ID || "").trim();

// Per-run budget. Each master list ingest holds the workbook in memory plus
// the entry transaction. xlsx workbook objects don't release memory between
// iterations even with explicit reassignment. Vercel killed earlier runs at
// budget=30 (with CDS) and budget=10 (without CDS, partial). At 5 we get
// reliable completion. Throughput: 5 files × 4 runs/day = 20/day max,
// enough to drain a 35-file backlog in 2 days.
const MAX_FILES_PER_RUN = 5;

// Build list of folders to scan for master list files.
// Staff drop new files in the parent "Master Numbered Forms" folder before
// they get sorted into year subfolders. Scan parent first (newest files),
// then current + previous year subfolders for any we missed.
function getMasterListFolders(): string[] {
  const currentYear = new Date().getFullYear();
  return [
    `Spay Neuter Clinics/Master Numbered Forms`,
    `Spay Neuter Clinics/Master Numbered Forms/${currentYear} Completed Master List`,
    `Spay Neuter Clinics/Master Numbered Forms/${currentYear - 1} Completed Master List`,
  ];
}

interface SyncStats {
  foldersScanned: number;
  filesDiscovered: number;
  filesSkippedTemplate: number;
  filesSkippedNonMaster: number;
  filesAlreadySynced: number;
  filesProcessed: number;
  imported: number;
  skippedExisting: number;
  errors: number;
  budgetReached: boolean;
}

interface FileResult {
  filename: string;
  date: string | null;
  status: "imported" | "skipped_existing" | "skipped_template" | "already_synced" | "error";
  detail?: string;
  imported_count?: number;
  matched_after?: number;
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  // Auth
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  const config = validateSharePointConfig();
  if (!config.valid) {
    return apiError(`Missing env vars: ${config.missing.join(", ")}`, 500);
  }
  if (!SHAREPOINT_DRIVE_ID) {
    return apiError("Missing SHAREPOINT_DRIVE_ID env var", 500);
  }

  const stats: SyncStats = {
    foldersScanned: 0,
    filesDiscovered: 0,
    filesSkippedTemplate: 0,
    filesSkippedNonMaster: 0,
    filesAlreadySynced: 0,
    filesProcessed: 0,
    imported: 0,
    skippedExisting: 0,
    errors: 0,
    budgetReached: false,
  };

  const log: string[] = [];
  const fileResults: FileResult[] = [];

  try {
    const folders = getMasterListFolders();
    log.push(`Scanning ${folders.length} master list folders`);

    for (const folderPath of folders) {
      log.push(`\nScanning: ${folderPath}`);

      let items;
      try {
        items = await listFolderChildren(SHAREPOINT_DRIVE_ID, folderPath);
      } catch (err) {
        log.push(`  SKIP: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      stats.foldersScanned++;
      log.push(`  ${items.length} items in folder`);

      // Filter to .xlsx files (skip non-Excel and folders)
      const xlsxFiles = items.filter(
        (f) => !f.isFolder && /\.xlsx?$/i.test(f.name)
      );

      // Sort by filename so latest dates process last (more useful for CDS demo)
      xlsxFiles.sort((a, b) => a.name.localeCompare(b.name));

      stats.filesDiscovered += xlsxFiles.length;

      for (const file of xlsxFiles) {
        if (stats.filesProcessed >= MAX_FILES_PER_RUN) {
          stats.budgetReached = true;
          log.push(`  Budget reached (${MAX_FILES_PER_RUN} files). Remaining will sync next tick.`);
          break;
        }

        // Parse filename → date
        const parsed = parseMasterListFilename(file.name);
        if (!parsed) {
          stats.filesSkippedNonMaster++;
          log.push(`  SKIP non-master: ${file.name}`);
          fileResults.push({ filename: file.name, date: null, status: "error", detail: "filename did not parse as master list" });
          continue;
        }

        // Only skip true templates (no date extracted). Staff sometimes name
        // real files "Template" (e.g., "Master List Template April 8, 2026.xlsx").
        // If a date was successfully parsed, treat it as real data.
        if (parsed.isTemplate && !parsed.date) {
          stats.filesSkippedTemplate++;
          log.push(`  SKIP template: ${file.name}`);
          fileResults.push({ filename: file.name, date: parsed.date, status: "skipped_template" });
          continue;
        }

        // Check sharepoint_synced_files dedup
        const alreadySynced = await queryOne<{ synced_file_id: string }>(
          `SELECT synced_file_id FROM ops.sharepoint_synced_files
           WHERE drive_id = $1 AND item_id = $2`,
          [SHAREPOINT_DRIVE_ID, file.id]
        );

        if (alreadySynced) {
          stats.filesAlreadySynced++;
          fileResults.push({ filename: file.name, date: parsed.date, status: "already_synced" });
          continue;
        }

        // Download + ingest
        try {
          stats.filesProcessed++;
          log.push(`  Processing: ${file.name} (${parsed.date})`);

          const content = await downloadFile(SHAREPOINT_DRIVE_ID, file.id);
          const fileHash = createHash("sha256").update(content).digest("hex");

          // Create file_uploads row (mirrors waiver sync convention)
          const ts = new Date().toISOString().replace(/[:.]/g, "-");
          const storedFilename = `master_list_sharepoint_${ts}_${fileHash.slice(0, 8)}.xlsx`;

          // Plain INSERT — dedup is handled at the sharepoint_synced_files
          // layer (item_id check above), so we never reach here for a file
          // we've already processed. file_hash isn't unique on this table.
          const uploadRow = await queryOne<{ upload_id: string }>(
            `INSERT INTO ops.file_uploads (
               source_system, source_table, original_filename, stored_filename,
               file_content, file_size_bytes, file_hash, status, rows_total
             ) VALUES ('master_list', 'sharepoint_master_list', $1, $2, $3, $4, $5, 'pending', 0)
             RETURNING upload_id`,
            [file.name, storedFilename, content, content.length, fileHash]
          );

          // Parse + ingest via shared lib.
          // skipCDS: true — running CDS in the cron caused OOM (CDS loads
          // appointments + waivers + clinic_day_entries per date).
          //
          // sheetRows: 200 — caps the xlsx workbook at the first 200 rows
          // at READ time. Some master list files (observed: March 11, 2026)
          // have phantom cells beyond the visible data range that make the
          // xlsx library iterate millions of empty rows and OOM the process.
          // Real data is always < 60 rows so 200 is safe headroom.
          const workbook = xlsx.read(content, { type: "buffer", sheetRows: 200 });
          const result = await ingestMasterListWorkbook(workbook, {
            dateOverride: parsed.date,
            enteredBy: null, // cron-driven, no staff session
            sourceSystem: "master_list_sharepoint_sync",
            skipIfExists: true,
            skipCDS: true,
          });

          // Mark file_uploads completed
          if (uploadRow?.upload_id) {
            await execute(
              `UPDATE ops.file_uploads
                 SET status = 'completed',
                     processed_at = NOW(),
                     rows_total = $2,
                     rows_inserted = $3
               WHERE upload_id = $1`,
              [uploadRow.upload_id, result.parsed_entries || 0, result.imported || 0]
            );
          }

          // Track in sharepoint_synced_files
          await execute(
            `INSERT INTO ops.sharepoint_synced_files (
               drive_id, item_id, file_name, file_size,
               sharepoint_modified_at, file_upload_id
             ) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (drive_id, item_id) DO NOTHING`,
            [
              SHAREPOINT_DRIVE_ID,
              file.id,
              file.name,
              content.length,
              file.lastModifiedDateTime,
              uploadRow?.upload_id,
            ]
          );

          if (result.status === "ok") {
            stats.imported++;
            fileResults.push({
              filename: file.name,
              date: parsed.date,
              status: "imported",
              imported_count: result.imported,
              matched_after: result.matched_after,
            });
            log.push(`    OK: ${result.imported} entries, CDS matched ${result.matched_after} of ${result.imported}`);
          } else if (result.status === "skipped_existing") {
            stats.skippedExisting++;
            fileResults.push({
              filename: file.name,
              date: parsed.date,
              status: "skipped_existing",
              detail: result.message,
            });
            log.push(`    Skipped: ${result.message}`);
          } else {
            stats.errors++;
            fileResults.push({
              filename: file.name,
              date: parsed.date,
              status: "error",
              detail: result.message || result.status,
            });
            log.push(`    ERROR: ${result.status} — ${result.message || ""}`);
          }
        } catch (err) {
          stats.errors++;
          const msg = err instanceof Error ? err.message : String(err);
          fileResults.push({
            filename: file.name,
            date: parsed.date,
            status: "error",
            detail: msg,
          });
          log.push(`    EXCEPTION: ${msg}`);
        }
      }

      if (stats.budgetReached) break;
    }

    return apiSuccess({
      status: "ok",
      duration_s: ((Date.now() - startTime) / 1000).toFixed(1),
      stats,
      results: fileResults,
      log,
    });
  } catch (err) {
    console.error("[cron/sharepoint-master-list-sync] error:", err);
    return apiError(
      err instanceof Error ? err.message : "Cron failed",
      500
    );
  }
}
