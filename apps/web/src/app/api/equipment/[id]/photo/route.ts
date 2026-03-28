import { queryOne } from "@/lib/db";
import { apiSuccess, apiNotFound } from "@/lib/api-response";
import { requireValidUUID, withErrorHandling, ApiError } from "@/lib/api-validation";
import { uploadFile, getPublicUrl, isStorageAvailable } from "@/lib/supabase";
import { NextRequest } from "next/server";
import crypto from "crypto";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

/**
 * POST /api/equipment/[id]/photo
 * Upload a photo for an equipment item.
 * Accepts FormData with a "file" field.
 * Stores to Supabase Storage and updates ops.equipment.photo_url.
 */
export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "equipment");

  if (!isStorageAvailable()) {
    throw new ApiError("Storage not configured", 503);
  }

  // Verify equipment exists
  const equipment = await queryOne<{ equipment_id: string }>(
    `SELECT equipment_id FROM ops.equipment WHERE equipment_id = $1`,
    [id]
  );
  if (!equipment) {
    return apiNotFound("equipment", id);
  }

  // Parse FormData
  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    throw new ApiError("file field is required", 400);
  }

  // Validate file type
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new ApiError(
      `Invalid file type: ${file.type}. Allowed: ${ALLOWED_TYPES.join(", ")}`,
      400
    );
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    throw new ApiError(
      `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max: 10MB`,
      400
    );
  }

  // Generate storage path: equipment/{id}/{timestamp}_{hash}.jpg
  const timestamp = Date.now();
  const hash = crypto.randomBytes(4).toString("hex");
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const storagePath = `equipment/${id}/${timestamp}_${hash}.${ext}`;

  // Upload to Supabase
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const result = await uploadFile(storagePath, buffer, file.type);

  if (!result.success) {
    throw new ApiError(`Upload failed: ${result.error}`, 500);
  }

  const publicUrl = result.url || getPublicUrl(storagePath);

  // Update equipment record
  await queryOne(
    `UPDATE ops.equipment SET photo_url = $1, updated_at = NOW() WHERE equipment_id = $2`,
    [publicUrl, id]
  );

  return apiSuccess({ photo_url: publicUrl });
});
