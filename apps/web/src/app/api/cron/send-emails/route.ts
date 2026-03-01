import { NextRequest } from "next/server";
import { getPendingOutOfCountyEmails, sendOutOfCountyEmail } from "@/lib/email";
import { apiSuccess, apiServerError, apiError } from "@/lib/api-response";

// Email Sending Cron Job
//
// Processes pending out-of-county emails. Run every hour or as needed.
//
// Vercel Cron: Add to vercel.json:
//   "crons": [{ "path": "/api/cron/send-emails", "schedule": "0 8 * * *" }]

export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  // Check if email is configured
  if (!process.env.RESEND_API_KEY) {
    return apiServerError("RESEND_API_KEY not configured");
  }

  const startTime = Date.now();

  try {
    // Get pending out-of-county emails
    const pending = await getPendingOutOfCountyEmails();

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

    // Send each email
    for (const submission of pending) {
      const result = await sendOutOfCountyEmail(submission.submission_id);

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
