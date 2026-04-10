import { NextRequest } from "next/server";
import {
  getPendingOutOfServiceAreaEmails,
  sendOutOfServiceAreaEmail,
} from "@/lib/email";
import { apiSuccess, apiServerError, apiError } from "@/lib/api-response";
import {
  assertOutOfAreaLive,
  OutOfAreaPipelineDisabledError,
} from "@/lib/email-safety";
import { getFlow } from "@/lib/email-flows";

// Email Sending Cron Job
//
// Processes pending out-of-county emails. Run every hour or as needed.
//
// Vercel Cron: Add to vercel.json:
//   "crons": [{ "path": "/api/cron/send-emails", "schedule": "0 8 * * *" }]
//
// FFS-1182: This cron is GATED by assertOutOfAreaLive(). Until both
// EMAIL_OUT_OF_AREA_LIVE=true (env) and email.out_of_area.live=true (DB)
// are set, every invocation returns 503. See lib/email-safety.ts.

export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  // FFS-1182 Phase 0: hard-fail until Go Live
  try {
    await assertOutOfAreaLive();
  } catch (err) {
    if (err instanceof OutOfAreaPipelineDisabledError) {
      return apiError(err.message, 503, { reason: err.reason });
    }
    throw err;
  }

  // Check if an email provider is configured. Flows that send via
  // Outlook (Microsoft Graph app permissions) don't need RESEND_API_KEY.
  const outOfAreaFlow = await getFlow("out_of_service_area");
  if (outOfAreaFlow?.send_via !== "outlook" && !process.env.RESEND_API_KEY) {
    return apiServerError("RESEND_API_KEY not configured (and flow is not set to send via Outlook)");
  }

  const startTime = Date.now();

  try {
    // Get pending out-of-service-area emails (FFS-1186)
    const pending = await getPendingOutOfServiceAreaEmails();

    if (pending.length === 0) {
      return apiSuccess({
        message: "No pending emails to send",
        sent: 0,
        failed: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    let sentCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    // Send each email. The view only returns rows already approved by staff;
    // sendOutOfServiceAreaEmail's second arg is `sentBy` (recorded on
    // ops.sent_emails.created_by), so we record this batch as the cron.
    for (const submission of pending) {
      const result = await sendOutOfServiceAreaEmail(
        submission.submission_id,
        "out_of_service_area_cron"
      );

      if (result.success) {
        sentCount++;
      } else {
        failedCount++;
        errors.push(`${submission.submission_id}: ${result.error}`);
      }

      // Rate limit - 100ms between emails
      await new Promise((r) => setTimeout(r, 100));
    }

    return apiSuccess({
      message: `Sent ${sentCount} emails, ${failedCount} failed`,
      sent: sentCount,
      failed: failedCount,
      errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Email cron error:", error);
    return apiServerError(error instanceof Error ? error.message : "Email sending failed");
  }
}

// POST endpoint for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
