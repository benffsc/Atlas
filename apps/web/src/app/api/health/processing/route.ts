import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

/**
 * Processing Health Check Endpoint
 *
 * Returns detailed status of the processing pipeline including:
 * - Queue status by source system and table
 * - Stuck jobs detection
 * - Recent failures
 * - Data integrity metrics (missing owner_email, unlinked cats)
 *
 * Use this endpoint for monitoring dashboards and alerting.
 */

interface DashboardRow {
  source_system: string;
  source_table: string;
  queued: number;
  processing: number;
  linking: number;
  completed_24h: number;
  failed_24h: number;
  retry_pending: number;
  avg_duration_seconds: number | null;
  last_completed: string | null;
}

interface StuckJob {
  job_id: string;
  source_system: string;
  source_table: string;
  status: string;
  started_at: string;
  heartbeat_at: string | null;
  minutes_stuck: number;
}

interface RecentFailure {
  job_id: string;
  source_system: string;
  source_table: string;
  last_error: string;
  completed_at: string;
  attempt_count: number;
}

interface DataIntegrityMetric {
  metric: string;
  count: number;
  threshold: number;
  status: "ok" | "warning" | "critical";
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Get queue status
    const dashboard = await queryRows<DashboardRow>(
      "SELECT * FROM ops.v_processing_dashboard ORDER BY queued DESC"
    );

    // Detect stuck jobs (no heartbeat for 30+ minutes)
    const stuckJobs = await queryRows<StuckJob>(
      "SELECT * FROM trapper.detect_stuck_jobs(30)"
    );

    // Get recent failures
    const recentFailures = await queryRows<RecentFailure>(`
      SELECT
        job_id,
        source_system,
        source_table,
        last_error,
        completed_at,
        attempt_count
      FROM trapper.processing_jobs
      WHERE status = 'failed'
        AND completed_at > NOW() - INTERVAL '24 hours'
      ORDER BY completed_at DESC
      LIMIT 10
    `);

    // Calculate totals
    const totals = dashboard.reduce(
      (acc, row) => ({
        queued: acc.queued + Number(row.queued || 0),
        processing: acc.processing + Number(row.processing || 0),
        linking: acc.linking + Number(row.linking || 0),
        completed_24h: acc.completed_24h + Number(row.completed_24h || 0),
        failed_24h: acc.failed_24h + Number(row.failed_24h || 0),
        retry_pending: acc.retry_pending + Number(row.retry_pending || 0),
      }),
      {
        queued: 0,
        processing: 0,
        linking: 0,
        completed_24h: 0,
        failed_24h: 0,
        retry_pending: 0,
      }
    );

