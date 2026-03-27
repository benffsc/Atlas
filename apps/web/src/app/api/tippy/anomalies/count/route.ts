import { NextRequest } from "next/server";
import { apiSuccess } from "@/lib/api-response";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";

/**
 * GET /api/tippy/anomalies/count — Count unacknowledged anomalies
 * FFS-867: Notification badge for Tippy FAB button.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session?.staff_id) {
      return apiSuccess({ count: 0 });
    }

    const result = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int as count
       FROM ops.tippy_anomaly_log
       WHERE status = 'new'
         AND severity IN ('high', 'critical')
         AND created_at > NOW() - INTERVAL '7 days'`
    );

    return apiSuccess({ count: result?.count ?? 0 });
  } catch {
    return apiSuccess({ count: 0 });
  }
}
