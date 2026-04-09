/**
 * GET /api/admin/intake/geocoding
 *
 * Part of FFS-1181 Follow-Up Phase 4. Lists intake submissions that
 * are stuck in the geocoding queue — pending (with attempts > 0),
 * failed, zero_results, or unreachable.
 *
 * Query params:
 *   status=failed|zero_results|unreachable|pending (defaults to all non-ok)
 *   limit=50
 *
 * Admin/staff only.
 */

import { NextRequest } from "next/server";
import {
  apiSuccess,
  apiForbidden,
  apiServerError,
  apiUnauthorized,
} from "@/lib/api-response";
import { getSession } from "@/lib/auth";
import { queryRows, queryOne } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin" && session.auth_role !== "staff") {
    return apiForbidden("Only staff can view the geocoding DLQ");
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") || "50", 10) || 50, 1),
      200
    );

    const whereClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (status && ["failed", "zero_results", "unreachable", "pending"].includes(status)) {
      whereClauses.push(`geocode_status = $${idx++}`);
      values.push(status);
    } else {
      whereClauses.push(
        `geocode_status IN ('failed','zero_results','unreachable')`
      );
    }

    values.push(limit);

    const rows = await queryRows(
      `SELECT submission_id, first_name, last_name, email,
              cats_address, cats_city, cats_zip,
              geocode_status, geocode_attempts,
              geocode_last_attempted_at, geocode_last_error,
              geocode_next_attempt_at, created_at
         FROM ops.intake_submissions
        WHERE ${whereClauses.join(" AND ")}
        ORDER BY geocode_last_attempted_at DESC NULLS LAST
        LIMIT $${idx}`,
      values
    );

    const health = await queryOne(
      `SELECT * FROM ops.v_intake_geocoding_health`
    );

    return apiSuccess({ rows, health });
  } catch (err) {
    console.error("admin/intake/geocoding GET error:", err);
    return apiServerError("Failed to load geocoding queue");
  }
}
