import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { createHash } from "crypto";
import { uploadFile, isStorageAvailable, getPublicUrl } from "@/lib/supabase";
import { requireValidUUID } from "@/lib/api-validation";
import { apiBadRequest, apiNotFound, apiSuccess, apiServerError } from "@/lib/api-response";

interface MediaRow {
  media_id: string;
  media_type: string;
  original_filename: string;
  storage_path: string;
  caption: string | null;
  cat_description: string | null;
  uploaded_by: string;
  uploaded_at: string;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/places/[id]/media - List all media for a place
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  try {
    requireValidUUID(id, "place");
    // Include both direct place photos AND photos from requests linked to this place
    const media = await queryRows<MediaRow>(
      `SELECT
        media_id,
        media_type::TEXT,
        original_filename,
        storage_path,
        caption,
        cat_description,
        uploaded_by,
        uploaded_at
       FROM ops.request_media
       WHERE (place_id = $1
              OR (request_id IN (SELECT request_id FROM ops.requests WHERE place_id = $1)
                  AND place_id IS NULL))
         AND NOT COALESCE(is_archived, FALSE)
       ORDER BY uploaded_at DESC`,
      [id]
    );

    return apiSuccess({ media });
  } catch (error) {
    console.error("Error fetching place media:", error);
    return apiServerError("Failed to fetch media");
  }
}

// POST /api/places/[id]/media - Upload new media for a place
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  try {
    requireValidUUID(id, "place");
    const placeExists = await queryOne<{ place_id: string }>(
      `SELECT place_id FROM sot.places WHERE place_id = $1`,
      [id]
    );

    if (!placeExists) {
      return apiNotFound("Place", id);
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const mediaType = (formData.get("media_type") as string) || "site_photo";
    const caption = (formData.get("caption") as string) || null;
    const notes = (formData.get("notes") as string) || null;
    const catDescription = (formData.get("cat_description") as string) || null;
    const uploadedBy = (formData.get("uploaded_by") as string) || "app_user";

    if (!file) {
      return apiBadRequest("No file provided");
    }

    const validTypes = ["cat_photo", "site_photo", "evidence", "map_screenshot", "document", "other"];
    if (!validTypes.includes(mediaType)) {
      return apiBadRequest("Invalid media type");
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const timestamp = Date.now();
    const hash = createHash("sha256").update(buffer).digest("hex").substring(0, 8);
    const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
    const storedFilename = `${id}_${timestamp}_${hash}.${ext}`;

    const mimeTypes: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      gif: "image/gif", webp: "image/webp", heic: "image/heic",
      pdf: "application/pdf",
    };
    const mimeType = mimeTypes[ext] || "application/octet-stream";

    const storagePath = `places/${id}/${storedFilename}`;
    let publicUrl = "";

    if (isStorageAvailable()) {
      const uploadResult = await uploadFile(storagePath, buffer, mimeType);
      if (!uploadResult.success) {
        return apiServerError(uploadResult.error || "Failed to upload to storage");
      }
      publicUrl = uploadResult.url || getPublicUrl(storagePath);
    } else {
      return apiServerError("Storage not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    }

    const result = await queryOne<{ media_id: string }>(
      `INSERT INTO ops.request_media (
        place_id, media_type, original_filename, stored_filename,
        file_size_bytes, mime_type, storage_provider, storage_path,
        caption, notes, cat_description, uploaded_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )
      RETURNING media_id`,
      [
        id, mediaType, file.name, storedFilename,
        buffer.length, mimeType, "supabase", publicUrl,
        caption, notes, catDescription, uploadedBy,
      ]
    );

    return apiSuccess({
      media_id: result?.media_id,
      stored_filename: storedFilename,
      storage_path: publicUrl,
    });
  } catch (error) {
    console.error("Error uploading place media:", error);
    return apiServerError("Failed to upload media");
  }
}
