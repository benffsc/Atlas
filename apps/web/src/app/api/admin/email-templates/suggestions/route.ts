import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne, query } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";

interface TemplateSuggestion {
  suggestion_id: string;
  template_id: string;
  template_key: string;
  template_name: string;
  suggested_name: string | null;
  suggested_subject: string | null;
  suggested_body_html: string | null;
  suggested_body_text: string | null;
  suggestion_notes: string | null;
  status: string;
  current_subject: string | null;
  current_body_html: string | null;
  suggested_by_name: string;
  suggested_by_email: string;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
}

// GET /api/admin/email-templates/suggestions - List suggestions
export async function GET(request: NextRequest) {
  try {
    const session = await requireRole(request, ["admin", "staff"]);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "pending";
    const myOnly = searchParams.get("my_only") === "true";

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (status !== "all") {
      conditions.push(`ts.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    // Staff can only see their own suggestions by default, admins see all
    if (myOnly || session.auth_role !== "admin") {
      conditions.push(`ts.created_by = $${paramIndex}`);
      params.push(session.staff_id);
      paramIndex++;
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const suggestions = await queryRows<TemplateSuggestion>(`
      SELECT
        ts.suggestion_id,
        ts.template_id,
        ts.template_key,
        et.name AS template_name,
        ts.suggested_name,
        ts.suggested_subject,
        ts.suggested_body_html,
        ts.suggested_body_text,
        ts.suggestion_notes,
        ts.status,
        et.subject AS current_subject,
        et.body_html AS current_body_html,
        s.display_name AS suggested_by_name,
        s.email AS suggested_by_email,
        ts.created_at::TEXT,
        ts.reviewed_by,
        ts.reviewed_at::TEXT,
        ts.review_notes
      FROM ops.email_template_suggestions ts
      JOIN ops.email_templates et ON et.template_id = ts.template_id
      JOIN ops.staff s ON s.staff_id = ts.created_by
      ${whereClause}
      ORDER BY ts.created_at DESC
    `, params);

    return NextResponse.json({ suggestions });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error fetching template suggestions:", error);
    return NextResponse.json(
      { error: "Failed to fetch suggestions" },
      { status: 500 }
    );
  }
}

// POST /api/admin/email-templates/suggestions - Create a new suggestion
export async function POST(request: NextRequest) {
  try {
    const session = await requireRole(request, ["admin", "staff"]);

    const body = await request.json();
    const {
      template_id,
      suggested_name,
      suggested_subject,
      suggested_body_html,
      suggested_body_text,
      suggestion_notes,
    } = body;

    if (!template_id) {
      return NextResponse.json(
        { error: "template_id is required" },
        { status: 400 }
      );
    }

    // Check at least one change is provided
    if (!suggested_name && !suggested_subject && !suggested_body_html && !suggested_body_text) {
      return NextResponse.json(
        { error: "At least one suggested change is required" },
        { status: 400 }
      );
    }

    // Get template info
    const template = await queryOne<{ template_key: string; edit_restricted: boolean }>(`
      SELECT template_key, COALESCE(edit_restricted, TRUE) AS edit_restricted
      FROM ops.email_templates
      WHERE template_id = $1
    `, [template_id]);

    if (!template) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    // If template is not restricted and user is admin, they should just edit directly
    // But we still allow suggestions for tracking purposes

    const result = await queryOne<{ suggestion_id: string }>(`
      INSERT INTO ops.email_template_suggestions (
        template_id,
        template_key,
        suggested_name,
        suggested_subject,
        suggested_body_html,
        suggested_body_text,
        suggestion_notes,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING suggestion_id
    `, [
      template_id,
      template.template_key,
      suggested_name || null,
      suggested_subject || null,
      suggested_body_html || null,
      suggested_body_text || null,
      suggestion_notes || null,
      session.staff_id,
    ]);

    return NextResponse.json({
      success: true,
      suggestion_id: result?.suggestion_id,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error creating template suggestion:", error);
    return NextResponse.json(
      { error: "Failed to create suggestion" },
      { status: 500 }
    );
  }
}
