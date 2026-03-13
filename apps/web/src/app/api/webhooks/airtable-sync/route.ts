import { NextRequest } from "next/server";
import { apiSuccess, apiError, apiServerError } from "@/lib/api-response";
import { AirtableSyncEngine } from "@/lib/airtable-sync-engine";

/**
 * Generic Airtable Sync Webhook (FFS-507)
 *
 * Trigger any sync config by name or ID:
 *   POST /api/webhooks/airtable-sync?config=trapper-agreement
 *   POST /api/webhooks/airtable-sync?config=<uuid>
 *
 * Auth: Bearer token via WEBHOOK_SECRET or CRON_SECRET
 *
 * Airtable automation script:
 *   await fetch('https://YOUR_DOMAIN/api/webhooks/airtable-sync?config=CONFIG_NAME', {
 *     method: 'POST',
 *     headers: { 'Authorization': 'Bearer YOUR_SECRET' }
 *   });
 */

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || process.env.CRON_SECRET;

export async function POST(request: NextRequest) {
  // Auth
  const authHeader = request.headers.get("authorization");
  if (WEBHOOK_SECRET && authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  const configParam = request.nextUrl.searchParams.get("config");
  if (!configParam) {
    return apiError("Missing required query parameter: config (name or UUID)", 400);
  }

  try {
    const engine = new AirtableSyncEngine();

    // Detect UUID vs name
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(configParam);
    const result = isUuid
      ? await engine.runSync(configParam, "webhook")
      : await engine.runSyncByName(configParam, "webhook");

    return apiSuccess({
      message: `Synced ${result.recordsSynced} records, ${result.recordsErrored} errors`,
      ...result,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("not found")) {
      return apiError(msg, 404);
    }
    if (msg.includes("AIRTABLE_PAT")) {
      return apiError(msg, 503);
    }
    console.error("[WEBHOOK] Airtable sync error:", error);
    return apiServerError("Webhook sync failed");
  }
}
