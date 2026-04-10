import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import {
  apiSuccess,
  apiBadRequest,
  apiUnauthorized,
  apiServerError,
} from "@/lib/api-response";
import {
  runWaiverAudit,
  getUnresolvedAudits,
  resolveAudit,
} from "@/lib/waiver-audit";

interface RouteParams {
  params: Promise<{ date: string }>;
}

/**
 * GET /api/admin/clinic-days/[date]/evidence/audit
 *
 * Returns unresolved audit results for a clinic date.
 *
 * POST /api/admin/clinic-days/[date]/evidence/audit
 *
 * Runs the waiver cross-reference audit for a clinic date.
 * Body: {} (no params needed) or { resolve: audit_id, note: "..." }
 *
 * Linear: FFS-1220
 */

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) return apiUnauthorized();

    const { date } = await params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return apiBadRequest("Invalid date format. Use YYYY-MM-DD.");
    }

    const results = await getUnresolvedAudits(date);
    return apiSuccess({
      clinic_date: date,
      unresolved: results.length,
      critical: results.filter((r) => r.severity === "critical").length,
      warning: results.filter((r) => r.severity === "warning").length,
      info: results.filter((r) => r.severity === "info").length,
      results,
    });
  } catch (error) {
    console.error("Evidence audit GET error:", error);
    return apiServerError("Failed to fetch audit results");
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) return apiUnauthorized();

    const { date } = await params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return apiBadRequest("Invalid date format. Use YYYY-MM-DD.");
    }

    const body = await request.json();

    // Resolve an audit result
    if (body.resolve) {
      await resolveAudit(
        body.resolve,
        session.staff_id ?? null,
        body.note || "",
      );
      return apiSuccess({ resolved: body.resolve });
    }

    // Run the audit
    const summary = await runWaiverAudit(date);
    return apiSuccess(summary);
  } catch (error) {
    console.error("Evidence audit POST error:", error);
    return apiServerError("Failed to run audit");
  }
}
