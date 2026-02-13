import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";

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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      return NextResponse.json(
        { error: "Message not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ message });
  } catch (error) {
    console.error("Error fetching message:", error);
    return NextResponse.json(
      { error: "Failed to fetch message" },
      { status: 500 }
    );
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      return NextResponse.json(
        { error: "Message not found" },
        { status: 404 }
      );
    }

    if (!status) {
      return NextResponse.json(
        { error: "status is required" },
        { status: 400 }
      );
    }

    const validStatuses = ["unread", "read", "archived"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: "Invalid status. Must be: unread, read, or archived" },
        { status: 400 }
      );
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
      return NextResponse.json(
        { error: "Failed to update message" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Message marked as ${status}`,
    });
  } catch (error) {
    console.error("Error updating message:", error);
    return NextResponse.json(
      { error: "Failed to update message" },
      { status: 500 }
    );
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      return NextResponse.json(
        { error: "Message not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Message archived",
    });
  } catch (error) {
    console.error("Error archiving message:", error);
    return NextResponse.json(
      { error: "Failed to archive message" },
      { status: 500 }
    );
  }
}
