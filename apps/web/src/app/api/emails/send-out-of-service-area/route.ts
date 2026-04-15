/**
 * POST /api/emails/send-out-of-service-area
 *
 * Body: { submission_id: string }
 *
 * FFS-1186 (Phase 3). Replacement for /api/emails/send-out-of-county.
 *
 * Sends the out-of-service-area resource referral email for a single
 * submission. Requires:
 *   - Authenticated staff (recorded as approved_by)
 *   - Submission already approved via the intake UI
 *   - Phase 0 safety gate passing (env + DB flags) — enforced inside
 *     sendOutOfServiceAreaEmail()
 *
 * In dry-run mode (Phase 5) the response includes `dry_run: true`
 * and the submission status is NOT transitioned to 'redirected'.
 */

import { NextRequest } from "next/server";
import { sendOutOfServiceAreaEmail } from "@/lib/email";
import {
  apiSuccess,
  apiBadRequest,
  apiError,
  apiServerError,
} from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";
import { requireAuth, AuthError } from "@/lib/auth";
import { queryOne } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    // Auth — required so we can record approved_by
    const staff = await requireAuth(request);

    const body = await request.json().catch(() => ({}));
    const { submission_id, body_html_override, subject_override } = body as {
      submission_id?: string;
      body_html_override?: string;
      subject_override?: string;
    };

    if (!submission_id) {
      return apiBadRequest("submission_id is required");
    }
    requireValidUUID(submission_id, "submission");

    // Per FFS-1186, "Approve & Send" is a single staff click. We record
    // approval immediately before delegating to sendOutOfServiceAreaEmail
    // (which requires out_of_service_area_approved_at IS NOT NULL).
    // The approve function is idempotent — returns FALSE if already approved.
    await queryOne(
      `SELECT ops.approve_out_of_service_area_email($1, $2) AS approved`,
      [submission_id, staff.staff_id]
    );

    const result = await sendOutOfServiceAreaEmail(
      submission_id,
      staff.staff_id,
      body_html_override || subject_override
        ? { bodyHtml: body_html_override, subject: subject_override }
        : undefined
    );

    if (!result.success) {
      // The function returns its own structured errors. Most are
      // client-side problems (already sent, not approved, etc.) so
      // 400 is appropriate. The 503 case (pipeline disabled) is
      // raised inside sendOutOfServiceAreaEmail and surfaced as a
      // normal error message — caller can detect by string match.
      return apiBadRequest(result.error || "Failed to send email");
    }

    return apiSuccess({
      success: true,
      message: result.dryRun
        ? "Dry-run mode — email rendered and logged but not sent"
        : "Out-of-service-area email sent successfully",
      email_id: result.emailId,
      external_id: result.externalId,
      dry_run: result.dryRun ?? false,
      test_override: result.testOverride ?? null,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return apiError(err.message, err.statusCode);
    }
    console.error("Error sending out-of-service-area email:", err);
    return apiServerError("Failed to send email");
  }
}
