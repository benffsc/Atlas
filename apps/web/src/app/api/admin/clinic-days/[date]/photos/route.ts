import { NextRequest } from "next/server";
import { queryOne, queryRows, execute } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { createHash } from "crypto";
import { uploadFile, isStorageAvailable, getPublicUrl } from "@/lib/supabase";
import {
  apiSuccess,
  apiBadRequest,
  apiUnauthorized,
  apiServerError,
} from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ date: string }>;
}

/**
 * POST /api/admin/clinic-days/[date]/photos
 *
 * Batch upload photos for a clinic day. Accepts multipart form data with:
 * - files[]: Multiple photo files
 * - groups: JSON string mapping photo index → group info
 *   e.g. [
 *     { indices: [0,1,2], entry_line_number: 1, photo_type: "cat" },
 *     { indices: [3], entry_line_number: 1, photo_type: "waiver" },
 *     { indices: [4,5], entry_line_number: 2, photo_type: "cat" },
 *   ]
 *
 * If no groups provided, photos are uploaded as unlinked clinic-day photos.
 *
 * Photos are stored at: clinic-days/{date}/{filename}
 * And linked to cats via clinic_day_entries → appointment → cat
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) {
      return apiUnauthorized();
    }

    const { date } = await params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return apiBadRequest("Invalid date format.");
    }

    if (!isStorageAvailable()) {
      return apiServerError("Storage not configured");
    }

    const formData = await request.formData();

    // Collect all files
    const files: File[] = [];
    for (const f of formData.getAll("files[]")) {
      if (f instanceof File) files.push(f);
    }
    for (const f of formData.getAll("files")) {
      if (f instanceof File) files.push(f);
    }
    if (files.length === 0) {
      return apiBadRequest("No files provided");
    }

    // Parse group assignments (optional)
    interface PhotoGroup {
      indices: number[];
      entry_line_number: number | null;
      photo_type: "cat" | "microchip" | "waiver" | "other";
    }
    const groupsRaw = formData.get("groups") as string | null;
    let groups: PhotoGroup[] = [];
    if (groupsRaw) {
      try {
        groups = JSON.parse(groupsRaw);
      } catch {
        return apiBadRequest("Invalid groups JSON");
      }
    }

    // Build index → group mapping
    const indexToGroup = new Map<number, PhotoGroup>();
    for (const g of groups) {
      for (const idx of g.indices) {
        indexToGroup.set(idx, g);
      }
    }

    // Resolve entry_line_number → cat_id via clinic_day_entries
    const entryMap = new Map<number, { entry_id: string; cat_id: string | null; appointment_id: string | null }>();
    if (groups.length > 0) {
      const lineNumbers = [...new Set(groups.filter(g => g.entry_line_number != null).map(g => g.entry_line_number!))];
      if (lineNumbers.length > 0) {
        const entries = await queryRows<{
          entry_id: string;
          line_number: number;
          cat_id: string | null;
          appointment_id: string | null;
        }>(
          `SELECT e.entry_id, e.line_number, e.cat_id, e.appointment_id
           FROM ops.clinic_day_entries e
           JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
           WHERE cd.clinic_date = $1
             AND e.line_number = ANY($2)`,
          [date, lineNumbers]
        );
        for (const entry of entries) {
          entryMap.set(entry.line_number, entry);
        }
      }
    }

    // Upload each file
    const results: Array<{
      index: number;
      filename: string;
      storage_path: string;
      media_id: string | null;
      cat_id: string | null;
      entry_line_number: number | null;
      photo_type: string;
    }> = [];
    const errors: Array<{ index: number; filename: string; error: string }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const group = indexToGroup.get(i);
      const photoType = group?.photo_type || "cat";
      const entryLineNumber = group?.entry_line_number ?? null;
      const entry = entryLineNumber != null ? entryMap.get(entryLineNumber) : null;
      const catId = entry?.cat_id ?? null;

      try {
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Generate filename
        const timestamp = Date.now();
        const hash = createHash("sha256").update(buffer).digest("hex").substring(0, 8);
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const storedFilename = `${date}_${String(i + 1).padStart(3, "0")}_${hash}.${ext}`;

        const mimeTypes: Record<string, string> = {
          jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
          gif: "image/gif", webp: "image/webp", heic: "image/heic",
        };
        const mimeType = mimeTypes[ext] || "image/jpeg";

        // Store under clinic-days/{date}/
        const storagePath = `clinic-days/${date}/${storedFilename}`;
        const uploadResult = await uploadFile(storagePath, buffer, mimeType);
        if (!uploadResult.success) {
          errors.push({ index: i, filename: file.name, error: uploadResult.error || "Upload failed" });
          continue;
        }
        const publicUrl = uploadResult.url || getPublicUrl(storagePath);

        // Create media record if we have a cat_id to link to
        let mediaId: string | null = null;
        if (catId) {
          const mediaType = photoType === "waiver" ? "document" : "cat_photo";
          const inserted = await queryOne<{ media_id: string }>(
            `INSERT INTO ops.request_media (
               cat_id, media_type, original_filename, stored_filename,
               file_size_bytes, mime_type, storage_provider, storage_path,
               cat_identification_confidence, uploaded_by, notes
             ) VALUES ($1, $2, $3, $4, $5, $6, 'supabase', $7, 'confirmed', $8, $9)
             RETURNING media_id`,
            [
              catId, mediaType, file.name, storedFilename,
              buffer.length, mimeType, publicUrl,
              session.staff_id,
              entryLineNumber ? `Clinic day #${entryLineNumber}, ${photoType}` : null,
            ]
          );
          mediaId = inserted?.media_id ?? null;
        } else {
          // No cat yet — store as clinic-day-level photo with metadata
          // These get linked when matching resolves later
          const inserted = await queryOne<{ media_id: string }>(
            `INSERT INTO ops.request_media (
               media_type, original_filename, stored_filename,
               file_size_bytes, mime_type, storage_provider, storage_path,
               cat_identification_confidence, uploaded_by, notes
             ) VALUES ('cat_photo', $1, $2, $3, $4, 'supabase', $5, 'unidentified', $6, $7)
             RETURNING media_id`,
            [
              file.name, storedFilename, buffer.length, mimeType,
              publicUrl, session.staff_id,
              `Clinic day ${date}, #${entryLineNumber ?? "unlinked"}, ${photoType}`,
            ]
          );
          mediaId = inserted?.media_id ?? null;
        }

        results.push({
          index: i,
          filename: file.name,
          storage_path: publicUrl,
          media_id: mediaId,
          cat_id: catId,
          entry_line_number: entryLineNumber,
          photo_type: photoType,
        });
      } catch (err) {
        errors.push({
          index: i,
          filename: file.name,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return apiSuccess({
      uploaded: results.length,
      failed: errors.length,
      linked_to_cats: results.filter((r) => r.cat_id).length,
      unlinked: results.filter((r) => !r.cat_id).length,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Clinic day photo upload error:", error);
    return apiServerError("Failed to upload photos");
  }
}

/**
 * GET /api/admin/clinic-days/[date]/photos
 *
 * Get all photos for a clinic day (linked via appointments + unlinked)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) {
      return apiUnauthorized();
    }

    const { date } = await params;

    // Photos linked to cats from this day's appointments
    const linkedPhotos = await queryRows<{
      media_id: string;
      cat_id: string;
      cat_name: string | null;
      clinic_day_number: number | null;
      storage_path: string;
      media_type: string;
      original_filename: string;
      created_at: string;
    }>(
      `SELECT rm.media_id, rm.cat_id, COALESCE(c.display_name, c.name) as cat_name,
              a.clinic_day_number, rm.storage_path, rm.media_type,
              rm.original_filename, rm.created_at::text
       FROM ops.request_media rm
       JOIN ops.appointments a ON a.cat_id = rm.cat_id
       JOIN sot.cats c ON c.cat_id = rm.cat_id
       WHERE a.appointment_date = $1
         AND a.merged_into_appointment_id IS NULL
         AND rm.media_type IN ('cat_photo', 'document')
       ORDER BY a.clinic_day_number NULLS LAST, rm.created_at`,
      [date]
    );

    // Unlinked photos from this clinic day (stored in notes or storage path)
    const unlinkedPhotos = await queryRows<{
      media_id: string;
      storage_path: string;
      media_type: string;
      original_filename: string;
      notes: string | null;
      created_at: string;
    }>(
      `SELECT media_id, storage_path, media_type, original_filename, notes, created_at::text
       FROM ops.request_media
       WHERE cat_id IS NULL
         AND storage_path LIKE $1
       ORDER BY created_at`,
      [`%clinic-days/${date}/%`]
    );

    return apiSuccess({
      linked: linkedPhotos,
      unlinked: unlinkedPhotos,
      total: linkedPhotos.length + unlinkedPhotos.length,
    });
  } catch (error) {
    console.error("Clinic day photos fetch error:", error);
    return apiServerError("Failed to fetch photos");
  }
}
