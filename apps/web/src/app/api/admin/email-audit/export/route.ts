import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";

interface EmailExportRow {
  email_id: string;
  template_key: string | null;
  template_name: string | null;
  recipient_email: string;
  recipient_name: string | null;
  subject: string | null;
  status: string;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
  sent_by_name: string | null;
  from_email: string | null;
}

// GET /api/admin/email-audit/export - Export email audit log as CSV (admin only)
export async function GET(request: NextRequest) {
  try {
    // Admin only for export
    await requireRole(request, ["admin"]);

    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("date_from") || "";
    const dateTo = searchParams.get("date_to") || "";
    const status = searchParams.get("status") || "";

    // Build WHERE clauses dynamically
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`se.status = $${paramIndex}`);
      params.push(status);
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

    const emails = await queryRows<EmailExportRow>(`
      SELECT
        se.email_id,
        se.template_key,
        et.name AS template_name,
        se.recipient_email,
        se.recipient_name,
        se.subject_rendered AS subject,
        se.status,
        se.error_message,
        se.sent_at::TEXT,
        se.created_at::TEXT,
        s.display_name AS sent_by_name,
        oa.email AS from_email
      FROM ops.sent_emails se
      LEFT JOIN ops.email_templates et ON et.template_key = se.template_key
      LEFT JOIN ops.staff s ON s.staff_id = se.sent_by
      LEFT JOIN ops.outlook_email_accounts oa ON oa.account_id = se.outlook_account_id
      ${whereClause}
      ORDER BY se.created_at DESC
      LIMIT 10000
    `, params);

    // Convert to CSV
    const headers = [
      "Email ID",
      "Template Key",
      "Template Name",
      "Recipient Email",
      "Recipient Name",
      "Subject",
      "Status",
      "Error Message",
      "Sent At",
      "Created At",
      "Sent By",
      "From Email",
    ];

    const escapeCSV = (value: string | null): string => {
      if (value === null || value === undefined) return "";
      const str = String(value);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvRows = [
      headers.join(","),
      ...emails.map((row) =>
        [
          escapeCSV(row.email_id),
          escapeCSV(row.template_key),
          escapeCSV(row.template_name),
          escapeCSV(row.recipient_email),
          escapeCSV(row.recipient_name),
          escapeCSV(row.subject),
          escapeCSV(row.status),
          escapeCSV(row.error_message),
          escapeCSV(row.sent_at),
          escapeCSV(row.created_at),
          escapeCSV(row.sent_by_name),
          escapeCSV(row.from_email),
        ].join(",")
      ),
    ];

    const csv = csvRows.join("\n");
    const filename = `email-audit-${new Date().toISOString().split("T")[0]}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error exporting email audit log:", error);
    return NextResponse.json(
      { error: "Failed to export audit log" },
      { status: 500 }
    );
  }
}
