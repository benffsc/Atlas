import { NextRequest } from "next/server";
import { apiSuccess, apiServerError } from "@/lib/api-response";
import { parsePagination } from "@/lib/api-validation";
import { getSession } from "@/lib/auth";
import { queryRows, queryOne } from "@/lib/db";

/**
 * GET /api/tippy/conversations — List own conversations
 * FFS-863: Staff can browse their past Tippy conversations.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session?.staff_id) {
      return apiSuccess({ conversations: [], pagination: { limit: 20, offset: 0, hasMore: false } });
    }

    const { limit, offset } = parsePagination(request.nextUrl.searchParams, {
      defaultLimit: 20,
      maxLimit: 50,
    });

    const conversations = await queryRows<{
      conversation_id: string;
      started_at: string;
      ended_at: string | null;
      message_count: number;
      summary: string | null;
      first_message: string | null;
    }>(
      `SELECT
        c.conversation_id,
        c.started_at::text,
        c.updated_at::text AS ended_at,
        (SELECT COUNT(*)::int FROM ops.tippy_messages m WHERE m.conversation_id = c.conversation_id) AS message_count,
        NULL::text AS summary,
        (
          SELECT LEFT(m.content, 100)
          FROM ops.tippy_messages m
          WHERE m.conversation_id = c.conversation_id
            AND m.role = 'user'
            AND m.content != '__shift_briefing__'
          ORDER BY m.created_at ASC
          LIMIT 1
        ) AS first_message
      FROM ops.tippy_conversations c
      WHERE c.staff_id = $1
      ORDER BY c.started_at DESC
      LIMIT $2 OFFSET $3`,
      [session.staff_id, limit + 1, offset]
    );

    // Filter out empty conversations (no messages) in application code
    const nonEmpty = conversations.filter(c => c.message_count > 0);

    const hasMore = nonEmpty.length > limit;
    const results = hasMore ? nonEmpty.slice(0, limit) : nonEmpty;

    return apiSuccess({
      conversations: results,
      pagination: { limit, offset, hasMore },
    });
  } catch (error) {
    console.error("Failed to list Tippy conversations:", error);
    return apiServerError("Failed to load conversations");
  }
}
