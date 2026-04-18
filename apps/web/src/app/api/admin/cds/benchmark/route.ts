import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import {
  apiSuccess,
  apiBadRequest,
  apiUnauthorized,
  apiServerError,
} from "@/lib/api-response";
import {
  loadCDSMetricsForDate,
  loadCDSMetricsAggregate,
} from "@/lib/cds-metrics";

/**
 * GET /api/admin/cds/benchmark
 *
 * Compares CDS automated matches against ground truth (Ben's manual
 * clinic_day_number assignments flagged by MIG_3082).
 *
 * Query params:
 *   ?date=YYYY-MM-DD  → single date metrics + pairs
 *   (no date)         → aggregate across all ground truth dates
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return apiUnauthorized();
    }

    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");

    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return apiBadRequest("Invalid date format. Use YYYY-MM-DD.");
      }
      const metrics = await loadCDSMetricsForDate(date);
      return apiSuccess(metrics);
    }

    const aggregate = await loadCDSMetricsAggregate();
    return apiSuccess(aggregate);
  } catch (error) {
    console.error("CDS benchmark error:", error);
    return apiServerError("Failed to compute CDS benchmark");
  }
}
