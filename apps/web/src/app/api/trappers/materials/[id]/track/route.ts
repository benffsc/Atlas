import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";

// POST /api/trappers/materials/[id]/track - Track view/download
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const action = body.action as string;

    if (!["view", "download"].includes(action)) {
      return apiBadRequest("Invalid action");
    }

    const column = action === "view" ? "view_count" : "download_count";

    await query(
      `UPDATE ops.education_materials
       SET ${column} = COALESCE(${column}, 0) + 1
       WHERE material_id = $1`,
      [id]
    );

    return apiSuccess({ success: true });
  } catch (error) {
    console.error("Error tracking material:", error);
    return apiServerError("Failed to track");
  }
}
