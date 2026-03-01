import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { execute } from "@/lib/db";
import { apiSuccess, apiServerError, apiBadRequest, apiError } from "@/lib/api-response";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return apiError("Admin access required", 403);
  }

  const { id } = await params;
  const body = await request.json();
  const { resolution_status, resolution_notes, related_view } = body;

  // Validate status
  const validStatuses = [
    "unresolved",
    "view_created",
    "data_added",
    "tool_added",
    "documentation",
    "out_of_scope",
    "duplicate",
  ];
  if (resolution_status && !validStatuses.includes(resolution_status)) {
    return apiBadRequest("Invalid status");
  }

  try {
    await execute(
      `
      UPDATE ops.tippy_capability_gaps
      SET
        resolution_status = COALESCE($1, resolution_status),
        resolved_by = $2,
        resolved_at = NOW(),
        resolution_notes = COALESCE($3, resolution_notes),
        related_view = COALESCE($4, related_view)
      WHERE question_id = $5
      `,
      [resolution_status, session.staff_id, resolution_notes, related_view, id]
    );

    return apiSuccess({ updated: true });
  } catch (error) {
    console.error("Error updating question:", error);
    return apiServerError("Failed to update question");
  }
}
