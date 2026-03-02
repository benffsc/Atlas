import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { apiSuccess, apiUnauthorized, apiBadRequest, apiNotFound, apiServerError } from "@/lib/api-response";

interface StaffMessage {
  message_id: string;
  sender_staff_id: string | null;
  sender_name: string;
  recipient_staff_id: string;
  recipient_name: string;
  subject: string;
  content: string;
  priority: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  status: string;
  read_at: string | null;
  source: string;
  conversation_id: string | null;
  created_at: string;
}

/**
 * GET /api/me/messages/[id]
 *
 * Get a single message with full details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);

    if (!session?.staff_id) {
      return apiUnauthorized();
    }

    const { id } = await params;

    const message = await queryOne<StaffMessage>(
      `SELECT
        m.message_id,
        m.sender_staff_id,
        COALESCE(m.sender_name, s.display_name, 'System') as sender_name,
        m.recipient_staff_id,
        r.display_name as recipient_name,
        m.subject,
        m.content,
        m.priority,
        m.entity_type,
        m.entity_id,
        m.entity_label,
        m.status,
        m.read_at,
        m.source,
        m.conversation_id,
        m.created_at
      FROM ops.staff_messages m
      LEFT JOIN ops.staff s ON s.staff_id = m.sender_staff_id
      JOIN ops.staff r ON r.staff_id = m.recipient_staff_id
      WHERE m.message_id = $1
        AND (m.recipient_staff_id = $2 OR m.sender_staff_id = $2)`,
      [id, session.staff_id]
    );

    if (!message) {
      return apiNotFound("message", id);
    }

    return apiSuccess({ message });
  } catch (error) {
    console.error("Error fetching message:", error);
    return apiServerError("Failed to fetch message");
  }
}

/**
 * PATCH /api/me/messages/[id]
 *
 * Update message status (mark as read, archive)
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
    const { status } = body;

    // Verify ownership (must be recipient to update status)
    const existing = await queryOne<{ message_id: string }>(
      `SELECT message_id FROM ops.staff_messages
       WHERE message_id = $1 AND recipient_staff_id = $2`,
      [id, session.staff_id]
    );

    if (!existing) {
      return apiNotFound("message", id);
    }

    if (!status) {
      return apiBadRequest("status is required");
    }

    const validStatuses = ["unread", "read", "archived"];
    if (!validStatuses.includes(status)) {
      return apiBadRequest("Invalid status. Must be: unread, read, or archived");
    }

    // Update status and read_at if marking as read
    const result = await queryOne<{ message_id: string }>(
      `UPDATE ops.staff_messages
       SET
         status = $1,
         read_at = ${status === "read" ? "COALESCE(read_at, NOW())" : "read_at"}
       WHERE message_id = $2
       RETURNING message_id`,
      [status, id]
    );

    if (!result) {
      return apiServerError("Failed to update message");
    }

    return apiSuccess({
      success: true,
      message: `Message marked as ${status}`,
    });
  } catch (error) {
    console.error("Error updating message:", error);
    return apiServerError("Failed to update message");
  }
}

/**
 * DELETE /api/me/messages/[id]
 *
 * Archive a message (soft delete)
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

    // Verify ownership (must be recipient) and archive
    const result = await queryOne<{ message_id: string }>(
      `UPDATE ops.staff_messages
       SET status = 'archived'
       WHERE message_id = $1 AND recipient_staff_id = $2
       RETURNING message_id`,
      [id, session.staff_id]
    );

    if (!result) {
      return apiNotFound("message", id);
    }

    return apiSuccess({
      success: true,
      message: "Message archived",
    });
  } catch (error) {
    console.error("Error archiving message:", error);
    return apiServerError("Failed to archive message");
  }
}
