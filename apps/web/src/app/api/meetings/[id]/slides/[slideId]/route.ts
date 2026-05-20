import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiNotFound, apiBadRequest, apiServerError } from "@/lib/api-response";

type Params = { params: Promise<{ id: string; slideId: string }> };

const VALID_TYPES = ["title", "content", "stats", "photo", "two_column", "quote"];
const VALID_BG = ["default", "dark", "accent", "photo_bg"];

// PATCH /api/meetings/[id]/slides/[slideId] — update slide
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id, slideId } = await params;
    requireValidUUID(id, "meeting");
    requireValidUUID(slideId, "slide");

    const body = await request.json();
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.slide_type !== undefined) {
      if (!VALID_TYPES.includes(body.slide_type)) {
        return apiBadRequest(`slide_type must be one of: ${VALID_TYPES.join(", ")}`);
      }
      updates.push(`slide_type = $${idx++}`);
      values.push(body.slide_type);
    }
    if (body.title !== undefined) {
      updates.push(`title = $${idx++}`);
      values.push(body.title || null);
    }
    if (body.body !== undefined) {
      updates.push(`body = $${idx++}`);
      values.push(body.body || null);
    }
    if (body.image_url !== undefined) {
      updates.push(`image_url = $${idx++}`);
      values.push(body.image_url || null);
    }
    if (body.image_caption !== undefined) {
      updates.push(`image_caption = $${idx++}`);
      values.push(body.image_caption || null);
    }
    if (body.background_style !== undefined) {
      if (!VALID_BG.includes(body.background_style)) {
        return apiBadRequest(`background_style must be one of: ${VALID_BG.join(", ")}`);
      }
      updates.push(`background_style = $${idx++}`);
      values.push(body.background_style);
    }
    if (body.custom_data !== undefined) {
      updates.push(`custom_data = $${idx++}`);
      values.push(JSON.stringify(body.custom_data));
    }

    if (updates.length === 0) return apiBadRequest("No fields to update");

    values.push(slideId, id);
    const slide = await queryOne(
      `UPDATE ops.meeting_slides SET ${updates.join(", ")}
       WHERE slide_id = $${idx} AND meeting_id = $${idx + 1}
       RETURNING slide_id, slide_type, title, body, image_url, image_caption,
                 background_style, custom_data, display_order, is_from_library`,
      values
    );

    if (!slide) return apiNotFound("slide", slideId);
    return apiSuccess({ slide });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") throw error;
    console.error("[meetings/slides/id] PATCH error:", error);
    return apiServerError("Failed to update slide");
  }
}

// DELETE /api/meetings/[id]/slides/[slideId]
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id, slideId } = await params;
    requireValidUUID(id, "meeting");
    requireValidUUID(slideId, "slide");

    const result = await queryOne(
      `DELETE FROM ops.meeting_slides
       WHERE slide_id = $1 AND meeting_id = $2
       RETURNING slide_id`,
      [slideId, id]
    );

    if (!result) return apiNotFound("slide", slideId);
    return apiSuccess({ deleted: true, slide_id: slideId });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") throw error;
    console.error("[meetings/slides/id] DELETE error:", error);
    return apiServerError("Failed to delete slide");
  }
}
