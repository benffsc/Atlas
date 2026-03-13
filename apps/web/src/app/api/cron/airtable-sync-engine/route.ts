import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiError, apiServerError } from "@/lib/api-response";
import { AirtableSyncEngine, SyncRunResult } from "@/lib/airtable-sync-engine";

/**
 * Generic Airtable Sync Engine Cron (FFS-507)
 *
 * Single cron that processes ALL active, non-legacy sync configs.
 * Replaces the need for per-sync cron routes.
 *
 * Vercel Cron: { "path": "/api/cron/airtable-sync-engine", "schedule": "0/15 * * * *" }
 *
 * Auth: Vercel cron header or Bearer CRON_SECRET
 */

export const maxDuration = 120;

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  return handleSync(request);
}

export async function POST(request: NextRequest) {
  return handleSync(request);
}

async function handleSync(request: NextRequest) {
  // Auth: Vercel cron header or Bearer token
  const cronHeader = request.headers.get("x-vercel-cron");
  const authHeader = request.headers.get("authorization");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  try {
    // Fetch all active, non-legacy configs
    const configs = await queryRows<{ config_id: string; name: string }>(
      `SELECT config_id, name
       FROM ops.airtable_sync_configs
       WHERE is_active = TRUE AND is_legacy = FALSE
       ORDER BY name`
    );

    if (configs.length === 0) {
      return apiSuccess({
        message: "No active sync configs to process",
        runs: [],
      });
    }

    const engine = new AirtableSyncEngine();
    const runs: SyncRunResult[] = [];

    // Process each config sequentially (avoids Airtable rate limits)
    for (const config of configs) {
      try {
        const result = await engine.runSync(config.config_id, "cron");
        runs.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[SYNC-CRON] Failed to run "${config.name}":`, msg);
        runs.push({
          configName: config.name,
          triggerType: "cron",
          recordsFound: 0,
          recordsSynced: 0,
          recordsErrored: 0,
          durationMs: 0,
          results: [],
          error: msg,
        });
      }
    }

    const totalSynced = runs.reduce((sum, r) => sum + r.recordsSynced, 0);
    const totalErrors = runs.reduce((sum, r) => sum + r.recordsErrored, 0);

    return apiSuccess({
      message: `Processed ${configs.length} configs: ${totalSynced} synced, ${totalErrors} errors`,
      configs_processed: configs.length,
      total_synced: totalSynced,
      total_errors: totalErrors,
      runs: runs.map((r) => ({
        config: r.configName,
        synced: r.recordsSynced,
        errors: r.recordsErrored,
        duration_ms: r.durationMs,
        error: r.error || null,
      })),
    });
  } catch (error) {
    console.error("[SYNC-CRON] Fatal error:", error);
    return apiServerError("Airtable sync engine cron failed");
  }
}