    // Data integrity checks
    const integrityChecks = await queryOne<{
      appointments_missing_owner_email: number;
      appointments_missing_person_id: number;
      cats_with_procedures_no_place: number;
      unprocessed_staged_records: number;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM ops.appointments WHERE owner_email IS NULL) as appointments_missing_owner_email,
        (SELECT COUNT(*) FROM ops.appointments WHERE person_id IS NULL AND owner_email IS NOT NULL) as appointments_missing_person_id,
        (SELECT COUNT(DISTINCT cp.cat_id)
         FROM ops.cat_procedures cp
         WHERE (cp.is_spay OR cp.is_neuter)
           AND NOT EXISTS (
             SELECT 1 FROM sot.cat_place_relationships cpr WHERE cpr.cat_id = cp.cat_id
           )
        ) as cats_with_procedures_no_place,
        (SELECT COUNT(*) FROM ops.staged_records WHERE processed_at IS NULL) as unprocessed_staged_records
    `);

    // Build integrity metrics with thresholds
    const integrityMetrics: DataIntegrityMetric[] = [];

    if (integrityChecks) {
      integrityMetrics.push({
        metric: "appointments_missing_owner_email",
        count: integrityChecks.appointments_missing_owner_email,
        threshold: 1000,
        status:
          integrityChecks.appointments_missing_owner_email > 5000
            ? "critical"
            : integrityChecks.appointments_missing_owner_email > 1000
            ? "warning"
            : "ok",
      });

      integrityMetrics.push({
        metric: "appointments_missing_person_id",
        count: integrityChecks.appointments_missing_person_id,
        threshold: 500,
        status:
          integrityChecks.appointments_missing_person_id > 2000
            ? "critical"
            : integrityChecks.appointments_missing_person_id > 500
            ? "warning"
            : "ok",
      });

      integrityMetrics.push({
        metric: "cats_with_procedures_no_place",
        count: integrityChecks.cats_with_procedures_no_place,
        threshold: 10,
        status:
          integrityChecks.cats_with_procedures_no_place > 50
            ? "critical"
            : integrityChecks.cats_with_procedures_no_place > 10
            ? "warning"
            : "ok",
      });

      integrityMetrics.push({
        metric: "unprocessed_staged_records",
        count: integrityChecks.unprocessed_staged_records,
        threshold: 1000,
        status:
          integrityChecks.unprocessed_staged_records > 5000
            ? "critical"
            : integrityChecks.unprocessed_staged_records > 1000
            ? "warning"
            : "ok",
      });
    }

    // Determine overall health status
    const hasCritical = integrityMetrics.some((m) => m.status === "critical");
    const hasWarning = integrityMetrics.some((m) => m.status === "warning");
    const hasStuckJobs = stuckJobs.length > 0;
    const hasRecentFailures = recentFailures.length > 0;

    let overallStatus: "healthy" | "degraded" | "unhealthy";
    if (hasCritical || hasStuckJobs) {
      overallStatus = "unhealthy";
    } else if (hasWarning || hasRecentFailures) {
      overallStatus = "degraded";
    } else {
      overallStatus = "healthy";
    }

    return NextResponse.json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,

      queue: {
        totals,
        by_source: dashboard,
      },

      stuck_jobs: stuckJobs,

      recent_failures: recentFailures,

      data_integrity: integrityMetrics,

      recommendations:
        overallStatus !== "healthy"
          ? generateRecommendations(
              integrityMetrics,
              stuckJobs,
              recentFailures
            )
          : [],
    });
  } catch (error) {
    console.error("Health check error:", error);
    return NextResponse.json(
      {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

function generateRecommendations(
  integrityMetrics: DataIntegrityMetric[],
  stuckJobs: StuckJob[],
  recentFailures: RecentFailure[]
): string[] {
  const recommendations: string[] = [];

  // Stuck jobs
  if (stuckJobs.length > 0) {
    recommendations.push(
      `${stuckJobs.length} stuck job(s) detected. Consider running: UPDATE trapper.processing_jobs SET status = 'retry_pending', next_retry_at = NOW() WHERE job_id IN ('${stuckJobs.map((j) => j.job_id).join("','")}')`
    );
  }

  // Data integrity issues
  for (const metric of integrityMetrics) {
    if (metric.status === "critical") {
      switch (metric.metric) {
        case "appointments_missing_owner_email":
          recommendations.push(
            `Critical: ${metric.count} appointments missing owner_email. Run: SELECT trapper.enqueue_processing('clinichq', 'owner_info', 'backfill', NULL, 10);`
          );
          break;
        case "cats_with_procedures_no_place":
          recommendations.push(
            `Critical: ${metric.count} cats with procedures but no place link. Run: SELECT * FROM sot.run_all_entity_linking();`
          );
          break;
        case "unprocessed_staged_records":
          recommendations.push(
            `${metric.count} unprocessed staged records. Check if /api/ingest/process cron is running.`
          );
          break;
      }
    }
  }

  // Recent failures
  if (recentFailures.length > 0) {
    recommendations.push(
      `${recentFailures.length} failed jobs in last 24h. Check logs for errors: ${recentFailures[0]?.last_error}`
    );
  }

  return recommendations;
}
