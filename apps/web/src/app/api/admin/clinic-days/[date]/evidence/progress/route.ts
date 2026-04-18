import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  apiSuccess,
  apiBadRequest,
  apiUnauthorized,
  apiServerError,
} from "@/lib/api-response";

/**
 * GET /api/admin/clinic-days/[date]/evidence/progress
 *
 * Returns classification progress for a clinic date's evidence segments.
 * Used by the batch upload UI to poll during CDS-AI classification.
 *
 * Linear: FFS-1197
 */

interface RouteParams {
  params: Promise<{ date: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) return apiUnauthorized();

    const { date } = await params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return apiBadRequest("Invalid date format. Use YYYY-MM-DD.");
    }

    const progress = await queryOne<{
      total: number;
      pending: number;
      classified: number;
      chunked: number;
      assigned: number;
      rejected: number;
      ambiguous: number;
    }>(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE assignment_status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE assignment_status = 'classified')::int AS classified,
        COUNT(*) FILTER (WHERE assignment_status = 'chunked')::int AS chunked,
        COUNT(*) FILTER (WHERE assignment_status = 'assigned')::int AS assigned,
        COUNT(*) FILTER (WHERE assignment_status = 'rejected')::int AS rejected,
        COUNT(*) FILTER (WHERE assignment_status = 'ambiguous')::int AS ambiguous
      FROM ops.evidence_stream_segments
      WHERE clinic_date = $1::DATE
        AND source_kind = 'request_media'
    `, [date]);

    const total = progress?.total ?? 0;
    const pending = progress?.pending ?? 0;
    const processed = total - pending;

    return apiSuccess({
      clinic_date: date,
      total,
      pending,
      processed,
      classified: progress?.classified ?? 0,
      chunked: progress?.chunked ?? 0,
      assigned: progress?.assigned ?? 0,
      rejected: progress?.rejected ?? 0,
      ambiguous: progress?.ambiguous ?? 0,
      pct: total > 0 ? Math.round((processed / total) * 100) : 0,
    });
  } catch (error) {
    console.error("Evidence progress error:", error);
    return apiServerError("Failed to fetch progress");
  }
}
