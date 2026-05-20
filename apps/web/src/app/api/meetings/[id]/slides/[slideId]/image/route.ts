import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiNotFound, apiBadRequest, apiServerError } from "@/lib/api-response";
import { uploadFile, isStorageAvailable, getPublicUrl } from "@/lib/supabase";
import { createHash } from "crypto";

type Params = { params: Promise<{ id: string; slideId: string }> };

// POST /api/meetings/[id]/slides/[slideId]/image — upload slide image
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id, slideId } = await params;
    requireValidUUID(id, "meeting");
    requireValidUUID(slideId, "slide");

    if (!isStorageAvailable()) {
      return apiServerError("Storage not configured");
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file || !(file instanceof File)) {
      return apiBadRequest("file is required");
    }

    // Verify slide exists in this meeting
    const slide = await queryOne(
      `SELECT slide_id FROM ops.meeting_slides WHERE slide_id = $1 AND meeting_id = $2`,
      [slideId, id]
    );
    if (!slide) return apiNotFound("slide", slideId);

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const hash = createHash("sha256").update(buffer).digest("hex").substring(0, 8);
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const storedFilename = `${slideId}_${Date.now()}_${hash}.${ext}`;
    const storagePath = `meetings/${id}/${storedFilename}`;

    const mimeTypes: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      gif: "image/gif", webp: "image/webp",
    };

    const result = await uploadFile(storagePath, buffer, mimeTypes[ext] || "image/jpeg");
    if (!result.success) {
      return apiServerError(result.error || "Upload failed");
    }

    const publicUrl = result.url || getPublicUrl(storagePath);

    // Update the slide's image_url
    await queryOne(
      `UPDATE ops.meeting_slides SET image_url = $1 WHERE slide_id = $2`,
      [publicUrl, slideId]
    );

    return apiSuccess({ image_url: publicUrl });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") throw error;
    console.error("[meetings/slides/image] POST error:", error);
    return apiServerError("Failed to upload image");
  }
}
