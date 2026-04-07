import { NextRequest } from "next/server";
import { sendOutOfCountyEmail } from "@/lib/email";
import {
  apiSuccess,
  apiBadRequest,
  apiError,
  apiServerError,
} from "@/lib/api-response";
import {
  assertOutOfAreaLive,
  OutOfAreaPipelineDisabledError,
} from "@/lib/email-safety";

// Send out-of-county email for a specific submission
// POST /api/emails/send-out-of-county
// Body: { submission_id: string }
//
// FFS-1182: Gated by assertOutOfAreaLive() — returns 503 until Go Live.

export async function POST(request: NextRequest) {
  try {
    // FFS-1182 Phase 0: hard-fail until Go Live
    try {
      await assertOutOfAreaLive();
    } catch (err) {
      if (err instanceof OutOfAreaPipelineDisabledError) {
        return apiError(err.message, 503, { reason: err.reason });
      }
      throw err;
    }

    const body = await request.json();
    const { submission_id } = body;

    if (!submission_id) {
      return apiBadRequest("submission_id is required");
    }

    const result = await sendOutOfCountyEmail(submission_id);

    if (result.success) {
      return apiSuccess({
        success: true,
        message: "Out-of-county email sent successfully",
        email_id: result.emailId,
        external_id: result.externalId,
      });
    } else {
      return apiBadRequest(result.error || "Failed to send email");
    }
  } catch (err) {
    console.error("Error sending out-of-county email:", err);
    return apiServerError("Failed to send email");
  }
}
