import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiUnauthorized, apiNotFound } from "@/lib/api-response";
import { requireValidUUID, withErrorHandling, ApiError } from "@/lib/api-validation";

/**
 * PUT /api/admin/staff/[id]
 * Update staff fields (currently: show_in_kiosk).
 * Admin auth required.
 */
export const PUT = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const session = await getSession(request);
  if (!session) {
    return apiUnauthorized();
  }

  const { id } = await params;
  requireValidUUID(id, "staff");

  const body = await request.json();
  const { show_in_kiosk } = body;

  if (typeof show_in_kiosk !== "boolean") {
    throw new ApiError("show_in_kiosk must be a boolean", 400);
  }

  const result = await queryOne<{ staff_id: string }>(
    `UPDATE ops.staff
     SET show_in_kiosk = $2, updated_at = NOW()
     WHERE staff_id = $1
     RETURNING staff_id`,
    [id, show_in_kiosk]
  );

  if (!result) {
    return apiNotFound("staff", id);
  }

  return apiSuccess({ staff_id: result.staff_id, show_in_kiosk });
});
