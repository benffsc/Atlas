import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";

interface EmailAuditEntry {
  email_id: string;
  template_key: string | null;
  template_name: string | null;
  recipient_email: string;
  recipient_name: string | null;
  subject: string | null;
  body_html_rendered: string | null;
  status: string;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
  sent_by: string | null;
  sent_by_name: string | null;
  from_email: string | null;
  person_id: string | null;
  request_id: string | null;
  submission_id: string | null;
}

// GET /api/admin/email-audit - Search email audit log
export async function GET(request: NextRequest) {
  try {
    // Both admin and staff can view audit log
    await requireRole(request, ["admin", "staff"]);

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "";
    const templateKey = searchParams.get("template_key") || "";
    const sentBy = searchParams.get("sent_by") || "";
    const dateFrom = searchParams.get("date_from") || "";
    const dateTo = searchParams.get("date_to") || "";
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
    const offset = parseInt(searchParams.get("offset") || "0");

    // Build WHERE clauses dynamically
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(
        se.recipient_email ILIKE $${paramIndex} OR
        se.recipient_name ILIKE $${paramIndex} OR
        se.subject_rendered ILIKE $${paramIndex}
      )`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (status) {
      conditions.push(`se.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (templateKey) {
      conditions.push(`se.template_key = $${paramIndex}`);
      params.push(templateKey);
      paramIndex++;
    }

    if (sentBy) {
      conditions.push(`se.sent_by = $${paramIndex}`);
      params.push(sentBy);
      paramIndex++;
    }

    if (dateFrom) {
      conditions.push(`se.created_at >= $${paramIndex}::DATE`);
      params.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      conditions.push(`se.created_at < ($${paramIndex}::DATE + INTERVAL '1 day')`);
      params.push(dateTo);
      paramIndex++;
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    // Get total count for pagination
    const countResult = await queryOne<{ count: number }>(`
      SELECT COUNT(*)::INT AS count
      FROM ops.sent_emails se
      ${whereClause}
    `, params);

    // Get paginated results
    const emails = await queryRows<EmailAuditEntry>(`
      SELECT
        se.email_id,
        se.template_key,
        et.name AS template_name,
        se.recipient_email,
        se.recipient_name,
        se.subject_rendered AS subject,
        se.body_html_rendered,
        se.status,
        se.error_message,
        se.sent_at::TEXT,
        se.created_at::TEXT,
        se.sent_by,
        s.display_name AS sent_by_name,
        oa.email AS from_email,
        se.person_id,
        se.request_id,
        se.submission_id
      FROM ops.sent_emails se
      LEFT JOIN ops.email_templates et ON et.template_key = se.template_key
      LEFT JOIN ops.staff s ON s.staff_id = se.sent_by
      LEFT JOIN ops.outlook_email_accounts oa ON oa.account_id = se.outlook_account_id
      ${whereClause}
      ORDER BY se.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, limit, offset]);

    // Get distinct template keys for filter dropdown
    const templates = await queryRows<{ template_key: string; name: string }>(`
      SELECT DISTINCT et.template_key, et.name
      FROM ops.sent_emails se
      JOIN ops.email_templates et ON et.template_key = se.template_key
      ORDER BY et.name
    `);

    // Get distinct senders for filter dropdown
    const senders = await queryRows<{ staff_id: string; display_name: string }>(`
      SELECT DISTINCT s.staff_id, s.display_name
      FROM ops.sent_emails se
      JOIN ops.staff s ON s.staff_id = se.sent_by
      ORDER BY s.display_name
    `);

    return NextResponse.json({
      emails,
      total: countResult?.count || 0,
      limit,
      offset,
      filters: {
        templates,
        senders,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error fetching email audit log:", error);
    return NextResponse.json(
      { error: "Failed to fetch audit log" },
      { status: 500 }
    );
  }
}
