import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";

/**
 * GET /api/admin/tippy-feedback
 * List Tippy feedback for admin review
 */
export async function GET(request: NextRequest) {
  try {
    // Require admin auth
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "pending";
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Get feedback with staff info
    const feedback = await queryRows(
      `
      SELECT
        tf.feedback_id,
        tf.staff_id,
        s.display_name as staff_name,
        tf.tippy_message,
        tf.user_correction,
        tf.conversation_id,
        tf.entity_type,
        tf.entity_id,
        tf.feedback_type,
        tf.status,
        tf.reviewed_by,
        rb.display_name as reviewer_name,
        tf.reviewed_at,
        tf.review_notes,
        tf.data_improvement_id,
        tf.created_at,
        -- Entity details based on type
        CASE
          WHEN tf.entity_type = 'place' THEN (SELECT label FROM sot.places WHERE place_id = tf.entity_id)
          WHEN tf.entity_type = 'cat' THEN (SELECT name FROM sot.cats WHERE cat_id = tf.entity_id)
          WHEN tf.entity_type = 'person' THEN (SELECT display_name FROM sot.people WHERE person_id = tf.entity_id)
          WHEN tf.entity_type = 'request' THEN (SELECT short_address FROM ops.requests WHERE request_id = tf.entity_id)
          ELSE NULL
        END as entity_name
      FROM ops.tippy_feedback tf
      LEFT JOIN ops.staff s ON s.staff_id = tf.staff_id
      LEFT JOIN ops.staff rb ON rb.staff_id = tf.reviewed_by
      WHERE ($1 = 'all' OR tf.status = $1)
      ORDER BY tf.created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [status, limit, offset]
    );

    // Get counts by status
    const counts = await queryOne(
      `
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'reviewed') as reviewed,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
        COUNT(*) as total
      FROM ops.tippy_feedback
      `
    );

    return NextResponse.json({
      feedback,
      counts,
      pagination: {
        limit,
        offset,
        hasMore: feedback.length === limit,
      },
    });
  } catch (error) {
    console.error("Admin tippy feedback list error:", error);
    return NextResponse.json(
      { error: "Failed to fetch feedback" },
      { status: 500 }
    );
  }
}
