import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";

type Params = { params: Promise<{ id: string }> };

// POST /api/meetings/[id]/slides/reorder — reorder slides
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    requireValidUUID(id, "meeting");

    const body = await request.json();
    const { slide_ids } = body;

    if (!Array.isArray(slide_ids) || slide_ids.length === 0) {
      return apiBadRequest("slide_ids must be a non-empty array");
    }

    // Update each slide's display_order in a single transaction
    const cases = slide_ids
      .map((sid: string, i: number) => `WHEN '${sid}'::uuid THEN ${i}`)
      .join(" ");

    await query(
      `UPDATE ops.meeting_slides
       SET display_order = CASE slide_id ${cases} ELSE display_order END
       WHERE meeting_id = $1 AND slide_id = ANY($2::uuid[])`,
      [id, slide_ids]
    );

    return apiSuccess({ reordered: true });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") throw error;
    console.error("[meetings/slides/reorder] POST error:", error);
    return apiServerError("Failed to reorder slides");
  }
}
