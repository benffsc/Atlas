/**
 * Slack Webhook Helper
 *
 * Simple Slack notification via incoming webhook.
 * No SDK, no subscription — just a single fetch() call.
 *
 * Configure SLACK_WEBHOOK_URL in environment variables.
 * Get webhook URL from: Slack > Apps > Incoming Webhooks > Add New Webhook
 *
 * Phase 1A of long-term data strategy (FFS-897).
 */

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

interface SlackAlert {
  level: "info" | "warning" | "critical";
  metric: string;
  message: string;
  current_value?: number | null;
  threshold_value?: number | null;
}

/**
 * Send a batch of alerts to Slack as a single message.
 * Returns true if sent successfully, false otherwise.
 */
export async function sendSlackAlerts(
  alerts: SlackAlert[]
): Promise<boolean> {
  if (!SLACK_WEBHOOK_URL) {
    console.warn("SLACK_WEBHOOK_URL not configured, skipping Slack notification");
    return false;
  }

  if (alerts.length === 0) return true;

  const criticalAlerts = alerts.filter((a) => a.level === "critical");
  const warningAlerts = alerts.filter((a) => a.level === "warning");

  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: criticalAlerts.length > 0
          ? `Atlas Alert: ${criticalAlerts.length} Critical, ${warningAlerts.length} Warning`
          : `Atlas Alert: ${warningAlerts.length} Warning`,
        emoji: true,
      },
    },
  ];

  // Critical alerts first
  for (const alert of criticalAlerts) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*CRITICAL* \`${alert.metric}\`\n${alert.message}${
          alert.current_value != null && alert.threshold_value != null
            ? `\n_Current: ${alert.current_value} | Threshold: ${alert.threshold_value}_`
            : ""
        }`,
      },
    });
  }

  // Warning alerts
  for (const alert of warningAlerts) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Warning* \`${alert.metric}\`\n${alert.message}${
          alert.current_value != null && alert.threshold_value != null
            ? `\n_Current: ${alert.current_value} | Threshold: ${alert.threshold_value}_`
            : ""
        }`,
      },
    });
  }

  // Add timestamp
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Checked at ${new Date().toISOString()} | <${process.env.NEXT_PUBLIC_BASE_URL || "https://atlas.forgottenfelines.org"}/admin/anomalies|View in Atlas>`,
      },
    ],
  });

  try {
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });

    if (!response.ok) {
      console.error("Slack webhook failed:", response.status, await response.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error("Slack webhook error:", error);
    return false;
  }
}

/**
 * Send a single text message to Slack. For simple notifications.
 */
export async function sendSlackMessage(text: string): Promise<boolean> {
  if (!SLACK_WEBHOOK_URL) {
    return false;
  }

  try {
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    return response.ok;
  } catch {
    return false;
  }
}
