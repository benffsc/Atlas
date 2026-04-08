#!/usr/bin/env npx tsx
/**
 * Photo Upload Executor
 *
 * Reads a plan.json produced by photo-upload-plan.ts and uploads each
 * assigned file to the target cat via the same Supabase upload path
 * that the admin UI uses.
 *
 * Skips files that already exist in ops.request_media (by filename +
 * upload date) to make re-runs safe.
 *
 * Usage:
 *   set -a && source .env.production.local && set +a
 *   npx tsx scripts/photo-upload-execute.ts plan_2026-04-01.json
 */
export {};

import { queryOne } from "@/lib/db";
import { uploadFile, isStorageAvailable, getPublicUrl } from "@/lib/supabase";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

interface PlanEntry {
  line_number: number;
  entry_id: string;
  appointment_id: string | null;
  cat_id: string | null;
  cat_name: string | null;
  owner_name: string | null;
  parsed_owner_name: string | null;
  clinic_day_number_source: string | null;
  ambiguity_flag: string | null;
  assigned_files: string[];
}

interface Plan {
  date: string;
  folder: string;
  lines: PlanEntry[];
}

interface UploadResult {
  line_number: number;
  filename: string;
  cat_id: string | null;
  status: "uploaded" | "skipped_existing" | "unlinked" | "error";
  detail?: string;
}

const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
};

async function main() {
  const planPath = process.argv[2];
  if (!planPath) {
    console.error("Usage: photo-upload-execute.ts <plan.json>");
    process.exit(1);
  }
  if (!fs.existsSync(planPath)) {
    console.error(`Plan file not found: ${planPath}`);
    process.exit(1);
  }
  if (!isStorageAvailable()) {
    console.error("Supabase storage not configured. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const plan: Plan = JSON.parse(fs.readFileSync(planPath, "utf-8"));
  const { date, folder, lines } = plan;

  const totalFiles = lines.reduce((sum, l) => sum + l.assigned_files.length, 0);
  const linesWithCat = lines.filter(l => l.cat_id).length;
  console.log(`Plan: ${planPath}`);
  console.log(`Date: ${date}`);
  console.log(`Lines with cat_id: ${linesWithCat} / ${lines.length}`);
  console.log(`Files to upload: ${totalFiles}\n`);

  const results: UploadResult[] = [];
  let processed = 0;

  for (const line of lines) {
    if (line.assigned_files.length === 0) continue;

    for (const filename of line.assigned_files) {
      processed++;
      const fullPath = path.join(folder, filename);
      if (!fs.existsSync(fullPath)) {
        results.push({
          line_number: line.line_number,
          filename,
          cat_id: line.cat_id,
          status: "error",
          detail: "file not found on disk",
        });
        console.log(`[${processed}/${totalFiles}] ✗ ${filename} — file not found`);
        continue;
      }

      try {
        const buffer = fs.readFileSync(fullPath);
        const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
        const mimeType = MIME_TYPES[ext] || "image/jpeg";
        const hash = createHash("sha256").update(buffer).digest("hex");
        const shortHash = hash.substring(0, 8);

        // Idempotency: check if this file's hash is already in request_media
        const existing = await queryOne<{ media_id: string }>(
          `SELECT media_id FROM ops.request_media
           WHERE stored_filename LIKE '%' || $1 || '%'
             AND NOT is_archived
           LIMIT 1`,
          [shortHash]
        );
        if (existing) {
          results.push({
            line_number: line.line_number,
            filename,
            cat_id: line.cat_id,
            status: "skipped_existing",
            detail: `media_id=${existing.media_id}`,
          });
          console.log(`[${processed}/${totalFiles}] ⏭  ${filename} — already uploaded`);
          continue;
        }

        // Storage path mirrors the existing photos route convention
        const timestamp = Date.now();
        const storedFilename = `${date}_L${String(line.line_number).padStart(3, "0")}_${timestamp}_${shortHash}.${ext}`;
        const storagePath = `clinic-days/${date}/${storedFilename}`;

        const uploadResult = await uploadFile(storagePath, buffer, mimeType);
        if (!uploadResult.success) {
          results.push({
            line_number: line.line_number,
            filename,
            cat_id: line.cat_id,
            status: "error",
            detail: uploadResult.error || "upload failed",
          });
          console.log(`[${processed}/${totalFiles}] ✗ ${filename} — ${uploadResult.error}`);
          continue;
        }
        const publicUrl = uploadResult.url || getPublicUrl(storagePath);

        const noteParts = [
          `Clinic day ${date}`,
          `line ${line.line_number}`,
          line.owner_name || line.parsed_owner_name || "",
          line.cat_name || "",
          line.clinic_day_number_source === "legacy_v1" ? "[ground truth]" : "",
        ].filter(Boolean);
        const noteText = noteParts.join(" | ");

        if (line.cat_id) {
          const inserted = await queryOne<{ media_id: string }>(
            `INSERT INTO ops.request_media (
               cat_id, media_type, original_filename, stored_filename,
               file_size_bytes, mime_type, storage_provider, storage_path,
               cat_identification_confidence, uploaded_by, notes
             ) VALUES ($1, 'cat_photo', $2, $3, $4, $5, 'supabase', $6, 'confirmed', $7, $8)
             RETURNING media_id`,
            [line.cat_id, filename, storedFilename, buffer.length, mimeType, publicUrl, "bulk_script", noteText]
          );
          results.push({
            line_number: line.line_number,
            filename,
            cat_id: line.cat_id,
            status: "uploaded",
            detail: `media_id=${inserted?.media_id}`,
          });
          console.log(`[${processed}/${totalFiles}] ✓ ${filename} → line ${line.line_number} (${line.cat_name || line.owner_name || "?"})`);
        } else {
          // No cat_id — store unlinked with metadata
          const inserted = await queryOne<{ media_id: string }>(
            `INSERT INTO ops.request_media (
               media_type, original_filename, stored_filename,
               file_size_bytes, mime_type, storage_provider, storage_path,
               cat_identification_confidence, uploaded_by, notes
             ) VALUES ('cat_photo', $1, $2, $3, $4, 'supabase', $5, 'unidentified', $6, $7)
             RETURNING media_id`,
            [filename, storedFilename, buffer.length, mimeType, publicUrl, "bulk_script", noteText]
          );
          results.push({
            line_number: line.line_number,
            filename,
            cat_id: null,
            status: "unlinked",
            detail: `media_id=${inserted?.media_id}`,
          });
          console.log(`[${processed}/${totalFiles}] ⚠ ${filename} → line ${line.line_number} (UNLINKED — no cat_id)`);
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        results.push({
          line_number: line.line_number,
          filename,
          cat_id: line.cat_id,
          status: "error",
          detail,
        });
        console.log(`[${processed}/${totalFiles}] ✗ ${filename} — ${detail}`);
      }
    }
  }

  // Summary
  console.log(`\n── Summary ──`);
  const byStatus: Record<string, number> = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  for (const [status, count] of Object.entries(byStatus)) {
    console.log(`  ${status}: ${count}`);
  }

  const errors = results.filter(r => r.status === "error");
  if (errors.length > 0) {
    console.log(`\n── Errors (${errors.length}) ──`);
    errors.slice(0, 20).forEach(e => console.log(`  ✗ L${e.line_number} ${e.filename}: ${e.detail}`));
  }

  // Write result log
  const resultPath = planPath.replace(/\.json$/, "") + ".results.json";
  fs.writeFileSync(resultPath, JSON.stringify({ date, folder, results }, null, 2));
  console.log(`\nResults logged to: ${resultPath}`);

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Crashed:", err);
  process.exit(1);
});
