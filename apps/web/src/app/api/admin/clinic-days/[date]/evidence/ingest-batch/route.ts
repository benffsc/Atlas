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
 * POST /api/admin/clinic-days/[date]/evidence/ingest-batch
 *
 * Chunked batch upload for desktop folders (200-400 photos).
 * Same logic as evidence/ingest but supports:
 *   - batch_id (client-assigned UUID, shared across all chunks)
 *   - chunk_index + total_chunks (for progress tracking)
 *   - sequence_offset (so chunk 2 starts at sequence 21, not 1)
 *
 * Accepts: multipart/form-data with:
 *   - files[] — chunk of image files (typically 20 at a time)
 *   - batch_id — UUID for the full upload session
 *   - chunk_index — 0-based index of this chunk
 *   - total_chunks — total number of chunks expected
 *   - sequence_offset — starting sequence number for this chunk
 *   - sequence_data — JSON array of { index, exif_taken_at, camera_make, camera_model }
 *
 * Returns: { uploaded, skipped, errors, chunk_index, batch_id }
 *
 * Linear: FFS-1197
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

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
};

function resolveFileType(file: File): { ext: string; mime: string } | null {
  const extFromMime = MIME_TYPES[file.type];
  if (extFromMime) return { ext: extFromMime, mime: file.type };

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
    const batchId = (formData.get("batch_id") as string) || randomUUID();
    const chunkIndex = parseInt((formData.get("chunk_index") as string) || "0", 10);
    const totalChunks = parseInt((formData.get("total_chunks") as string) || "1", 10);
    const sequenceOffset = parseInt((formData.get("sequence_offset") as string) || "0", 10);
    const sequenceRaw = formData.get("sequence_data") as string | null;

    if (files.length === 0) {
      return apiBadRequest("No files provided");
    }

    // Parse optional sequence data
    let sequenceData: Array<{
      index: number;
      exif_taken_at: string | null;
      camera_make?: string | null;
      camera_model?: string | null;
    }> = [];
    if (sequenceRaw) {
      try {
        sequenceData = JSON.parse(sequenceRaw);
      } catch {
        // Ignore — fall back to upload order
      }
    }

    const staffId = session.staff_id;
    let uploaded = 0;
    let skipped = 0;
    let errors = 0;
    let segmentsCreated = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      const fileType = resolveFileType(file);
      if (!fileType) {
        skipped++;
        continue;
      }

      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      // SHA-256 hash for dedup
      const hash = createHash("sha256").update(buffer).digest("hex");
      const shortHash = hash.substring(0, 8);

      // Check for duplicate
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

      // Sequence number: offset + position in this chunk
      const seqNum = sequenceOffset + i + 1;

      const storedFilename = `${date}_seq${String(seqNum).padStart(4, "0")}_${shortHash}.${fileType.ext}`;
      const storagePath = `clinic-days/${date}/evidence/${storedFilename}`;

      const uploadResult = await uploadFile(storagePath, buffer, fileType.mime);
      if (!uploadResult.success) {
        errors++;
        continue;
      }

      const publicUrl = uploadResult.url || getPublicUrl(storagePath);

      const exifEntry = sequenceData.find((s) => s.index === i);
      const exifTakenAt = exifEntry?.exif_taken_at || null;

      const notesJson = JSON.stringify({
        clinic_date: date,
        ingest_batch_id: batchId,
        chunk_index: chunkIndex,
        total_chunks: totalChunks,
        sequence_number: seqNum,
        exif_taken_at: exifTakenAt,
        camera_make: exifEntry?.camera_make || null,
        camera_model: exifEntry?.camera_model || null,
        original_folder: "web_batch_upload",
        file_hash: hash,
        uploaded_by_staff_id: staffId,
      });

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

      await queryOne(
        `INSERT INTO ops.evidence_stream_segments (
           ingest_batch_id, clinic_date, source_kind, source_ref_id,
           sequence_number, assignment_status
         ) VALUES ($1::UUID, $2::DATE, 'request_media', $3, $4, 'pending')`,
        [batchId, date, mediaRow.media_id, seqNum]
      );

      segmentsCreated++;
      uploaded++;
    }

    return apiSuccess({
      uploaded,
      skipped,
      errors,
      chunk_index: chunkIndex,
      total_chunks: totalChunks,
      batch_id: batchId,
      segments_created: segmentsCreated,
    });
  } catch (error) {
    console.error("Evidence batch ingest error:", error);
    return apiServerError("Batch ingest failed");
  }
}
