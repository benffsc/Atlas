import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { queryRows, queryOne, query } from "@/lib/db";

interface EmailJob {
  job_id: string;
  category_key: string;
  template_key: string | null;
  recipient_email: string;
  recipient_name: string | null;
  recipient_person_id: string | null;
  custom_subject: string | null;
  custom_body_html: string | null;
  placeholders: Record<string, string>;
  outlook_account_id: string | null;
  submission_id: string | null;
  request_id: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
  template_name?: string;
  template_subject?: string;
  category_name?: string;
  from_email?: string;
  created_by_name?: string;
}

/**
 * GET /api/admin/email-jobs
 *
 * List email jobs. Filter by status.
 */
export async function GET(request: NextRequest) {
  try {
    await requireRole(request, ["admin", "staff"]);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status"); // draft, queued, sent, failed, all
    const limit = parseInt(searchParams.get("limit") || "50");

    let whereClause = "";
    const params: (string | number)[] = [];

    if (status && status !== "all") {
      whereClause = "WHERE ej.status = $1";
      params.push(status);
    }

    const jobs = await queryRows<EmailJob>(`
      SELECT
        ej.*,
        et.name AS template_name,
        et.subject AS template_subject,
        ec.display_name AS category_name,
        oa.email AS from_email,
        s.display_name AS created_by_name
      FROM trapper.email_jobs ej
      LEFT JOIN trapper.email_templates et ON et.template_key = ej.template_key
      LEFT JOIN trapper.email_categories ec ON ec.category_key = ej.category_key
      LEFT JOIN trapper.outlook_email_accounts oa ON oa.account_id = ej.outlook_account_id
      LEFT JOIN ops.staff s ON s.staff_id = ej.created_by
      ${whereClause}
      ORDER BY ej.created_at DESC
      LIMIT ${params.length > 0 ? "$2" : "$1"}
    `, params.length > 0 ? [...params, limit] : [limit]);

    // Get counts by status
    const counts = await queryOne<{
      draft: number;
      queued: number;
      sent: number;
      failed: number;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'draft') AS draft,
        COUNT(*) FILTER (WHERE status = 'queued') AS queued,
        COUNT(*) FILTER (WHERE status = 'sent') AS sent,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed
      FROM trapper.email_jobs
    `);

    return NextResponse.json({
      jobs,
      counts,
    });
  } catch (error) {
    console.error("Get email jobs error:", error);

    if (error instanceof Error && "statusCode" in error) {
      const authError = error as { message: string; statusCode: number };
      return NextResponse.json({ error: authError.message }, { status: authError.statusCode });
    }

    return NextResponse.json({ error: "Failed to get email jobs" }, { status: 500 });
  }
}

/**
 * POST /api/admin/email-jobs
 *
 * Create a new email job.
 */
export async function POST(request: NextRequest) {
  try {
    const staff = await requireRole(request, ["admin", "staff"]);

    const body = await request.json();
    const {
      category_key,
      template_key,
      recipient_email,
      recipient_name,
      recipient_person_id,
      custom_subject,
      custom_body_html,
      placeholders,
      outlook_account_id,
      submission_id,
      request_id,
    } = body;

    // Validate required fields
    if (!recipient_email || !recipient_email.includes("@")) {
      return NextResponse.json({ error: "Valid recipient email is required" }, { status: 400 });
    }

    if (!template_key && !custom_body_html) {
      return NextResponse.json({ error: "Either template_key or custom content is required" }, { status: 400 });
    }

    if (custom_body_html && !custom_subject) {
      return NextResponse.json({ error: "Subject is required for custom emails" }, { status: 400 });
    }

    // Get default outlook account from category if not specified
    let finalOutlookAccountId = outlook_account_id;
    if (!finalOutlookAccountId && category_key) {
      const category = await queryOne<{ default_outlook_account_id: string | null }>(`
        SELECT default_outlook_account_id FROM trapper.email_categories WHERE category_key = $1
      `, [category_key]);
      finalOutlookAccountId = category?.default_outlook_account_id;
    }

    const result = await queryOne<{ job_id: string }>(`
      INSERT INTO trapper.email_jobs (
        category_key, template_key, recipient_email, recipient_name, recipient_person_id,
        custom_subject, custom_body_html, placeholders, outlook_account_id,
        submission_id, request_id, created_by, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft')
      RETURNING job_id
    `, [
      category_key || null,
      template_key || null,
      recipient_email,
      recipient_name || null,
      recipient_person_id || null,
      custom_subject || null,
      custom_body_html || null,
      JSON.stringify(placeholders || {}),
      finalOutlookAccountId || null,
      submission_id || null,
      request_id || null,
      staff.staff_id,
    ]);

    return NextResponse.json({
      success: true,
      job_id: result?.job_id,
    });
  } catch (error) {
    console.error("Create email job error:", error);

    if (error instanceof Error && "statusCode" in error) {
      const authError = error as { message: string; statusCode: number };
      return NextResponse.json({ error: authError.message }, { status: authError.statusCode });
    }

    return NextResponse.json({ error: "Failed to create email job" }, { status: 500 });
  }
}
