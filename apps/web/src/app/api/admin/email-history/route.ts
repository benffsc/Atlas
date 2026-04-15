import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";
import { parsePagination } from "@/lib/api-validation";

interface SentEmailRow {
  email_id: string;
  template_key: string;
  recipient_email: string;
  recipient_name: string | null;
  subject_rendered: string;
  body_html_rendered: string | null;
  body_text_rendered: string | null;
  status: string;
  error_message: string | null;
  external_id: string | null;
  sent_at: string | null;
  created_at: string;
  created_by: string | null;
}

interface StatusCounts {
  total: number;
  sent: number;
  dry_run: number;
  failed: number;
  pending: number;
}

/**
 * GET /api/admin/email-history
 *
 * List sent emails with filtering, search, and pagination.
 *
 * Query params:
 *   - status: filter by status (sent, dry_run, failed, pending, delivered, bounced)
 *   - days: 7, 30, 90, or "all"
 *   - search: search by recipient email (ILIKE)
 *   - limit: page size (default 50, max 100)
 *   - offset: pagination offset
 */
export async function GET(request: NextRequest) {
  try {
    await requireRole(request, ["admin", "staff"]);

    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status");
    const days = searchParams.get("days");
    const search = searchParams.get("search");
    const { limit, offset } = parsePagination(searchParams);

    // Build WHERE clauses
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (status && status !== "all") {
      conditions.push(`se.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (days && days !== "all") {
      const daysNum = parseInt(days, 10);
      if (!isNaN(daysNum) && daysNum > 0) {
        conditions.push(`se.created_at >= NOW() - INTERVAL '${daysNum} days'`);
      }
    }

    if (search && search.trim().length > 0) {
      conditions.push(`se.recipient_email ILIKE $${paramIndex}`);
      params.push(`%${search.trim()}%`);
      paramIndex++;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Count query for stats (with same filters except status)
    const statsConditions: string[] = [];
    const statsParams: unknown[] = [];
    let statsParamIndex = 1;

    if (days && days !== "all") {
      const daysNum = parseInt(days, 10);
      if (!isNaN(daysNum) && daysNum > 0) {
        statsConditions.push(
          `created_at >= NOW() - INTERVAL '${daysNum} days'`
        );
      }
    }

    if (search && search.trim().length > 0) {
      statsConditions.push(`recipient_email ILIKE $${statsParamIndex}`);
      statsParams.push(`%${search.trim()}%`);
      statsParamIndex++;
    }

    const statsWhere =
      statsConditions.length > 0
        ? `WHERE ${statsConditions.join(" AND ")}`
        : "";

    const statsRow = await queryOne<StatusCounts>(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
        COUNT(*) FILTER (WHERE status = 'dry_run')::int AS dry_run,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
      FROM ops.sent_emails
      ${statsWhere}`,
      statsParams
    );

    // Main query
    const rows = await queryRows<SentEmailRow>(
      `SELECT
        se.email_id,
        se.template_key,
        se.recipient_email,
        se.recipient_name,
        se.subject_rendered,
        se.body_html_rendered,
        se.body_text_rendered,
        se.status,
        se.error_message,
        se.external_id,
        se.sent_at,
        se.created_at,
        se.created_by
      FROM ops.sent_emails se
      ${whereClause}
      ORDER BY se.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    // Total count for current filters (for pagination)
    const countRow = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM ops.sent_emails se
       ${whereClause}`,
      params
    );

    return apiSuccess(
      {
        emails: rows,
        stats: statsRow || {
          total: 0,
          sent: 0,
          dry_run: 0,
          failed: 0,
          pending: 0,
        },
      },
      {
        total: countRow?.count ?? 0,
        limit,
        offset,
      }
    );
  } catch (err) {
    console.error("[email-history] GET error:", err);
    if (err instanceof Error && err.name === "AuthError") {
      const { apiUnauthorized, apiForbidden } = await import(
        "@/lib/api-response"
      );
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 403) return apiForbidden(err.message);
      return apiUnauthorized(err.message);
    }
    return apiServerError("Failed to load email history");
  }
}
