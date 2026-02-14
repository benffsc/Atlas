import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/admin/tippy-feedback/[id]
 * Update feedback status
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    // Require admin auth
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { status, review_notes } = body;

    // Validate status
    const validStatuses = ["pending", "reviewed", "resolved", "rejected"];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: (string | null)[] = [];
    let paramIndex = 1;

    if (status) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);

      // Set reviewed_at and reviewed_by when status changes from pending
      updates.push(`reviewed_by = $${paramIndex++}`);
      values.push(session.staff_id);
      updates.push(`reviewed_at = NOW()`);
    }

    if (review_notes !== undefined) {
      updates.push(`review_notes = $${paramIndex++}`);
      values.push(review_notes);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No updates provided" }, { status: 400 });
    }

    values.push(id);

    const result = await queryOne(
      `
      UPDATE ops.tippy_feedback
      SET ${updates.join(", ")}
      WHERE feedback_id = $${paramIndex}
      RETURNING
        feedback_id,
        status,
        reviewed_by,
        reviewed_at,
        review_notes
      `,
      values
    );

    if (!result) {
      return NextResponse.json({ error: "Feedback not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      feedback: result,
    });
  } catch (error) {
    console.error("Admin tippy feedback update error:", error);
    return NextResponse.json(
      { error: "Failed to update feedback" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/tippy-feedback/[id]
 * Get single feedback detail
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // Require admin auth
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;

    const feedback = await queryOne(
      `
      SELECT
        tf.*,
        s.display_name as staff_name,
        s.email as staff_email,
        rb.display_name as reviewer_name
      FROM ops.tippy_feedback tf
      LEFT JOIN ops.staff s ON s.staff_id = tf.staff_id
      LEFT JOIN ops.staff rb ON rb.staff_id = tf.reviewed_by
      WHERE tf.feedback_id = $1
      `,
      [id]
    );

    if (!feedback) {
      return NextResponse.json({ error: "Feedback not found" }, { status: 404 });
    }

    return NextResponse.json({ feedback });
  } catch (error) {
    console.error("Admin tippy feedback get error:", error);
    return NextResponse.json(
      { error: "Failed to fetch feedback" },
      { status: 500 }
    );
  }
}
