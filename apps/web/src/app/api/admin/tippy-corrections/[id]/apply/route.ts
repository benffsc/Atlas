import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError, apiBadRequest, apiError } from "@/lib/api-response";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return apiError("Admin access required", 403);
  }

  const { id } = await params;

  try {
    // Apply the correction using the SQL function
    const result = await queryOne<{
      success: boolean;
      edit_id?: string;
      correction_id?: string;
      error?: string;
      manual_required?: boolean;
    }>(
      `SELECT * FROM ops.tippy_apply_correction($1, $2)`,
      [id, session.staff_id]
    );

    if (!result?.success) {
      return apiBadRequest(result?.error || "Failed to apply correction");
    }

    return apiSuccess({
      edit_id: result.edit_id,
      correction_id: result.correction_id,
    });
  } catch (error) {
    console.error("Error applying correction:", error);
    return apiServerError("Failed to apply correction");
  }
}
