import { NextRequest } from "next/server";
import { randomUUID, createHash } from "crypto";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { uploadFile, getPublicUrl, isStorageAvailable } from "@/lib/supabase";
import {
  apiSuccess,
  apiBadRequest,
  apiUnauthorized,
  apiServerError,
} from "@/lib/api-response";

/**
 * POST /api/admin/clinic-days/[date]/evidence/ingest
 *
 * Accept photos from the web UI (phone upload), store in Supabase,
 * and create request_media + evidence_stream_segments rows with
 * sequence preserved. Mirrors the logic in evidence-ingest-photos.ts.
 *
 * Accepts: multipart/form-data with:
 *   - files[] — multiple image files (client sorts by EXIF before upload)
 *   - sequence_data — JSON array of { index, exif_taken_at } for ordering
 *
 * Returns: { uploaded, skipped, errors, batch_id, segments_created }
 */

export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ date: string }>;
}

const MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/webp": "webp",
};

// Fallback: resolve extension from filename when browser reports empty/unknown MIME
const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
};

function resolveFileType(file: File): { ext: string; mime: string } | null {
  // Try MIME type first
  const extFromMime = MIME_TYPES[file.type];
  if (extFromMime) return { ext: extFromMime, mime: file.type };

  // Fallback: extract extension from filename
  const nameExt = file.name.split(".").pop()?.toLowerCase();
  if (nameExt && EXT_TO_MIME[nameExt]) {
    return { ext: nameExt === "jpeg" ? "jpg" : nameExt, mime: EXT_TO_MIME[nameExt] };
  }

  return null;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) return apiUnauthorized();

    const { date } = await params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return apiBadRequest("Invalid date format. Use YYYY-MM-DD.");
    }

    if (!isStorageAvailable()) {
      return apiServerError("Storage not configured");
    }

    const formData = await request.formData();
    const files = formData.getAll("files[]") as File[];
    const sequenceRaw = formData.get("sequence_data") as string | null;

    if (files.length === 0) {
      return apiBadRequest("No files provided");
    }

    // Parse optional sequence data (EXIF times from client)
    let sequenceData: Array<{ index: number; exif_taken_at: string | null }> = [];
    if (sequenceRaw) {
      try {
        sequenceData = JSON.parse(sequenceRaw);
      } catch {
        // Ignore parse errors — fall back to upload order
      }
    }

    const batchId = randomUUID();
    const staffId = session.staff_id;

    let uploaded = 0;
    let skipped = 0;
    let errors = 0;
    let segmentsCreated = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Validate file type (MIME or extension fallback for HEIC)
      const fileType = resolveFileType(file);
      if (!fileType) {
        // Skip non-image files silently
        skipped++;
        continue;
      }

      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      // SHA-256 hash for dedup (first 8 chars)
      const hash = createHash("sha256").update(buffer).digest("hex");
      const shortHash = hash.substring(0, 8);

      // Check for duplicate by hash in stored_filename
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

      // Sequence number: 1-indexed position in the upload batch
      const seqNum = i + 1;

      // Build stored filename matching evidence-ingest-photos.ts pattern
      const storedFilename = `${date}_seq${String(seqNum).padStart(4, "0")}_${shortHash}.${fileType.ext}`;
      const storagePath = `clinic-days/${date}/evidence/${storedFilename}`;

      // Upload to Supabase
      const uploadResult = await uploadFile(storagePath, buffer, fileType.mime);
      if (!uploadResult.success) {
        errors++;
        continue;
      }

      const publicUrl = uploadResult.url || getPublicUrl(storagePath);

      // Get EXIF time from client-provided sequence data
      const exifEntry = sequenceData.find((s) => s.index === i);
      const exifTakenAt = exifEntry?.exif_taken_at || null;

      // Build notes JSON (same shape as evidence-ingest-photos.ts)
      const notesJson = JSON.stringify({
        clinic_date: date,
        ingest_batch_id: batchId,
        sequence_number: seqNum,
        exif_taken_at: exifTakenAt,
        original_folder: "web_upload",
        file_hash: hash,
        uploaded_by_staff_id: staffId,
      });

      // INSERT request_media row (cat_id = NULL, unassigned)
      const mediaRow = await queryOne<{ media_id: string }>(
        `INSERT INTO ops.request_media (
           media_type, original_filename, stored_filename,
           file_size_bytes, mime_type, storage_provider, storage_path,
           cat_identification_confidence, uploaded_by, notes
         ) VALUES (
           'cat_photo', $1, $2, $3, $4, 'supabase', $5,
           'unidentified', $6, $7
         )
         RETURNING media_id`,
        [
          file.name,
          storedFilename,
          buffer.length,
          fileType.mime,
          publicUrl,
          `staff:${staffId}`,
          notesJson,
        ]
      );

      if (!mediaRow) {
        errors++;
        continue;
      }

      // INSERT evidence_stream_segments row
      await queryOne(
        `INSERT INTO ops.evidence_stream_segments (
           ingest_batch_id, clinic_date, source_kind, source_ref_id,
           sequence_number, assignment_status
         ) VALUES ($1, $2::DATE, 'request_media', $3, $4, 'pending')`,
        [batchId, date, mediaRow.media_id, seqNum]
      );

      segmentsCreated++;
      uploaded++;
    }

    return apiSuccess({
      uploaded,
      skipped,
      errors,
      batch_id: batchId,
      segments_created: segmentsCreated,
    });
  } catch (error) {
    console.error("Evidence ingest error:", error);
    return apiServerError("Evidence ingest failed");
  }
}
