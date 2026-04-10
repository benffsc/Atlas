import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api-response";
import { findPendingDates, runCdsAi, type CdsAiRunResult } from "@/lib/cds-ai";

/**
 * CDS-AI Classification Cron
 *
 * Finds clinic dates with pending evidence segments and runs the
 * classify → chunk → match pipeline. Time-budgeted to stay within
 * Vercel's 300s limit. Partial dates resume on the next tick.
 *
 * Schedule: every 4 hours at :45 — runs after SharePoint sync (:00)
 * and DQ checks (:30).
 *
 * Linear: FFS-1219
 */

export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;
const TIME_BUDGET_MS = 250_000; // Stop at 250s to leave margin for response

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return apiError("ANTHROPIC_API_KEY not configured", 500);
  }

  const startTime = Date.now();
  const logs: string[] = [];
  const log = (msg: string) => {
    logs.push(msg);
    console.log(`[cds-ai-classify] ${msg}`);
  };

  try {
    // Find up to 2 dates with pending work
    const pendingDates = await findPendingDates(2);

    if (pendingDates.length === 0) {
      log("No pending dates found.");
      return apiSuccess({ dates_processed: 0, message: "No pending work" });
    }

    log(`Found ${pendingDates.length} pending date(s): ${pendingDates.join(", ")}`);

    const results: CdsAiRunResult[] = [];
    let remainingBudget = TIME_BUDGET_MS;

    for (const date of pendingDates) {
      if (remainingBudget < 30_000) {
        log(`Insufficient time budget (${Math.round(remainingBudget / 1000)}s) — deferring ${date}`);
        break;
      }

      const result = await runCdsAi(date, {
        apply: true,
        timeBudgetMs: remainingBudget,
        log,
      });

      results.push(result);
      remainingBudget = TIME_BUDGET_MS - (Date.now() - startTime);

      log(`${date}: classified=${result.classified}, chunks=${result.chunks_formed}, matched=${result.matched}/${result.matched + result.unmatched}${result.stopped_early ? " (stopped early)" : ""}`);
    }

    return apiSuccess({
      dates_processed: results.length,
      results: results.map((r) => ({
        date: r.date,
        segments_total: r.segments_total,
        classified: r.classified,
        chunks_formed: r.chunks_formed,
        matched: r.matched,
        unmatched: r.unmatched,
        agreements: r.agreements,
        disagreements: r.disagreements,
        elapsed_ms: r.elapsed_ms,
        stopped_early: r.stopped_early,
      })),
      total_elapsed_ms: Date.now() - startTime,
    });
  } catch (err) {
    console.error("[cds-ai-classify] error:", err);
    return apiError(
      err instanceof Error ? err.message : "CDS-AI cron failed",
      500,
      { logs }
    );
  }
}
