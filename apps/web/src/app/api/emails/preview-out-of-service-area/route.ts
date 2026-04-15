/**
 * GET /api/emails/preview-out-of-service-area?submission_id=...
 *
 * FFS-1187 (Phase 4). Preview-only — never sends, never logs.
 *
 * Returns the rendered HTML + subject + plain-text body that would be
 * sent for the given submission, by:
 *   1. Loading the submission
 *   2. Loading the out_of_service_area template
 *   3. Rendering dynamic resource cards via lib/email-resource-renderer
 *   4. Substituting all placeholders
 *
 * The intake UI displays the HTML inside a sandboxed iframe.
 *
 * NOT gated by assertOutOfAreaLive() — preview is always available
 * so staff can review before approving.
 */

import { NextRequest } from "next/server";
import {
  apiSuccess,
  apiBadRequest,
  apiNotFound,
  apiServerError,
} from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";
import { queryOne } from "@/lib/db";
import { getEmailTemplate } from "@/lib/email";
import { renderCountyResources } from "@/lib/email-resource-renderer";
import { buildOrgRenderContext } from "@/lib/email-render-context";
import { requireAuth, AuthError } from "@/lib/auth";

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

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);

    const submissionId = request.nextUrl.searchParams.get("submission_id");
    if (!submissionId) return apiBadRequest("submission_id is required");
    requireValidUUID(submissionId, "submission");

    const submission = await queryOne<{
      submission_id: string;
      first_name: string | null;
      email: string | null;
      county: string | null;
      service_area_status: string | null;
    }>(
      `SELECT submission_id, first_name, email, county, service_area_status
         FROM ops.intake_submissions
        WHERE submission_id = $1`,
      [submissionId]
    );
    if (!submission) return apiNotFound("submission", submissionId);

    const template = await getEmailTemplate("out_of_service_area");
    if (!template) {
      return apiBadRequest(
        "Template 'out_of_service_area' not found or inactive — run MIG_3060"
      );
    }

    const resources = await renderCountyResources(submission.county);

    // FFS-1181 follow-up Phase 2/6: shared org render context.
    const placeholders: Record<string, string> = {
      ...(await buildOrgRenderContext()),
      first_name: submission.first_name || "there",
      detected_county: submission.county || "your area",
      nearest_county_resources_html: resources.countyHtml,
      nearby_resources_html: resources.nearbyHtml,
      statewide_resources_html: resources.statewideHtml,
      nearest_county_resources_text: resources.countyText,
      nearby_resources_text: resources.nearbyText,
      statewide_resources_text: resources.statewideText,
      // Preview-safe stub for unsubscribe URL — avoids minting a real
      // token just for staff review.
      unsubscribe_url: "#preview-no-unsubscribe",
    };

    const subject = replacePlaceholders(template.subject, placeholders);
    const bodyHtml = replacePlaceholders(template.body_html, placeholders);
    const bodyText = template.body_text
      ? replacePlaceholders(template.body_text, placeholders)
      : null;

    return apiSuccess({
      submission_id: submissionId,
      recipient: {
        email: submission.email,
        name: submission.first_name,
        county: submission.county,
        service_area_status: submission.service_area_status,
      },
      template_key: "out_of_service_area",
      subject,
      body_html: bodyHtml,
      body_text: bodyText,
      resource_count: resources.rows.length,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return apiServerError(err.message);
    }
    console.error("preview-out-of-service-area error:", err);
    return apiServerError(
      err instanceof Error ? err.message : "Failed to render preview"
    );
  }
}
