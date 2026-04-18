#!/usr/bin/env npx ts-node
/**
 * Backlog Clinic Photo Ingest
 *
 * Reads local photo folders from /Users/benmisdiaz/Desktop/Clinic photos/,
 * uploads to Supabase storage, creates request_media + evidence_stream_segments
 * rows, then optionally runs CDS-AI classification.
 *
 * Folder naming conventions:
 *   - "147_0317" → clinic day 147, date 2026-03-17
 *   - "04:01:26" → date 2026-04-01
 *   - "04:06:2026" → date 2026-04-06
 *
 * Usage (run from apps/web/ so deps resolve):
 *   cd apps/web && source ../../.env && npx ts-node ../../scripts/ingest-clinic-photos.ts [--dry-run] [--classify] [--folder 147_0317]
 *
 * Requires: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * For --classify: ANTHROPIC_API_KEY
 *
 * Linear: FFS-1197
 */

import * as fs from "fs";
import * as path from "path";
import { createHash, randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import exifr from "exifr";

// ── Config ─────────────────────────────────────────────────

const PHOTOS_ROOT = "/Users/benmisdiaz/Desktop/Clinic photos";
const MEDIA_BUCKET = "request-media";

const CAMERA_OFFSETS: Record<string, number> = {
  "Canon PowerShot G7 X Mark III": -86400000, // Clock +1 day
};

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".heic": "image/heic",
  ".webp": "image/webp",
};

// ── Args ───────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const CLASSIFY = args.includes("--classify");
const folderIdx = args.indexOf("--folder");
const SINGLE_FOLDER = folderIdx >= 0 ? args[folderIdx + 1] : null;

// ── DB + Storage ───────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
  max: 5,
});

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

// ── Folder → Date parsing ──────────────────────────────────

function parseFolderDate(folderName: string): { date: string; clinicDayNum: number | null } | null {
  // Pattern 1: "147_0317" → clinic day 147, date 2026-03-17
  const numMatch = folderName.match(/^(\d+)_(\d{2})(\d{2})$/);
  if (numMatch) {
    const clinicDayNum = parseInt(numMatch[1], 10);
    const month = numMatch[2];
    const day = numMatch[3];
    return { date: `2026-${month}-${day}`, clinicDayNum };
  }

  // Pattern 2: "04:01:26" → 2026-04-01
  const colonShort = folderName.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (colonShort) {
    const year = 2000 + parseInt(colonShort[3], 10);
    return { date: `${year}-${colonShort[1]}-${colonShort[2]}`, clinicDayNum: null };
  }

  // Pattern 3: "04:06:2026" → 2026-04-06
  const colonLong = folderName.match(/^(\d{2}):(\d{2}):(\d{4})$/);
  if (colonLong) {
    return { date: `${colonLong[3]}-${colonLong[1]}-${colonLong[2]}`, clinicDayNum: null };
  }

  return null;
}

// ── EXIF extraction ────────────────────────────────────────

interface PhotoMeta {
  filePath: string;
  fileName: string;
  exifTakenAt: string | null;
  adjustedTakenAt: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  offsetMs: number;
  fileSize: number;
}

async function extractPhotoMeta(filePath: string): Promise<PhotoMeta> {
  const stat = fs.statSync(filePath);
  let exifTakenAt: string | null = null;
  let cameraMake: string | null = null;
  let cameraModel: string | null = null;

  try {
    const buffer = fs.readFileSync(filePath);
    const exif = await exifr.parse(buffer, {
      pick: ["DateTimeOriginal", "CreateDate", "Make", "Model"],
    });
    if (exif?.DateTimeOriginal) {
      exifTakenAt = new Date(exif.DateTimeOriginal).toISOString();
    } else if (exif?.CreateDate) {
      exifTakenAt = new Date(exif.CreateDate).toISOString();
    }
    cameraMake = exif?.Make || null;
    cameraModel = exif?.Model || null;
  } catch {
    // EXIF not critical
  }

  const key = cameraModel || "";
  const offsetMs = CAMERA_OFFSETS[key] || 0;
  const adjustedTakenAt = exifTakenAt && offsetMs
    ? new Date(new Date(exifTakenAt).getTime() + offsetMs).toISOString()
    : exifTakenAt;

  return {
    filePath,
    fileName: path.basename(filePath),
    exifTakenAt,
    adjustedTakenAt,
    cameraMake,
    cameraModel,
    offsetMs,
    fileSize: stat.size,
  };
}

