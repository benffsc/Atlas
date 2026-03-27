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
        c.started_at,
        c.ended_at,
        c.message_count,
        c.summary,
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
        AND c.is_archived = false
        AND c.message_count > 0
      ORDER BY c.started_at DESC
      LIMIT $2 OFFSET $3`,
      [session.staff_id, limit + 1, offset]
    );

    const hasMore = conversations.length > limit;
    const results = hasMore ? conversations.slice(0, limit) : conversations;

    return apiSuccess({
      conversations: results,
      pagination: { limit, offset, hasMore },
    });
  } catch (error) {
    console.error("Failed to list Tippy conversations:", error);
    return apiServerError("Failed to load conversations");
  }
}
