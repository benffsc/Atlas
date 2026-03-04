import { NextRequest } from "next/server";
import { apiSuccess, apiUnauthorized, apiServerError } from "@/lib/api-response";

/**
 * Webhook endpoint for instant Airtable sync
 *
 * Zapier can call this immediately after creating a record in Airtable
 * to trigger an instant sync to Atlas.
 *
 * Setup in Zapier:
 * 1. After "Create Record in Airtable" step
 * 2. Add "Webhooks by Zapier" action
 * 3. Choose "POST"
 * 4. URL: https://your-domain.vercel.app/api/webhooks/airtable-submission
 * 5. Headers: Authorization: Bearer YOUR_WEBHOOK_SECRET
 * 6. Body: { "record_id": "{{airtable_record_id}}" } (optional)
 */

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || process.env.CRON_SECRET;

export async function POST(request: NextRequest) {
  // Verify webhook secret
  const authHeader = request.headers.get("authorization");

  if (WEBHOOK_SECRET && authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
    return apiUnauthorized("Unauthorized");
  }

  try {
    // Trigger the airtable sync endpoint
    const baseUrl = request.nextUrl.origin;
    const syncUrl = `${baseUrl}/api/cron/airtable-sync`;

    const syncResponse = await fetch(syncUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Pass through auth if we have a CRON_SECRET
        ...(process.env.CRON_SECRET && {
          Authorization: `Bearer ${process.env.CRON_SECRET}`,
        }),
      },
    });

    const syncResult = await syncResponse.json();

    return apiSuccess({
      message: "Sync triggered",
      sync_result: syncResult,
      triggered_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Webhook sync error:", error);
    return apiServerError("Sync failed");
  }
}

// Also support GET for testing
export async function GET() {
  return apiSuccess({
    endpoint: "airtable-submission webhook",
    usage: "POST to trigger immediate Airtable sync",
    auth: "Include Authorization: Bearer YOUR_SECRET header",
  });
}
