import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/api-response";
import { sendSlackAlerts } from "@/lib/slack";

/**
 * MIG_3050 / FFS-1150 Initiative 3
 *
 * Data Quality Checks Cron — runs the registry-based check evaluator
 * (separate from the legacy /api/cron/data-quality-check which monitors
 * coverage metrics). Posts Slack alerts for fail+critical results.
 *
 * Schedule: every 4 hours via vercel.json
 */

export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

interface CheckResult {
  check_id: string;
  status: string;
  value: number;
  duration_ms: number;
}

interface CheckMeta {
  check_id: string;
  name: string;
  severity: string;
  expected_max: number;
}

export async function GET(request: NextRequest) {
  // Vercel cron auth
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  try {
    const results = await queryRows<CheckResult>(
      `SELECT * FROM ops.run_data_quality_checks(NULL)`
    );

    const failed = results.filter(
      (r) => r.status === "fail" || r.status === "error"
    );

    if (failed.length > 0) {
      // Hydrate metadata for Slack message
      const metas = await queryRows<CheckMeta>(
        `SELECT check_id, name, severity, expected_max
         FROM ops.data_quality_checks
         WHERE check_id = ANY($1::TEXT[])`,
        [failed.map((f) => f.check_id)]
      );
      const metaById = new Map(metas.map((m) => [m.check_id, m]));

      const alerts = failed.map((f) => {
        const m = metaById.get(f.check_id);
        return {
          level:
            m?.severity === "critical"
              ? ("critical" as const)
              : ("warning" as const),
          metric: f.check_id,
          message: m
            ? `${m.name} returned ${f.value} (expected ≤ ${m.expected_max})`
            : `${f.check_id} returned ${f.value}`,
          current_value: f.value,
          threshold_value: m?.expected_max ?? null,
        };
      });

      try {
        await sendSlackAlerts(alerts);
      } catch (err) {
        console.error("[cron/data-quality-checks] Slack send failed:", err);
      }
    }

    return apiSuccess({
      ran: results.length,
      pass: results.filter((r) => r.status === "pass").length,
      warn: results.filter((r) => r.status === "warn").length,
      fail: results.filter((r) => r.status === "fail").length,
      error: results.filter((r) => r.status === "error").length,
      slack_sent: failed.length,
    });
  } catch (err) {
    console.error("[cron/data-quality-checks] error:", err);
    return apiError(
      err instanceof Error ? err.message : "Cron failed",
      500
    );
  }
}
