import { NextRequest, NextResponse } from "next/server";
import { queryOne, query } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";

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
      return NextResponse.json(
        { error: "Suggestion not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ suggestion });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error fetching template suggestion:", error);
    return NextResponse.json(
      { error: "Failed to fetch suggestion" },
      { status: 500 }
    );
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

    const body = await request.json();
    const { action, review_notes } = body;

    if (!action || !["approve", "reject"].includes(action)) {
      return NextResponse.json(
        { error: "action must be 'approve' or 'reject'" },
        { status: 400 }
      );
    }

    // Get the suggestion
    const suggestion = await queryOne<TemplateSuggestion>(`
      SELECT * FROM ops.email_template_suggestions WHERE suggestion_id = $1
    `, [id]);

    if (!suggestion) {
      return NextResponse.json(
        { error: "Suggestion not found" },
        { status: 404 }
      );
    }

    if (suggestion.status !== "pending") {
      return NextResponse.json(
        { error: "Suggestion has already been processed" },
        { status: 400 }
      );
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

    return NextResponse.json({
      success: true,
      action,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error processing template suggestion:", error);
    return NextResponse.json(
      { error: "Failed to process suggestion" },
      { status: 500 }
    );
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

    // Get the suggestion
    const suggestion = await queryOne<{ created_by: string; status: string }>(`
      SELECT created_by, status FROM ops.email_template_suggestions WHERE suggestion_id = $1
    `, [id]);

    if (!suggestion) {
      return NextResponse.json(
        { error: "Suggestion not found" },
        { status: 404 }
      );
    }

    // Only creator can withdraw, unless admin
    if (suggestion.created_by !== session.staff_id && session.auth_role !== "admin") {
      return NextResponse.json(
        { error: "Only the creator can withdraw this suggestion" },
        { status: 403 }
      );
    }

    if (suggestion.status !== "pending") {
      return NextResponse.json(
        { error: "Can only withdraw pending suggestions" },
        { status: 400 }
      );
    }

    await query(`
      UPDATE ops.email_template_suggestions
      SET status = 'withdrawn'
      WHERE suggestion_id = $1
    `, [id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error withdrawing template suggestion:", error);
    return NextResponse.json(
      { error: "Failed to withdraw suggestion" },
      { status: 500 }
    );
  }
}
