import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { execute } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiUnauthorized, apiServerError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/notifications/[id]
 * Mark a single notification as read.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session?.staff_id) return apiUnauthorized();

    const { id } = await params;
    requireValidUUID(id, "notification");

    await execute(
      `UPDATE ops.staff_notifications SET is_read = TRUE
       WHERE id = $1 AND staff_id = $2`,
      [id, session.staff_id]
    );

    return apiSuccess({ marked: true });
  } catch (error) {
    console.error("Error marking notification read:", error);
    return apiServerError("Failed to update notification");
  }
}
