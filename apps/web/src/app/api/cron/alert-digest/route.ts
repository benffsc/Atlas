import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiServerError, apiError } from "@/lib/api-response";
import { getServerConfig } from "@/lib/server-config";
import { sendTemplateEmail } from "@/lib/email";

// Alert Digest Cron Job
//
// Sends a daily email digest of alerts from ops.alert_queue.
// Uses the existing email infrastructure (Resend + ops.email_templates).
//
// Phase 1A of long-term data strategy (FFS-897).
//
// Vercel Cron: "0 9 * * *" (daily at 9 AM, after data-quality-check runs at 6h intervals)

export const maxDuration = 30;

const CRON_SECRET = process.env.CRON_SECRET;

interface DigestRow {
  level: string;
  alert_count: number;
  alerts: Array<{
    metric: string;
    message: string;
    current_value: number | null;
    threshold_value: number | null;
    created_at: string;
  }>;
}

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  const startTime = Date.now();

  try {
    const [digestEnabled, digestRecipient] = await Promise.all([
      getServerConfig("alerts.email_digest_enabled", true),
      getServerConfig("alerts.digest_recipient", ""),
    ]);

    if (!digestEnabled) {
      return apiSuccess({
        message: "Email digest disabled via config",
        duration_ms: Date.now() - startTime,
      });
    }

    if (!digestRecipient) {
      return apiSuccess({
        message: "No digest recipient configured (set alerts.digest_recipient in app_config)",
        duration_ms: Date.now() - startTime,
      });
    }

    // Get digest data from alert queue (last 24 hours, not yet emailed)
    let digestRows: DigestRow[] = [];
    try {
      digestRows = await queryRows<DigestRow>(
        "SELECT * FROM ops.get_alert_digest(24)"
      );
    } catch {
      // MIG_2999 may not be applied yet
      return apiSuccess({
        message: "Alert digest not available (MIG_2999 not applied)",
        duration_ms: Date.now() - startTime,
      });
    }

    if (digestRows.length === 0) {
      return apiSuccess({
        message: "No alerts in last 24 hours, no digest to send",
        duration_ms: Date.now() - startTime,
      });
    }

    // Build digest content
    const criticalCount = digestRows.find(r => r.level === "critical")?.alert_count || 0;
    const warningCount = digestRows.find(r => r.level === "warning")?.alert_count || 0;
    const totalCount = digestRows.reduce((sum, r) => sum + Number(r.alert_count), 0);

    const allAlerts = digestRows.flatMap(r => r.alerts);

    // Build HTML body
    const alertRows = allAlerts.map(a => {
      const levelEmoji = a.message.includes("CRITICAL") || a.message.includes("BROKEN") ? "!!!" : "!";
      return `<tr>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${levelEmoji}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>${a.metric}</strong></td>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${a.message}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${a.current_value ?? "-"}</td>
      </tr>`;
    }).join("\n");

    const subject = criticalCount > 0
      ? `Atlas Alert Digest: ${criticalCount} Critical, ${warningCount} Warning`
      : `Atlas Alert Digest: ${warningCount} Warning`;

    const htmlBody = `
      <h2>Atlas Data Quality Alert Digest</h2>
      <p>${totalCount} alert(s) in the last 24 hours:</p>
      ${criticalCount > 0 ? `<p style="color: #dc2626; font-weight: bold;">${criticalCount} critical alert(s) require immediate attention.</p>` : ""}
      <table style="border-collapse: collapse; width: 100%;">
        <thead>
          <tr style="background: #f8f9fa;">
            <th style="padding: 8px; text-align: left;">Level</th>
            <th style="padding: 8px; text-align: left;">Metric</th>
            <th style="padding: 8px; text-align: left;">Message</th>
            <th style="padding: 8px; text-align: left;">Value</th>
          </tr>
        </thead>
        <tbody>
          ${alertRows}
        </tbody>
      </table>
      <p style="margin-top: 16px;">
        <a href="${process.env.NEXT_PUBLIC_BASE_URL || "https://atlas.forgottenfelines.org"}/admin/anomalies">
          View in Atlas
        </a>
      </p>
      <p style="color: #6b7280; font-size: 12px;">
        This digest is sent daily at 9 AM. Configure in Admin > App Config > alerts.*.
      </p>
    `;

    // Try sending via template first, fall back to direct send
    let emailSent = false;
    try {
      const result = await sendTemplateEmail({
        templateKey: "alert_digest",
        to: digestRecipient,
        placeholders: {
          subject,
          body: htmlBody,
          critical_count: String(criticalCount),
          warning_count: String(warningCount),
          total_count: String(totalCount),
        },
        sentBy: "alert_digest_cron",
      });
      emailSent = result.success;
    } catch {
      // Template may not exist — that's OK, we tried
    }

    // If template doesn't exist, send via Resend directly
    if (!emailSent && process.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        const from = process.env.EMAIL_FROM || "Atlas <alerts@forgottenfelines.org>";

        await resend.emails.send({
          from,
          to: digestRecipient,
          subject,
          html: htmlBody,
        });
        emailSent = true;
      } catch (e) {
        console.error("Direct email send failed:", e);
      }
    }

    // Mark alerts as email-notified
    if (emailSent) {
      try {
        await queryOne("SELECT ops.mark_alerts_email_notified(24)");
      } catch {
        // Non-fatal
      }
    }

    return apiSuccess({
      message: emailSent
        ? `Digest sent to ${digestRecipient} (${totalCount} alerts)`
        : "Failed to send digest email",
      email_sent: emailSent,
      recipient: digestRecipient,
      alerts: {
        critical: criticalCount,
        warning: warningCount,
        total: totalCount,
      },
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Alert digest error:", error);
    return apiServerError(error instanceof Error ? error.message : "Alert digest failed");
  }
}

// POST endpoint for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
