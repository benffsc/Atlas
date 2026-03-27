import { NextRequest } from "next/server";
import { apiSuccess, apiNotFound, apiServerError } from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";
import { getSession } from "@/lib/auth";
import { queryRows, queryOne } from "@/lib/db";

/**
 * GET /api/tippy/conversations/[id] — Load conversation messages
 * FFS-863: Staff can resume past conversations.
 * Validates conversation belongs to authenticated user.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    requireValidUUID(id, "conversation");

    const session = await getSession(request);
    if (!session?.staff_id) {
      return apiNotFound("Conversation not found");
    }

    // Validate ownership
    const conversation = await queryOne<{
      conversation_id: string;
      started_at: string;
    }>(
      `SELECT conversation_id, started_at
       FROM ops.tippy_conversations
       WHERE conversation_id = $1 AND staff_id = $2`,
      [id, session.staff_id]
    );

    if (!conversation) {
      return apiNotFound("Conversation not found");
    }

    // Load messages (user + assistant only, exclude briefing markers)
    const messages = await queryRows<{
      message_id: string;
      role: string;
      content: string;
      created_at: string;
    }>(
      `SELECT message_id, role, content, created_at
       FROM ops.tippy_messages
       WHERE conversation_id = $1
         AND role IN ('user', 'assistant')
         AND content != '__shift_briefing__'
       ORDER BY created_at ASC`,
      [id]
    );

    return apiSuccess({
      conversation_id: conversation.conversation_id,
      started_at: conversation.started_at,
      messages,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      const apiErr = error as Error & { status: number };
      return new Response(
        JSON.stringify({ success: false, error: { message: error.message, code: apiErr.status } }),
        { status: apiErr.status, headers: { "Content-Type": "application/json" } }
      );
    }
    console.error("Failed to load Tippy conversation:", error);
    return apiServerError("Failed to load conversation");
  }
}
