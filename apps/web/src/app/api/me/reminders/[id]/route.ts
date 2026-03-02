import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { apiSuccess, apiUnauthorized, apiBadRequest, apiNotFound, apiServerError } from "@/lib/api-response";

/**
 * PATCH /api/me/reminders/[id]
 *
 * Update a reminder's status or snooze it
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);

    if (!session?.staff_id) {
      return apiUnauthorized();
    }

    const { id } = await params;
    const body = await request.json();
    const { status, snooze_until } = body;

    // Verify ownership
    const existing = await queryOne<{ reminder_id: string }>(
      `SELECT reminder_id FROM ops.staff_reminders
       WHERE reminder_id = $1 AND staff_id = $2`,
      [id, session.staff_id]
    );

    if (!existing) {
      return apiNotFound("reminder", id);
    }

    // Handle snooze
    if (snooze_until) {
      const result = await queryOne<{ reminder_id: string }>(
        `UPDATE ops.staff_reminders
         SET
           status = 'snoozed',
           remind_at = $1,
           snooze_count = snooze_count + 1,
           last_snoozed_at = NOW(),
           updated_at = NOW()
         WHERE reminder_id = $2
         RETURNING reminder_id`,
        [snooze_until, id]
      );

      if (!result) {
        return apiServerError("Failed to snooze reminder");
      }

      return apiSuccess({
        success: true,
        message: "Reminder snoozed",
      });
    }

    // Handle status change
    if (status) {
      const validStatuses = ["pending", "due", "snoozed", "completed", "archived"];
      if (!validStatuses.includes(status)) {
        return apiBadRequest("Invalid status");
      }

      const completedAt = status === "completed" ? "NOW()" : "NULL";

      const result = await queryOne<{ reminder_id: string }>(
        `UPDATE ops.staff_reminders
         SET
           status = $1,
           completed_at = ${status === "completed" ? "NOW()" : "completed_at"},
           updated_at = NOW()
         WHERE reminder_id = $2
         RETURNING reminder_id`,
        [status, id]
      );

      if (!result) {
        return apiServerError("Failed to update reminder");
      }

      return apiSuccess({
        success: true,
        message: `Reminder marked as ${status}`,
      });
    }

    return apiBadRequest("No update provided");
  } catch (error) {
    console.error("Error updating reminder:", error);
    return apiServerError("Failed to update reminder");
  }
}

/**
 * DELETE /api/me/reminders/[id]
 *
 * Archive a reminder (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);

    if (!session?.staff_id) {
      return apiUnauthorized();
    }

    const { id } = await params;

    // Verify ownership and archive
    const result = await queryOne<{ reminder_id: string }>(
      `UPDATE ops.staff_reminders
       SET status = 'archived', updated_at = NOW()
       WHERE reminder_id = $1 AND staff_id = $2
       RETURNING reminder_id`,
      [id, session.staff_id]
    );

    if (!result) {
      return apiNotFound("reminder", id);
    }

    return apiSuccess({
      success: true,
      message: "Reminder archived",
    });
  } catch (error) {
    console.error("Error archiving reminder:", error);
    return apiServerError("Failed to archive reminder");
  }
}
