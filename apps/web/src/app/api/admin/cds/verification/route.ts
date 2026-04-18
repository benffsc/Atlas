import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import {
  apiSuccess,
  apiBadRequest,
  apiUnauthorized,
  apiServerError,
} from "@/lib/api-response";
import { loadCDSMetricsForDate } from "@/lib/cds-metrics";

/**
 * GET /api/admin/cds/verification?date=YYYY-MM-DD
 *
 * Returns coverage + gap classification + cancelled entries + ground truth
 * agreement for a single clinic date. Powers the verification report view.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return apiUnauthorized();
    }

    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return apiBadRequest("date query param required (YYYY-MM-DD).");
    }

    const metrics = await loadCDSMetricsForDate(date);

    return apiSuccess({
      date: metrics.date,
      coverage: {
        total: metrics.entries.total,
        matched: metrics.entries.matched,
        pct: metrics.entries.total > 0
          ? Math.round((metrics.entries.matched / metrics.entries.total) * 100)
          : 0,
      },
      gaps: metrics.gaps,
      cancelled: metrics.cancelled,
      cdn_agreement: {
        ground_truth: metrics.agreement.total_pairs,
        agree: metrics.agreement.agree,
        disagree: metrics.agreement.disagree,
        cds_unmatched: metrics.agreement.cds_unmatched,
        rate_pct:
          metrics.agreement.total_pairs > 0
            ? Math.round(
                (metrics.agreement.agree / metrics.agreement.total_pairs) * 1000
              ) / 10
            : 0,
      },
    });
  } catch (error) {
    console.error("CDS verification error:", error);
    return apiServerError("Failed to compute CDS verification report");
  }
}
