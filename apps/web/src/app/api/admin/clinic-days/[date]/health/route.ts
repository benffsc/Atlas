import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  apiSuccess,
  apiBadRequest,
  apiUnauthorized,
  apiError,
} from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ date: string }>;
}

/**
 * GET /api/admin/clinic-days/[date]/health
 *
 * MIG_3050 / FFS-1150 Initiative 3
 *
 * Date-scoped data quality summary for the clinic day hub page.
 * Wraps ops.clinic_day_health(date), which returns one row per check
 * (ghost appointments, orphan cat_info, missing clinic_day_number,
 * unmatched master list entries).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) {
      return apiUnauthorized();
    }

    const { date } = await params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return apiBadRequest("Invalid date format. Use YYYY-MM-DD.");
    }

    const checks = await queryRows<{
      check_name: string;
      status: string;
      value: number;
      detail: string;
    }>(`SELECT * FROM ops.clinic_day_health($1::DATE)`, [date]);

    const failed = checks.filter((c) => c.status === "fail");
    const warnings = checks.filter((c) => c.status === "warn");

    const overall: "pass" | "warn" | "fail" =
      failed.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass";

    return apiSuccess({
      date,
      overall,
      checks,
      summary: {
        pass: checks.filter((c) => c.status === "pass").length,
        warn: warnings.length,
        fail: failed.length,
      },
    });
  } catch (err) {
    console.error("[admin/clinic-days/health] error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to load health",
      500
    );
  }
}