// ── Ingest one folder ──────────────────────────────────────

async function ingestFolder(folderPath: string, clinicDate: string) {
  const folderName = path.basename(folderPath);
  const imageFiles = fs.readdirSync(folderPath)
    .filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return MIME_MAP[ext] !== undefined;
    })
    .map((f) => path.join(folderPath, f));

  console.log(`\n=== ${folderName} → ${clinicDate} (${imageFiles.length} photos) ===`);

  if (imageFiles.length === 0) {
    console.log("  No image files found — skipping");
    return { uploaded: 0, skipped: 0, errors: 0 };
  }

  // Extract EXIF for all photos
  console.log("  Reading EXIF...");
  const metas: PhotoMeta[] = [];
  for (const fp of imageFiles) {
    const meta = await extractPhotoMeta(fp);
    metas.push(meta);
  }

  // Sort by adjusted EXIF time, then filename
  const withExif = metas.filter((m) => m.adjustedTakenAt);
  const withoutExif = metas.filter((m) => !m.adjustedTakenAt);

  withExif.sort((a, b) => {
    const diff = new Date(a.adjustedTakenAt!).getTime() - new Date(b.adjustedTakenAt!).getTime();
    return diff !== 0 ? diff : a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
  });
  withoutExif.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));

  const sorted = [...withExif, ...withoutExif];

  // Camera breakdown
  const cameras = new Map<string, number>();
  for (const m of sorted) {
    const label = m.cameraModel || "Unknown";
    cameras.set(label, (cameras.get(label) || 0) + 1);
  }
  const offsetApplied = sorted.some((m) => m.offsetMs !== 0);
  const cameraLabels: string[] = [];
  cameras.forEach((v, k) => cameraLabels.push(`${k}: ${v}`));
  console.log(`  Cameras: ${cameraLabels.join(", ")}${offsetApplied ? " (clock offset applied)" : ""}`);

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would upload ${sorted.length} photos`);
    return { uploaded: sorted.length, skipped: 0, errors: 0 };
  }

  // Upload
  const batchId = randomUUID();
  let uploaded = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < sorted.length; i++) {
    const meta = sorted[i];
    const ext = path.extname(meta.fileName).toLowerCase();
    const mime = MIME_MAP[ext] || "image/jpeg";
    const buffer = fs.readFileSync(meta.filePath);

    // SHA-256 dedup
    const hash = createHash("sha256").update(buffer).digest("hex");
    const shortHash = hash.substring(0, 8);

    // Check for existing
    const existing = await queryOne<{ media_id: string }>(
      `SELECT media_id FROM ops.request_media
       WHERE stored_filename LIKE '%' || $1 || '%'
         AND NOT is_archived
       LIMIT 1`,
      [shortHash]
    );

    if (existing) {
      skipped++;
      continue;
    }

    const seqNum = i + 1;
    const storedFilename = `${clinicDate}_seq${String(seqNum).padStart(4, "0")}_${shortHash}${ext.toLowerCase() === ".jpeg" ? ".jpg" : ext.toLowerCase()}`;
    const storagePath = `clinic-days/${clinicDate}/evidence/${storedFilename}`;

    // Upload to Supabase
    const { error: uploadError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(storagePath, buffer, { contentType: mime, upsert: true });

    if (uploadError) {
      console.error(`  [${seqNum}] Upload error: ${uploadError.message}`);
      errors++;
      continue;
    }

    const { data: urlData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(storagePath);
    const publicUrl = urlData.publicUrl;

    const notesJson = JSON.stringify({
      clinic_date: clinicDate,
      ingest_batch_id: batchId,
      sequence_number: seqNum,
      exif_taken_at: meta.adjustedTakenAt,
      camera_make: meta.cameraMake,
      camera_model: meta.cameraModel,
      offset_applied_ms: meta.offsetMs,
      original_folder: path.basename(folderPath),
      file_hash: hash,
      source: "backlog_ingest",
    });

    // INSERT request_media
    const mediaRow = await queryOne<{ media_id: string }>(
      `INSERT INTO ops.request_media (
         media_type, original_filename, stored_filename,
         file_size_bytes, mime_type, storage_provider, storage_path,
         cat_identification_confidence, uploaded_by, notes
       ) VALUES (
         'cat_photo', $1, $2, $3, $4, 'supabase', $5,
         'unidentified', 'backlog_script', $6
       )
       RETURNING media_id`,
      [meta.fileName, storedFilename, meta.fileSize, mime, publicUrl, notesJson]
    );

    if (!mediaRow) {
      errors++;
      continue;
    }

    // INSERT evidence_stream_segments
    await queryOne(
      `INSERT INTO ops.evidence_stream_segments (
         ingest_batch_id, clinic_date, source_kind, source_ref_id,
         sequence_number, assignment_status
       ) VALUES ($1::UUID, $2::DATE, 'request_media', $3, $4, 'pending')`,
      [batchId, clinicDate, mediaRow.media_id, seqNum]
    );

    uploaded++;

    if ((i + 1) % 50 === 0) {
      console.log(`  Progress: ${i + 1}/${sorted.length} (${uploaded} uploaded, ${skipped} skipped)`);
    }
  }

  console.log(`  Done: ${uploaded} uploaded, ${skipped} skipped, ${errors} errors`);
  return { uploaded, skipped, errors };
}

// ── Main ───────────────────────────────────────────────────

async function main() {
  console.log(`Clinic Photo Backlog Ingest${DRY_RUN ? " [DRY RUN]" : ""}${CLASSIFY ? " [+classify]" : ""}`);
  console.log(`Source: ${PHOTOS_ROOT}`);

  const folders = fs.readdirSync(PHOTOS_ROOT)
    .filter((f) => fs.statSync(path.join(PHOTOS_ROOT, f)).isDirectory())
    .filter((f) => !SINGLE_FOLDER || f === SINGLE_FOLDER);

  if (SINGLE_FOLDER && folders.length === 0) {
    console.error(`Folder not found: ${SINGLE_FOLDER}`);
    process.exit(1);
  }

  const results: Array<{ folder: string; date: string; uploaded: number; skipped: number; errors: number }> = [];

  for (const folder of folders) {
    const parsed = parseFolderDate(folder);
    if (!parsed) {
      console.log(`\nSkipping "${folder}" — can't parse date`);
      continue;
    }

    const result = await ingestFolder(path.join(PHOTOS_ROOT, folder), parsed.date);
    results.push({ folder, date: parsed.date, ...result });
  }

  // Summary
  console.log("\n=== Summary ===");
  let totalUploaded = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  for (const r of results) {
    console.log(`  ${r.folder} (${r.date}): ${r.uploaded} uploaded, ${r.skipped} skipped, ${r.errors} errors`);
    totalUploaded += r.uploaded;
    totalSkipped += r.skipped;
    totalErrors += r.errors;
  }
  console.log(`  Total: ${totalUploaded} uploaded, ${totalSkipped} skipped, ${totalErrors} errors`);

  // Classify if requested
  if (CLASSIFY && !DRY_RUN && totalUploaded > 0) {
    console.log("\n=== Running CDS-AI classification ===");
    console.log("Trigger classification from the web UI:");
    for (const r of results) {
      if (r.uploaded > 0) {
        console.log(`  /admin/clinic-days/${r.date} → Evidence tab → Classify Now`);
      }
    }
    console.log("(Automated classification not run from script to avoid 300s API timeout)");
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
