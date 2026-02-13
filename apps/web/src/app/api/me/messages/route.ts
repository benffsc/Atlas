import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { queryRows, queryOne } from "@/lib/db";

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
  created_at: string;
  age_display: string;
}

/**
 * GET /api/me/messages
 *
 * List current staff member's messages
 * Query params:
 *   - status: unread|read|archived|all (default: unread)
 *   - direction: inbox|sent (default: inbox)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);

    if (!session?.staff_id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "unread";
    const direction = url.searchParams.get("direction") || "inbox";
    const limit = parseInt(url.searchParams.get("limit") || "50");

    // Build status filter
    let statusFilter = "";
    if (status !== "all") {
      statusFilter = `AND m.status = '${status}'`;
    }

    // Build direction filter
    const directionFilter =
      direction === "sent"
        ? `m.sender_staff_id = $1`
        : `m.recipient_staff_id = $1`;

    const messages = await queryRows<StaffMessage>(
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
        m.created_at,
        CASE
          WHEN m.created_at > NOW() - INTERVAL '1 hour' THEN
            EXTRACT(MINUTE FROM NOW() - m.created_at)::int || 'm ago'
          WHEN m.created_at > NOW() - INTERVAL '1 day' THEN
            EXTRACT(HOUR FROM NOW() - m.created_at)::int || 'h ago'
          ELSE
            TO_CHAR(m.created_at, 'Mon DD')
        END as age_display
      FROM ops.staff_messages m
      LEFT JOIN ops.staff s ON s.staff_id = m.sender_staff_id
      JOIN ops.staff r ON r.staff_id = m.recipient_staff_id
      WHERE ${directionFilter}
        ${statusFilter}
      ORDER BY m.created_at DESC
      LIMIT $2`,
      [session.staff_id, limit]
    );

    // Get unread count for badge
    const unreadCount = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int as count
       FROM ops.staff_messages
       WHERE recipient_staff_id = $1 AND status = 'unread'`,
      [session.staff_id]
    );

    return NextResponse.json({
      messages,
      unread_count: unreadCount?.count || 0,
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/me/messages
 *
 * Send a new message to another staff member
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);

    if (!session?.staff_id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      recipient_staff_id,
      recipient_name,
      subject,
      content,
      priority,
      entity_type,
      entity_id,
      entity_label,
    } = body;

    // Either recipient_staff_id or recipient_name required
    if (!recipient_staff_id && !recipient_name) {
      return NextResponse.json(
        { error: "recipient_staff_id or recipient_name is required" },
        { status: 400 }
      );
    }

    if (!subject || !content) {
      return NextResponse.json(
        { error: "subject and content are required" },
        { status: 400 }
      );
    }

    // If recipient_name provided, use the SQL function to find them
    if (recipient_name && !recipient_staff_id) {
      const result = await queryOne<{
        success: boolean;
        message_id?: string;
        recipient_name?: string;
        recipient_id?: string;
        error?: string;
      }>(
        `SELECT * FROM trapper.send_staff_message(
          $1, $2, $3, $4, $5, $6, $7, $8, 'dashboard', NULL
        )`,
        [
          session.staff_id,
          recipient_name,
          subject,
          content,
          priority || "normal",
          entity_type || null,
          entity_id || null,
          entity_label || null,
        ]
      );

      if (!result) {
        return NextResponse.json(
          { error: "Failed to send message" },
          { status: 500 }
        );
      }

      // The function returns JSONB, need to parse if it's a string
      const parsed =
        typeof result === "string" ? JSON.parse(result) : result;

      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error || "Failed to send message" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        message_id: parsed.message_id,
        recipient_name: parsed.recipient_name,
      });
    }

    // Direct insert if recipient_staff_id provided
    const senderName = await queryOne<{ display_name: string }>(
      `SELECT display_name FROM ops.staff WHERE staff_id = $1`,
      [session.staff_id]
    );

    const result = await queryOne<{ message_id: string }>(
      `INSERT INTO ops.staff_messages (
        sender_staff_id,
        sender_name,
        recipient_staff_id,
        subject,
        content,
        priority,
        entity_type,
        entity_id,
        entity_label,
        source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'dashboard')
      RETURNING message_id`,
      [
        session.staff_id,
        senderName?.display_name || null,
        recipient_staff_id,
        subject,
        content,
        priority || "normal",
        entity_type || null,
        entity_id || null,
        entity_label || null,
      ]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to send message" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message_id: result.message_id,
    });
  } catch (error) {
    console.error("Error sending message:", error);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}
