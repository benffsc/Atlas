import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { queryRows, queryOne, execute } from "@/lib/db";
import { apiSuccess, apiUnauthorized, apiServerError } from "@/lib/api-response";

interface Notification {
  id: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  link_url: string | null;
  source: string;
  is_read: boolean;
  created_at: string;
}

/**
 * GET /api/notifications
 * Returns unread notifications for the current staff member.
 * Query params: ?include_read=true to include read notifications (last 50).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session?.staff_id) return apiUnauthorized();

    const url = new URL(request.url);
    const includeRead = url.searchParams.get("include_read") === "true";

    const readFilter = includeRead ? "" : "AND is_read = FALSE";

    const notifications = await queryRows<Notification>(
      `SELECT id::text, title, body, entity_type, entity_id::text,
        link_url, source, is_read, created_at::text
       FROM ops.staff_notifications
       WHERE staff_id = $1 ${readFilter}
       ORDER BY created_at DESC
       LIMIT 50`,
      [session.staff_id]
    );

    const unreadCount = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM ops.staff_notifications
       WHERE staff_id = $1 AND is_read = FALSE`,
      [session.staff_id]
    );

    return apiSuccess({
      notifications,
      unread_count: unreadCount?.cnt ?? 0,
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return apiServerError("Failed to fetch notifications");
  }
}

/**
 * POST /api/notifications
 * Bulk action: mark all as read.
 * Body: { action: "mark_all_read" }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session?.staff_id) return apiUnauthorized();

    const body = await request.json();

    if (body.action === "mark_all_read") {
      await execute(
        `UPDATE ops.staff_notifications SET is_read = TRUE
         WHERE staff_id = $1 AND is_read = FALSE`,
        [session.staff_id]
      );
      return apiSuccess({ marked: true });
    }

    return apiServerError("Unknown action");
  } catch (error) {
    console.error("Error updating notifications:", error);
    return apiServerError("Failed to update notifications");
  }
}
