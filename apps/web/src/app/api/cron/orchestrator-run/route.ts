/**
 * Atlas Data Orchestrator - Unified Cron Endpoint
 *
 * Runs all data processing phases in correct dependency order:
 * 1. ClinicHQ: appointments → owners → cats
 * 2. VolunteerHub: people
 * 3. ShelterLuv: people → animals → events
 * 4. Entity linking
 * 5. Cross-source reconciliation
 * 6. Data quality audit
 *
 * Usage:
 *   POST /api/cron/orchestrator-run
 *   POST /api/cron/orchestrator-run?type=full
 *   POST /api/cron/orchestrator-run?type=incremental
 *
 * Authentication: Vercel Cron secret or Bearer token
 */

import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

// Vercel Cron authorization
const CRON_SECRET = process.env.CRON_SECRET;

interface OrchestratorResult {
  run_id: string;
  status: string;
  duration_ms: number;
  phases_completed: number;
  records_processed: Record<string, number>;
  conflicts_detected: number;
  phases: Array<{
    phase: string;
    status: string;
    duration_ms?: number;
    records_processed?: number;
    error?: string;
  }>;
}

interface HealthResult {
  last_run_id: string | null;
  last_run_status: string | null;
  last_run_at: string | null;
  last_run_duration_ms: number | null;
  runs_last_24h: number;
  failures_last_24h: number;
  cat_conflicts: number;
  person_conflicts: number;
  phase_last_runs: Record<string, string>;
}

export async function GET(request: NextRequest) {
  // Health check - returns orchestrator status
  try {
    const health = await queryOne<HealthResult>(
      `SELECT * FROM ops.v_orchestrator_health`
    );

    return NextResponse.json({
      status: "healthy",
      orchestrator: health,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Orchestrator health check failed:", error);
    return NextResponse.json(
      {
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // Verify authorization
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron-secret");

  const isAuthorized =
    (CRON_SECRET && cronHeader === CRON_SECRET) ||
    (authHeader && authHeader === `Bearer ${process.env.API_SECRET}`);

  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse options
  const { searchParams } = new URL(request.url);
  const runType = searchParams.get("type") || "incremental";
  const batchSize = parseInt(searchParams.get("batch_size") || "500", 10);

  console.log(
    `[orchestrator] Starting ${runType} run with batch_size=${batchSize}`
  );

  try {
    // Run the orchestrator
    const result = await queryOne<OrchestratorResult>(
      `SELECT * FROM sot.run_full_orchestrator($1, $2, $3)`,
      [runType, "api", batchSize]
    );

    if (!result) {
      throw new Error("Orchestrator returned no result");
    }

    const duration = Date.now() - startTime;
    console.log(
      `[orchestrator] Completed in ${duration}ms - status: ${result.status}`
    );

    // Log summary
    const phaseSummary = result.phases
      .map((p) => `${p.phase}: ${p.status}`)
      .join(", ");
    console.log(`[orchestrator] Phases: ${phaseSummary}`);

    return NextResponse.json({
      success: result.status === "completed",
      run_id: result.run_id,
      status: result.status,
      duration_ms: result.duration_ms,
      phases_completed: result.phases_completed,
      records_processed: result.records_processed,
      conflicts_detected: result.conflicts_detected,
      phases: result.phases,
    });
  } catch (error) {
    console.error("[orchestrator] Error:", error);

    // Try to log the failure
    try {
      await queryOne(
        `UPDATE ops.orchestrator_run_logs
         SET status = 'failed',
             error_message = $1,
             completed_at = NOW()
         WHERE status = 'running'
         ORDER BY started_at DESC
         LIMIT 1`,
        [error instanceof Error ? error.message : "Unknown error"]
      );
    } catch (logError) {
      console.error("[orchestrator] Failed to log error:", logError);
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

// Disable body parsing for this route (not needed)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
