import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

/**
 * Unified Processing Endpoint
 *
 * This endpoint is designed to be called by Vercel Cron every 10 minutes.
 * It processes queued jobs from the processing_jobs table until either:
 * - No more jobs remain
 * - Time limit is reached (55 seconds, leaving buffer before 60s timeout)
 *
 * Each job goes through:
 * 1. Processing phase - Route to source-specific processor (ClinicHQ, Airtable, etc.)
 * 2. Linking phase - Run entity linking to connect cats/people/places
 *
 * Vercel cron configured in vercel.json to run every 10 minutes.
 */

export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

interface ProcessResult {
  status: string;
  job_id?: string;
  source_system?: string;
  source_table?: string;
  processing_results?: Record<string, unknown>;
  linking_results?: Record<string, number>;
  error?: string;
}

interface DashboardRow {
  source_system: string;
  source_table: string;
  queued: number;
  processing: number;
  linking: number;
  completed_24h: number;
  failed_24h: number;
  retry_pending: number;
}

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  const isFromCron = !!cronHeader;
  const hasValidAuth = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;

  if (!isFromCron && !hasValidAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // If called from Vercel Cron, actually process jobs (not just return status)
  // Vercel crons send GET requests, so we need to process here too
  if (isFromCron) {
    return processJobs(request);
  }

  // For manual GET requests with auth, return status
  try {
    const dashboard = await queryRows<DashboardRow>(
      "SELECT * FROM trapper.v_processing_dashboard ORDER BY queued DESC"
    );

    const totalQueued = dashboard.reduce((sum, row) => sum + Number(row.queued || 0), 0);

    return NextResponse.json({
      status: "ok",
      queue: {
        total_queued: totalQueued,
        by_source: dashboard,
      },
      message: "Use POST to process jobs, or call from Vercel Cron",
    });
  } catch (error) {
    console.error("Error fetching processing status:", error);
    return NextResponse.json(
      { error: "Failed to fetch processing status" },
      { status: 500 }
    );
  }
}

/**
 * Shared processing logic for both GET (cron) and POST (manual) requests
 */
async function processJobs(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();
  const MAX_DURATION = 55000; // 55 seconds (leave 5s buffer before 60s timeout)
  const BATCH_SIZE = 500;

  const results: ProcessResult[] = [];
  let totalProcessed = 0;

  try {
    // Process jobs until time limit or no more jobs
    while (Date.now() - startTime < MAX_DURATION) {
      const result = await queryOne<ProcessResult>(
        "SELECT * FROM trapper.process_next_job($1)",
        [BATCH_SIZE]
      );

      if (!result || result.status === "no_jobs") {
        break;
      }

      results.push(result);
      totalProcessed++;

      // Log each completed job
      if (result.status === "completed") {
        console.log(
          `Processed job ${result.job_id}: ${result.source_system}/${result.source_table}`
        );
      } else if (result.status === "failed") {
        console.error(
          `Failed job ${result.job_id}: ${result.error}`
        );
      }
    }

    // Get final queue status
    const dashboard = await queryRows<DashboardRow>(
      "SELECT * FROM trapper.v_processing_dashboard ORDER BY queued DESC"
    );

    const totalQueued = dashboard.reduce((sum, row) => sum + Number(row.queued || 0), 0);

    return NextResponse.json({
      success: true,
      jobs_processed: totalProcessed,
      duration_ms: Date.now() - startTime,
      results: results.map((r) => ({
        job_id: r.job_id,
        source: `${r.source_system}/${r.source_table}`,
        status: r.status,
        linking: r.linking_results,
        error: r.error,
      })),
      queue_remaining: totalQueued,
    });
  } catch (error) {
    console.error("Processing error:", error);
    return NextResponse.json(
      {
        error: "Processing failed",
        details: error instanceof Error ? error.message : "Unknown error",
        jobs_completed: totalProcessed,
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return processJobs(request);
}
