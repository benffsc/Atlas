import { NextRequest } from "next/server";
import { queryOne, query } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiError, apiBadRequest, apiForbidden, apiNotFound, apiServerError } from "@/lib/api-response";

interface TemplateSuggestion {
  suggestion_id: string;
  template_id: string;
  template_key: string;
  suggested_name: string | null;
  suggested_subject: string | null;
  suggested_body_html: string | null;
  suggested_body_text: string | null;
  suggestion_notes: string | null;
  status: string;
  created_by: string;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
}

// GET /api/admin/email-templates/suggestions/[id] - Get single suggestion
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole(request, ["admin", "staff"]);
    const { id } = await params;
    requireValidUUID(id, "suggestion");

    const suggestion = await queryOne<TemplateSuggestion>(`
      SELECT
        ts.suggestion_id,
        ts.template_id,
        ts.template_key,
        ts.suggested_name,
        ts.suggested_subject,
        ts.suggested_body_html,
        ts.suggested_body_text,
        ts.suggestion_notes,
        ts.status,
        ts.created_by,
        ts.created_at::TEXT,
        ts.reviewed_by,
        ts.reviewed_at::TEXT,
        ts.review_notes
      FROM ops.email_template_suggestions ts
      WHERE ts.suggestion_id = $1
    `, [id]);

    if (!suggestion) {
      return apiNotFound("suggestion", id);
    }

    return apiSuccess({ suggestion });
  } catch (error) {
    if (error instanceof AuthError) {
      return apiError(error.message, error.statusCode);
    }
    console.error("Error fetching template suggestion:", error);
    return apiServerError("Failed to fetch suggestion");
  }
}

// PATCH /api/admin/email-templates/suggestions/[id] - Approve or reject suggestion
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole(request, ["admin"]);
    const { id } = await params;
    requireValidUUID(id, "suggestion");

    const body = await request.json();
    const { action, review_notes } = body;

    if (!action || !["approve", "reject"].includes(action)) {
      return apiBadRequest("action must be 'approve' or 'reject'");
    }

    // Get the suggestion
    const suggestion = await queryOne<TemplateSuggestion>(`
      SELECT * FROM ops.email_template_suggestions WHERE suggestion_id = $1
    `, [id]);

    if (!suggestion) {
      return apiNotFound("suggestion", id);
    }

    if (suggestion.status !== "pending") {
      return apiBadRequest("Suggestion has already been processed");
    }

    if (action === "approve") {
      // Apply the suggested changes to the template
      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (suggestion.suggested_name) {
        updates.push(`name = $${paramIndex++}`);
        values.push(suggestion.suggested_name);
      }
      if (suggestion.suggested_subject) {
        updates.push(`subject = $${paramIndex++}`);
        values.push(suggestion.suggested_subject);
      }
      if (suggestion.suggested_body_html) {
        updates.push(`body_html = $${paramIndex++}`);
        values.push(suggestion.suggested_body_html);
      }
      if (suggestion.suggested_body_text) {
        updates.push(`body_text = $${paramIndex++}`);
        values.push(suggestion.suggested_body_text);
      }

      // Add audit columns
      updates.push(`last_edited_by = $${paramIndex++}`);
      values.push(session.staff_id);
      updates.push(`last_edited_at = NOW()`);
      updates.push(`updated_at = NOW()`);

      values.push(suggestion.template_id);

      if (updates.length > 0) {
        await query(`
          UPDATE ops.email_templates
          SET ${updates.join(", ")}
          WHERE template_id = $${paramIndex}
        `, values);
      }
    }

    // Update the suggestion status
    await query(`
      UPDATE ops.email_template_suggestions
      SET
        status = $1,
        reviewed_by = $2,
        reviewed_at = NOW(),
        review_notes = $3
      WHERE suggestion_id = $4
    `, [
      action === "approve" ? "approved" : "rejected",
      session.staff_id,
      review_notes || null,
      id,
    ]);

    return apiSuccess({
      success: true,
      action,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return apiError(error.message, error.statusCode);
    }
    console.error("Error processing template suggestion:", error);
    return apiServerError("Failed to process suggestion");
  }
}

// DELETE /api/admin/email-templates/suggestions/[id] - Withdraw suggestion (creator only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole(request, ["admin", "staff"]);
    const { id } = await params;
    requireValidUUID(id, "suggestion");

    // Get the suggestion
    const suggestion = await queryOne<{ created_by: string; status: string }>(`
      SELECT created_by, status FROM ops.email_template_suggestions WHERE suggestion_id = $1
    `, [id]);

    if (!suggestion) {
      return apiNotFound("suggestion", id);
    }

    // Only creator can withdraw, unless admin
    if (suggestion.created_by !== session.staff_id && session.auth_role !== "admin") {
      return apiForbidden("Only the creator can withdraw this suggestion");
    }

    if (suggestion.status !== "pending") {
      return apiBadRequest("Can only withdraw pending suggestions");
    }

    await query(`
      UPDATE ops.email_template_suggestions
      SET status = 'withdrawn'
      WHERE suggestion_id = $1
    `, [id]);

    return apiSuccess({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return apiError(error.message, error.statusCode);
    }
    console.error("Error withdrawing template suggestion:", error);
    return apiServerError("Failed to withdraw suggestion");
  }
}
