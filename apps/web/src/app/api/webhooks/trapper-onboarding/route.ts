import { NextRequest } from "next/server";
import { apiSuccess, apiUnauthorized, apiServerError } from "@/lib/api-response";

/**
 * Webhook to trigger instant Community Trapper Agreement sync (FFS-474)
 *
 * Same pattern as /api/webhooks/airtable-submission:
 *   - Receives a POST (from Airtable automation or manual trigger)
 *   - Triggers /api/cron/trapper-agreement-sync which pulls pending records
 *   - The cron handles all the processing and writes back to Airtable
 *
 * You can also call the cron directly if preferred.
 *
 * Auth: Bearer token via WEBHOOK_SECRET or CRON_SECRET env var.
 */

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || process.env.CRON_SECRET;

export async function POST(request: NextRequest) {
  // Verify webhook secret
  const authHeader = request.headers.get("authorization");

  if (WEBHOOK_SECRET && authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
    return apiUnauthorized("Unauthorized");
  }

  try {
    // Trigger the trapper agreement sync endpoint
    const baseUrl = request.nextUrl.origin;
    const syncUrl = `${baseUrl}/api/cron/trapper-agreement-sync`;

    const syncResponse = await fetch(syncUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.CRON_SECRET && {
          Authorization: `Bearer ${process.env.CRON_SECRET}`,
        }),
      },
    });

    const syncResult = await syncResponse.json();

    return apiSuccess({
      message: "Trapper agreement sync triggered",
      sync_result: syncResult,
      triggered_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Trapper onboarding webhook error:", error);
    return apiServerError("Sync trigger failed");
  }
}

// GET for endpoint discovery
export async function GET() {
  return apiSuccess({
    endpoint: "trapper-onboarding webhook",
    usage: "POST to trigger immediate trapper agreement sync from Airtable",
    auth: "Include Authorization: Bearer YOUR_SECRET header",
    cron: "Or call /api/cron/trapper-agreement-sync directly",
  });
}
