#!/usr/bin/env npx tsx
/**
 * Evidence Ingest — Photos
 *
 * Stages a folder of clinic day photos into Beacon's evidence pool with
 * sequence preserved. No matching, no AI, no cat_id assignment. Just
 * uploads to Supabase + inserts ops.request_media (unassigned) +
 * ops.evidence_stream_segments (pending).
 *
 * CDS-AI (FFS-1089 → FFS-1090) does the reasoning afterward.
 *
 * Default is --dry-run. Pass --apply to actually write.
 *
 * Usage:
 *   set -a && source .env.production.local && set +a
 *   npx tsx scripts/evidence-ingest-photos.ts "/path/to/folder" 2026-04-01
 *   npx tsx scripts/evidence-ingest-photos.ts "/path/to/folder" 2026-04-01 --apply
 *
 * Linear: FFS-1198
 */
export {};

import { queryOne, queryRows } from "@/lib/db";
import { uploadFile, isStorageAvailable, getPublicUrl } from "@/lib/supabase";
import { createHash, randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import exifr from "exifr";

// ── Types ────────────────────────────────────────────────────

interface FileEntry {
  filename: string;
  fullPath: string;
  sequenceNumber: number;
  hash: string;
  shortHash: string;
  fileSize: number;
  mimeType: string;
  ext: string;
  exifTakenAt: Date | null;
}

interface IngestResult {
  filename: string;
  sequenceNumber: number;
  status: "ingested" | "skipped_existing" | "error";
  mediaId?: string;
  detail?: string;
}

// ── Constants ────────────────────────────────────────────────

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

const IMAGE_PATTERN = /\.(jpe?g|png|heic|heif|webp|tiff?)$/i;

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.filter((a) => !a.startsWith("--"));
  const [folderArg, dateArg] = positional;

  if (!folderArg || !dateArg) {
    console.error("Usage: evidence-ingest-photos.ts <folder> <YYYY-MM-DD> [--apply]");
    process.exit(1);
  }

  const folder = path.resolve(folderArg);
  const date = dateArg;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("Invalid date format — use YYYY-MM-DD");
    process.exit(1);
  }

  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    console.error(`Not a directory: ${folder}`);
    process.exit(1);
  }

  if (apply && !isStorageAvailable()) {
    console.error("Supabase storage not configured. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const mode = apply ? "APPLY" : "DRY RUN";
  console.log(`Mode:   ${mode}`);
  console.log(`Folder: ${folder}`);
  console.log(`Date:   ${date}\n`);

  // ── Step 1: List files with numeric sort ──────────────────

  const filenames = fs.readdirSync(folder)
    .filter((f) => IMAGE_PATTERN.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (filenames.length === 0) {
    console.error("No image files found in folder.");
    process.exit(1);
  }

  console.log(`Files:  ${filenames.length}`);

  // ── Step 2: Read each file + compute hash + EXIF ──────────

  const entries: FileEntry[] = [];
  let exifReadErrors = 0;

  for (let i = 0; i < filenames.length; i++) {
    const filename = filenames[i];
    const fullPath = path.join(folder, filename);
    const buffer = fs.readFileSync(fullPath);
    const hash = createHash("sha256").update(buffer).digest("hex");
    const ext = filename.split(".").pop()?.toLowerCase() || "jpg";

    let exifTakenAt: Date | null = null;
    try {
      const exif = await exifr.parse(buffer, { pick: ["DateTimeOriginal", "CreateDate"] });
      if (exif?.DateTimeOriginal) {
        exifTakenAt = new Date(exif.DateTimeOriginal);
      } else if (exif?.CreateDate) {
        exifTakenAt = new Date(exif.CreateDate);
      }
    } catch {
      exifReadErrors++;
    }

    entries.push({
      filename,
      fullPath,
      sequenceNumber: 0, // will be set after EXIF sort
      hash,
      shortHash: hash.substring(0, 8),
      fileSize: buffer.length,
      mimeType: MIME_TYPES[ext] || "image/jpeg",
      ext,
      exifTakenAt,
    });
  }

  if (exifReadErrors > 0) {
    console.log(`EXIF:   ${exifReadErrors} files had no readable EXIF (HEIC or stripped)\n`);
  }

  // ── Step 3: Sort by EXIF timestamp (ground truth), filename as tiebreaker ──
  //
  // EXIF DateTimeOriginal is the true capture order. Filename numeric sort
  // is only a proxy that breaks when photos come from multiple sequences
  // (different phones, re-saved photos, burst continuations).
  //
  // Files without EXIF are placed at the end of the stream (safest default —
  // they get caught by the review queue rather than polluting the sequence).

  const withExif = entries.filter((e) => e.exifTakenAt);
  const withoutExif = entries.filter((e) => !e.exifTakenAt);

  // Sort by EXIF time, then filename as tiebreaker for same-second photos
  withExif.sort((a, b) => {
    const timeDiff = a.exifTakenAt!.getTime() - b.exifTakenAt!.getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.filename.localeCompare(b.filename, undefined, { numeric: true });
  });

  // Files without EXIF go at end, sorted by filename
  withoutExif.sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));

  // Merge and assign final sequence numbers
  const sorted = [...withExif, ...withoutExif];
  for (let i = 0; i < sorted.length; i++) {
    sorted[i].sequenceNumber = i + 1;
  }

  // Check if filename order differed from EXIF order
  const filenameOrder = [...entries].sort((a, b) =>
    a.filename.localeCompare(b.filename, undefined, { numeric: true })
  );
  let reordered = false;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].filename !== filenameOrder[i]?.filename) {
      reordered = true;
      break;
    }
  }

  if (reordered) {
    console.log(
      `\nNOTE: EXIF sort differs from filename sort — using EXIF temporal order.`
    );
    console.log(
      `  This is normal when photos come from multiple camera sequences.`
    );
  }

  // Replace entries array with sorted version
  entries.length = 0;
  entries.push(...sorted);

  const exifCoverage = withExif.length;
  console.log(
    `EXIF:   ${exifCoverage} of ${entries.length} files have EXIF timestamps${reordered ? " (reordered)" : ""}`
  );
  if (withoutExif.length > 0) {
    console.log(
      `        ${withoutExif.length} files without EXIF placed at end of sequence`
    );
  }

  // ── Step 4: Check idempotency (hash-based dedup) ──────────

  let dedupHits = 0;
  for (const entry of entries) {
    const existing = await queryOne<{ media_id: string }>(
      `SELECT media_id FROM ops.request_media
       WHERE stored_filename LIKE '%' || $1 || '%'
         AND NOT is_archived
       LIMIT 1`,
      [entry.shortHash]
    );
    if (existing) {
      dedupHits++;
      (entry as any)._existingMediaId = existing.media_id;
    }
  }

  console.log(`Dedup:  ${dedupHits} files already in request_media\n`);

  // ── Dry-run summary ───────────────────────────────────────

  if (!apply) {
    console.log("── DRY RUN SUMMARY ──\n");
    console.log(`Would ingest: ${entries.length - dedupHits} files`);
    console.log(`Would skip:   ${dedupHits} files (existing)\n`);

    const preview = entries.slice(0, 5);
    console.log("First 5 files:");
    preview.forEach((e) => {
      const exif = e.exifTakenAt ? e.exifTakenAt.toISOString() : "no EXIF";
      const status = (e as any)._existingMediaId ? "SKIP" : "NEW";
      console.log(`  [${status}] seq=${e.sequenceNumber} ${e.filename} (${exif})`);
    });

    if (entries.length > 5) {
      const last5 = entries.slice(-5);
      console.log(`\nLast 5 files:`);
      last5.forEach((e) => {
        const exif = e.exifTakenAt ? e.exifTakenAt.toISOString() : "no EXIF";
        const status = (e as any)._existingMediaId ? "SKIP" : "NEW";
        console.log(`  [${status}] seq=${e.sequenceNumber} ${e.filename} (${exif})`);
      });
    }

    console.log(`\nTo apply: npx tsx scripts/evidence-ingest-photos.ts "${folderArg}" ${date} --apply`);
    process.exit(0);
  }

  // ── Step 5: Apply — upload + insert ───────────────────────

  const batchId = randomUUID();
  console.log(`Batch:  ${batchId}\n`);

  const results: IngestResult[] = [];
  let ingested = 0;
  let skipped = 0;
  let errors = 0;

  for (const entry of entries) {
    // Dedup check
    if ((entry as any)._existingMediaId) {
      results.push({
        filename: entry.filename,
        sequenceNumber: entry.sequenceNumber,
        status: "skipped_existing",
        mediaId: (entry as any)._existingMediaId,
        detail: "hash already in request_media",
      });
      skipped++;
      console.log(`[${entry.sequenceNumber}/${entries.length}] ⏭  ${entry.filename} — already exists`);
      continue;
    }

    try {
      // Upload to Supabase
      const buffer = fs.readFileSync(entry.fullPath);
      const storedFilename = `${date}_seq${String(entry.sequenceNumber).padStart(4, "0")}_${entry.shortHash}.${entry.ext}`;
      const storagePath = `clinic-days/${date}/staging/${storedFilename}`;

      const uploadResult = await uploadFile(storagePath, buffer, entry.mimeType);
      if (!uploadResult.success) {
        results.push({
          filename: entry.filename,
          sequenceNumber: entry.sequenceNumber,
          status: "error",
          detail: uploadResult.error || "upload failed",
        });
        errors++;
        console.log(`[${entry.sequenceNumber}/${entries.length}] ✗ ${entry.filename} — ${uploadResult.error}`);
        continue;
      }
      const publicUrl = uploadResult.url || getPublicUrl(storagePath);

      // Build notes JSON with metadata
      const notesJson = JSON.stringify({
        clinic_date: date,
        ingest_batch_id: batchId,
        sequence_number: entry.sequenceNumber,
        exif_taken_at: entry.exifTakenAt?.toISOString() || null,
        original_folder: folder,
        file_hash: entry.hash,
      });

      // Insert request_media row (cat_id = NULL, unassigned)
      const mediaRow = await queryOne<{ media_id: string }>(
        `INSERT INTO ops.request_media (
           media_type, original_filename, stored_filename,
           file_size_bytes, mime_type, storage_provider, storage_path,
           cat_identification_confidence, uploaded_by, notes
         ) VALUES (
           'cat_photo', $1, $2, $3, $4, 'supabase', $5,
           'unidentified', 'evidence_ingest', $6
         )
         RETURNING media_id`,
        [entry.filename, storedFilename, entry.fileSize, entry.mimeType, publicUrl, notesJson]
      );

      if (!mediaRow) {
        results.push({
          filename: entry.filename,
          sequenceNumber: entry.sequenceNumber,
          status: "error",
          detail: "request_media INSERT returned NULL",
        });
        errors++;
        continue;
      }

      // Insert evidence_stream_segments row
      await queryOne(
        `INSERT INTO ops.evidence_stream_segments (
           ingest_batch_id, clinic_date, source_kind, source_ref_id,
           sequence_number, assignment_status
         ) VALUES ($1, $2::DATE, 'request_media', $3, $4, 'pending')`,
        [batchId, date, mediaRow.media_id, entry.sequenceNumber]
      );

      results.push({
        filename: entry.filename,
        sequenceNumber: entry.sequenceNumber,
        status: "ingested",
        mediaId: mediaRow.media_id,
      });
      ingested++;
      console.log(`[${entry.sequenceNumber}/${entries.length}] ✓ ${entry.filename} → seq ${entry.sequenceNumber}`);

    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      results.push({
        filename: entry.filename,
        sequenceNumber: entry.sequenceNumber,
        status: "error",
        detail,
      });
      errors++;
      console.log(`[${entry.sequenceNumber}/${entries.length}] ✗ ${entry.filename} — ${detail}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────

  console.log(`\n── Summary ──`);
  console.log(`  Batch:    ${batchId}`);
  console.log(`  Date:     ${date}`);
  console.log(`  Ingested: ${ingested}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Errors:   ${errors}`);

  // Verify contiguous sequence
  const seqCheck = await queryOne<{ min_seq: number; max_seq: number; count: number }>(
    `SELECT
       MIN(sequence_number) AS min_seq,
       MAX(sequence_number) AS max_seq,
       COUNT(*)::INT AS count
     FROM ops.evidence_stream_segments
     WHERE ingest_batch_id = $1`,
    [batchId]
  );

  if (seqCheck && seqCheck.count > 0) {
    const contiguous = seqCheck.max_seq - seqCheck.min_seq + 1 === seqCheck.count;
    console.log(`  Sequence: ${seqCheck.min_seq}..${seqCheck.max_seq} (${contiguous ? "contiguous" : "GAPS DETECTED"})`);
  }

  console.log(`\n  ops.request_media:            ${ingested} new rows`);
  console.log(`  ops.evidence_stream_segments: ${ingested} new rows`);

  if (errors > 0) {
    console.log(`\n── Errors (${errors}) ──`);
    results.filter((r) => r.status === "error").slice(0, 20).forEach((r) => {
      console.log(`  ✗ seq ${r.sequenceNumber} ${r.filename}: ${r.detail}`);
    });
  }

  // Write results log
  const resultPath = `/tmp/evidence-ingest_${date}.results.json`;
  fs.writeFileSync(resultPath, JSON.stringify({ date, folder, batchId, results }, null, 2));
  console.log(`\nResults: ${resultPath}`);

  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Crashed:", err);
  process.exit(1);
});
