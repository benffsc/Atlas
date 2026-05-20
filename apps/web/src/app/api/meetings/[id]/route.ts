import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiNotFound, apiBadRequest, apiServerError } from "@/lib/api-response";

type Params = { params: Promise<{ id: string }> };

// GET /api/meetings/[id] — meeting detail + slides
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    requireValidUUID(id, "meeting");

    const meeting = await queryOne<{
      meeting_id: string;
      title: string;
      meeting_date: string | null;
      status: string;
      description: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT meeting_id, title, meeting_date, status, description, created_at, updated_at
       FROM ops.trapper_meetings WHERE meeting_id = $1`,
      [id]
    );

    if (!meeting) return apiNotFound("meeting", id);

    const slides = await queryRows<{
      slide_id: string;
      slide_type: string;
      title: string | null;
      body: string | null;
      image_url: string | null;
      image_caption: string | null;
      background_style: string;
      custom_data: Record<string, unknown>;
      display_order: number;
      is_from_library: boolean;
      library_slide_id: string | null;
    }>(
      `SELECT slide_id, slide_type, title, body, image_url, image_caption,
              background_style, custom_data, display_order, is_from_library, library_slide_id
       FROM ops.meeting_slides
       WHERE meeting_id = $1
       ORDER BY display_order ASC, created_at ASC`,
      [id]
    );

    return apiSuccess({ meeting, slides });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") throw error;
    console.error("[meetings/id] GET error:", error);
    return apiServerError("Failed to load meeting");
  }
}

// PATCH /api/meetings/[id] — update metadata
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    requireValidUUID(id, "meeting");

    const body = await request.json();
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.title !== undefined) {
      if (typeof body.title !== "string" || body.title.trim().length === 0) {
        return apiBadRequest("title cannot be empty");
      }
      updates.push(`title = $${idx++}`);
      values.push(body.title.trim());
    }
    if (body.meeting_date !== undefined) {
      updates.push(`meeting_date = $${idx++}`);
      values.push(body.meeting_date || null);
    }
    if (body.status !== undefined) {
      const valid = ["draft", "ready", "presented", "archived"];
      if (!valid.includes(body.status)) {
        return apiBadRequest(`status must be one of: ${valid.join(", ")}`);
      }
      updates.push(`status = $${idx++}`);
      values.push(body.status);
    }
    if (body.description !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(body.description || null);
    }

    if (updates.length === 0) return apiBadRequest("No fields to update");

    values.push(id);
    const meeting = await queryOne(
      `UPDATE ops.trapper_meetings SET ${updates.join(", ")}
       WHERE meeting_id = $${idx}
       RETURNING meeting_id, title, meeting_date, status, description, updated_at`,
      values
    );

    if (!meeting) return apiNotFound("meeting", id);

    return apiSuccess({ meeting });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") throw error;
    console.error("[meetings/id] PATCH error:", error);
    return apiServerError("Failed to update meeting");
  }
}

// DELETE /api/meetings/[id] — archive (soft delete)
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    requireValidUUID(id, "meeting");

    const meeting = await queryOne(
      `UPDATE ops.trapper_meetings SET status = 'archived'
       WHERE meeting_id = $1
       RETURNING meeting_id, status`,
      [id]
    );

    if (!meeting) return apiNotFound("meeting", id);

    return apiSuccess({ meeting });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") throw error;
    console.error("[meetings/id] DELETE error:", error);
    return apiServerError("Failed to archive meeting");
  }
}
