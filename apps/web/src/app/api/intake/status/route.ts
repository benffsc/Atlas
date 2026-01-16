import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      submission_id,
      // Unified status (primary)
      submission_status,
      appointment_date,
      priority_override,
      // Native status (kept for transition)
      status,
      final_category,
      review_notes,
      reviewed_by = "web_user",
      // Legacy field updates (backward compatibility)
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

    // Handle unified status update (primary)
    // Also sync to legacy fields for Airtable compatibility
    if (submission_status !== undefined) {
      const validStatuses = ["new", "in_progress", "scheduled", "complete", "archived"];
      if (!validStatuses.includes(submission_status)) {
        return NextResponse.json(
          { error: "Invalid submission_status. Valid values: new, in_progress, scheduled, complete, archived" },
          { status: 400 }
        );
      }
      updates.push(`submission_status = $${paramIndex}`);
      params.push(submission_status);
      paramIndex++;

      // Auto-sync to legacy fields for Airtable compatibility
      // Only if legacy fields weren't explicitly provided in this request
      if (legacy_submission_status === undefined) {
        const legacyStatusMap: Record<string, string | null> = {
          "new": "Pending Review",
          "in_progress": "Pending Review",
          "scheduled": "Booked",
          "complete": "Complete",
          "archived": "Complete", // Archived items show as complete in legacy
        };
        updates.push(`legacy_submission_status = $${paramIndex}`);
        params.push(legacyStatusMap[submission_status]);
        paramIndex++;
      }
    }

    // Handle appointment date
    // Also sync to legacy field for Airtable compatibility
    if (appointment_date !== undefined) {
      updates.push(`appointment_date = $${paramIndex}`);
      params.push(appointment_date || null);
      paramIndex++;

      // Auto-sync to legacy field if not explicitly provided
      if (legacy_appointment_date === undefined) {
        updates.push(`legacy_appointment_date = $${paramIndex}`);
        params.push(appointment_date || null);
        paramIndex++;
      }
    }

    // Handle priority override
    if (priority_override !== undefined) {
      const validPriorities = ["high", "normal", "low", null, ""];
      if (priority_override && !validPriorities.includes(priority_override)) {
        return NextResponse.json(
          { error: "Invalid priority_override. Valid values: high, normal, low" },
          { status: 400 }
        );
      }
      updates.push(`priority_override = $${paramIndex}`);
      params.push(priority_override || null);
      paramIndex++;
    }

    // Handle native status update (kept for transition)
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
