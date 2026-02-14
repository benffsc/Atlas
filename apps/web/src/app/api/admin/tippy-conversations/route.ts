import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";

/**
 * GET /api/admin/tippy-conversations
 * List Tippy conversations for admin review
 */
export async function GET(request: NextRequest) {
  try {
    // Require admin auth
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");
    const staffId = searchParams.get("staff_id");
    const hasFeedback = searchParams.get("has_feedback");
    const tool = searchParams.get("tool");

    // Build WHERE clauses
    const whereClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (staffId) {
      whereClauses.push(`c.staff_id = $${paramIndex}`);
      params.push(staffId);
      paramIndex++;
    }

    if (hasFeedback === "true") {
      whereClauses.push(`EXISTS (SELECT 1 FROM ops.tippy_feedback f WHERE f.conversation_id = c.conversation_id::text)`);
    }

    if (tool) {
      whereClauses.push(`$${paramIndex} = ANY(c.tools_used)`);
      params.push(tool);
      paramIndex++;
    }

    const whereClause = whereClauses.length > 0
      ? `WHERE ${whereClauses.join(" AND ")}`
      : "";

    // Get conversations with summary info
    const conversations = await queryRows(
      `
      SELECT
        c.conversation_id,
        c.staff_id,
        s.display_name as staff_name,
        c.started_at,
        c.ended_at,
        c.message_count,
        c.tools_used,
        c.is_archived,
        -- First user message preview
        (
          SELECT content
          FROM ops.tippy_messages m
          WHERE m.conversation_id = c.conversation_id
            AND m.role = 'user'
          ORDER BY m.created_at
          LIMIT 1
        ) AS first_message,
        -- Has feedback
        EXISTS (
          SELECT 1 FROM ops.tippy_feedback f
          WHERE f.conversation_id = c.conversation_id::text
        ) AS has_feedback,
        -- Feedback count
        (
          SELECT COUNT(*) FROM ops.tippy_feedback f
          WHERE f.conversation_id = c.conversation_id::text
        ) AS feedback_count
      FROM ops.tippy_conversations c
      LEFT JOIN ops.staff s ON s.staff_id = c.staff_id
      ${whereClause}
      ORDER BY c.started_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
      [...params, limit, offset]
    );

    // Get summary stats
    const stats = await queryOne(
      `
      SELECT
        COUNT(*) as total_conversations,
        COUNT(DISTINCT staff_id) as unique_staff,
        SUM(message_count) as total_messages,
        (SELECT COUNT(*) FROM ops.tippy_feedback) as total_feedback
      FROM ops.tippy_conversations
      `
    );

    // Get unique tools used
    const tools = await queryRows<{ tool: string }>(
      `
      SELECT DISTINCT unnest(tools_used) as tool
      FROM ops.tippy_conversations
      WHERE tools_used IS NOT NULL AND array_length(tools_used, 1) > 0
      ORDER BY tool
      `
    );

    return NextResponse.json({
      conversations,
      stats,
      tools: tools.map((t) => t.tool),
      pagination: {
        limit,
        offset,
        hasMore: conversations.length === limit,
      },
    });
  } catch (error) {
    console.error("Admin tippy conversations list error:", error);
    return NextResponse.json(
      { error: "Failed to fetch conversations" },
      { status: 500 }
    );
  }
}
