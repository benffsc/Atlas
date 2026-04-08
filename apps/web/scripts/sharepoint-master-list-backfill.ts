#!/usr/bin/env npx tsx
/**
 * One-shot SharePoint master list backfill — run locally to catch up
 * the historical files that the Vercel cron can't ship in one budget.
 *
 * Usage (from apps/web/):
 *   set -a && source .env.production.local && set +a
 *   npx tsx scripts/sharepoint-master-list-backfill.ts
 *
 * Uses the same lib/master-list-ingest.ts code as the production cron,
 * so behavior is identical. No Vercel function memory/time limits apply.
 *
 * Idempotent: skips files already in ops.sharepoint_synced_files and dates
 * already populated in ops.clinic_day_entries.
 */
export {};

import { queryOne, execute } from "@/lib/db";
import {
  validateSharePointConfig,
  listFolderChildren,
  downloadFile,
} from "@/lib/sharepoint";
import { parseMasterListFilename } from "@/lib/master-list-parser";
import { ingestMasterListWorkbook } from "@/lib/master-list-ingest";
import * as xlsx from "xlsx";
import { createHash } from "crypto";

const SHAREPOINT_DRIVE_ID = (process.env.SHAREPOINT_DRIVE_ID || "").trim();

async function main() {
  const cfg = validateSharePointConfig();
  if (!cfg.valid) {
    console.error("Missing env vars:", cfg.missing.join(", "));
    process.exit(1);
  }
  if (!SHAREPOINT_DRIVE_ID) {
    console.error("Missing SHAREPOINT_DRIVE_ID");
    process.exit(1);
  }

  const currentYear = new Date().getFullYear();
  const folders = [
    `Spay Neuter Clinics/Master Numbered Forms/${currentYear} Completed Master List`,
    `Spay Neuter Clinics/Master Numbered Forms/${currentYear - 1} Completed Master List`,
  ];

  const stats = {
    folders_scanned: 0,
    files_discovered: 0,
    skipped_template: 0,
    skipped_non_master: 0,
    skipped_already_synced: 0,
    skipped_existing: 0,
    imported: 0,
    errors: 0,
  };

  for (const folderPath of folders) {
    console.log(`\n── ${folderPath} ──`);
    let items;
    try {
      items = await listFolderChildren(SHAREPOINT_DRIVE_ID, folderPath);
    } catch (err) {
      console.log(`  SKIP: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    stats.folders_scanned++;

    const xlsxFiles = items.filter(
      (f) => !f.isFolder && /\.xlsx?$/i.test(f.name)
    );
    xlsxFiles.sort((a, b) => a.name.localeCompare(b.name));
    stats.files_discovered += xlsxFiles.length;
    console.log(`  ${xlsxFiles.length} .xlsx files`);

    for (const file of xlsxFiles) {
      const parsed = parseMasterListFilename(file.name);
      if (!parsed) {
        stats.skipped_non_master++;
        console.log(`  SKIP non-master: ${file.name}`);
        continue;
      }
      if (parsed.isTemplate) {
        stats.skipped_template++;
        console.log(`  SKIP template: ${file.name}`);
        continue;
      }

      // Dedup check
      const alreadySynced = await queryOne<{ synced_file_id: string }>(
        `SELECT synced_file_id FROM ops.sharepoint_synced_files
         WHERE drive_id = $1 AND item_id = $2`,
        [SHAREPOINT_DRIVE_ID, file.id]
      );
      if (alreadySynced) {
        stats.skipped_already_synced++;
        continue;
      }

      console.log(`  Processing: ${file.name} (${parsed.date})`);
      try {
        const content = await downloadFile(SHAREPOINT_DRIVE_ID, file.id);
        const fileHash = createHash("sha256").update(content).digest("hex");

        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const storedFilename = `master_list_local_backfill_${ts}_${fileHash.slice(0, 8)}.xlsx`;

        const uploadRow = await queryOne<{ upload_id: string }>(
          `INSERT INTO ops.file_uploads (
             source_system, source_table, original_filename, stored_filename,
             file_content, file_size_bytes, file_hash, status, rows_total
           ) VALUES ('master_list', 'sharepoint_master_list', $1, $2, $3, $4, $5, 'pending', 0)
           RETURNING upload_id`,
          [file.name, storedFilename, content, content.length, fileHash]
        );

        const workbook = xlsx.read(content, { type: "buffer", sheetRows: 200 });
        const result = await ingestMasterListWorkbook(workbook, {
          dateOverride: parsed.date,
          enteredBy: null,
          sourceSystem: "master_list_sharepoint_sync",
          skipIfExists: true,
          skipCDS: true,
        });

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

        await execute(
          `INSERT INTO ops.sharepoint_synced_files (
             drive_id, item_id, file_name, file_size,
             sharepoint_modified_at, file_upload_id
           ) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (drive_id, item_id) DO NOTHING`,
          [SHAREPOINT_DRIVE_ID, file.id, file.name, content.length, file.lastModifiedDateTime, uploadRow?.upload_id]
        );

        if (result.status === "ok") {
          stats.imported++;
          console.log(`    ✓ ${result.imported} entries`);
        } else if (result.status === "skipped_existing") {
          stats.skipped_existing++;
          console.log(`    Skipped: ${result.message}`);
        } else {
          stats.errors++;
          console.log(`    ERROR: ${result.status} — ${result.message}`);
        }
      } catch (err) {
        stats.errors++;
        console.log(`    EXCEPTION: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  console.log("\n=== Summary ===");
  console.log(stats);
  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Crashed:", err);
  process.exit(2);
});
