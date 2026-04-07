/**
 * POST /api/admin/email-settings/test-send
 *
 * Body: { template_key?: string }   (defaults to 'out_of_service_area')
 *
 * Sends ONE manual test email to the configured test recipient (default
 * ben@forgottenfelines.com). This is the prerequisite step for enabling
 * Go Live — it forces Ben to verify deliverability end-to-end before
 * production emails can flow.
 *
 * IMPORTANT: this endpoint TEMPORARILY bypasses the global dry-run flag
 * by reading the template + sending directly through Resend, but ONLY
 * to the test recipient address. It does NOT bypass the assertOutOfAreaLive
 * gate — that's only checked by the cron + send-out-of-service-area route.
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
import { queryOne } from "@/lib/db";
import { Resend } from "resend";
import {
  getOrgEmailFrom,
  getOrgName,
  getOrgNameShort,
  getOrgPhone,
  getOrgWebsite,
  getOrgSupportEmail,
  getOrgAddress,
  getOrgLogoUrl,
  getOrgAnniversaryBadgeUrl,
} from "@/lib/org-config";
import { getServiceAreaName } from "@/lib/geo-config";
import { getEmailTemplate } from "@/lib/email";
import { renderCountyResources } from "@/lib/email-resource-renderer";

const TEST_RECIPIENT_DEFAULT = "ben@forgottenfelines.com";

function replacePlaceholders(
  template: string,
  values: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(
      new RegExp(`\\{\\{${key}\\}\\}`, "g"),
      value || ""
    );
  }
  return result;
}

export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") {
    return apiForbidden("Only admins can send test emails");
  }

  if (!process.env.RESEND_API_KEY) {
    return apiServerError("RESEND_API_KEY not configured");
  }

  try {
    const body = await request.json().catch(() => ({}));
    const templateKey =
      (body as { template_key?: string }).template_key ?? "out_of_service_area";

    const testRecipient =
      process.env.EMAIL_TEST_RECIPIENT_OVERRIDE || TEST_RECIPIENT_DEFAULT;

    const template = await getEmailTemplate(templateKey);
    if (!template) {
      return apiBadRequest(`Template not found or inactive: ${templateKey}`);
    }

    // Render with sample data — Marin County so we exercise the resource
    // renderer path the same way the real flow would.
    const resources = await renderCountyResources("Marin");
    const [
      brandFullName,
      brandName,
      orgPhone,
      orgEmail,
      orgWebsite,
      orgAddress,
      orgLogoUrl,
      orgAnniversaryBadgeUrl,
      serviceAreaName,
    ] = await Promise.all([
      getOrgName(),
      getOrgNameShort(),
      getOrgPhone(),
      getOrgSupportEmail(),
      getOrgWebsite(),
      getOrgAddress(),
      getOrgLogoUrl(),
      getOrgAnniversaryBadgeUrl(),
      getServiceAreaName(),
    ]);

    const placeholders: Record<string, string> = {
      first_name: "Ben (TEST)",
      detected_county: "Marin",
      service_area_name: serviceAreaName,
      brand_name: brandName,
      brand_full_name: brandFullName,
      org_phone: orgPhone,
      org_email: orgEmail,
      org_address: orgAddress,
      org_website: orgWebsite,
      org_logo_url: orgLogoUrl,
      org_anniversary_badge_url: orgAnniversaryBadgeUrl,
      nearest_county_resources_html: resources.countyHtml,
      statewide_resources_html: resources.statewideHtml,
      nearest_county_resources_text: resources.countyText,
      statewide_resources_text: resources.statewideText,
    };

    const subject = `[TEST SEND] ${replacePlaceholders(template.subject, placeholders)}`;
    const bodyHtml = replacePlaceholders(template.body_html, placeholders);
    const bodyText = template.body_text
      ? replacePlaceholders(template.body_text, placeholders)
      : undefined;

    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromAddress = await getOrgEmailFrom();
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: testRecipient,
      subject,
      html: bodyHtml,
      text: bodyText,
    });

    if (error) {
      // Log failure
      await queryOne(
        `INSERT INTO ops.sent_emails
           (template_key, recipient_email, recipient_name, subject_rendered,
            body_html_rendered, body_text_rendered, status, error_message,
            sent_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'failed', $7, NULL, $8)
         RETURNING email_id`,
        [
          templateKey,
          testRecipient,
          "Ben (TEST)",
          subject,
          bodyHtml,
          bodyText || null,
          error.message,
          session.staff_id,
        ]
      );
      return apiServerError(`Test send failed: ${error.message}`);
    }

    // Log success — this is the row that gates Go Live
    const row = await queryOne<{ email_id: string }>(
      `INSERT INTO ops.sent_emails
         (template_key, recipient_email, recipient_name, subject_rendered,
          body_html_rendered, body_text_rendered, status, external_id,
          sent_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7, NOW(), $8)
       RETURNING email_id`,
      [
        templateKey,
        testRecipient,
        "Ben (TEST)",
        subject,
        bodyHtml,
        bodyText || null,
        data?.id ?? null,
        session.staff_id,
      ]
    );

    return apiSuccess({
      success: true,
      message: `Test email sent to ${testRecipient}`,
      recipient: testRecipient,
      email_id: row?.email_id,
      external_id: data?.id,
    });
  } catch (err) {
    console.error("test-send error:", err);
    return apiServerError(
      err instanceof Error ? err.message : "Failed to send test email"
    );
  }
}
