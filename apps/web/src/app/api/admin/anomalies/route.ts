import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { queryRows, queryOne, execute } from "@/lib/db";
import { apiSuccess, apiServerError, apiError } from "@/lib/api-response";

/**
 * FFS-756: Admin anomalies API
 * GET — list anomalies with optional status/severity filters
 * PATCH — update anomaly status (acknowledge, resolve, etc.)
 */

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return apiError("Admin access required", 403);
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "new";
  const severity = searchParams.get("severity");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIdx = 1;

    if (status !== "all") {
      conditions.push(`a.status = $${paramIdx++}`);
      params.push(status);
    }

    if (severity) {
      conditions.push(`a.severity = $${paramIdx++}`);
      params.push(severity);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const anomalies = await queryRows(
      `SELECT
        a.anomaly_id::text,
        a.conversation_id::text,
        a.staff_id::text,
        a.entity_type,
        a.entity_id::text,
        a.anomaly_type,
        a.description,
        a.evidence,
        a.severity,
        a.status,
        a.resolved_at,
        a.resolved_by::text,
        a.resolution_notes,
        a.created_at,
        s.display_name as flagged_by_name,
        rs.display_name as resolved_by_name,
        CASE a.entity_type
          WHEN 'person' THEN (SELECT display_name FROM sot.people WHERE person_id = a.entity_id)
          WHEN 'cat' THEN (SELECT display_name FROM sot.cats WHERE cat_id = a.entity_id)
          WHEN 'place' THEN (SELECT formatted_address FROM sot.places WHERE place_id = a.entity_id)
          WHEN 'request' THEN (SELECT 'Request #' || source_record_id FROM ops.requests WHERE request_id = a.entity_id)
        END as entity_display_name
      FROM ops.tippy_anomaly_log a
      LEFT JOIN ops.staff s ON s.staff_id = a.staff_id
      LEFT JOIN ops.staff rs ON rs.staff_id = a.resolved_by
      ${whereClause}
      ORDER BY
        CASE a.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        a.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    const total = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM ops.tippy_anomaly_log a ${whereClause}`,
      params
    );

    return apiSuccess({ anomalies, total: total?.count ?? 0 });
  } catch (error) {
    console.error("Admin anomalies GET error:", error);
    return apiServerError(error instanceof Error ? error.message : "Failed to fetch anomalies");
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return apiError("Admin access required", 403);
  }

  try {
    const body = await request.json();
    const { anomaly_id, status, resolution_notes } = body;

    if (!anomaly_id || !status) {
      return apiError("anomaly_id and status are required", 400);
    }

    const validStatuses = ["new", "acknowledged", "investigating", "resolved", "wont_fix"];
    if (!validStatuses.includes(status)) {
      return apiError(`Invalid status. Must be one of: ${validStatuses.join(", ")}`, 400);
    }

    const isResolved = status === "resolved" || status === "wont_fix";

    await execute(
      `UPDATE ops.tippy_anomaly_log
       SET status = $2,
           resolution_notes = COALESCE($3, resolution_notes),
           resolved_at = CASE WHEN $4 THEN NOW() ELSE resolved_at END,
           resolved_by = CASE WHEN $4 THEN $5 ELSE resolved_by END
       WHERE anomaly_id = $1`,
      [anomaly_id, status, resolution_notes || null, isResolved, session.staff_id]
    );

    return apiSuccess({ updated: true, anomaly_id, status });
  } catch (error) {
    console.error("Admin anomalies PATCH error:", error);
    return apiServerError(error instanceof Error ? error.message : "Failed to update anomaly");
  }
}
