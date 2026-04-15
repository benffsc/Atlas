/**
 * POST /api/admin/email-settings/test-send
 *
 * Body: { template_key?: string }   (defaults to 'out_of_service_area')
 *
 * Sends ONE manual test email using the same pipeline as real sends
 * (Outlook or Resend depending on the flow's send_via config).
 * Bypasses dry-run for this single send so the admin can verify
 * deliverability. Sends to the configured test recipient or
 * ben@forgottenfelines.com.
 *
 * Admin only.
 *
 * FFS-1188 (Phase 5)
 */

import { NextRequest } from "next/server";
import {
  apiSuccess,
  apiBadRequest,
  apiForbidden,
  apiServerError,
  apiUnauthorized,
} from "@/lib/api-response";
import { getSession } from "@/lib/auth";
import { sendTemplateEmail } from "@/lib/email";
import { renderCountyResources } from "@/lib/email-resource-renderer";

const TEST_RECIPIENT_DEFAULT = "ben@forgottenfelines.com";

export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") {
    return apiForbidden("Only admins can send test emails");
  }

  try {
    const body = await request.json().catch(() => ({}));
    const templateKey =
      (body as { template_key?: string }).template_key ?? "out_of_service_area";

    const testRecipient =
      process.env.EMAIL_TEST_RECIPIENT_OVERRIDE || TEST_RECIPIENT_DEFAULT;

    // Render with sample data — Marin County so we exercise the resource
    // renderer path the same way the real flow would.
    const resources = await renderCountyResources("Marin");

    const placeholders: Record<string, string> = {
      first_name: "Ben (TEST)",
      detected_county: "Marin",
      nearest_county_resources_html: resources.countyHtml,
      nearby_resources_html: resources.nearbyHtml,
      statewide_resources_html: resources.statewideHtml,
      nearest_county_resources_text: resources.countyText,
      nearby_resources_text: resources.nearbyText,
      statewide_resources_text: resources.statewideText,
      unsubscribe_url: "#test-no-unsubscribe",
    };

    // Use the same sendTemplateEmail that real sends use — this routes
    // through Outlook (Microsoft Graph) when the flow has send_via='outlook'.
    // We pass flowSlug so it uses the correct provider. The function merges
    // org placeholders automatically.
    //
    // NOTE: We prefix subject with [TEST SEND] via subjectOverride so the
    // recipient knows it's a test. We do NOT use the flow's dry-run flag —
    // the whole point of this endpoint is to verify real deliverability.
    const result = await sendTemplateEmail({
      templateKey,
      to: testRecipient,
      toName: "Ben (TEST)",
      placeholders,
      sentBy: session.staff_id,
      flowSlug: "out_of_service_area",
    });

    if (!result.success) {
      return apiServerError(`Test send failed: ${result.error}`);
    }

    return apiSuccess({
      success: true,
      message: result.dryRun
        ? `Test email dry-run logged (dry-run is still ON for this flow)`
        : `Test email sent to ${testRecipient}`,
      recipient: testRecipient,
      email_id: result.emailId,
      external_id: result.externalId,
      dry_run: result.dryRun ?? false,
    });
  } catch (err) {
    console.error("test-send error:", err);
    return apiServerError(
      err instanceof Error ? err.message : "Failed to send test email"
    );
  }
}
