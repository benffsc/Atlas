import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      submission_id,
      status,
      final_category,
      review_notes,
      reviewed_by = "web_user",
      // Legacy field updates
      legacy_status,
      legacy_submission_status,
      legacy_appointment_date,
      legacy_notes,
    } = body;

    if (!submission_id) {
      return NextResponse.json(
        { error: "submission_id is required" },
        { status: 400 }
      );
    }

    const updates: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];
    let paramIndex = 1;

    // Handle standard status update
    if (status !== undefined) {
      const validStatuses = [
        "new",
        "triaged",
        "reviewed",
        "request_created",
        "redirected",
        "client_handled",  // New: client will handle it themselves (e.g., book their own cat)
        "archived"
      ];
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { error: "Invalid status" },
          { status: 400 }
        );
      }
      updates.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;

      // If marking as reviewed, set reviewed_by and reviewed_at
      if (status === "reviewed") {
        updates.push(`reviewed_by = $${paramIndex}`);
        params.push(reviewed_by);
        paramIndex++;

        updates.push(`reviewed_at = NOW()`);

        if (review_notes) {
          updates.push(`review_notes = $${paramIndex}`);
          params.push(review_notes);
          paramIndex++;
        }
        if (final_category) {
          updates.push(`final_category = $${paramIndex}`);
          params.push(final_category);
          paramIndex++;
        }
      }
    }

    // Handle legacy field updates (for compatibility with Jami's workflow)
    if (legacy_status !== undefined) {
      updates.push(`legacy_status = $${paramIndex}`);
      params.push(legacy_status || null);
      paramIndex++;
    }
    if (legacy_submission_status !== undefined) {
      updates.push(`legacy_submission_status = $${paramIndex}`);
      params.push(legacy_submission_status || null);
      paramIndex++;
    }
    if (legacy_appointment_date !== undefined) {
      updates.push(`legacy_appointment_date = $${paramIndex}`);
      params.push(legacy_appointment_date || null);
      paramIndex++;
    }
    if (legacy_notes !== undefined) {
      updates.push(`legacy_notes = $${paramIndex}`);
      params.push(legacy_notes || null);
      paramIndex++;
    }

    // Handle review_notes update separately (when not changing status)
    if (review_notes !== undefined && status === undefined) {
      updates.push(`review_notes = $${paramIndex}`);
      params.push(review_notes);
      paramIndex++;
    }

    // Add submission_id as final parameter
    params.push(submission_id);

    const sql = `
      UPDATE trapper.web_intake_submissions
      SET ${updates.join(", ")}
      WHERE submission_id = $${paramIndex}
    `;

    await query(sql, params);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Status update error:", err);
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}
