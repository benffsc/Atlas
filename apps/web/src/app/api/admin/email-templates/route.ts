import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne, query } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";

interface EmailTemplate {
  template_id: string;
  template_key: string;
  name: string;
  description: string | null;
  subject: string;
  body_html: string;
  body_text: string | null;
  placeholders: string[] | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// GET /api/admin/email-templates - List all templates
export async function GET(request: NextRequest) {
  try {
    // Require admin role
    await requireRole(request, ["admin"]);
    const templates = await queryRows<EmailTemplate>(`
      SELECT
        template_id,
        template_key,
        name,
        description,
        subject,
        body_html,
        body_text,
        placeholders,
        is_active,
        created_at::TEXT,
        updated_at::TEXT
      FROM trapper.email_templates
      ORDER BY name
    `);

    // Get send stats for each template
    const stats = await queryRows<{ template_key: string; total: number; last_sent: string }>(`
      SELECT
        template_key,
        COUNT(*)::INT AS total,
        MAX(sent_at)::TEXT AS last_sent
      FROM trapper.sent_emails
      WHERE status = 'sent'
      GROUP BY template_key
    `);

    const statsMap = new Map(stats.map(s => [s.template_key, s]));

    const templatesWithStats = templates.map(t => ({
      ...t,
      send_count: statsMap.get(t.template_key)?.total || 0,
      last_sent: statsMap.get(t.template_key)?.last_sent || null,
    }));

    return NextResponse.json({ templates: templatesWithStats });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error fetching email templates:", error);
    return NextResponse.json(
      { error: "Failed to fetch templates" },
      { status: 500 }
    );
  }
}

// POST /api/admin/email-templates - Create new template
export async function POST(request: NextRequest) {
  try {
    // Require admin role
    await requireRole(request, ["admin"]);

    const body = await request.json();
    const {
      template_key,
      name,
      description,
      subject,
      body_html,
      body_text,
      placeholders,
    } = body;

    if (!template_key || !name || !subject || !body_html) {
      return NextResponse.json(
        { error: "template_key, name, subject, and body_html are required" },
        { status: 400 }
      );
    }

    // Check if key already exists
    const existing = await queryOne<{ template_id: string }>(
      `SELECT template_id FROM trapper.email_templates WHERE template_key = $1`,
      [template_key]
    );

    if (existing) {
      return NextResponse.json(
        { error: "Template key already exists" },
        { status: 400 }
      );
    }

    const result = await queryOne<{ template_id: string }>(`
      INSERT INTO trapper.email_templates (
        template_key, name, description, subject, body_html, body_text, placeholders
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING template_id
    `, [
      template_key,
      name,
      description || null,
      subject,
      body_html,
      body_text || null,
      placeholders ? JSON.stringify(placeholders) : null,
    ]);

    return NextResponse.json({
      success: true,
      template_id: result?.template_id,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error creating email template:", error);
    return NextResponse.json(
      { error: "Failed to create template" },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/email-templates - Update template
export async function PATCH(request: NextRequest) {
  try {
    // Require admin role
    await requireRole(request, ["admin"]);

    const body = await request.json();
    const { template_id, ...updates } = body;

    if (!template_id) {
      return NextResponse.json(
        { error: "template_id is required" },
        { status: 400 }
      );
    }

    const allowedFields = [
      "name",
      "description",
      "subject",
      "body_html",
      "body_text",
      "placeholders",
      "is_active",
    ];

    const setClause: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        if (key === "placeholders") {
          setClause.push(`${key} = $${paramIndex++}::JSONB`);
          values.push(value ? JSON.stringify(value) : null);
        } else {
          setClause.push(`${key} = $${paramIndex++}`);
          values.push(value);
        }
      }
    }

    if (setClause.length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    setClause.push(`updated_at = NOW()`);
    values.push(template_id);

    await query(
      `UPDATE trapper.email_templates
       SET ${setClause.join(", ")}
       WHERE template_id = $${paramIndex}`,
      values
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error updating email template:", error);
    return NextResponse.json(
      { error: "Failed to update template" },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/email-templates - Delete template (soft delete)
export async function DELETE(request: NextRequest) {
  try {
    // Require admin role
    await requireRole(request, ["admin"]);

    const { searchParams } = new URL(request.url);
    const templateId = searchParams.get("template_id");

    if (!templateId) {
      return NextResponse.json(
        { error: "template_id is required" },
        { status: 400 }
      );
    }

    await query(
      `UPDATE trapper.email_templates SET is_active = FALSE, updated_at = NOW() WHERE template_id = $1`,
      [templateId]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error deleting email template:", error);
    return NextResponse.json(
      { error: "Failed to delete template" },
      { status: 500 }
    );
  }
}
