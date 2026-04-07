import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/api-response";

/**
 * MIG_3050 / FFS-1150 Initiative 3
 *
 * Data quality checks registry API.
 *
 * GET  — list all checks with their last_run_at + last_value + last_status
 * POST — { run: true } to evaluate all (or filtered) checks now
 */

interface CheckRow {
  check_id: string;
  name: string;
  description: string | null;
  category: string;
  severity: string;
  enabled: boolean;
  expected_max: number;
  last_run_at: string | null;
  last_value: number | null;
  last_status: string | null;
  last_error: string | null;
  drilldown_sql: string | null;
}

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return apiError("Admin access required", 403);
  }

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const status = searchParams.get("status"); // pass | warn | fail | error

  try {
    const conditions: string[] = [];
    const params: string[] = [];
    let i = 1;

    if (category) {
      conditions.push(`category = $${i++}`);
      params.push(category);
    }

    if (status) {
      conditions.push(`last_status = $${i++}`);
      params.push(status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const checks = await queryRows<CheckRow>(
      `SELECT
         check_id, name, description, category, severity, enabled,
         expected_max, last_run_at, last_value, last_status, last_error,
         drilldown_sql
       FROM ops.data_quality_checks
       ${where}
       ORDER BY
         CASE last_status
           WHEN 'fail' THEN 1
           WHEN 'error' THEN 2
           WHEN 'warn' THEN 3
           WHEN 'pass' THEN 4
           ELSE 5
         END,
         category, check_id`,
      params
    );

    // Summary by status
    const summary = await queryOne<{
      total: number;
      pass: number;
      warn: number;
      fail: number;
      error: number;
      never_run: number;
    }>(
      `SELECT
         COUNT(*)::INT AS total,
         COUNT(*) FILTER (WHERE last_status = 'pass')::INT AS pass,
         COUNT(*) FILTER (WHERE last_status = 'warn')::INT AS warn,
         COUNT(*) FILTER (WHERE last_status = 'fail')::INT AS fail,
         COUNT(*) FILTER (WHERE last_status = 'error')::INT AS error,
         COUNT(*) FILTER (WHERE last_run_at IS NULL)::INT AS never_run
       FROM ops.data_quality_checks
       WHERE enabled = TRUE`
    );

    return apiSuccess({ checks, summary });
  } catch (err) {
    console.error("[admin/data-quality/checks GET] error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to load checks",
      500
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return apiError("Admin access required", 403);
  }

  let body: { run?: boolean; categories?: string[] } = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine
  }

  if (!body.run) {
    return apiError("Set { run: true } to evaluate checks", 400);
  }

  try {
    const results = await queryRows<{
      check_id: string;
      status: string;
      value: number;
      duration_ms: number;
    }>(
      `SELECT * FROM ops.run_data_quality_checks($1::TEXT[])`,
      [body.categories ?? null]
    );

    return apiSuccess({
      ran: results.length,
      pass: results.filter((r) => r.status === "pass").length,
      warn: results.filter((r) => r.status === "warn").length,
      fail: results.filter((r) => r.status === "fail").length,
      error: results.filter((r) => r.status === "error").length,
      results,
    });
  } catch (err) {
    console.error("[admin/data-quality/checks POST] error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to run checks",
      500
    );
  }
}
