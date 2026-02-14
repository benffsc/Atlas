import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/admin/tippy-conversations/[id]
 * Get a single conversation with all messages
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // Require admin auth
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;

    // Get conversation details
    const conversation = await queryOne(
      `
      SELECT
        c.conversation_id,
        c.staff_id,
        s.display_name as staff_name,
        s.email as staff_email,
        c.started_at,
        c.ended_at,
        c.message_count,
        c.tools_used,
        c.is_archived
      FROM ops.tippy_conversations c
      LEFT JOIN ops.staff s ON s.staff_id = c.staff_id
      WHERE c.conversation_id = $1
      `,
      [id]
    );

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Get all messages in the conversation
    const messages = await queryRows(
      `
      SELECT
        message_id,
        role,
        content,
        tool_calls,
        tool_results,
        tokens_used,
        created_at
      FROM ops.tippy_messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC
      `,
      [id]
    );

    // Get any feedback associated with this conversation
    const feedback = await queryRows(
      `
      SELECT
        feedback_id,
        tippy_message,
        user_correction,
        entity_type,
        entity_id,
        feedback_type,
        status,
        created_at
      FROM ops.tippy_feedback
      WHERE conversation_id = $1
      ORDER BY created_at ASC
      `,
      [id]
    );

    return NextResponse.json({
      conversation,
      messages,
      feedback,
    });
  } catch (error) {
    console.error("Admin tippy conversation detail error:", error);
    return NextResponse.json(
      { error: "Failed to fetch conversation" },
      { status: 500 }
    );
  }
}
