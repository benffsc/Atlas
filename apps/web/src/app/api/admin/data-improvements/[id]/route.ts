import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiBadRequest, apiForbidden, apiNotFound, apiServerError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/admin/data-improvements/[id]
 * Get a single data improvement
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // Require admin auth
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return apiForbidden("Admin access required");
    }

    const { id } = await params;

    const improvement = await queryOne(
      `
      SELECT
        di.*,
        a.display_name as assigned_name,
        rb.display_name as resolver_name,
        -- Get linked tippy feedback if source is tippy_feedback
        CASE WHEN di.source = 'tippy_feedback' THEN (
          SELECT row_to_json(tf.*)
          FROM ops.tippy_feedback tf
          WHERE tf.feedback_id = di.source_reference_id
        ) END as source_feedback
      FROM ops.data_improvements di
      LEFT JOIN ops.staff a ON a.staff_id = di.assigned_to
      LEFT JOIN ops.staff rb ON rb.staff_id = di.resolved_by
      WHERE di.improvement_id = $1
      `,
      [id]
    );

    if (!improvement) {
      return apiNotFound("Improvement", id);
    }

    return apiSuccess({ improvement });
  } catch (error) {
    console.error("Data improvement get error:", error);
    return apiServerError("Failed to fetch improvement");
  }
}

/**
 * PATCH /api/admin/data-improvements/[id]
 * Update a data improvement
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    // Require admin auth
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return apiForbidden("Admin access required");
    }

    const { id } = await params;
    const body = await request.json();
    const {
      status,
      priority,
      assigned_to,
      resolution_notes,
      fix_sql,
      suggested_fix,
    } = body;

    // Build update query dynamically
    const updates: string[] = [];
    const values: (string | null)[] = [];
    let paramIndex = 1;

    if (status) {
      // Validate status
      const validStatuses = ["pending", "confirmed", "in_progress", "resolved", "rejected", "wont_fix"];
      if (!validStatuses.includes(status)) {
        return apiBadRequest(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
      }
      updates.push(`status = $${paramIndex++}`);
      values.push(status);

      // Set resolved_by and resolved_at when marking as resolved
      if (["resolved", "rejected", "wont_fix"].includes(status)) {
        updates.push(`resolved_by = $${paramIndex++}`);
        values.push(session.staff_id);
        updates.push(`resolved_at = NOW()`);
      }
    }

    if (priority) {
      const validPriorities = ["critical", "high", "normal", "low"];
      if (!validPriorities.includes(priority)) {
        return apiBadRequest(`Invalid priority. Must be one of: ${validPriorities.join(", ")}`);
      }
      updates.push(`priority = $${paramIndex++}`);
      values.push(priority);
    }

    if (assigned_to !== undefined) {
      updates.push(`assigned_to = $${paramIndex++}`);
      values.push(assigned_to || null);
    }

    if (resolution_notes !== undefined) {
      updates.push(`resolution_notes = $${paramIndex++}`);
      values.push(resolution_notes);
    }

    if (fix_sql !== undefined) {
      updates.push(`fix_sql = $${paramIndex++}`);
      values.push(fix_sql);
    }

    if (suggested_fix !== undefined) {
      updates.push(`suggested_fix = $${paramIndex++}`);
      values.push(suggested_fix ? JSON.stringify(suggested_fix) : null);
    }

    if (updates.length === 0) {
      return apiBadRequest("No updates provided");
    }

    values.push(id);

    const result = await queryOne(
      `
      UPDATE ops.data_improvements
      SET ${updates.join(", ")}
      WHERE improvement_id = $${paramIndex}
      RETURNING
        improvement_id,
        status,
        priority,
        assigned_to,
        resolved_by,
        resolved_at,
        resolution_notes,
        updated_at
      `,
      values
    );

    if (!result) {
      return apiNotFound("Improvement", id);
    }

    return apiSuccess({
      success: true,
      improvement: result,
    });
  } catch (error) {
    console.error("Data improvement update error:", error);
    return apiServerError("Failed to update improvement");
  }
}
